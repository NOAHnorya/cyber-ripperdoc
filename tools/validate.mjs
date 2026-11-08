import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {NodeIO,getBounds} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import sharp from 'sharp';
import validator from 'gltf-validator';

process.chdir(fileURLToPath(new URL('..',import.meta.url)));
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const specs=await read('tools/assets.json');
for(const group of ['implants','patients','props']){
  const data=await read('src/data/'+group+'.json');
  const expected=specs.filter(s=>s.meta.model.startsWith('models/'+group+'/'));
  assert.deepEqual(data.map(e=>e.id).sort(),expected.map(s=>s.meta.id).sort());
  for(const e of data){
    const spec=expected.find(s=>s.meta.id===e.id);
    const bytes=await fs.readFile('public/'+e.model);
    const {issues}=await validator.validateBytes(bytes);
    assert.equal(issues.numErrors,0,JSON.stringify(issues.messages));
    assert.ok(bytes.length<=(group==='patients'?8:group==='implants'?3:5)*1e6);
    const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
    assert.equal(json.asset.version,'2.0');
    assert.ok(json.buffers.every(b=>!b.uri));
    assert.ok(json.images.every(i=>!i.uri && i.bufferView!==undefined && i.mimeType==='image/webp'));
    assert.ok(json.extensionsUsed.includes('EXT_meshopt_compression'));
    assert.ok(!json.cameras?.length && !json.animations?.length && !json.extensions?.KHR_lights_punctual);
    const root=(await io.readBinary(bytes)).getRoot(),scene=root.listScenes()[0];
    assert.equal(scene.listChildren().length,1);
    assert.equal(scene.listChildren()[0].getName(),e.id);
    const bounds=getBounds(scene);
    const size=bounds.max.map((m,i)=>m-bounds.min[i]);
    size.forEach((m,i)=>assert.ok(Math.abs(e.size_m[i]-m)<.00001,e.id+' bounds differ'));
    for(const [axis,limit] of Object.entries(spec.dimensions)){
      if(spec.calibration?.featureSpan?.[axis])continue;
      assert.ok(Math.abs(size['xyz'.indexOf(axis)]/limit-1)<=.05,e.id+' dimension '+axis);
    }
    if(group!=='implants')assert.ok(Math.abs(bounds.min[1])<=.01);
    let tris=0;
    scene.traverse(n=>{for(const p of n.getMesh()?.listPrimitives()??[])tris+=(p.getIndices()??p.getAttribute('POSITION')).getCount()/3});
    assert.equal(tris,e.tris);
    assert.ok(tris<=spec.triangleLimit);
    for(const texture of root.listTextures()){
      const {width,height}=await sharp(texture.getImage()).metadata();
      assert.ok(Math.max(width,height)<=spec.textureLimit);
    }
    if(e.thumb){const {format}=await sharp('public/'+e.thumb).metadata();assert.equal(format,'png')}
    if(group==='implants'){
      const thumb=await sharp('public/'+e.thumb).metadata();
      assert.deepEqual([thumb.width,thumb.height],[512,512]);
      const names=root.listNodes().map(n=>n.getName());
      assert.ok(names.includes('connector'));
      for(let i=1;i<=e.wires;i++)assert.ok(names.includes('pin_'+i));
    }
    console.log(e.id,tris,bytes.length);
  }
}
