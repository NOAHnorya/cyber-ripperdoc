import * as THREE from 'three';
import { loadModel, loadGltf, normalizeHeight, cloneSkinned } from './AssetLoader.js';
import { PatientAnimator, boneForSlot, boneChainForSlot } from './PatientAnimator.js';
import { makePlaceholderPatient, makePlaceholderImplant, makeRemovableCover } from './placeholders.js';
import { createCutUniforms, applyCutMaterial, applyNeonGlow } from './materials.js';
import { DOOR_Z } from './Clinic.js';

// 接诊时病人站的位置：手术台床尾、面朝医生（+Z）；进出诊所走左前方
export const STAND_POS = [0, 0, 1.6];
// 两个角度之间走最短弧插值
function lerpAngle(a, b, t) {
  const d = ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const window01 = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
// 门洞在左墙 x=-3.5、z=DOOR_Z；进出点在门里的过道中
const ENTRY_POS = [-3.95, 0, DOOR_Z];
const EXIT_POS = [-4.3, 0, DOOR_Z];
// 走路动作的原始步速（米/秒）；走得更快时按比例加快动作，脚不打滑
const WALK_CLIP_SPEED = 1.17;

// 病人离开后释放这一位占用的显存：切割材质副本、蒙皮后的义体、骨骼贴图、占位几何体。
// 几何体和贴图数据还留在内存里（资产缓存共用），再来一位同样的病人会自动重新上传，
// 不释放的话每台手术都在显存里多留一份，玩久了 GPU 进程会被浏览器杀掉。
function disposeTree(root) {
  root.traverse((obj) => {
    if (obj.isSkinnedMesh) obj.skeleton?.dispose?.();
    if (obj.geometry) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) m.dispose();
  });
}

