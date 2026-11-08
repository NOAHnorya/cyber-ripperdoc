// 绑骨后的病人 GLB 瘦身：meshopt 压缩
// 顶点位置不量化（量化会把反量化矩阵塞进骨骼逆绑定矩阵，切割着色器按绑定空间坐标算，会错位）；
// 法线 / UV / 权重量化，然后整体 meshopt 编码
// 用法：node rig-compress.mjs a.glb [b.glb ...]（原地覆盖）
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder, quantize, dedup, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const before = fs.statSync(f).size;
  const doc = await io.read(f);
  await doc.transform(
    dedup(),
    prune({ keepLeaves: true }),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^(NORMAL|TEXCOORD_\d+|WEIGHTS_\d+)$/, quantizeNormal: 8, quantizeTexcoord: 12 }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(f, doc);
  console.log(f.split('/').pop(), 'size', (before / 1e6).toFixed(1), '->', (fs.statSync(f).size / 1e6).toFixed(1), 'MB');
}
