import * as THREE from 'three';
import { neonMaterial } from './materials.js';

// Hi3D 资产到位之前用的占位模型。尺寸、原点、朝向都按交接文档的规格做，
// 真模型放进 public/models 后会自动替换，游戏逻辑不用改。

const UP = new THREE.Vector3(0, 1, 0);

function std(color, metalness = 0.1, roughness = 0.7) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function limb(a, b, radius, mat) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, len), 6, 14), mat);
  mesh.position.copy(A).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

function box(w, h, d, mat, pos = [0, 0, 0]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(...pos);
  return m;
}

function cyl(rTop, rBottom, h, mat, pos = [0, 0, 0], segments = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat);
  m.position.set(...pos);
  return m;
}

// ---------------- 病人 ----------------
const PATIENT_LOOKS = {
  aqiang: { top: 0xe8d21a, bottom: 0x1b1b1f, hair: 0x111111, skin: 0xc99a74 },
  jinya: { top: 0xd2602a, bottom: 0x4a4f57, hair: 0x9a9a9a, skin: 0xb98a66 },
  xiaolin: { top: 0x6b6f78, bottom: 0x2a3a5c, hair: 0x15151a, skin: 0xd8b08c },
  lili: { top: 0xb7a6ff, bottom: 0x2b2440, hair: 0xff8fc8, skin: 0xe6c2a3 },
  daoba: { top: 0x121214, bottom: 0x3a3a2e, hair: null, skin: 0xa77a58 },
};

export function makePlaceholderPatient(id) {
  const look = PATIENT_LOOKS[id] ?? { top: 0x445566, bottom: 0x222222, hair: 0x111111, skin: 0xc8a080 };
  const skin = std(look.skin, 0.0, 0.6);
  const top = std(look.top, 0.05, 0.55);
  const bottom = std(look.bottom, 0.05, 0.7);
  const g = new THREE.Group();
  g.name = `placeholder_patient_${id}`;

  // 腿（左腿在 +X）
  for (const s of [1, -1]) {
    const legMat = id === 'aqiang' ? skin : bottom;
    g.add(limb([0.11 * s, 0.88, 0], [0.11 * s, 0.1, 0], 0.068, legMat));
    g.add(box(0.1, 0.08, 0.24, std(0x1a1a1a), [0.11 * s, 0.04, 0.05]));
  }
  if (id === 'aqiang') {
    // 短裤
    g.add(box(0.38, 0.22, 0.24, bottom, [0, 0.86, 0]));
  }
  g.add(box(0.36, 0.16, 0.22, bottom, [0, 0.93, 0]));

  // 躯干
  const torso = limb([0, 0.98, 0], [0, 1.36, 0], 0.16, top);
  torso.scale.set(1, 1, 0.68);
  g.add(torso);
  g.add(limb([-0.19, 1.4, 0], [0.19, 1.4, 0], 0.065, top));

  // 手臂：A 字，离开身体 30°
  const armLen = 0.7;
  for (const s of [1, -1]) {
    const shoulder = [0.2 * s, 1.38, 0];
    const hand = [0.2 * s + armLen * 0.5 * s, 1.38 - armLen * 0.866, 0];
    const sleeveless = id === 'daoba';
    g.add(limb(shoulder, hand, 0.048, sleeveless ? skin : skin));
    if (!sleeveless) {
      const sleeveEnd = [0.2 * s + 0.16 * 0.5 * s, 1.38 - 0.16 * 0.866, 0];
      g.add(limb(shoulder, sleeveEnd, 0.058, top));
    }
    const handPos = new THREE.Vector3(hand[0] + 0.04 * s, hand[1] - 0.07, 0);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), skin);
    h.position.copy(handPos);
    h.scale.set(0.8, 1.2, 0.5);
    g.add(h);
  }
  if (id === 'xiaolin') {
    // 左手腕护具
    g.add(limb([0.52, 0.82, 0], [0.55, 0.77, 0], 0.056, std(0x222222)));
  }

  // 头和脖子
  g.add(cyl(0.05, 0.055, 0.08, skin, [0, 1.49, 0]));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 28, 20), skin);
  head.position.set(0, 1.63, 0);
  head.scale.set(0.9, 1.05, 1);
  g.add(head);
  if (look.hair) {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), std(look.hair, 0, 0.9));
    hair.position.set(0, 1.645, -0.005);
    hair.scale.set(0.92, 1.05, 1.02);
    g.add(hair);
  }
  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 10), std(0xf2f2f2, 0, 0.3));
    eye.position.set(0.034 * s, 1.65, 0.093);
    g.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), std(0x111111, 0, 0.3));
    pupil.position.set(0.034 * s, 1.65, 0.105);
    g.add(pupil);
  }
  if (id === 'daoba') {
    g.add(box(0.006, 0.05, 0.004, neonMaterial(0xff2a6d, 0.8), [-0.06, 1.6, 0.098]));
  }
  if (id === 'jinya') {
    g.add(box(0.012, 0.01, 0.004, neonMaterial(0xffc640, 1.5), [0.008, 1.565, 0.103]));
  }
  return g;
}

