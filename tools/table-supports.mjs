import {CylinderGeometry} from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

// The unrigged patients keep their A-pose. Raise the two forearm pads above
// the folding boards; a heel pad bridges the gap left by the rigid ankles.
export function addTableSupports(doc, root) {
  const cushion=doc.createMaterial('table_support_vinyl').setBaseColorFactor([.051,.089,.099,1]).setRoughnessFactor(.78);
  const steel=doc.createMaterial('table_support_steel').setBaseColorFactor([.24,.27,.26,1]).setMetallicFactor(.7).setRoughnessFactor(.39);
  const buffer=doc.getRoot().listBuffers()[0];
  const centerX=-.207;
  function add(name, geometry, material, position) {
    const primitive=doc.createPrimitive().setMaterial(material);
    for(const [key,semantic] of [['position','POSITION'],['normal','NORMAL']]){
      primitive.setAttribute(semantic,doc.createAccessor().setType('VEC3').setArray(geometry.getAttribute(key).array).setBuffer(buffer));
    }
    if(geometry.index)primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(geometry.index.array).setBuffer(buffer));
    root.addChild(doc.createNode(name).setTranslation(position).setMesh(doc.createMesh(name).addPrimitive(primitive)));
  }
  for(const side of [-1,1]){
    const x=centerX+side*.412;
    add('armrest_post_'+side,new CylinderGeometry(.032,.041,.147,20),steel,[x,.853,-.205]);
    const pad=new RoundedBoxGeometry(.19,.055,.47,3,.020);
    pad.rotateX(-.18).rotateY(.62*side);
    add('armrest_pad_'+side,pad,cushion,[x,.925,-.205]);
  }
  add('heel_pad',new RoundedBoxGeometry(.54,.045,.20,3,.02),cushion,[centerX,.86,.72]);
}
