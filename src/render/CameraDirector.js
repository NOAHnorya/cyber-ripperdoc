import * as THREE from 'three';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// 镜头：全景、各部位特写、拆除时带上回收托盘
export class CameraDirector {
  constructor(camera) {
    this.camera = camera;
    this.pos = camera.position.clone();
    this.target = new THREE.Vector3(0, 1.1, 0);
    this.from = null;
    this.to = null;
    this.t = 1;
    this.dur = 1;
    this.sway = 0;
    this.supine = false; // 病人躺在手术台上时，特写改成从床边往下看
  }

  go(pos, target, dur = 0.9) {
    this.from = { pos: this.pos.clone(), target: this.target.clone() };
    this.to = { pos: new THREE.Vector3(...pos), target: new THREE.Vector3(...target) };
    this.t = 0;
    this.dur = dur;
    return new Promise((resolve) => (this.onArrive = resolve));
  }

  // 全景：病人站在床尾，手术台在后面
  overview(dur) {
    return this.go([2.6, 1.75, 5.0], [0.1, 0.66, 0.8], dur);
  }

  // 义眼扫描：中景，病人在画面左侧，右边留出数据标注的位置
  scanShot(dur) {
    return this.go([1.25, 1.25, 5.25], [0.5, 0.86, 1.6], dur);
  }

  scanDolly(dur) {
    return this.go([1.0, 1.2, 4.9], [0.48, 0.86, 1.6], dur);
  }

  shelf(dur) {
    return this.go([0.2, 1.6, 2.2], [-1.6, 1.0, -0.6], dur);
  }

  focusSlot(slotKey, socket, dur) {
    const s = socket;
    if (this.supine) return this.focusSlotSupine(slotKey, s, dur);
    switch (slotKey) {
      case 'eye':
        return this.go([s.x + 0.07, s.y + 0.02, s.z + 0.22], [s.x, s.y, s.z], dur);
      case 'face':
        return this.go([s.x + 0.1, s.y + 0.03, s.z + 0.38], [s.x, s.y, s.z], dur);
      case 'arm':
        return this.go([s.x + 0.85, s.y - 0.1, s.z + 1.05], [s.x + 0.18, s.y - 0.28, s.z], dur);
      case 'leg':
      default:
        return this.go([s.x + 0.75, s.y + 0.02, s.z + 1.3], [s.x, s.y - 0.13, s.z], dur);
    }
  }

  // 仰卧：头在 −Z、脚在 +Z，手术侧在 +X。镜头放在脚侧偏上，画面里头朝上方
  focusSlotSupine(slotKey, s, dur) {
    switch (slotKey) {
      // 头部：镜头在正上方稍偏脚侧，X 不偏，脸在画面里是正的（额头朝上）
      case 'eye':
        return this.go([s.x, s.y + 0.21, s.z + 0.08], [s.x, s.y, s.z - 0.01], dur);
      case 'face':
        return this.go([s.x, s.y + 0.34, s.z + 0.14], [s.x, s.y, s.z - 0.01], dur);
      // 四肢：从手术侧（+X）床边斜着往下看，肢体横在画面里，头在右、脚在左
      case 'arm':
        return this.go([s.x + 0.95, s.y + 0.95, s.z + 0.08], [s.x + 0.16, s.y - 0.1, s.z + 0.08], dur);
      case 'leg':
      default:
        return this.go([s.x + 0.95, s.y + 0.85, s.z + 0.24], [s.x, s.y - 0.08, s.z + 0.22], dur);
    }
  }

  focusRemoval(socket, tray, dur) {
    if (this.supine) {
      const mid = socket.clone().lerp(tray, 0.5);
      const spread = socket.distanceTo(tray);
      return this.go([mid.x + 0.2, mid.y + 0.9 + spread * 0.5, mid.z + 0.8 + spread * 0.6], [mid.x, mid.y - 0.05, mid.z], dur);
    }
    const mid = socket.clone().lerp(tray, 0.5);
    const spread = socket.distanceTo(tray);
    return this.go([mid.x + 0.25, mid.y + 0.45, mid.z + 0.9 + spread * 1.1], [mid.x, mid.y, mid.z], dur);
  }

  update(dt) {
    if (this.to && this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const e = ease(this.t);
      this.pos.lerpVectors(this.from.pos, this.to.pos, e);
      this.target.lerpVectors(this.from.target, this.to.target, e);
      if (this.t >= 1) {
        const done = this.onArrive;
        this.onArrive = null;
        done?.();
      }
    }
    this.sway += dt;
    this.camera.position.copy(this.pos);
    this.camera.position.y += Math.sin(this.sway * 0.6) * 0.004;
    this.camera.lookAt(this.target);
  }
}
