// Rejoin an isolated missing triangle across split UV vertices after decimation.
// A longer open contour needs inspection and is never filled by this routine.
export function closeTriangularGaps(primitive) {
  const positions=primitive.getAttribute('POSITION'),indices=primitive.getIndices();
  const verts=new Map(),ids=[],coords=[],edges=new Map();
  for(let i=0;i<positions.getCount();i++){
    const key=positions.getElement(i,coords).join(',');
    if(!verts.has(key))verts.set(key,verts.size);
    ids.push(verts.get(key));
  }
  const array=indices.getArray();
  for(let i=0;i<array.length;i+=3) for(let k=0;k<3;k++){
    const a=array[i+k],b=array[i+(k+1)%3];
    const key=Math.min(ids[a],ids[b])+','+Math.max(ids[a],ids[b]);
    if(edges.has(key)) edges.delete(key); else edges.set(key,[a,b]);
  }
  const next=new Map([...edges.values()].map(([a,b])=>[ids[a],[a,b]]));
  const caps=[];
  while(next.size){
    const [a,b]=next.values().next().value;
    const second=next.get(ids[b]);
    const third=second && next.get(ids[second[1]]);
    if(!third || ids[third[1]]!==ids[a]) throw Error('Open patient contour needs inspection');
    caps.push(a,second[1],b);
    for(const i of [a,b,second[1]]) next.delete(ids[i]);
  }
  if(caps.length){
    const combined=new array.constructor(array.length+caps.length);
    combined.set(array);combined.set(caps,array.length);indices.setArray(combined);
  }
}
