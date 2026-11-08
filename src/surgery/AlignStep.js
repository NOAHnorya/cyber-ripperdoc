import * as THREE from 'three';
import { alignScore } from '../systems/scoring.js';
import { toHologram, disposeHologram } from '../render/materials.js';

const DEG = Math.PI / 180;
// 按键 -> [转向, 倾斜] 方向
const KEY_DIR = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
};

// 第 3 步 对位：拖动旋转义体，让卡口对准接口（全息虚影是目标姿态），变绿后点击锁定
export class AlignStep {
  static key = 'align';
  static title = '对位';
  static hint = '← → 旋转，↑ ↓ 微调。虚影变绿后按回车或空格锁定';

  constructor(ctx) {
    this.ctx = ctx;
  }

  start() {
    const { game, slotKey, slotDef, fx, tolFactor } = this.ctx;
    this.holder = this.ctx.holder;
    this.mainAxis = slotDef.mainAxis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    this.tiltAxis = new THREE.Vector3(1, 0, 0);
    this.axes = slotDef.align.axes;
    this.tol = slotDef.align.tolDeg * tolFactor + (fx.alignTolBonusDeg ?? 0);
    const outward = slotDef.mainAxis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, -1, 0);
    this.hoverOffset = outward.multiplyScalar(slotDef.align.hover);
    this.holder.position.copy(this.hoverOffset);
    this.holder.visible = true;

    const sign = () => (Math.random() < 0.5 ? -1 : 1);
    this.yaw = sign() * (50 + Math.random() * 60);
    this.tilt = this.axes === 2 ? sign() * (18 + Math.random() * 14) : 0;
    this.apply();

    // 目标姿态的全息虚影
    this.ghost = this.holder.children[0].clone(true);
    this.ghost.scale.multiply(this.holder.scale);
    this.ghostMat = toHologram(this.ghost, 0x05d9e8, 0.5);
    game.rig.sockets[slotKey].add(this.ghost);

    this.attempts = 0;
    this.locked = false;
    this.down = null;
    // 方向键 / WASD 按住旋转（比拖鼠标好控制），按住 Shift 微调
    this.keys = new Set();
    this.held = 0;
    this.onKeyUp = (e) => {
      this.keys.delete(e.code);
      this.fine = e.shiftKey;
    };
    this.onBlur = () => this.onPause();
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    if (this.axes === 2) game.ui.stepHintUpdate('← → 旋转，↑ ↓ 倾斜。虚影变绿后按回车或空格锁定');
    game.director.focusSlot(slotKey, game.rig.socketWorld(slotKey), 0.7);
    return new Promise((resolve) => (this.resolve = resolve));
  }

  apply() {
    const q1 = new THREE.Quaternion().setFromAxisAngle(this.mainAxis, this.yaw * DEG);
    const q2 = new THREE.Quaternion().setFromAxisAngle(this.tiltAxis, this.tilt * DEG);
    this.holder.quaternion.copy(q1).multiply(q2);
  }

  error() {
    const w = Math.min(1, Math.abs(this.holder.quaternion.w));
    return (2 * Math.acos(w)) / DEG;
  }

  onPointerDown(p) {
    this.down = { x: p.x, y: p.y, moved: 0 };
    this.last = p;
  }

  onPointerMove(p) {
    if (!this.down || this.locked) return;
    const dx = p.x - this.last.x;
    const dy = p.y - this.last.y;
    this.last = p;
    this.down.moved += Math.abs(dx) + Math.abs(dy);
    this.rotate(dx * 0.5, dy * 0.4);
  }

  rotate(yaw, tilt) {
    this.yaw = ((this.yaw + yaw + 540) % 360) - 180;
    if (this.axes === 2) this.tilt = Math.max(-80, Math.min(80, this.tilt + tilt));
    this.apply();
  }

  onPause() {
    this.down = null;
    this.keys?.clear();
    this.held = 0;
    this.fine = false;
  }

  turnWithKeys(horizontal, vertical, degrees) {
    if (this.axes === 1) this.rotate((horizontal + vertical * 0.25) * degrees, 0);
    else this.rotate(horizontal * degrees, vertical * degrees * 0.7);
  }

  keyRotate(dt) {
    if (this.locked || !this.keys.size) {
      this.held = 0;
      return;
    }
    let horizontal = 0;
    let vertical = 0;
    for (const code of this.keys) {
      horizontal += KEY_DIR[code][0];
      vertical += KEY_DIR[code][1];
    }
    this.held += dt;
    const near = Math.min(1, Math.max(0.3, this.error() / (this.tol * 3)));
    const speed = (this.fine ? 22 : 35 + Math.min(1, this.held / 0.7) * 85) * near;
    this.turnWithKeys(Math.sign(horizontal), Math.sign(vertical), speed * dt);
  }

  onPointerUp() {
    if (this.down && this.down.moved < 6) this.tryLock();
    this.down = null;
  }

  onKey(e) {
    this.fine = e.shiftKey;
    const direction = KEY_DIR[e.code];
    if (direction) {
      e.preventDefault();
      if (e.repeat || this.locked || this.keys.has(e.code)) return;
      if (this.keys.size === 0) this.held = 0;
      this.keys.add(e.code);
      // Give even a tap between two rendered frames a visible response.
      this.turnWithKeys(...direction, this.fine ? 1 : 3);
    } else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      if (!e.repeat) this.tryLock();
    }
  }

  tryLock() {
    if (this.locked) return;
    const err = this.error();
    this.attempts++;
    if (err > this.tol) {
      this.ctx.penalize('没对准');
      return;
    }
    this.locked = true;
    this.ctx.game.sfx.snap();
    this.lockAnim = { t: 0, fromPos: this.holder.position.clone(), fromQ: this.holder.quaternion.clone() };
    this.lockErr = err;
  }

  update(dt) {
    this.keyRotate(dt);
    if (!this.lockAnim) {
      const ok = this.error() <= this.tol;
      this.ghostMat?.uniforms.uColor.value.set(ok ? 0x39ff14 : 0x05d9e8);
      return;
    }
    const a = this.lockAnim;
    a.t = Math.min(1, a.t + dt / 0.35);
    this.holder.position.lerpVectors(a.fromPos, new THREE.Vector3(), a.t);
    this.holder.quaternion.slerpQuaternions(a.fromQ, new THREE.Quaternion(), a.t);
    if (a.t >= 1) {
      this.lockAnim = null;
      this.ctx.game.particles.sparks(this.ctx.game.rig.socketWorld(this.ctx.slotKey));
      this.removeGhost();
      this.resolve({ score: alignScore(this.lockErr, this.tol, this.attempts) });
    }
  }

  removeGhost() {
    if (!this.ghost) return;
    this.ghost.removeFromParent();
    disposeHologram(this.ghostMat);
    this.ghost = null;
  }

  auto() {
    const holder = this.ctx.holder;
    holder.visible = true;
    holder.position.set(0, 0, 0);
    holder.quaternion.identity();
    return { score: 80 + Math.round(Math.random() * 20) };
  }

  draw(o) {
    if (!this.holder || this.locked) return;
    const s = o.project(this.ctx.game.rig.socketWorld(this.ctx.slotKey));
    const err = this.error();
    const ok = err <= this.tol;
    o.text(`偏差 ${Math.round(err)}°  容差 ${Math.round(this.tol)}°`, { x: s.x, y: s.y + 70 }, ok ? '#39ff14' : '#05d9e8', 16);
  }

  dispose() {
    this.removeGhost();
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
