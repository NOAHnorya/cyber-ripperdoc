import * as THREE from 'three';
import { loadModel, fitToSize, placeOnFloor } from './AssetLoader.js';
import { makePlaceholderProp, makeAssistArm } from './placeholders.js';
import { neonMaterial, applyNeonGlow } from './materials.js';
import { propForLevel } from '../systems/upgrades.js';

// 道具摆放（世界坐标，病人站在原点、面朝 +Z）
// 立式手术架已经不用了（改成卧式手术台 + 医生的义眼扫描），不再摆进场景
const LAYOUT = {
  // 卧式手术台：常驻房间中央，长轴沿 Z，枕头在 −Z
  surgery_table: { pos: [0, 0, 0], rotY: 0 },
  surgery_lamp: { pos: [0.35, 2.0, 0.75], rotY: 0 },
  tool_cart: { pos: [1.55, 0, -0.35], rotY: -0.3 },
  recycle_tray: { pos: [1.15, 0, 0.7], rotY: -0.2 },
  implant_shelf: { pos: [-2.2, 0, -0.9], rotY: 0.55 },
  laser_lv1: { pos: [1.5, 0.9, -0.3], rotY: 0.4 },
  laser_lv2: { pos: [1.5, 0.9, -0.3], rotY: 0.4 },
  scanner_lv1: { pos: [-1.25, 0.76, -1.25], rotY: 0.5 },
  scanner_lv2: { pos: [-1.25, 0.76, -1.25], rotY: 0.5 },
};

