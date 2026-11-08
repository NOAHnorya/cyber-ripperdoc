import * as THREE from 'three';
import { removalScore } from '../systems/scoring.js';

// 手术台台面范围（世界坐标）：拖着旧部件经过时要从台面上方过去，不能穿进床里
const TABLE = { minX: -0.85, maxX: 0.75, minZ: -1.05, maxZ: 1.05, top: 0.86 };

// 第 2 步 拆除：按住旧部件往外拉，拉松后拖进回收托盘。拖太猛会撕裂。
// 部件跟着鼠标走（世界坐标换算到病人坐标系，病人躺平后轴向是转过的），带一点平滑；
// 拉松之前有阻力（橡皮筋），拉松后完全跟手，并自动抬离台面
export class RemovalStep {
  static key = 'removal';
  static title = '拆除';
  static hint = '按住旧部件往外拉，拉松以后拖进右边的回收托盘';

  constructor(ctx) {
    this.ctx = ctx;
  }

  async start() {
    const { game, slotKey, cutMode, slotDef } = this.ctx;
    const { object, centerLocal } = game.rig.removable(slotKey, cutMode);
    this.object = object;
    this.object.visible = true;
    this.centerLocal = centerLocal;
    this.homeCenter = this.center();
    this.target = this.homeCenter.clone();
    this.tears = 0;
    this.loosened = false;
    this.dragging = false;
    this.pulled = 0;
    this.overTray = false;
    this.cursor = null;
    this.cfg = slotDef.removal;
    // 抓住的那一点一直贴着鼠标（1:1 跟手）；难度靠“不能拉太快”和拉松距离
    this.grabOffset = new THREE.Vector3();
    // 拉松后贴着台面上方水平移动的高度
    this.hoverY = Math.max(TABLE.top + 0.14, this.homeCenter.y + 0.06);
    this.done = false;
    const socket = game.rig.socketWorld(slotKey);
    game.director.focusRemoval(socket, game.clinic.trayPoint, 0.8);
    return new Promise((resolve) => (this.resolve = resolve));
  }

  center() {
    return this.object.localToWorld(this.centerLocal.clone());
  }

  // 把部件中心移到世界坐标 p（只平移）
  moveCenterTo(p) {
    const delta = p.clone().sub(this.center());
    const world = this.object.getWorldPosition(new THREE.Vector3()).add(delta);
    this.object.position.copy(this.object.parent.worldToLocal(world));
  }