// ---------------- 义体 ----------------
const BRAND_LOOKS = {
  tianqiong: { body: 0xe9e6df, accent: 0xd4af37, metal: 0.2, rough: 0.25 },
  anvil: { body: 0x7d838a, accent: 0xff7a1a, metal: 0.8, rough: 0.35 },
  laozhou: { body: 0xb5b9bd, accent: 0x6a8caf, metal: 0.9, rough: 0.3 },
  ghost: { body: 0x4f4038, accent: 0x9c6b30, metal: 0.6, rough: 0.6 },
};

function connectorFlange(radius, look) {
  const g = new THREE.Group();
  g.add(cyl(radius, radius, 0.02, std(look.accent, 0.7, 0.3), [0, -0.01, 0], 32));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.72, 0.006, 8, 32), neonMaterial(0x05d9e8, 3));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.002;
  g.add(ring);
  // 对位缺口：朝 +Z
  g.add(box(0.025, 0.024, 0.02, neonMaterial(0xfcee0a, 2.5), [0, -0.01, radius]));
  return g;
}

export function makePlaceholderImplant(implant) {
  const look = BRAND_LOOKS[implant.brand] ?? BRAND_LOOKS.anvil;
  const body = std(look.body, look.metal, look.rough);
  const accent = std(look.accent, 0.6, 0.35);
  const g = new THREE.Group();
  g.name = `placeholder_implant_${implant.id}`;

  if (implant.slot === 'arm') {
    const slim = implant.id.includes('precision');
    const r = slim ? 0.042 : 0.052;
    g.add(connectorFlange(0.06, look));
    g.add(cyl(r + 0.006, r, 0.31, body, [0, -0.175, 0]));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), accent).translateY(-0.345));
    g.add(cyl(r, r - 0.008, 0.29, body, [0, -0.5, 0]));
    g.add(box(slim ? 0.07 : 0.09, 0.14, 0.035, body, [0, -0.72, 0]));
    if (slim) {
      for (const y of [-0.1, -0.25, -0.42, -0.58]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.002, 0.002, 6, 24), neonMaterial(0xd4af37, 1.6));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y;
        g.add(ring);
      }
    }
    if (implant.id.includes('blade')) {
      const blade = box(0.01, 0.4, 0.05, std(0xd8dde3, 1, 0.15), [0.062, -0.52, 0]);
      blade.rotation.z = -0.12;
      g.add(blade);
      g.add(box(0.004, 0.38, 0.004, neonMaterial(0x05d9e8, 3), [0.068, -0.52, 0.026]));
    }
  } else if (implant.slot === 'leg') {
    g.add(connectorFlange(0.075, look));
    g.add(cyl(0.07, 0.058, 0.3, body, [0, -0.16, 0]));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), accent).translateY(-0.33));
    for (let i = 0; i < 4; i++) g.add(box(0.012, 0.012, 0.012, neonMaterial(0x05d9e8, 3), [0.058, -0.42 - i * 0.05, 0.02]));
    const blade = box(0.035, 0.46, 0.07, std(0x1d1f23, 0.3, 0.4), [0, -0.6, 0.03]);
    blade.rotation.x = 0.18;
    g.add(blade);
    g.add(box(0.07, 0.03, 0.2, body, [0, -0.835, 0.07]));
  } else if (implant.slot === 'eye') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.0125, 20, 16), body));
    const lens = cyl(0.008, 0.009, 0.007, std(0x111111, 0.2, 0.1), [0, 0, 0.012], 20);
    lens.rotation.x = Math.PI / 2;
    g.add(lens);
    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.005, 20), neonMaterial(0xfcae1a, 3));
    iris.position.z = 0.0158;
    g.add(iris);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0135, 0.0016, 8, 28), accent);
    ring.position.z = 0.004;
    g.add(ring);
    const stub = cyl(0.004, 0.004, 0.008, accent, [0, 0, -0.014], 12);
    stub.rotation.x = Math.PI / 2;
    g.add(stub);
  } else if (implant.slot === 'face') {
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.08, 0.09, 32, 1, true, -1.15, 2.3),
      new THREE.MeshStandardMaterial({ color: look.body, metalness: look.metal, roughness: look.rough, side: THREE.DoubleSide }),
    );
    shell.position.z = -0.075;
    g.add(shell);
    for (let i = -3; i <= 3; i++) {
      const bar = box(0.004, 0.05, 0.004, neonMaterial(0x05d9e8, 2.5), [i * 0.012, 0, 0.012]);
      g.add(bar);
    }
    for (const x of [-0.05, 0, 0.05]) g.add(box(0.012, 0.01, 0.01, accent, [x, -0.048, -0.004]));
  }
  return g;
}

