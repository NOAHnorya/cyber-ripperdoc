globalThis.self = globalThis; globalThis.window = globalThis;
import * as THREE from 'three';
import fs from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const P = process.env.HOME + '/mnt/黑客松：义体诊所/';
const OUT = process.argv[2] === 'write';
const def = JSON.parse(fs.readFileSync(P + 'src/data/calibration/default_patient.json'));
const patients = JSON.parse(fs.readFileSync(P + 'src/data/patients.json'));
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
console.warn = () => {}; const err = console.error; console.error = () => {};
const r4 = (v) => +v.toFixed(4);
const max = (a) => a.reduce((m, x) => (x > m ? x : m), -Infinity);
const min = (a) => a.reduce((m, x) => (x < m ? x : m), Infinity);
const ARM_LEN = 0.75, LEG_LEN = 0.85;

for (const p of patients) {
  const buf = fs.readFileSync(P + 'public/' + p.model);
  const gltf = await new Promise((r, j) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', r, j));
  const scene = gltf.scene; scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene); const size = box.getSize(new THREE.Vector3());
  const s = Math.abs(size.y - 1.75) / 1.75 > 0.05 ? 1.75 / size.y : 1; const c = box.getCenter(new THREE.Vector3());
  const pts = []; const v = new THREE.Vector3();
  scene.traverse(o => { if (!o.isMesh) return; const pos = o.geometry.attributes.position; for (let i = 0; i < pos.count; i += 2) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); pts.push(new THREE.Vector3((v.x - c.x) * s, (v.y - box.min.y) * s, (v.z - c.z) * s)); } });
  const top = max(pts.map(q => q.y));

  // ---- 手臂（左 = +X）：每个高度层找躯干和手臂之间的空隙 ----
  let torsoEdge = 0, armpit = 0;
  for (let y = 0.7; y <= 1.4; y += 0.02) {
    const xs = pts.filter(q => q.y >= y && q.y < y + 0.02 && q.x > 0).map(q => q.x).sort((a, b) => a - b);
    let best = 0, at = -1;
    for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > best) { best = xs[i] - xs[i - 1]; at = i; }
    if (best > 0.015 && xs[at - 1] < 0.35) { torsoEdge = Math.max(torsoEdge, xs[at - 1]); armpit = Math.max(armpit, y); }
  }
  const cutX = torsoEdge + 0.012;
  const centroid = (arr) => arr.reduce((a, q) => a.add(q), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, arr.length));
  const ring = pts.filter(q => q.x >= cutX && q.x < cutX + 0.03 && q.y > armpit - 0.15 && q.y < armpit + 0.12);
  const sock = centroid(ring);
  // 沿手臂追踪：先用上臂一小段定方向，再取离轴线 10 cm 以内的点
  const upper = pts.filter(q => q.x > cutX + 0.07 && q.x < cutX + 0.12 && q.y > armpit - 0.35 && q.y < armpit + 0.05);
  let dir = centroid(upper).sub(sock).normalize();
  const along = (q) => q.clone().sub(sock).dot(dir);
  const off = (q) => q.clone().sub(sock).sub(dir.clone().multiplyScalar(along(q))).length();
  let armPts = pts.filter(q => q.x > cutX && along(q) > 0 && along(q) < 0.95 && off(q) < 0.1);
  const mid = armPts.filter(q => along(q) > 0.12 && along(q) < 0.35);
  if (mid.length > 20) dir = centroid(mid).sub(sock).normalize();
  armPts = pts.filter(q => q.x > cutX && along(q) > 0 && along(q) < 0.95 && off(q) < 0.11);
  const armLen = max(armPts.map(along));
  const armMinY = min(armPts.map(q => q.y));
  const armRotZ = Math.atan2(dir.x, -dir.y);
  const arm = {
    cut: { min: [r4(cutX), r4(armMinY - 0.03), -0.3], max: [1.2, r4(top - 0.15), 0.3] },
    socket: { pos: [r4(sock.x), r4(sock.y), r4(sock.z)], rot: [0, 0, r4(armRotZ)], scale: r4(armLen / ARM_LEN) },
    incisionAxis: [1, 0, 0],
  };

  // ---- 腿：找两腿分开的最高处（裆部），在下面 5 cm 切 ----
  let crotch = 0.3;
  for (let y = 0.3; y <= 1.0; y += 0.01) {
    const near = pts.filter(q => q.y >= y && q.y < y + 0.01 && Math.abs(q.x) < 0.02);
    if (near.length === 0) crotch = y; else if (y > 0.5) break;
  }
  const cutY = crotch - 0.06;
  const legRing = pts.filter(q => q.x > 0.005 && Math.abs(q.y - cutY) < 0.01);
  const legSock = legRing.reduce((a, q) => a.add(q), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, legRing.length));
  // 两腿内侧粘连时，内侧顶点会把平均值拉向中线；X 改用左右边缘的中点
  if (legRing.length) {
    const xs = legRing.map(q => q.x);
    legSock.x = (Math.min(...xs) + Math.max(...xs)) / 2;
  }
  const leg = {
    cut: { min: [0.005, -0.05, -0.35], max: [0.5, r4(cutY), 0.4] },
    socket: { pos: [r4(legSock.x), r4(cutY), r4(legSock.z)], rot: [0, 0, 0], scale: r4(cutY / LEG_LEN) },
    incisionAxis: [0, 1, 0],
  };

  // ---- 眼睛和下半张脸：从头顶往下按比例找高度，取脸的最前面 ----
  const frontZ = (x, y, dx = 0.012, dy = 0.012) => {
    const zs = pts.filter(q => Math.abs(q.x - x) < dx && Math.abs(q.y - y) < dy).map(q => q.z);
    return zs.length ? max(zs) : null;
  };
  const headPts = pts.filter(q => q.y > top - 0.26);
  const headFront = max(headPts.map(q => q.z));
  // 鼻尖 = 脸中线上最靠前的点；眼睛在鼻尖上方约 3.2 cm（只按头顶比例算会被头发顶高，落到眉毛上）
  const nosePts = pts.filter(q => Math.abs(q.x) < 0.01 && q.y > top - 0.24 && q.y < top - 0.1);
  const noseTip = nosePts.reduce((a, q) => (q.z > a.z ? q : a), nosePts[0] ?? { y: top - 0.15, z: 0 });
  const eyeY = noseTip.y + 0.032, mouthY = top - 0.19;
  const eyeZ = frontZ(0.033, eyeY, 0.012, 0.006) ?? headFront;
  const mouthZ = frontZ(0, mouthY) ?? headFront;
  const dEye = eyeY - def.slots.eye.socket.pos[1];
  const eyeCut = { min: def.slots.eye.cut.min.map((v, i) => (i === 1 ? r4(v + dEye) : v)), max: def.slots.eye.cut.max.map((v, i) => (i === 1 ? r4(v + dEye) : v)) };
  const eye = { cut: eyeCut, socket: { pos: [0.033, r4(eyeY), r4(eyeZ - 0.004)], rot: [0, 0, 0] }, incisionAxis: [0, 0, 1] };
  const face = { cut: def.slots.face.cut, socket: { pos: [0, r4(mouthY), r4(mouthZ - 0.02)], rot: [0, 0, 0] }, incisionAxis: [0, 0, 1] };

  const out = { patient: p.id, auto: true, slots: { arm, leg, eye, face } };
  console.log(`${p.id}: top=${top.toFixed(3)} torsoEdge=${torsoEdge.toFixed(3)} armpit=${armpit.toFixed(2)} armRot=${(armRotZ*57.3).toFixed(0)}° armLen=${armLen.toFixed(2)} crotch=${crotch.toFixed(2)} noseY=${noseTip.y.toFixed(3)} eyeY=${eyeY.toFixed(3)} eyeZ=${eyeZ?.toFixed(3)} mouthZ=${mouthZ?.toFixed(3)}`);
  if (OUT) fs.writeFileSync(P + `src/data/calibration/patient_${p.id}.json`, JSON.stringify(out, null, 2) + '\n');
}
console.error = err;
