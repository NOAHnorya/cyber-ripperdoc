import {Shape,Path,ExtrudeGeometry,CylinderGeometry} from 'three';

// Dimensions are metres. The keyed face sits on XZ at y=0, with its gap toward +Z.
export function addConnector(doc, parent, diameter, pins) {
  const radius = diameter / 2;
  const buffer = doc.getRoot().listBuffers()[0];
  const node = doc.createNode('connector');
  parent.addChild(node);
  const metal = doc.createMaterial('connector_steel').setBaseColorFactor([.21,.24,.26,1]).setMetallicFactor(.8).setRoughnessFactor(.4);
  const gold = doc.createMaterial('contact_gold').setBaseColorFactor([.92,.56,.17,1]).setMetallicFactor(.75).setRoughnessFactor(.32);
  function part(geometry, material, name) {
    const mesh = doc.createMesh(name);
    const primitive = doc.createPrimitive().setMaterial(material);
    for (const [key,semantic] of [['position','POSITION'],['normal','NORMAL']]) {
      const array = geometry.getAttribute(key).array;
      primitive.setAttribute(semantic,doc.createAccessor().setType('VEC3').setArray(array).setBuffer(buffer));
    }
    if (geometry.index) primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(geometry.index.array).setBuffer(buffer));
    node.addChild(doc.createNode(name).setMesh(mesh.addPrimitive(primitive)));
  }
  const shape = new Shape();
  const segments = 96;
  for(let i=0;i<=segments;i++){
    const angle = i*2*Math.PI/segments;
    const r = (i<=3 || i>=segments-3) ? radius*.79 : radius;
    const x=r*Math.sin(angle), y=-r*Math.cos(angle);
    if(i===0) shape.moveTo(x,y);else shape.lineTo(x,y);
  }
  shape.closePath();
  const hole=new Path();hole.absarc(0,0,.48*radius,0,Math.PI*2,true);shape.holes.push(hole);
  const ring=new ExtrudeGeometry(shape,{depth:.16*radius,bevelEnabled:false,curveSegments:36});
  ring.translate(0,0,-.2*radius).rotateX(-Math.PI/2);
  part(ring,metal,'keyed_flange');
  for(let i=0;i<pins;i++){
    const a=(i+.5)*2*Math.PI/pins;
    const contact=new CylinderGeometry(.085*radius,.085*radius,.08*radius,16);
    contact.translate(.67*radius*Math.sin(a),-.04*radius,.67*radius*Math.cos(a));
    part(contact,gold,'pin_'+(i+1));
  }
  return node;
}

// Three inward-facing spring clips latch the jaw shell to the patient.
export function addJawClips(doc,parent) {
  const points=[[-.035,-.045,.009],[0,-.054,.011],[.035,-.045,.009]];
  const mat=doc.createMaterial('jaw_clip_gold').setBaseColorFactor([.65,.36,.08,1]).setMetallicFactor(.7).setRoughnessFactor(.35);
  for(const [index,point] of points.entries()){
    const section=new Shape();
    section.moveTo(0,0);section.lineTo(0,.013);section.lineTo(.002,.013);section.lineTo(.002,.003);
    section.lineTo(.007,.003);section.lineTo(.007,.007);section.lineTo(.009,.007);section.lineTo(.009,0);section.closePath();
    const geometry=new ExtrudeGeometry(section,{depth:.007,bevelEnabled:false});
    geometry.rotateY(Math.PI/2);geometry.translate(-.0035,0,0);
    const p=doc.createPrimitive().setMaterial(mat);
    for(const [key,semantic] of [['position','POSITION'],['normal','NORMAL']]){
      p.setAttribute(semantic,doc.createAccessor().setType('VEC3').setArray(geometry.getAttribute(key).array).setBuffer(doc.getRoot().listBuffers()[0]));
    }
    parent.addChild(doc.createNode('jaw_clip_'+(index+1)).setTranslation(point).setMesh(doc.createMesh().addPrimitive(p)));
  }
}
