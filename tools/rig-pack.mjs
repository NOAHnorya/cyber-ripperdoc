// 把 Meshy 下载的绑骨模型和动作压缩后放进游戏：贴图转 WebP、去掉重复关键帧，
// 输出 public/models/patients/rigged/patient_<id>.glb 和 patient_<id>_anims.glb，并在 patients.json 里登记。
// 用法：node tools/rig-pack.mjs [patientId ...]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['aqiang', 'jinya', 'xiaolin', 'lili', 'daoba'];
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const outDir = path.join(root, 'public/models/patients/rigged');
fs.mkdirSync(outDir, { recursive: true });
const patientsFile = path.join(root, 'src/data/patients.json');
const patients = JSON.parse(fs.readFileSync(patientsFile, 'utf8'));

function describe(doc) {
  const r = doc.getRoot();
  return `meshes ${r.listMeshes().length}, skins ${r.listSkins().length}, anims ${r.listAnimations().map((a) => a.getName()).join(' | ') || '无'}`;
}

for (const id of ids) {
  const rigIn = path.join(root, `raw/rig/rigged_${id}.glb`);
  const animIn = path.join(root, `raw/rig/anim_${id}.glb`);
  if (!fs.existsSync(rigIn)) {
    console.log(`${id}: 还没有绑骨结果，跳过`);
    continue;
  }
  const rig = await io.read(rigIn);
  console.log(`${id} rigged: ${describe(rig)}`);
  await rig.transform(dedup(), resample(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048] }));
  const rigOut = path.join(outDir, `patient_${id}.glb`);
  await io.write(rigOut, rig);
  const entry = patients.find((p) => p.id === id);
  entry.rigged = path.relative(path.join(root, 'public'), rigOut);

  if (fs.existsSync(animIn)) {
    const anim = await io.read(animIn);
    console.log(`${id} anims: ${describe(anim)}`);
    // 动作文件只需要骨架和动画：去掉网格和贴图，省一大半体积
    for (const node of anim.getRoot().listNodes()) node.setMesh(null);
    for (const mesh of anim.getRoot().listMeshes()) mesh.dispose();
    await anim.transform(dedup(), resample(), prune({ keepLeaves: true }));
    const animOut = path.join(outDir, `patient_${id}_anims.glb`);
    await io.write(animOut, anim);
    entry.riggedAnims = path.relative(path.join(root, 'public'), animOut);
  }
  const size = (f) => (fs.existsSync(f) ? (fs.statSync(f).size / 1e6).toFixed(1) + ' MB' : '-');
  console.log(`${id}: ${size(rigOut)} + 动作 ${size(path.join(outDir, `patient_${id}_anims.glb`))}`);
}
fs.writeFileSync(patientsFile, JSON.stringify(patients, null, 2) + '\n');
