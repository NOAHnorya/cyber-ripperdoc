import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
for(const file of process.argv.slice(2)) {
 const doc=await io.read(file);
 const positions=new Map(), edges=new Map(),v=[];
 let degenerate=0;
 for(const mesh of doc.getRoot().listMeshes()) for(const primitive of mesh.listPrimitives()){
  const pos=primitive.getAttribute('POSITION'), idx=primitive.getIndices(), ids=[];
  for(let i=0;i<pos.getCount();i++){
   const key=pos.getElement(i,v).join(',');
   if(!positions.has(key))positions.set(key,positions.size);
   ids.push(positions.get(key));
  }
  const count=idx?.getCount()??ids.length;
  for(let i=0;i<count;i+=3) {
   const tri=[0,1,2].map(k=>ids[idx?idx.getScalar(i+k):i+k]);
   if(new Set(tri).size<3){degenerate++;continue}
   for(let k=0;k<3;k++){
    const a=tri[k],b=tri[(k+1)%3],key=Math.min(a,b)+','+Math.max(a,b);
    const edge=edges.get(key)??{count:0,direction:0};
    edge.count++;edge.direction+=a>b?1:-1;edges.set(key,edge);
   }
  }
 }
 const counts=[...edges.values()];
 console.log(JSON.stringify({file,boundary:counts.filter(e=>e.count===1).length,nonmanifold:counts.filter(e=>e.count>2).length,winding:counts.filter(e=>e.count===2&&e.direction!==0).length,degenerate}));
}
