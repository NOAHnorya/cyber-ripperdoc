import * as THREE from 'three';

// 病人骨骼动画：Meshy 绑骨 + 动捕动作。
// - 动作按名字找（Meshy 导出的动画名是动作名，比如 Idle、Casual_Walk）
// - rest：绑骨时的 A 字姿势。麻醉后身体松弛回到这个姿势，手术的切割框、接口、对位都按它标定，所以手术代码不用改
// - 走路的根运动去掉，位置由 PatientRig 控制
const NAMES = {
  idle: [/^idle$/i, /(^|[_|\s])idle($|[_|\s])/i],
  look: [/breathe_and_look/i, /look_around/i],
  walk: [/casual_walk/i, /walking_woman/i, /walk/i],
  talk: [/talk_with_hands_open/i, /talk/i],
  chat: [/stand_and_chat/i, /chat/i],
  happy: [/victory_fist_pump/i, /fist_pump/i, /victory/i],
  sway: [/happy_sway/i],
  angry: [/stand_talking_angry/i, /angry/i],
  pain: [/head_hold/i, /pain/i],
  listen: [/listening/i],
  sit: [/stand_?to_?sit/i],
  stand: [/sit_?to_?stand/i],
};

export class PatientAnimator {
  constructor(model, clips = []) {
    this.bones = [];
    model.traverse((o) => o.isBone && this.bones.push(o));
    this.rigged = this.bones.length > 0;
    this.clips = {};
    this.current = null;
    if (!this.rigged) return;
    this.mixer = new THREE.AnimationMixer(model);
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.current && this.after) {
        const next = this.after;
        this.after = null;
        this.play(next, { fade: 0.5 });
      }
    });

    // 躺平时脚背绷直一点：站姿脚掌是平的，躺下后脚跟会戳进床垫（只动脚，切割和接口都不受影响）
    this.restAdjust = {};
    model.updateMatrixWorld(true);
    for (const foot of this.bones.filter((b) => /foot$/i.test(b.name))) {
      const toe = foot.children.find((c) => c.isBone);
      if (!toe) continue;
      const q0 = foot.quaternion.clone();
      let best = null;
      let bestY = Infinity;
      for (const s of [1, -1]) {
        foot.quaternion.copy(q0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), s * 0.7));
        foot.updateMatrixWorld(true);
        const y = model.worldToLocal(toe.getWorldPosition(new THREE.Vector3())).y;
        if (y < bestY) {
          bestY = y;
          best = foot.quaternion.clone();
        }
      }
      foot.quaternion.copy(q0);
      foot.updateMatrixWorld(true);
      this.restAdjust[foot.name] = best;
    }

    // 绑骨姿势（A 字）做成一个单帧动作，用来平滑地"松弛"回去
    const tracks = [];
    for (const b of this.bones) {
      const q = this.restAdjust[b.name] ?? b.quaternion;
      tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0], q.toArray()));
      tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, [0], b.position.toArray()));
    }
    this.clips.rest = new THREE.AnimationClip('rest', 1, tracks);

    // 根骨骼：没有骨骼父节点的那根（通常叫 Hips）
    const hips = this.bones.find((b) => !b.parent?.isBone) ?? this.bones[0];
    this.hips = hips;
    this.hipsRest = hips.position.clone();
    // 髋骨父节点坐标里哪根轴是“竖直向上”（Mixamo 骨架的父节点转了 90°，高度在 -Z 上）
    model.updateMatrixWorld(true);
    const parentQ = (hips.parent ?? model).getWorldQuaternion(new THREE.Quaternion());
    const up = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()))
      .applyQuaternion(parentQ.invert());
    const ax = [Math.abs(up.x), Math.abs(up.y), Math.abs(up.z)];
    this.upAxis = ax.indexOf(Math.max(...ax));
    this.upSign = Math.sign(up.getComponent(this.upAxis)) || 1;
    // 共用动作包来自另一个角色：只留本角色有的骨头的轨道（有的角色带手指骨、有的没有）
    const names = new Set(this.bones.map((b) => b.name));
    // 髋高换算比例统一用站立待机动作算（蹲下、弯腰这类动作的高度变化要保留）
    const idleSrc = clips.find((c) => c.name.toLowerCase() === 'idle');
    this.hipsRefUp = idleSrc ? meanHipsUp(idleSrc, hips, this.upAxis) : null;
    const prepared = clips.map((c) => {
      const k = c.clone();
      k.tracks = k.tracks.filter((t) => names.has(t.name.slice(0, t.name.lastIndexOf('.'))));
      return this.stripRootMotion(k, hips);
    });
    for (const [key, patterns] of Object.entries(NAMES)) {
      // 动作文件名就是动作名（idle.fbx -> idle），优先精确匹配
      const exact = prepared.find((c) => c.name.toLowerCase() === key);
      if (exact) {
        this.clips[key] = exact;
        continue;
      }
      for (const re of patterns) {
        const clip = prepared.find((c) => re.test(c.name));
        if (clip) {
          this.clips[key] = clip;
          break;
        }
      }
    }
    this.names = prepared.map((c) => c.name);
  }

  // 去掉髋骨在水平面上的位移，人往哪儿走由代码决定；上下起伏按本角色的髋高等比缩放
  // （同一套动作会套到腿长不同的病人身上）
  stripRootMotion(clip, hips) {
    for (const t of clip.tracks) {
      if (t.name !== `${hips.name}.position`) continue;
      const v = t.values;
      const a = this.upAxis;
      const restUp = this.hipsRest.getComponent(a);
      const refUp = this.hipsRefUp ?? meanHipsUp(clip, hips, a);
      const k = Math.abs(refUp) > 1e-6 ? restUp / refUp : 1;
      for (let i = 0; i < v.length; i += 3) {
        for (let c = 0; c < 3; c++) v[i + c] = c === a ? v[i + c] * k : this.hipsRest.getComponent(c);
      }
    }
    return clip;
  }

  // 静止时髋骨离地高度（髋骨父节点单位，向上为正）
  get hipsRestUp() {
    return this.upSign * this.hipsRest.getComponent(this.upAxis);
  }

  has(name) {
    return !!this.clips[name];
  }

  // 动作首/末帧的髋骨高度（髋骨父节点单位，向上为正）
  clipHipsUp(name, atEnd = true) {
    const t = this.clips[name]?.tracks.find((x) => x.name === `${this.hips.name}.position`);
    if (!t) return this.hipsRestUp;
    const i = atEnd ? t.values.length - 3 : 0;
    return this.upSign * t.values[i + this.upAxis];
  }

  // 停在某个动作的最后一帧（比如坐姿），可以和别的动作交叉淡入淡出
  hold(name, { fade = 0.4 } = {}) {
    const clip = this.clips[name];
    if (!this.rigged || !clip) return false;
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.enabled = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.time = clip.duration - 1e-3;
    action.setEffectiveTimeScale(0);
    action.setEffectiveWeight(1);
    action.play();
    if (this.current && this.current !== action) this.current.crossFadeTo(action, fade, false);
    else action.fadeIn(fade);
    this.current = action;
    this.currentName = name;
    this.after = null;
    return true;
  }

  // once：只播一次，播完接 then（默认 idle）
  play(name, { fade = 0.4, once = false, then = 'idle', timeScale = 1 } = {}) {
    if (!this.rigged) return false;
    const clip = this.clips[name] ?? (name !== 'idle' ? this.clips.idle : null);
    if (!clip) return false;
    const action = this.mixer.clipAction(clip);
    if (action === this.current && !once) return true;
    action.reset();
    action.enabled = true;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.play();
    if (this.current && this.current !== action) this.current.crossFadeTo(action, fade, false);
    else action.fadeIn(fade);
    this.current = action;
    this.currentName = name;
    this.after = once ? then : null;
    return true;
  }

  update(dt) {
    this.mixer?.update(dt);
  }
}