// 病人：加载模型、走位、按部位切开、旧部件、挂义体、躺上手术台。
export class PatientRig {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'patient-rig';
    scene.add(this.root);
    this.bodyRoot = null;
    this.limbRoot = null;
    this.walk = null;
  }

  async load(patient, calibration) {
    this.clear();
    this.patient = patient;
    this.calibration = calibration;

    // 有绑好骨的版本就用它（带动捕动作），没有就用静态模型
    const rigged = patient?.rigged ? await loadGltf(patient.rigged, { quiet: true }) : null;
    // 动作可以单独放一个文件，按骨骼名字套到模型上
    const extra = rigged && patient.riggedAnims ? await loadGltf(patient.riggedAnims, { quiet: true }) : null;
    if (rigged && extra) rigged.animations = [...rigged.animations, ...extra.animations];
    let model = rigged?.scene ?? (await loadModel(patient?.model));
    this.isPlaceholder = !model;
    if (model) {
      model.updateMatrixWorld(true);
      normalizeHeight(model, patient.height_m || 1.75);
    } else model = makePlaceholderPatient(patient?.id);
    // 防止视锥剔除用绑骨姿势的包围盒把走动中的手脚裁掉
    model.traverse((o) => o.isSkinnedMesh && (o.frustumCulled = false));

    const limbModel = cloneSkinned(model);
    this.bodyRoot = new THREE.Group();
    this.bodyRoot.add(model);
    this.limbRoot = new THREE.Group();
    this.limbRoot.add(limbModel);
    this.limbRoot.visible = false;
    this.root.add(this.bodyRoot, this.limbRoot);

    this.bodyU = createCutUniforms();
    this.limbU = createCutUniforms();
    this.limbU.uCutInvert.value = 1;
    applyCutMaterial(this.bodyRoot, this.bodyU);
    applyCutMaterial(this.limbRoot, this.limbU);
    model.updateMatrix();
    limbModel.updateMatrix();
    this.bodyU.uRestMatrix.value = model.matrix;
    this.limbU.uRestMatrix.value = limbModel.matrix;

    this.sockets = {};
    for (const [slot, s] of Object.entries(calibration.slots)) {
      const socket = new THREE.Object3D();
      socket.name = `socket_${slot}`;
      socket.position.set(...s.socket.pos);
      socket.rotation.set(...s.socket.rot);
      this.bodyRoot.add(socket);
      this.sockets[slot] = socket;
    }

    // 骨骼动画；接口挂到对应的骨头上，装上的义体会跟着身体动
    this.anim = new PatientAnimator(model, rigged?.animations ?? []);
    if (this.anim.rigged) {
      this.root.updateMatrixWorld(true);
      for (const [slot, socket] of Object.entries(this.sockets)) {
        const side = patient?.sides?.[slot] ?? 'left';
        const bone = boneForSlot(this.anim.bones, slot, side, socket.getWorldPosition(new THREE.Vector3()));
        if (bone) bone.attach(socket);
      }
      console.info(`[rig] ${patient.id} 骨骼 ${this.anim.bones.length} 根，动作：${this.anim.names.join(', ') || '无'}`);
      // 髋骨在根节点坐标里的静止位置：上下手术台时按髋骨做支点
      this.hipsRestLocal = this.root.worldToLocal(this.anim.hips.getWorldPosition(new THREE.Vector3()));
      // 切下来的肢体（独立骨架，只在手术时出现）也用躺姿的脚
      limbModel.traverse((b) => {
        const q = b.isBone && this.anim.restAdjust[b.name];
        if (q) b.quaternion.copy(q);
      });
    }
    this.attached = {};
    this.cover = null;
    this.limbCenters = {};
    this.cavities = {};
    this.walkIn();
  }

  // 播放骨骼动作；没绑骨的模型直接忽略
  play(name, opts) {
    return this.anim?.play(name, opts) ?? false;
  }

  clear() {
    this.anim?.mixer?.stopAllAction();
    this.anim = null;
    this.bed = null;
    this.tweenState = null;
    this.skinned = {};
    for (const obj of [this.bodyRoot, this.limbRoot, this.cover]) {
      if (!obj) continue;
      obj.removeFromParent();
      disposeTree(obj);
    }
    this.bodyRoot = null;
    this.limbRoot = null;
    this.cover = null;
    this.attached = {};
  }

  // 从门口走到床尾，最后转身面向医生
  walkIn() {
    this.root.rotation.set(0, 0, 0);
    this.transfer = null;
    this.root.position.set(...ENTRY_POS);
    const dist = new THREE.Vector3(...ENTRY_POS).distanceTo(new THREE.Vector3(...STAND_POS));
    const speed = 1.4;
    // 先直着出门，再拐向医生（弧线控制点在门外）
    const ctrl = [ENTRY_POS[0] + 1.6, 0, ENTRY_POS[2] + 0.1];
    this.walk = this.makeWalk(ENTRY_POS, STAND_POS, this.anim?.has('walk') ? (dist * 1.1) / speed : 1.5, true, { ctrl });
    this.play('walk', { fade: 0.01, timeScale: speed / WALK_CLIP_SPEED });
  }

  // faceFront：走到后转身面向医生；endYaw：走到后转到这个朝向；ctrl：绕开障碍物的弧线控制点
  makeWalk(from, to, dur, faceFront, { endYaw = faceFront ? 0 : null, ctrl = null } = {}) {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const c = ctrl ? new THREE.Vector3(...ctrl) : null;
    const first = c ?? b;
    const heading = Math.atan2(first.x - a.x, first.z - a.z);
    return { a, b, c, heading, faceFront, endYaw, startYaw: this.root.rotation.y, t: 0, dur };
  }

  // 走到某处（可选弧线、到达后的朝向），走完 resolve
  walkTo(to, { dur, endYaw = null, ctrl = null } = {}) {
    const from = this.root.position.toArray();
    from[1] = 0;
    const len = new THREE.Vector3(...from).distanceTo(new THREE.Vector3(...to)) * (ctrl ? 1.15 : 1);
    return new Promise((resolve) => {
      this.walk = { ...this.makeWalk(from, to, dur ?? Math.max(0.8, len / 1.15), false, { endYaw, ctrl }), then: resolve };
      this.play('walk', { fade: 0.3 });
    });
  }

  // 等走位动画结束（手术镜头要按病人站定后的位置取景）
  waitWalk() {
    if (!this.walk) return Promise.resolve();
    return new Promise((resolve) => {
      const prev = this.walk.then;
      this.walk.then = () => {
        prev?.();
        resolve();
      };
    });
  }

  walkOut() {
    this.root.rotation.set(0, this.root.rotation.y, 0);
    const from = this.root.position.toArray();
    from[1] = 0;
    const speed = 1.4;
    const dist = new THREE.Vector3(...from).distanceTo(new THREE.Vector3(...EXIT_POS));
    const dur = this.anim?.has('walk') ? (dist * 1.1) / speed : 1.4;
    // 先朝门走，最后一段直着进门洞
    const ctrl = [EXIT_POS[0] + 1.9, 0, EXIT_POS[2] - 0.05];
    this.walk = { ...this.makeWalk(from, EXIT_POS, dur, false, { ctrl }), then: () => this.clear() };
    this.play('walk', { fade: 0.35, timeScale: speed / WALK_CLIP_SPEED });
    return new Promise((resolve) => setTimeout(resolve, dur * 1000 + 50));
  }

  // 磁悬浮转运：病人被托起、向后放平、落到手术台上（反过来就是扶起站好）。
  // 整个根节点一起动，可拆的肢体、接口和义体都跟着走。
  moveTo(position, rotationX, dur = 1.6, lift = 0.32) {
    return new Promise((resolve) => {
      this.transfer = {
        fromPos: this.root.position.clone(),
        toPos: new THREE.Vector3(...position),
        fromRot: this.root.rotation.x,
        toRot: rotationX,
        lift,
        t: 0,
        dur,
        resolve,
      };
    });
  }

  // 上手术台：走到床边 -> 背对床坐上床沿 -> 以髋为支点向后躺平、腿收上床，
  // 同时身体松弛回绑骨姿势（手术按这个姿势标定，躺平那一刻和以前完全一样）
  async layDown(pose) {
    if (!this.anim?.has('sit') || !this.hipsRestLocal) {
      this.play('rest', { fade: 0.9 });
      return this.moveTo(pose.position, pose.rotationX);
    }
    const plan = this.bedPlan(pose);
    this.bed = plan;
    // 绕开床尾的弧线走到床边，最后背对手术台
    await this.walkTo(plan.side.toArray(), { endYaw: plan.yaw, ctrl: [plan.side.x + 0.3, 0, (plan.side.z + STAND_POS[2]) / 2 + 0.25] });
    await this.sitOnEdge(plan);
    await this.pivotHips(plan.hipsSit, plan.qSit, plan.hipsLie, plan.qLie, 1.7, () => this.play('rest', { fade: 1.35 }));
    this.root.position.set(...pose.position);
    this.root.rotation.set(pose.rotationX, 0, 0);
  }

  // 下手术台：坐起到床沿 -> 跳下来站好 -> 走回医生面前
  async standUp() {
    const plan = this.bed;
    if (!plan || !this.anim?.has('stand')) {
      this.play('idle', { fade: 1.0 });
      return this.moveTo(STAND_POS, 0);
    }
    await this.pivotHips(plan.hipsLie, plan.qLie, plan.hipsSit, plan.qSit, 1.5, () => this.anim.hold('sit', { fade: 1.2 }));
    await this.hopOff(plan);
    await this.walkTo(STAND_POS, { endYaw: 0, ctrl: [plan.side.x + 0.35, 0, (plan.side.z + STAND_POS[2]) / 2 + 0.2] });
    this.play('idle', { fade: 0.45 });
    this.bed = null;
  }

  // 床的几何（世界坐标）：躺平时髋的位置、坐床沿时髋的位置、站在床边的位置
  bedPlan(pose) {
    const qLie = new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.rotationX, 0, 0));
    const hipsLie = this.hipsRestLocal.clone().applyQuaternion(qLie).add(new THREE.Vector3(...pose.position));
    // 床垫右沿（+X），避开腰部两侧的扶手，坐在大腿那一段
    const hipsSit = new THREE.Vector3(hipsLie.x + 0.13, hipsLie.y - 0.09, hipsLie.z + 0.5);
    const yaw = Math.PI / 2; // 背对床、面朝 +X
    const qSit = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    const side = new THREE.Vector3(hipsSit.x + 0.36, 0, hipsSit.z);
    // 坐姿最后一帧髋骨在根节点里的高度 -> 坐上去时根节点要抬多高（脚悬空）
    const k = this.hipsRestLocal.y / Math.max(1e-6, this.anim.hipsRestUp);
    const sitHipsLocalY = this.anim.clipHipsUp('sit', true) * k;
    const seatLift = Math.max(0, hipsSit.y - sitHipsLocalY);
    return { pose, qLie, hipsLie, hipsSit, yaw, qSit, side, seatLift };
  }

  // 坐上床沿：播"站→坐"，中段一撑跳上去，根节点后移到床沿
  sitOnEdge(plan) {
    this.play('sit', { once: true, then: null, fade: 0.3 });
    const dur = this.anim.clips.sit.duration;
    const from = this.root.position.clone();
    const to = new THREE.Vector3(plan.hipsSit.x, plan.seatLift, plan.hipsSit.z);
    return this.tween(dur, (t) => {
      const h = ease(window01(t, 0.18, 0.62));
      const x = ease(window01(t, 0.1, 0.7));
      this.root.position.set(from.x + (to.x - from.x) * x, to.y * h, from.z + (to.z - from.z) * x);
      this.root.rotation.set(0, plan.yaw, 0);
    });
  }

  // 跳下床：播"坐→站"，开头一撑落地，往外走半步
  hopOff(plan) {
    this.play('stand', { once: true, then: null, fade: 0.35 });
    const dur = this.anim.clips.stand.duration * 0.92;
    const from = this.root.position.clone();
    const to = plan.side.clone();
    return this.tween(dur, (t) => {
      const h = ease(window01(t, 0.05, 0.4));
      const x = ease(window01(t, 0.05, 0.55));
      this.root.position.set(from.x + (to.x - from.x) * x, from.y * (1 - h), from.z + (to.z - from.z) * x);
      this.root.rotation.set(0, plan.yaw, 0);
    });
  }

  // 以髋骨为支点转动全身：髋从 h0 移到 h1、朝向从 q0 转到 q1（姿势同时交叉淡入）
  pivotHips(h0, q0, h1, q1, dur, onStart) {
    onStart?.();
    const q = new THREE.Quaternion();
    const hips = new THREE.Vector3();
    const local = new THREE.Vector3();
    return this.tween(dur, (t) => {
      const e = ease(t);
      q.slerpQuaternions(q0, q1, e);
      hips.lerpVectors(h0, h1, e);
      hips.y += Math.sin(Math.PI * e) * 0.05;
      // 当前姿势下髋骨在根节点里的位置（坐姿和躺姿不一样）
      this.root.updateMatrixWorld(true);
      local.copy(this.root.worldToLocal(this.anim.hips.getWorldPosition(new THREE.Vector3())));
      this.root.quaternion.copy(q);
      this.root.position.copy(hips).sub(local.applyQuaternion(q));
    });
  }

  // 每帧在骨骼动画更新之后调用 fn(t)，t 从 0 到 1
  tween(dur, fn) {
    return new Promise((resolve) => {
      this.tweenState = { t: 0, dur, fn, resolve };
    });
  }

  updateTransfer(dt) {
    const tr = this.transfer;
    if (!tr) return;
    tr.t = Math.min(1, tr.t + dt / tr.dur);
    const t = tr.t;
    const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    // 先离地、再转、最后落下：旋转比位移早一点完成
    const er = Math.min(1, e * 1.15);
    this.root.position.lerpVectors(tr.fromPos, tr.toPos, e);
    this.root.position.y += Math.sin(Math.PI * t) * tr.lift + Math.sin(t * Math.PI * 6) * 0.006 * (1 - t);
    this.root.rotation.x = tr.fromRot + (tr.toRot - tr.fromRot) * er;
    if (t >= 1) {
      this.transfer = null;
      tr.resolve();
    }
  }

  slot(slotKey) {
    return this.calibration.slots[slotKey];
  }

  socketWorld(slotKey) {
    this.root.updateMatrixWorld(true);
    return this.sockets[slotKey].getWorldPosition(new THREE.Vector3());
  }

  // ---- 切开 ----
  prepareCut(slotKey) {
    const cut = this.slot(slotKey).cut;
    for (const u of [this.bodyU, this.limbU]) {
      u.uBoxMin.value.set(...cut.min);
      u.uBoxMax.value.set(...cut.max);
      u.uCutEnabled.value = 0;
      u.uCutShape.value = 0;
    }
  }

  // 眼睛：取下旧镜片后把原来的眼球挖掉（椭球形切口），里面放一个暗色眼窝，义眼再装进去
  openSocket(slotKey) {
    const cut = this.slot(slotKey).cut;
    // 标定框给义眼留了余量，眼窝在 X、Y 上收到 85%，看起来更像眼眶
    const k = 0.85;
    const mid = cut.min.map((v, i) => (v + cut.max[i]) / 2);
    const min = cut.min.map((v, i) => (i < 2 ? mid[i] + (v - mid[i]) * k : v));
    const max = cut.max.map((v, i) => (i < 2 ? mid[i] + (v - mid[i]) * k : v));
    const u = this.bodyU;
    u.uBoxMin.value.set(...min);
    u.uBoxMax.value.set(...max);
    u.uCutShape.value = 1;
    u.uCutEnabled.value = 1;
    // 脸部离镜头很近，四肢那种宽而亮的灼烧边会被辉光放大成一大团光，这里收细、调暗
    u.uEdgeWidth.value = 0.003;
    u.uGlowColor.value.setRGB(0.45, 0.16, 0.03);
    this.cavities ??= {};
    if (this.cavities[slotKey]) return;
    const w = max[0] - min[0];
    const h = max[1] - min[1];
    const r = Math.min(w, h) * 0.5;
    // 只渲染球的内壁：从外面看过去是一个凹进去的眼窝，洞外的部分被脸挡住
    const cavity = new THREE.Mesh(
      new THREE.SphereGeometry(r, 32, 20),
      new THREE.MeshStandardMaterial({
        color: 0x1c0b0d,
        roughness: 0.45,
        metalness: 0.35,
        emissive: 0x4a0c06,
        emissiveIntensity: 0.5,
        side: THREE.BackSide,
      }),
    );
    cavity.name = `cavity_${slotKey}`;
    this.sockets[slotKey].add(cavity);
    this.cavities[slotKey] = cavity;
  }

  // 被切下的肢体在 limbRoot 局部坐标里的中心：取切割框内实际顶点的包围盒中心。
  // 切割框为了罩住整条胳膊会留很大余量，直接用框的中心会落在半空。
  limbCenter(slotKey) {
    this.limbCenters ??= {};
    if (this.limbCenters[slotKey]) return this.limbCenters[slotKey].clone();
    const cut = this.slot(slotKey).cut;
    const box = new THREE.Box3(new THREE.Vector3(...cut.min), new THREE.Vector3(...cut.max));
    this.root.updateMatrixWorld(true);
    const toLocal = this.limbRoot.matrixWorld.clone().invert();
    const found = new THREE.Box3();
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    this.limbRoot.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry?.attributes.position) return;
      const pos = obj.geometry.attributes.position;
      // 带骨骼的网格按绑骨空间算（和切割着色器一致）
      if (obj.isSkinnedMesh) m.copy(this.limbU.uRestMatrix.value);
      else m.multiplyMatrices(toLocal, obj.matrixWorld);
      const step = Math.max(1, Math.floor(pos.count / 20000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        if (box.containsPoint(v)) found.expandByPoint(v);
      }
    });
    const center = found.isEmpty() ? box.getCenter(new THREE.Vector3()) : found.getCenter(new THREE.Vector3());
    this.limbCenters[slotKey] = center;
    return center.clone();
  }

  openCut() {
    this.bodyU.uCutEnabled.value = 1;
    this.limbU.uCutEnabled.value = 1;
    this.limbRoot.visible = true;
  }

  // 头部手术不切真实模型，而是先取下一个旧部件
  spawnCover(slotKey) {
    // 挂在接口上（接口跟着头骨走）。以前是生成时按世界坐标挂到根节点，那时病人还站着说话，
    // 躺下后头的位置变了，旧镜片就会从脸颊里戳出来
    const cover = makeRemovableCover(slotKey);
    this.sockets[slotKey].add(cover);
    this.cover = cover;
    return cover;
  }

  // 拆除步骤要拖走的物体，以及它在世界坐标里的中心
  removable(slotKey, cutMode) {
    if (cutMode === 'volume') {
      return { object: this.limbRoot, centerLocal: this.limbCenter(slotKey) };
    }
    return { object: this.cover ?? this.spawnCover(slotKey), centerLocal: new THREE.Vector3() };
  }

  // ---- 义体 ----
  async loadImplant(implant, implantCalib) {
    let model = await loadModel(implant.model);
    if (model) applyNeonGlow(model, 2.5);
    else model = makePlaceholderImplant(implant);
    const wrapper = new THREE.Group();
    wrapper.name = `implant_${implant.id}`;
    if (implantCalib) {
      if (implantCalib.pos) model.position.set(...implantCalib.pos);
      if (implantCalib.rot) model.rotation.set(...implantCalib.rot);
      if (implantCalib.scale) model.scale.multiplyScalar(implantCalib.scale);
    }
    wrapper.add(model);
    return wrapper;
  }

  // 返回挂在接口上的 holder；对位步骤旋转 holder，锁定后归零
  attachImplant(slotKey, implantObj) {
    const holder = new THREE.Group();
    holder.name = `holder_${slotKey}`;
    // 标定里的 scale：把义体缩放到这个病人实际的肢体长度
    holder.scale.setScalar(this.slot(slotKey).socket.scale ?? 1);
    holder.add(implantObj);
    this.sockets[slotKey].add(holder);
    this.attached[slotKey] = holder;
    return holder;
  }

  // 回访或结算时直接把义体装好（切口已经愈合）
  async installDirect(slotKey, implant, implantCalib, cutMode, hollow = false) {
    this.prepareCut(slotKey);
    if (cutMode === 'volume') {
      this.bodyU.uCutEnabled.value = 1;
      this.limbRoot.visible = false;
    } else if (hollow) {
      this.openSocket(slotKey);
    }
    this.bodyU.uGlowColor.value.setRGB(0.05, 0.35, 0.4);
    const obj = await this.loadImplant(implant, implantCalib);
    const holder = this.attachImplant(slotKey, obj);
    this.skinImplant(slotKey);
    return holder;
  }

  // 装好的义体改成蒙皮：膝/肘以下的部分跟着小腿/小臂骨动，病人坐下、走路时义体会跟着弯，
  // 不再是一根从大腿伸出去的僵直棍子。眼睛/面部的义体挂在头骨上，不用处理。
  skinImplant(slotKey) {
    const holder = this.attached[slotKey];
    if (!holder || !holder.visible || !this.anim?.rigged || this.skinned?.[slotKey]) return;
    const side = this.patient?.sides?.[slotKey] ?? 'left';
    const chain = boneChainForSlot(this.anim.bones, slotKey, side);
    const bodyMesh = this.bodyRoot.getObjectByProperty('isSkinnedMesh', true);
    if (!chain || !bodyMesh) return;
    const skeleton = bodyMesh.skeleton;
    const [boneA, boneB] = chain;
    const iA = skeleton.bones.indexOf(boneA);
    const iB = skeleton.bones.indexOf(boneB);
    if (iA < 0 || iB < 0) return;
    this.root.updateMatrixWorld(true);
    // 绑定空间 = 身体蒙皮的 bindMatrix 空间；关节在绑定姿势下的位置
    const jointBind = (i) => new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[i].clone().invert());
    const pB = jointBind(iB);
    const childB = boneB.children.find((c) => c.isBone);
    const iC = childB ? skeleton.bones.indexOf(childB) : -1;
    const axis = (iC >= 0 ? jointBind(iC) : pB.clone().multiplyScalar(2).sub(jointBind(iA))).sub(pB).normalize();
    const bindInv = bodyMesh.bindMatrix.clone().invert();
    const boneAInvNow = boneA.matrixWorld.clone().invert();
    const boneABind = skeleton.boneInverses[iA].clone().invert();
    const out = [];
    holder.traverse((mesh) => {
      if (!mesh.isMesh || mesh.isSkinnedMesh) return;
      // 义体网格局部 -> 绑定空间（义体是刚挂在 boneA 上的，所以 boneA 局部坐标与姿势无关）
      const toBind = new THREE.Matrix4().multiplyMatrices(boneABind, new THREE.Matrix4().multiplyMatrices(boneAInvNow, mesh.matrixWorld));
      const toLocal = new THREE.Matrix4().multiplyMatrices(bindInv, toBind);
      const nm = new THREE.Matrix3().getNormalMatrix(toLocal);
      const geo = mesh.geometry.clone();
      const pos = geo.attributes.position;
      const nrm = geo.attributes.normal;
      const n = pos.count;
      // 义体模型的顶点是量化过的 int16（靠节点缩放还原），要写回浮点属性，不然会溢出绕回
      const pOut = new Float32Array(n * 3);
      const nOut = nrm ? new Float32Array(n * 3) : null;
      const idx = new Uint16Array(n * 4);
      const wgt = new Float32Array(n * 4);
      const v = new THREE.Vector3();
      const b = new THREE.Vector3();
      const nn = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i);
        b.copy(v).applyMatrix4(toBind);
        // 关节以下为正：5 cm 内平滑过渡到下一段骨头
        const w = THREE.MathUtils.smoothstep(b.sub(pB).dot(axis), -0.04, 0.05);
        v.applyMatrix4(toLocal);
        pOut[i * 3] = v.x;
        pOut[i * 3 + 1] = v.y;
        pOut[i * 3 + 2] = v.z;
        if (nOut) {
          nn.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
          nOut[i * 3] = nn.x;
          nOut[i * 3 + 1] = nn.y;
          nOut[i * 3 + 2] = nn.z;
        }
        idx[i * 4] = iA;
        idx[i * 4 + 1] = iB;
        wgt[i * 4] = 1 - w;
        wgt[i * 4 + 1] = w;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pOut, 3));
      if (nOut) geo.setAttribute('normal', new THREE.BufferAttribute(nOut, 3));
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(wgt, 4));
      geo.computeBoundingSphere();
      const sm = new THREE.SkinnedMesh(geo, mesh.material);
      sm.name = `${mesh.name || 'implant'}_skinned`;
      sm.frustumCulled = false;
      sm.position.copy(bodyMesh.position);
      sm.quaternion.copy(bodyMesh.quaternion);
      sm.scale.copy(bodyMesh.scale);
      bodyMesh.parent.add(sm);
      sm.bind(skeleton, bodyMesh.bindMatrix);
      out.push(sm);
    });
    if (!out.length) return;
    holder.visible = false;
    (this.skinned ??= {})[slotKey] = out;
  }

  update(dt) {
    if (this.walk) {
      const w = this.walk;
      w.t = Math.min(1, w.t + dt / w.dur);
      const animated = this.anim?.has('walk');
      // 有走路动作时匀速走（脚步不打滑），起步和停步稍微缓一点；静态模型保留原来的颠步
      const smooth = w.t * w.t * (3 - 2 * w.t);
      const e = animated ? w.t * 0.75 + smooth * 0.25 : w.t < 0.5 ? 2 * w.t * w.t : 1 - (-2 * w.t + 2) ** 2 / 2;
      let heading = w.heading;
      if (w.c) {
        // 二次贝塞尔弧线，朝向跟着切线走
        const u = 1 - e;
        this.root.position.set(0, 0, 0).addScaledVector(w.a, u * u).addScaledVector(w.c, 2 * u * e).addScaledVector(w.b, e * e);
        const tx = 2 * u * (w.c.x - w.a.x) + 2 * e * (w.b.x - w.c.x);
        const tz = 2 * u * (w.c.z - w.a.z) + 2 * e * (w.b.z - w.c.z);
        heading = Math.atan2(tx, tz);
      } else this.root.position.lerpVectors(w.a, w.b, e);
      this.root.position.y = animated ? 0 : Math.abs(Math.sin(w.t * Math.PI * 5)) * 0.022 * (1 - w.t * 0.6);
      // 先转向前进方向，走到最后 30% 再转到目标朝向（面向医生 / 背对手术台）
      const s = (x) => x * x * (3 - 2 * x);
      let yaw = lerpAngle(w.startYaw, heading, s(Math.min(1, w.t / 0.18)));
      if (w.endYaw != null) yaw = lerpAngle(yaw, w.endYaw, s(Math.max(0, (w.t - 0.68) / 0.32)));
      this.root.rotation.y = yaw;
      if (w.t >= 1) {
        const then = w.then;
        this.walk = null;
        if (w.faceFront) this.play('idle', { fade: 0.45 });
        then?.();
      }
    }
    this.anim?.update(dt);
    const tw = this.tweenState;
    if (tw && this.bodyRoot) {
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      tw.fn(tw.t);
      if (tw.t >= 1) {
        this.tweenState = null;
        tw.resolve();
      }
    }
    this.updateTransfer(dt);
    if (!this.bodyRoot) return;
    this.root.updateMatrixWorld(true);
    this.bodyU.uCutMatrix.value.copy(this.bodyRoot.matrixWorld).invert();
    this.limbU.uCutMatrix.value.copy(this.limbRoot.matrixWorld).invert();
  }
}
