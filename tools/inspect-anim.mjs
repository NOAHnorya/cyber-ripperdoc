// 查看 GLB 里的动画：名字、时长、通道数、通道目标
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  console.log('==', f, 'nodes', root.listNodes().length, 'skins', root.listSkins().map(s => s.listJoints().length));
  for (const a of root.listAnimations()) {
    const ch = a.listChannels();
    let dur = 0;
    for (const s of a.listSamplers()) { const t = s.getInput().getArray(); dur = Math.max(dur, t[t.length - 1]); }
    const paths = {};
    for (const c of ch) paths[c.getTargetPath()] = (paths[c.getTargetPath()] || 0) + 1;
    console.log(' ', a.getName(), 'dur', dur.toFixed(2), 'ch', ch.length, JSON.stringify(paths), ch.slice(0, 3).map(c => c.getTargetNode()?.getName()).join(','));
  }
}