function meanHipsUp(clip, hips, axis) {
  const t = clip.tracks.find((x) => x.name === `${hips.name}.position`);
  if (!t) return 0;
  let sum = 0;
  for (let i = axis; i < t.values.length; i += 3) sum += t.values[i];
  return sum / Math.max(1, t.values.length / 3);
}

// 部位 → 义体挂在哪根骨头上：先按名字找，找不到就找离接口最近的骨段
// 名字先去掉 Mixamo 前缀（mixamorig: / mixamorig）再匹配
const SLOT_BONES = {
  leg: { left: [/^left_?up_?leg$/i, /^left_?thigh$/i], right: [/^right_?up_?leg$/i, /^right_?thigh$/i] },
  arm: { left: [/^left_?(upper_?)?arm$/i], right: [/^right_?(upper_?)?arm$/i] },
  eye: { any: [/^head$/i] },
  face: { any: [/^head$/i] },
};

// 义体蒙皮用的两段骨链：[大腿, 小腿] / [上臂, 小臂]
const SLOT_CHAIN = {
  leg: { left: [/^left_?up_?leg$/i, /^left_?leg$/i], right: [/^right_?up_?leg$/i, /^right_?leg$/i] },
  arm: { left: [/^left_?arm$/i, /^left_?fore_?arm$/i], right: [/^right_?arm$/i, /^right_?fore_?arm$/i] },
};

export function boneChainForSlot(bones, slotKey, side) {
  const list = SLOT_CHAIN[slotKey]?.[side] ?? SLOT_CHAIN[slotKey]?.left;
  if (!list) return null;
  const found = list.map((re) => bones.find((b) => re.test(b.name.replace(/^mixamorig\d*:?_?/i, ''))));
  return found.every(Boolean) ? found : null;
}

export function boneForSlot(bones, slotKey, side, socketWorld) {
  const def = SLOT_BONES[slotKey];
  const list = def?.[side] ?? def?.left ?? def?.any ?? [];
  for (const re of list) {
    const b = bones.find((x) => re.test(x.name.replace(/^mixamorig\d*:?_?/i, '')));
    if (b) return b;
  }
  // 兜底：接口点到"骨头 → 第一个子骨头"线段的距离最小，并列时取离骨头起点更近的
  let best = null;
  let bestScore = Infinity;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const bone of bones) {
    const child = bone.children.find((c) => c.isBone);
    if (!child) continue;
    bone.getWorldPosition(a);
    child.getWorldPosition(b);
    const ab = b.clone().sub(a);
    const t = THREE.MathUtils.clamp(socketWorld.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
    const d = a.clone().addScaledVector(ab, t).distanceTo(socketWorld);
    const score = d + t * 0.02;
    if (score < bestScore) {
      bestScore = score;
      best = bone;
    }
  }
  return best;
}
