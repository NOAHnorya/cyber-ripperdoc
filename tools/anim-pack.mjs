// 把带动作的角色 GLB 瘦身成“只有骨骼+动画”的共用动作包
// - 去掉网格、皮肤、材质、贴图
// - 只保留旋转通道 + Hips 的位移（不同角色骨长不同，位移/缩放通道会把别人的身体拉变形）
// - 重采样去掉冗余关键帧
// 用法：node anim-pack.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, resample, dedup } from '@gltf-transform/functions';
const [inp, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inp);
const root = doc.getRoot();
for (const n of root.listNodes()) { n.setMesh(null); n.setSkin(null); }
// 每个动作各带一副骨架（可能来自不同角色）：把通道都指到第一副骨架的同名骨头上，多余骨架删掉
// （否则 three.js 加载时会把重名骨头改成 xxx_1，动作就套不上角色了）
const canonical = new Map();
for (const n of root.listNodes()) if (!canonical.has(n.getName())) canonical.set(n.getName(), n);
for (const a of root.listAnimations())
  for (const c of a.listChannels()) c.setTargetNode(canonical.get(c.getTargetNode().getName()));
const keep = new Set(canonical.values());
let removed = 0;
for (const n of root.listNodes()) if (!keep.has(n)) { n.dispose(); removed++; }
for (const n of root.listNodes())
  if (/^rig_/.test(n.getName()) && n.listChildren().length === 0) { n.dispose(); removed++; }
console.log('merged skeletons, removed nodes', removed);
for (const m of root.listMeshes()) m.dispose();
for (const s of root.listSkins()) s.dispose();
for (const m of root.listMaterials()) m.dispose();
for (const t of root.listTextures()) t.dispose();
let kept = 0, dropped = 0;
for (const a of root.listAnimations()) {
  for (const c of a.listChannels()) {
    const path = c.getTargetPath();
    const name = c.getTargetNode()?.getName() || '';
    const isHips = /hips$/i.test(name);
    if (path === 'rotation' || (path === 'translation' && isHips)) { kept++; continue; }
    const s = c.getSampler(); c.dispose(); if (s && !s.listParents().some(p => p !== root && p.propertyType === 'AnimationChannel')) s.dispose();
    dropped++;
  }
}
await doc.transform(resample({ tolerance: 1e-4 }), dedup(), prune({ keepLeaves: true }));
await io.write(out, doc);
console.log('channels kept', kept, 'dropped', dropped);
for (const a of root.listAnimations()) {
  let dur = 0, keys = 0;
  for (const s of a.listSamplers()) { const t = s.getInput().getArray(); dur = Math.max(dur, t[t.length - 1]); keys += t.length; }
  console.log(' ', a.getName(), 'dur', dur.toFixed(2), 'ch', a.listChannels().length, 'keys', keys);
}