const FLOOR_PROPS = new Set(['surgery_rig', 'surgery_table', 'tool_cart', 'recycle_tray', 'implant_shelf']);
const TABLE_HIDDEN_Y = -1.15;
// 左墙门洞的 z 位置（病人进出口；PatientRig 的进出点要对着它）
export const DOOR_Z = 2.5;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function std(color, metalness = 0.5, roughness = 0.6) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function signTexture(text) {
  const chars = [...text];
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 220 * chars.length + 60;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = '900 180px "PingFang SC", "Microsoft YaHei", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#ff2a6d';
  g.shadowBlur = 30;
  g.fillStyle = '#ffd0e0';
  chars.forEach((ch, i) => g.fillText(ch, canvas.width / 2, 140 + i * 220));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skylineTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const g = canvas.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#05030c');
  sky.addColorStop(0.6, '#2a0c3a');
  sky.addColorStop(1, '#0b2a3a');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1024, 512);
  let x = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (x < 1024) {
    const w = 40 + rnd() * 90;
    const h = 120 + rnd() * 330;
    g.fillStyle = '#07070b';
    g.fillRect(x, 512 - h, w, h);
    for (let wy = 512 - h + 10; wy < 500; wy += 14) {
      for (let wx = x + 6; wx < x + w - 6; wx += 10) {
        if (rnd() < 0.18) {
          g.fillStyle = rnd() < 0.5 ? '#ff2a6d' : rnd() < 0.5 ? '#05d9e8' : '#fcee0a';
          g.globalAlpha = 0.5 + rnd() * 0.5;
          g.fillRect(wx, wy, 4, 6);
          g.globalAlpha = 1;
        }
      }
    }
    x += w + 4;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Clinic {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'clinic';
    scene.add(this.group);
    this.props = new Map();
    this.trayPoint = new THREE.Vector3(1.15, 0.88, 0.7);
    this.time = 0;
    this.buildRoom();
    this.buildLights();
    this.buildOutside();
  }

  buildRoom() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), std(0x0c0e13, 0.7, 0.22));
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    const wallMat = std(0x16161d, 0.2, 0.85);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.2), wallMat);
    back.position.set(0, 1.6, -3);
    this.group.add(back);
    // 左墙开一扇门（病人从这儿进出），门里是一截昏暗的过道
    const D = { z: DOOR_Z, w: 1.1, h: 2.3, depth: 1.2 };
    const leftSeg = (len, cz, h = 3.2, cy = 1.6, x = -3.5) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), wallMat);
      m.position.set(x, cy, cz);
      m.rotation.y = Math.PI / 2;
      this.group.add(m);
      return m;
    };
    leftSeg(5 + (D.z - D.w / 2), (D.z - D.w / 2 - 5) / 2);
    leftSeg(5 - (D.z + D.w / 2), (D.z + D.w / 2 + 5) / 2);
    leftSeg(D.w, D.z, 3.2 - D.h, D.h + (3.2 - D.h) / 2);
    // 过道：两侧、尽头、顶
    const hallMat = std(0x0e0e13, 0.3, 0.9);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(D.depth, D.h), hallMat);
      side.position.set(-3.5 - D.depth / 2, D.h / 2, D.z + (s * D.w) / 2);
      side.rotation.y = s > 0 ? Math.PI : 0;
      this.group.add(side);
    }
    const end = new THREE.Mesh(new THREE.PlaneGeometry(D.w, D.h), hallMat);
    end.position.set(-3.5 - D.depth, D.h / 2, D.z);
    end.rotation.y = Math.PI / 2;
    this.group.add(end);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(D.depth, D.w), hallMat);
    top.position.set(-3.5 - D.depth / 2, D.h, D.z);
    top.rotation.x = Math.PI / 2;
    this.group.add(top);
    // 门框霓虹（青色）+ 过道里一盏冷光
    const frame = (w, h, d, pos) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), neonMaterial(0x05d9e8, 1.6));
      m.position.set(...pos);
      this.group.add(m);
    };
    frame(0.04, D.h, 0.03, [-3.49, D.h / 2, D.z - D.w / 2]);
    frame(0.04, D.h, 0.03, [-3.49, D.h / 2, D.z + D.w / 2]);
    frame(0.04, 0.03, D.w + 0.03, [-3.49, D.h, D.z]);
    const hallLight = new THREE.PointLight(0x7ec8ff, 0.9, 3.2, 1.6);
    hallLight.position.set(-3.5 - D.depth * 0.6, D.h - 0.2, D.z);
    this.group.add(hallLight);

    // 右墙留一扇窗：窗外是雨夜城市
    const rightMat = wallMat;
    const seg = (w, h, y, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), rightMat);
      m.position.set(3.2, y, z);
      m.rotation.y = -Math.PI / 2;
      this.group.add(m);
    };
    seg(10, 1.1, 0.55, 0);
    seg(10, 1.1, 2.65, 0);
    seg(1.7, 1.0, 1.6, -2.15);
    seg(4.7, 1.0, 1.6, 2.65);
    for (let i = 0; i < 9; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 1.6), std(0x0d0d10, 0.3, 0.7));
      slat.position.set(3.18, 1.14 + i * 0.11, -0.5);
      slat.rotation.z = 0.5;
      this.group.add(slat);
    }

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), std(0x08080b, 0.1, 0.9));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 3.1;
    this.group.add(ceiling);

    // 墙上的管线和霓虹灯管
    const pipe = std(0x24262c, 0.9, 0.35);
    for (const [y, r] of [[2.75, 0.05], [2.6, 0.03], [0.35, 0.04]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 9, 12), pipe);
      p.rotation.z = Math.PI / 2;
      p.position.set(0, y, -2.92);
      this.group.add(p);
    }
    const tube = (w, color, pos, rotY = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, 0.025), neonMaterial(color, 3));
      m.position.set(...pos);
      m.rotation.y = rotY;
      this.group.add(m);
    };
    tube(6, 0xff2a6d, [0, 2.95, -2.95]);
    tube(5, 0x05d9e8, [-3.45, 2.95, 0], Math.PI / 2);
    tube(1.4, 0xfcee0a, [1.8, 1.25, -2.95]);

    // 霓虹招牌（升级后点亮）
    const signTex = signTexture('义体修理回收');
    this.sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.42 * (signTex.image.height / signTex.image.width)),
      new THREE.MeshBasicMaterial({ map: signTex, transparent: true, color: new THREE.Color(2.4, 2.4, 2.4), toneMapped: false }),
    );
    this.sign.position.set(-1.0, 1.75, -2.94);
    this.sign.visible = false;
    this.group.add(this.sign);
    this.signLight = new THREE.PointLight(0xff2a6d, 0, 6, 2);
    this.signLight.position.set(-1.0, 1.75, -2.6);
    this.group.add(this.signLight);

    // 放扫描仪的小桌
    const table = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.76, 0.55), std(0x1c1d22, 0.6, 0.5));
    table.position.set(-1.25, 0.38, -1.25);
    table.rotation.y = 0.5;
    this.group.add(table);
  }

  buildLights() {
    this.group.add(new THREE.AmbientLight(0x30304a, 0.6));
    this.group.add(new THREE.HemisphereLight(0x3a2a5a, 0x05060a, 0.5));

    const magenta = new THREE.PointLight(0xff2a6d, 30, 12, 2);
    magenta.position.set(-2.4, 2.3, 1.4);
    this.group.add(magenta);
    const cyan = new THREE.PointLight(0x05d9e8, 30, 12, 2);
    cyan.position.set(2.5, 2.4, -1.6);
    this.group.add(cyan);

    this.surgeryLight = new THREE.SpotLight(0xffd9a8, 18, 8, 0.6, 0.7, 2);
    this.surgeryLight.position.set(0.35, 2.9, 1.3);
    this.surgeryLight.target.position.set(0, 0.95, 0.2);
    this.group.add(this.surgeryLight, this.surgeryLight.target);

    // 窗外驶过的轻轨，灯光扫过屋内（银翼杀手式）
    this.trainLight = new THREE.SpotLight(0xbfd8ff, 0, 14, 0.35, 0.8, 1.5);
    this.trainLight.position.set(6, 1.8, -4);
    this.trainLight.target.position.set(-2, 1.2, 0);
    this.group.add(this.trainLight, this.trainLight.target);
  }

  buildOutside() {
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 7),
      new THREE.MeshBasicMaterial({ map: skylineTexture(), color: new THREE.Color(1.2, 1.2, 1.2), toneMapped: false }),
    );
    sky.position.set(8, 2.2, -0.5);
    sky.rotation.y = -Math.PI / 2;
    this.group.add(sky);

    const count = 600;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = 3.4 + Math.random() * 1.6;
      pos[i * 3 + 1] = 0.8 + Math.random() * 2.2;
      pos[i * 3 + 2] = -1.8 + Math.random() * 2.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: new THREE.Color(0.6, 0.8, 1.4), size: 0.012, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.group.add(this.rain);
  }

  async loadProps(props, upgrades, levels) {
    this.upgrades = upgrades;
    await Promise.all(
      props.map(async (p) => {
        const layout = LAYOUT[p.id];
        if (!layout) return;
        let obj = await loadModel(p.model);
        if (obj) {
          if (p.size_m?.some((v) => v > 0)) {
            const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
            const longest = Math.max(size.x, size.y, size.z);
            const target = Math.max(...p.size_m);
            if (Math.abs(longest - target) / target > 0.5) fitToSize(obj, p.size_m);
          }
          if (FLOOR_PROPS.has(p.id)) placeOnFloor(obj);
          applyNeonGlow(obj, 2);
        } else {
          obj = makePlaceholderProp(p.id);
        }
        const holder = new THREE.Group();
        holder.add(obj);
        holder.position.set(...layout.pos);
        holder.rotation.y = layout.rotY;
        holder.name = `prop_${p.id}`;
        this.group.add(holder);
        this.props.set(p.id, holder);
      }),
    );
    // 手术台先藏到地板下，病人的卧姿参数来自道具清单
    this.tablePose = props.find((p) => p.id === 'surgery_table')?.patientPose ?? null;
    if (!this.props.get('surgery_table')) this.tablePose = null;
    this.hatchLight = new THREE.PointLight(0x05d9e8, 0, 3.5, 2);
    this.hatchLight.position.set(0, 0.25, 0.2);
    this.group.add(this.hatchLight);

    this.assistArm = makeAssistArm();
    this.assistArm.position.set(0.75, 3.1, 0.15);
    this.assistArm.visible = false;
    this.group.add(this.assistArm);
    this.applyUpgrades(levels);
  }

  // 某位病人躺上手术台时根节点的位置和旋转（台在原点、不旋转时就是世界坐标）
  patientPose(patientId) {
    const t = this.tablePose;
    const pos = t?.positionByPatient?.[patientId];
    if (!pos) return null;
    return { position: pos, rotationX: t.rotationX ?? -Math.PI / 2 };
  }

  // 手术台从地板舱口升起 / 降回去
  showTable(on, dur = 0.9) {
    const table = this.props.get('surgery_table');
    if (!table) return Promise.resolve();
    table.visible = true;
    return new Promise((resolve) => {
      this.tableAnim = { from: table.position.y, to: on ? 0 : TABLE_HIDDEN_Y, t: 0, dur, on, resolve };
    });
  }

  updateTable(dt) {
    const a = this.tableAnim;
    if (!a) return;
    const table = this.props.get('surgery_table');
    a.t = Math.min(1, a.t + dt / a.dur);
    table.position.y = a.from + (a.to - a.from) * easeInOut(a.t);
    this.hatchLight.intensity = Math.sin(Math.PI * a.t) * 9;
    if (a.t >= 1) {
      if (!a.on) table.visible = false;
      this.tableAnim = null;
      a.resolve();
    }
  }

  // 手术特写时把手术架淡出，避免立柱和束带挡住切口；full = 完全隐藏（换成卧式手术台时）
  setRigFade(on, full = false) {
    this.rigFadeTarget = on ? (full ? 0 : 0.16) : 1;
    const rig = this.props.get('surgery_rig');
    if (!rig || this.rigMats) return;
    this.rigMats = [];
    rig.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.transparent = true;
        m.needsUpdate = true;
        this.rigMats.push(m);
      }
    });
    this.rigFade = 1;
  }

  updateRigFade(dt) {
    if (!this.rigMats || this.rigFadeTarget === undefined) return;
    const k = Math.min(1, dt * 5);
    this.rigFade += (this.rigFadeTarget - this.rigFade) * k;
    if (Math.abs(this.rigFade - this.rigFadeTarget) < 0.002) this.rigFade = this.rigFadeTarget;
    for (const m of this.rigMats) {
      m.opacity = this.rigFade;
      m.depthWrite = this.rigFade > 0.95;
    }
    const rig = this.props.get('surgery_rig');
    if (rig) rig.visible = this.rigFade > 0.01;
  }

  applyUpgrades(levels) {
    for (const up of this.upgrades ?? []) {
      if (!up.props?.length) continue;
      const active = propForLevel(up, levels);
      for (const id of up.props) {
        const obj = this.props.get(id);
        if (obj) obj.visible = id === active;
      }
    }
    const neonOn = (levels.neon ?? 0) > 0;
    this.sign.visible = neonOn;
    this.signLight.intensity = neonOn ? 12 : 0;
    if (this.assistArm) this.assistArm.visible = (levels.assist_arm ?? 0) > 0;
  }

  update(dt) {
    this.updateRigFade(dt);
    this.updateTable(dt);
    this.time += dt;
    // 轻轨每 9 秒经过一次
    const cycle = this.time % 9;
    if (cycle < 2.2) {
      const t = cycle / 2.2;
      this.trainLight.intensity = 60 * Math.sin(Math.PI * t);
      this.trainLight.position.z = -4 + 8 * t;
      this.trainLight.target.position.set(-2, 1.0, -3 + 6 * t);
    } else {
      this.trainLight.intensity = 0;
    }
    // 雨
    const arr = this.rain.geometry.attributes.position.array;
    for (let i = 1; i < arr.length; i += 3) {
      arr[i] -= dt * 6;
      if (arr[i] < 0.8) arr[i] += 2.2;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    // 招牌偶尔闪一下
    if (this.sign.visible) {
      const flicker = Math.sin(this.time * 31) > 0.97 ? 0.3 : 1;
      this.sign.material.color.setScalar(2.4 * flicker);
    }
  }
}