  onPointerDown(p) {
    if (this.done) return;
    const o = this.ctx.game.overlay;
    const c = o.project(this.center());
    if (Math.hypot(c.x - p.x, c.y - p.y) > 170) return;
    if (this.loosened) {
      // 已经拉松：在台面上方的水平面上拖
      this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.hoverY);
    } else {
      const cam = this.ctx.game.renderer.camera;
      const normal = cam.getWorldDirection(new THREE.Vector3());
      this.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.target);
    }
    const hit = o.unproject(p, this.plane);
    if (!hit) return;
    this.grabOffset.copy(this.target).sub(hit);
    this.dragging = true;
    this.cursor = p;
    this.samples = [{ x: p.x, y: p.y, t: performance.now() }];
  }

  onPointerMove(p) {
    if (!this.dragging) return;
    this.cursor = p;
    const o = this.ctx.game.overlay;
    const hit = o.unproject(p, this.plane);
    if (!hit) return;
    // 速度按最近约 100 ms 的位移算：相邻两个事件可能只差 1 ms，单次计算会误判成"拉太猛"
    const now = performance.now();
    this.samples.push({ x: p.x, y: p.y, t: now });
    while (this.samples.length > 2 && now - this.samples[1].t > 100) this.samples.shift();
    const first = this.samples[0];
    const span = now - first.t;
    const speed = span >= 30 ? (Math.hypot(p.x - first.x, p.y - first.y) / span) * 1000 : 0;

    if (!this.loosened) {
      if (speed > this.cfg.tearSpeed) {
        this.tears++;
        this.dragging = false;
        this.target.copy(this.homeCenter);
        this.ctx.game.particles.sparks(this.center());
        this.ctx.penalize('拉太猛，撕裂了');
        return;
      }
      this.target.copy(hit).add(this.grabOffset);
      // 不能往床里按
      this.target.y = Math.max(this.target.y, this.homeCenter.y - 0.01);
      this.pulled = this.target.distanceTo(this.homeCenter);
      if (this.pulled > this.cfg.threshold) {
        this.loosened = true;
        this.ctx.game.sfx.pop();
        this.ctx.game.particles.sparks(this.center());
        this.ctx.game.ui.stepHintUpdate('松了！拖进回收托盘');
        // 换成台面上方的水平面继续拖，部件中心直接落在鼠标下面
        this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.hoverY);
        const h = o.unproject(p, this.plane);
        if (h) {
          this.grabOffset.set(0, 0, 0);
          this.target.copy(h);
        }
      }
    } else {
      this.target.copy(hit).add(this.grabOffset);
    }
    this.clampTarget();
    const tray = o.project(this.ctx.game.clinic.trayPoint);
    const c = o.project(this.target);
    this.overTray = this.loosened && Math.hypot(tray.x - c.x, tray.y - c.y) < 95;
  }

  // 拉松后部件在台面范围内要悬在台面上方，出了台面才能往托盘里放低
  clampTarget() {
    if (!this.loosened) return;
    const t = this.target;
    const overTable = t.x > TABLE.minX && t.x < TABLE.maxX && t.z > TABLE.minZ && t.z < TABLE.maxZ;
    const floor = overTable ? Math.max(TABLE.top + 0.14, this.homeCenter.y + 0.06) : this.ctx.game.clinic.trayPoint.y + 0.05;
    t.y = Math.max(t.y, floor);
  }

  update(dt) {
    if (!this.object || this.done) return;
    // 平滑跟手：时间常数约 30 ms，几乎贴手又不会一跳一跳
    const k = 1 - Math.exp(-dt * 34);
    const cur = this.center();
    this.moveCenterTo(cur.lerp(this.target, k));
  }

  onPause() {
    this.dragging = false;
  }

  onPointerUp() {
    this.dragging = false;
    this.cursor = null;
    if (this.loosened && this.overTray) this.finish();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.moveCenterTo(this.target);
    this.ctx.game.particles.dissolve(this.object, 0x05d9e8);
    if (this.ctx.slotDef.hollow) this.ctx.game.rig.openSocket(this.ctx.slotKey);
    this.ctx.game.sfx.coin();
    this.resolve({ score: removalScore(this.tears) });
  }

  auto() {
    const { game, slotKey, cutMode } = this.ctx;
    const { object } = game.rig.removable(slotKey, cutMode);
    object.visible = true;
    game.particles.dissolve(object, 0x05d9e8);
    if (this.ctx.slotDef.hollow) game.rig.openSocket(slotKey);
    return { score: 85 + Math.round(Math.random() * 15) };
  }

  draw(o) {
    if (!this.object || this.done) return;
    const c = o.project(this.center());
    const tray = o.project(this.ctx.game.clinic.trayPoint);
    if (!this.loosened) {
      const k = Math.min(1, this.pulled / this.cfg.threshold);
      // 橡皮筋：从部件拉到鼠标，越拉越细越亮
      if (this.dragging && this.cursor) {
        o.glowLine([c, this.cursor], `rgba(252,238,10,${0.35 + k * 0.5})`, 4 - k * 2.5);
        o.circle(this.cursor, 8, '#fcee0a', 2);
      }
      o.circle(c, 36, 'rgba(5,217,232,0.6)', 2);
      const g = o.ctx;
      g.save();
      g.strokeStyle = '#fcee0a';
      g.lineWidth = 5;
      g.shadowColor = '#fcee0a';
      g.shadowBlur = 10;
      g.beginPath();
      g.arc(c.x, c.y, 36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      g.stroke();
      g.restore();
      o.text(this.cfg.label, { x: c.x, y: c.y - 46 }, '#05d9e8', 14);
    } else {
      const pulse = 60 + Math.sin(performance.now() / 150) * 8;
      o.circle(tray, pulse, this.overTray ? '#39ff14' : '#ff9a2e', 3);
      o.text(this.overTray ? '松手放进托盘' : '回收托盘', { x: tray.x, y: tray.y - pulse - 8 }, this.overTray ? '#39ff14' : '#ff9a2e', 14);
      o.glowLine([c, tray], 'rgba(255,154,46,0.6)', 2, [8, 8]);
    }
  }

  dispose() {}
}
