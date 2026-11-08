import * as THREE from 'three';
import { neonColor } from './materials.js';

// 火花和"化成数据粒子"的效果
export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.systems = [];
  }

  burst(position, { color = 0x05d9e8, count = 140, speed = 0.9, life = 1.0, size = 0.012, gravity = 0.6 } = {}) {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = position.x;
      pos[i * 3 + 1] = position.y;
      pos[i * 3 + 2] = position.z;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      const s = speed * (0.3 + Math.random() * 0.7);
      vel[i * 3] = dir.x * s;
      vel[i * 3 + 1] = dir.y * s;
      vel[i * 3 + 2] = dir.z * s;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: neonColor(color, 3),
      size,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.systems.push({ points, vel, age: 0, life, gravity });
  }

  sparks(position) {
    this.burst(position, { color: 0xffb347, count: 40, speed: 1.4, life: 0.45, size: 0.008, gravity: 3 });
  }

  // 物体化成粒子消失
  dissolve(object, color = 0x05d9e8) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    this.burst(center, { color, count: 260, speed: 0.6, life: 1.3, size: 0.014, gravity: -0.4 });
    object.visible = false;
  }

  update(dt) {
    for (let i = this.systems.length - 1; i >= 0; i--) {
      const s = this.systems[i];
      s.age += dt;
      const arr = s.points.geometry.attributes.position.array;
      for (let j = 0; j < arr.length; j += 3) {
        s.vel[j + 1] -= s.gravity * dt;
        arr[j] += s.vel[j] * dt;
        arr[j + 1] += s.vel[j + 1] * dt;
        arr[j + 2] += s.vel[j + 2] * dt;
      }
      s.points.geometry.attributes.position.needsUpdate = true;
      s.points.material.opacity = Math.max(0, 1 - s.age / s.life);
      if (s.age >= s.life) {
        this.scene.remove(s.points);
        s.points.geometry.dispose();
        s.points.material.dispose();
        this.systems.splice(i, 1);
      }
    }
  }
}