// 头部手术要先取下的旧部件（不切真实的脸，避免血腥）
export function makeRemovableCover(slot) {
  const g = new THREE.Group();
  if (slot === 'eye') {
    const lens = cyl(0.02, 0.02, 0.004, new THREE.MeshStandardMaterial({ color: 0x8fb8c8, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.75 }), [0, 0, 0], 24);
    lens.rotation.x = Math.PI / 2;
    g.add(lens);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.002, 8, 28), std(0x444444, 0.8, 0.4));
    g.add(rim);
  } else {
    const mask = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.075, 0.08, 28, 1, true, -1.1, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.9, side: THREE.DoubleSide }),
    );
    mask.position.z = -0.07;
    g.add(mask);
  }
  return g;
}

// ---------------- 诊所道具 ----------------
export function makePlaceholderProp(id) {
  const metal = std(0x2a2e35, 0.8, 0.45);
  const dark = std(0x15171b, 0.6, 0.6);
  const g = new THREE.Group();
  g.name = `placeholder_prop_${id}`;
  switch (id) {
    case 'surgery_rig': {
      for (const x of [-0.55, 0.55]) g.add(box(0.07, 2.2, 0.07, metal, [x, 1.1, -0.15]));
      g.add(box(1.17, 0.07, 0.07, metal, [0, 2.2, -0.15]));
      g.add(box(1.3, 0.04, 0.8, dark, [0, 0.02, 0]));
      for (const [x, y] of [[0.5, 0.85], [-0.5, 0.85], [0.18, 0.12], [-0.18, 0.12]]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 8, 24), neonMaterial(0x05d9e8, 2));
        ring.position.set(x, y, -0.1);
        g.add(ring);
      }
      g.add(box(1.0, 0.012, 0.012, neonMaterial(0xff2a6d, 2), [0, 2.15, -0.1]));
      break;
    }
    case 'surgery_lamp': {
      g.add(cyl(0.02, 0.02, 0.6, metal, [0, 0.4, 0]));
      const head = cyl(0.3, 0.34, 0.08, metal, [0, 0.06, 0], 32);
      g.add(head);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 32), neonMaterial(0xffe2b0, 2.2));
      glow.rotation.x = Math.PI / 2;
      glow.position.y = 0.015;
      g.add(glow);
      break;
    }
    case 'tool_cart': {
      g.add(box(0.7, 0.04, 0.45, metal, [0, 0.86, 0]));
      g.add(box(0.7, 0.04, 0.45, metal, [0, 0.36, 0]));
      for (const [x, z] of [[0.32, 0.2], [-0.32, 0.2], [0.32, -0.2], [-0.32, -0.2]]) g.add(box(0.03, 0.86, 0.03, dark, [x, 0.43, z]));
      for (let i = 0; i < 5; i++) g.add(box(0.012, 0.012, 0.18, std(0xcfd6dd, 1, 0.2), [-0.2 + i * 0.09, 0.89, 0]));
      break;
    }
    case 'recycle_tray': {
      g.add(cyl(0.03, 0.03, 0.78, dark, [0, 0.39, 0]));
      g.add(box(0.6, 0.04, 0.4, metal, [0, 0.8, 0]));
      for (const [x, z, w, d] of [[0, 0.2, 0.6, 0.02], [0, -0.2, 0.6, 0.02], [0.3, 0, 0.02, 0.4], [-0.3, 0, 0.02, 0.4]]) g.add(box(w, 0.08, d, metal, [x, 0.84, z]));
      g.add(box(0.5, 0.004, 0.3, neonMaterial(0xff8c1a, 1.4), [0, 0.825, 0]));
      break;
    }
    case 'implant_shelf': {
      for (const x of [-0.72, 0.72]) g.add(box(0.05, 2.0, 0.45, metal, [x, 1.0, 0]));
      for (const y of [0.3, 0.75, 1.2, 1.65]) {
        g.add(box(1.44, 0.04, 0.42, metal, [0, y, 0]));
        g.add(box(1.4, 0.01, 0.01, neonMaterial(0x05d9e8, 2), [0, y + 0.025, 0.21]));
      }
      break;
    }
    case 'laser_lv1': {
      const body = cyl(0.025, 0.03, 0.22, dark, [0, 0, 0]);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      const nozzle = cyl(0.008, 0.015, 0.1, metal, [0, 0, 0.16]);
      nozzle.rotation.x = Math.PI / 2;
      g.add(nozzle);
      g.add(box(0.06, 0.012, 0.06, std(0x333333), [0, 0.03, -0.05]));
      break;
    }
    case 'laser_lv2': {
      const pen = cyl(0.01, 0.012, 0.22, std(0xe9e6df, 0.3, 0.2), [0, 0, 0]);
      pen.rotation.x = Math.PI / 2;
      g.add(pen);
      const tip = cyl(0.002, 0.006, 0.03, neonMaterial(0xff2a6d, 3), [0, 0, 0.125]);
      tip.rotation.x = Math.PI / 2;
      g.add(tip);
      break;
    }
    case 'scanner_lv1': {
      g.add(box(0.5, 0.42, 0.42, std(0x3b3a33, 0.2, 0.8), [0, 0.21, 0]));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.28), neonMaterial(0x39ff14, 0.9));
      screen.position.set(0, 0.23, 0.211);
      g.add(screen);
      g.add(cyl(0.004, 0.004, 0.3, metal, [0.15, 0.55, 0]));
      break;
    }
    case 'scanner_lv2': {
      g.add(cyl(0.02, 0.06, 0.5, metal, [0, 0.25, 0]));
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.38),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0x05d9e8).multiplyScalar(1.4), transparent: true, opacity: 0.45, side: THREE.DoubleSide, toneMapped: false }),
      );
      panel.position.set(0, 0.72, 0);
      g.add(panel);
      g.add(box(0.6, 0.008, 0.01, neonMaterial(0x05d9e8, 3), [0, 0.53, 0]));
      break;
    }
    default:
      g.add(box(0.4, 0.4, 0.4, metal, [0, 0.2, 0]));
  }
  return g;
}

// 天花板上的机械辅助臂（升级后出现，暂无 Hi3D 资产）
export function makeAssistArm() {
  const metal = std(0x3a3f47, 0.8, 0.4);
  const g = new THREE.Group();
  g.add(cyl(0.05, 0.05, 0.3, metal, [0, -0.15, 0]));
  g.add(limb([0, -0.3, 0], [0.35, -0.65, 0.2], 0.035, metal));
  g.add(limb([0.35, -0.65, 0.2], [0.3, -0.95, 0.35], 0.03, metal));
  g.add(box(0.06, 0.02, 0.06, neonMaterial(0xff2a6d, 2.5), [0.3, -0.97, 0.35]));
  return g;
}
