import * as THREE from 'three';

// 切口路径（世界坐标的一串点）。切开和缝合共用同一条。
// ring：绕部位一圈；镜头正对时画整圈，否则只画朝向镜头的那一半多一点。
// arc：面部下颌的一段弧。
export function buildIncisionPath(slotDef, calibSlot, rootMatrix, cameraPos) {
  const inc = slotDef.incision;
  const axisLocal = new THREE.Vector3(...(calibSlot.incisionAxis ?? [0, 1, 0])).normalize();
  const centerLocal = new THREE.Vector3(...calibSlot.socket.pos);
  // 切口画在切割框的切面上（接口可能在切面里侧几厘米，比如手臂保留了一截上臂）
  if (slotDef.cutMode === 'volume' && calibSlot.cut) {
    const s = centerLocal.dot(axisLocal);
    const tMin = new THREE.Vector3(...calibSlot.cut.min).dot(axisLocal) - s;
    const tMax = new THREE.Vector3(...calibSlot.cut.max).dot(axisLocal) - s;
    const t = Math.abs(tMin) < Math.abs(tMax) ? tMin : tMax;
    if (Math.abs(t) < 0.3) centerLocal.addScaledVector(axisLocal, t);
  }
  const center = centerLocal.applyMatrix4(rootMatrix);
  const axis = axisLocal.clone().transformDirection(rootMatrix).normalize();
  const toCam = cameraPos.clone().sub(center).normalize();

  let u;
  let a0;
  let a1;
  let closed = false;
  if (inc.type === 'arc') {
    u = new THREE.Vector3(1, 0, 0).transformDirection(rootMatrix);
    u.sub(axis.clone().multiplyScalar(u.dot(axis))).normalize();
    a0 = THREE.MathUtils.degToRad(inc.fromDeg ?? 200);
    a1 = THREE.MathUtils.degToRad(inc.toDeg ?? 340);
  } else if (Math.abs(axis.dot(toCam)) > 0.7) {
    u = new THREE.Vector3(1, 0, 0);
    u.sub(axis.clone().multiplyScalar(u.dot(axis)));
    if (u.lengthSq() < 1e-6) u.set(0, 1, 0);
    u.normalize();
    a0 = 0;
    a1 = Math.PI * 2;
    closed = true;
  } else {
    u = toCam.clone().sub(axis.clone().multiplyScalar(toCam.dot(axis))).normalize();
    a0 = -1.75;
    a1 = 1.75;
  }
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const n = inc.points;
  const span = closed ? (a1 - a0) * (1 - 1 / n) : a1 - a0;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (span * i) / (n - 1);
    pts.push(
      center
        .clone()
        .addScaledVector(u, inc.radius * Math.cos(a))
        .addScaledVector(v, inc.radius * Math.sin(a)),
    );
  }
  return { points: pts, closed };
}

export function burnLine(points, closed) {
  const geo = new THREE.BufferGeometry().setFromPoints(closed ? [...points, points[0]] : points);
  const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(3, 1.2, 0.3), toneMapped: false, transparent: true });
  return new THREE.Line(geo, mat);
}
