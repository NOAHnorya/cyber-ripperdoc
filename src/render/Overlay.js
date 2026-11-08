import * as THREE from 'three';

const tmp = new THREE.Vector3();

// 叠在 3D 画面上的 2D 画布：画切口虚线、节拍圈、激光点
export class Overlay {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  // 世界坐标 → 屏幕 CSS 像素
  project(v) {
    tmp.copy(v).project(this.camera);
    return {
      x: (tmp.x * 0.5 + 0.5) * this.width,
      y: (-tmp.y * 0.5 + 0.5) * this.height,
      behind: tmp.z > 1,
    };
  }

  // 屏幕点 → 指定平面上的世界坐标
  unproject(p, plane) {
    const ndc = new THREE.Vector2((p.x / this.width) * 2 - 1, -(p.y / this.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? hit : null;
  }

  glowLine(points, color, width = 3, dash = null, alpha = 1) {
    if (points.length < 2) return;
    const g = this.ctx;
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.shadowColor = color;
    g.shadowBlur = 12;
    g.setLineDash(dash ?? []);
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
    g.stroke();
    g.restore();
  }

  circle(p, r, color, width = 2, fill = null, alpha = 1) {
    const g = this.ctx;
    g.save();
    g.globalAlpha = alpha;
    g.shadowColor = color;
    g.shadowBlur = 10;
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
    g.restore();
  }

  text(str, p, color = '#fcee0a', size = 14) {
    const g = this.ctx;
    g.save();
    g.font = `700 ${size}px "Share Tech Mono", ui-monospace, monospace`;
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 8;
    g.textAlign = 'center';
    g.fillText(str, p.x, p.y);
    g.restore();
  }
}
