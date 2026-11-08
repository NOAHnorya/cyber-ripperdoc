import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {CylinderGeometry,Vector3,Quaternion} from 'three';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {NodeIO, getBounds} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup, meshopt, prune, simplify, textureCompress, weld} from '@gltf-transform/functions';
import {MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';
import {addTableSupports} from './table-supports.mjs';
import {closeTriangularGaps} from './close-gaps.mjs';
import {addConnector,addJawClips} from './connector.mjs';
import validator from 'gltf-validator';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const specs = await read('tools/assets.json');
const ids = process.argv.slice(2);
if (ids.some(id => !specs.some(s => s.meta.id === id))) throw Error('Unknown asset ID');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
function triangles(scene) {
  let total = 0;
  scene.traverse(node => {
    for (const p of node.getMesh()?.listPrimitives() ?? []) {
      if (p.getMode() !== 4) throw Error('Expected triangle primitives');
      total += (p.getIndices() ?? p.getAttribute('POSITION')).getCount() / 3;
    }
  });
  return total;
}
async function processAsset({meta, dimensions, triangleLimit, textureLimit, origin, calibration = {}}) {
  const input = path.resolve('raw/models/' + meta.id + '_raw.glb');
  let doc;
  if (meta.height_m || meta.id === 'surgery_rig') {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(),'clinic-patient-'));
    try {
      const output = path.join(temp,'reduced.glb');
      const macBinary = '/Applications/Blender.app/Contents/MacOS/Blender';
      const blender = process.env.BLENDER_BIN ?? (process.platform === 'darwin' ? macBinary : 'blender');
      execFileSync(blender,['-b','-t','3','--python-exit-code','1','-P',path.resolve(meta.height_m ? 'tools/decimate-patient.py' : 'tools/open-rig.py'),'--',input,output]);
      doc = await io.read(output);
      if (meta.height_m) doc.getRoot().listMaterials().forEach(m => m.setDoubleSided(true));
    } finally {
      await fs.rm(temp,{recursive:true,force:true});
    }
  } else {
    doc = await io.read(input);
  }
  const r = doc.getRoot(), scene = r.getDefaultScene() ?? r.listScenes()[0];
  for (const item of [...r.listCameras(), ...r.listAnimations()]) item.dispose();
  for (const node of r.listNodes()) node.setExtension('KHR_lights_punctual', null);
  const children = scene.listChildren();
  const pivot = doc.createNode(meta.id + '_aligned');
  children.forEach(n => pivot.addChild(n));
  pivot.setRotation(calibration.rotation ?? [0,0,0,1]);
  const scaled = doc.createNode(meta.id + '_body').addChild(pivot);
  const root = doc.createNode(meta.id).addChild(scaled);
  scene.addChild(root);
  const {min,max} = getBounds(scene);
  const extents = max.map((v,i) => v-min[i]);
  const center = min.map((v,i) => (v+max[i])/2);
  // Features are measured on the aligned, unscaled raw mesh.
  const axes = ['x','y','z'];
  const scales = axes.map((a,i) => dimensions[a] / (calibration.featureSpan?.[a] ?? extents[i]));
  const uniform = calibration.uniformScale ?? scales.find(Number.isFinite);
  if (!(uniform > 0)) throw Error(meta.id + ' requires a measured feature scale');
  const anchor = calibration.anchor ?? (origin === 'base' ? [center[0],min[1],center[2]] : null);
  if (!anchor) throw Error(meta.id + ' requires a measured connector anchor');
  pivot.setTranslation(anchor.map(v => -v));
  scaled.setScale(scales.map(v => Number.isFinite(v) ? v : uniform));
  r.listMaterials().forEach((m,i) => m.setName(meta.id + '_mat' + (i ? '_' + i : '')));
  if (origin === 'flange') addConnector(doc,root,meta.slot === 'leg' ? .15 : .12,meta.wires);
  if (meta.slot === 'eye' && origin === 'sphere') {
    const socket = addConnector(doc,root,.01,meta.wires);
    socket.setRotation([-Math.SQRT1_2,0,0,Math.SQRT1_2]).setTranslation(calibration.connectorPosition ?? [0,0,-.0118]);
  }
  if (meta.slot === 'face' && origin === 'inner') {
    addJawClips(doc,root);
    const socket=addConnector(doc,root,.024,meta.wires);
    socket.setRotation([-Math.SQRT1_2,0,0,Math.SQRT1_2]).setTranslation(calibration.connectorPosition ?? [0,-.022,.009]);
  }
  if (meta.id === 'surgery_lamp') {
    // The reconstruction has a gap between the ceiling pivot and the lamp head.
    const start=new Vector3(0,.025,-.055),end=new Vector3(0,-.215,.09);
    const delta=end.clone().sub(start);
    const geometry=new CylinderGeometry(.016,.019,delta.length(),20);
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),delta.normalize()));
    const middle=start.clone().lerp(end,.5);
    geometry.translate(middle.x,middle.y,middle.z);
    const support=doc.createPrimitive().setMaterial(doc.createMaterial('lamp_joint_steel').setBaseColorFactor([.24,.25,.26,1]).setMetallicFactor(.7).setRoughnessFactor(.45));
    for(const [key,semantic] of [['position','POSITION'],['normal','NORMAL']]){
      support.setAttribute(semantic,doc.createAccessor().setType('VEC3').setArray(geometry.getAttribute(key).array).setBuffer(r.listBuffers()[0]));
    }
    support.setIndices(doc.createAccessor().setType('SCALAR').setArray(geometry.index.array).setBuffer(r.listBuffers()[0]));
    pivot.addChild(doc.createNode('lamp_joint').setMesh(doc.createMesh().addPrimitive(support)));
  }
  if (meta.id === 'surgery_table') addTableSupports(doc,root);
  await doc.transform(dedup(), weld(), prune());
  for (const error of [.001,.005,.02,.06]) {
    const count = triangles(scene);
    if (count <= triangleLimit) break;
    await doc.transform(simplify({simplifier:MeshoptSimplifier,ratio:.96*triangleLimit/count,error}));
  }
  if (triangles(scene) > triangleLimit) throw Error(meta.id + ' exceeds triangle budget');
  await doc.transform(textureCompress({encoder:sharp,targetFormat:'webp',resize:[textureLimit,textureLimit],quality:82}), meshopt({encoder:MeshoptEncoder,quantizePosition:meta.height_m ? 16 : 14}));
  if (meta.height_m) for (const mesh of r.listMeshes()) mesh.listPrimitives().forEach(closeTriangularGaps);
  const bytes = await io.writeBinary(doc);
  const loaded = await io.readBinary(bytes);
  const result = loaded.getRoot().getDefaultScene() ?? loaded.getRoot().listScenes()[0];
  const bounds = getBounds(result);
  const size_m = bounds.max.map((v,i) => +(v-bounds.min[i]).toFixed(6));
  const check = await validator.validateBytes(bytes);
  if (check.issues.numErrors) throw Error(JSON.stringify(check.issues.messages));
  if (bytes.length > (meta.height_m ? 8 : meta.model.startsWith('models/implants/') ? 3 : 5)*1e6) throw Error(meta.id + ' exceeds file budget');
  const out = path.join('public',meta.model);
  await fs.mkdir(path.dirname(out),{recursive:true});
  await fs.writeFile(out+'.tmp',bytes);
  await fs.rename(out+'.tmp',out);
  const tris = triangles(result);
  console.log(JSON.stringify({id:meta.id,tris,size_m,bytes:bytes.length}));
  return {...meta,size_m,tris};
}
for (const group of ['implants','patients','props']) {
  const selected = specs.filter(s => s.meta.model.split('/')[1] === group && (!ids.length || ids.includes(s.meta.id)));
  if (!selected.length) continue;
  const file = 'src/data/' + group + '.json';
  const records = await read(file).catch(e => {if (e.code === 'ENOENT') return []; throw e;});
  for (const s of selected) {
    const entry = await processAsset(s);
    if (entry.thumb) {
      const thumb = path.join('public',entry.thumb);
      await fs.mkdir(path.dirname(thumb),{recursive:true});
      const cover = sharp('raw/covers/'+entry.id+'.image');
      if (group === 'implants') cover.resize(512,512,{fit:'contain',background:'white'});
      await cover.png().toFile(thumb+'.tmp');
      await fs.rename(thumb+'.tmp',thumb);
    }
    const index = records.findIndex(r => r.id === entry.id);
    if (index < 0) records.push(entry);
    else {
      if (entry.slots) entry.slots = records[index].slots ?? {};
      records[index] = {...records[index], ...entry};
    }
    records.sort((a,b) => specs.findIndex(s => s.meta.id === a.id) - specs.findIndex(s => s.meta.id === b.id));
    await fs.writeFile(file + '.tmp',JSON.stringify(records,null,2)+'\n');
    await fs.rename(file+'.tmp',file);
  }
}
