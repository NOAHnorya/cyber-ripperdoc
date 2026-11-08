// 把游戏里的病人模型（Meshopt 压缩 + 量化 + WebP 贴图）转成 Meshy 能读的普通 GLB（无压缩、PNG 贴图）
// 用法：node tools/rig-prep.mjs [patientId ...]   输出到 raw/rig/input_<id>.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['aqiang', 'jinya', 'xiaolin', 'lili', 'daoba'];
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
fs.mkdirSync(path.join(root, 'raw/rig'), { recursive: true });

for (const id of ids) {
  const src = path.join(root, `public/models/patients/patient_${id}.glb`);
  const doc = await io.read(src);
  await doc.transform(dequantize(), textureCompress({ encoder: sharp, targetFormat: 'png' }));
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (['EXT_meshopt_compression', 'KHR_mesh_quantization', 'EXT_texture_webp'].includes(ext.extensionName)) ext.dispose();
  }
  const out = path.join(root, `raw/rig/input_${id}.glb`);
  await io.write(out, doc);
  const tris = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  console.log(`${id}: ${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${tris} tris -> ${path.relative(root, out)}`);
}
