import { evenlySpacedIndices } from '../systems/pathMath.js';
import { sutureScore } from '../systems/scoring.js';
import { buildIncisionPath } from './paths.js';

// 第 5 步 缝合：节拍圈缩到针脚上时点击（或按空格），类似 osu!
export class SutureStep {
  static key = 'suture';
  static title = '缝合';
  static hint = '跟着节拍，圆圈缩到针脚上时点击或按空格';

  constructor(ctx) {
    this.ctx = ctx;
  }

  start() {
    const { game, slotKey, slotDef, calibSlot, fx, tolFactor } = this.ctx;
    game.director.focusSlot(slotKey, game.rig.socketWorld(slotKey), 0.6);
    if (!this.ctx.incisionPath) {
      game.rig.root.updateMatrixWorld(true);
      this.ctx.incisionPath = buildIncisionPath(slotDef, calibSlot, game.rig.bodyRoot.matrixWorld, game.renderer.camera.position);
    }
    const path = this.ctx.incisionPath.points;
    this.path = path;
    const n = Math.max(3, slotDef.stitches + (fx.sutureStitchDelta ?? 0));
    this.beat = 60 / slotDef.bpm;
    this.windowMs = (fx.sutureWindowMs ?? 120) * tolFactor;
    const now = performance.now() / 1000;
    this.t0 = now + 1.0 + this.beat * 3;
    this.stitches = evenlySpacedIndices(path.length, n).map((idx, i) => ({ idx, time: this.t0 + i * this.beat, done: false, offset: null }));
    this.nextTick = this.t0 - this.beat * 3;
    this.lastTime = this.stitches[this.stitches.length - 1].time;
    this.finished = false;
    return new Promise((resolve) => (this.resolve = resolve));
  }

  hit() {
    if (!this.stitches || this.finished) return;
    const now = performance.now() / 1000;
    let best = null;
    for (const s of this.stitches) {
      if (s.done) continue;
      const d = Math.abs(now - s.time);
      if (d < this.beat * 0.6 && (!best || d < Math.abs(now - best.time))) best = s;
    }
    if (!best) return;
    best.done = true;
    best.offset = (now - best.time) * 1000;
    const good = Math.abs(best.offset) <= this.windowMs;
    this.ctx.game.sfx.stitch(good);
    this.ctx.game.particles.sparks(this.path[best.idx]);
  }

  onPointerDown() {
    this.hit();
  }

  // 节拍按真实时间排的，继续时整体顺延暂停的时长
  onResume(seconds) {
    if (!this.stitches) return;
    this.t0 += seconds;
    this.nextTick += seconds;
    this.lastTime += seconds;
    for (const s of this.stitches) s.time += seconds;
  }

  onKey(e) {
    if (e.code === 'Space') {
      e.preventDefault();
      this.hit();
    }
  }

  update() {
    if (!this.stitches || this.finished) return;
    const now = performance.now() / 1000;
    while (this.nextTick <= now && this.nextTick <= this.lastTime + 0.01) {
      const countIn = this.nextTick < this.t0 - 1e-3;
      this.ctx.game.sfx.tick(!countIn);
      this.nextTick += this.beat;
    }
    for (const s of this.stitches) {
      if (!s.done && now > s.time + (this.windowMs / 1000) * 2.2) {
        s.done = true;
        s.offset = null;
        this.ctx.game.sfx.error();
      }
    }
    if (this.stitches.every((s) => s.done)) {
      this.finished = true;
      setTimeout(() => this.resolve({ score: sutureScore(this.stitches.map((s) => s.offset), this.windowMs) }), 350);
    }
  }

  auto() {
    return { score: 80 + Math.round(Math.random() * 20) };
  }

  draw(o) {
    if (!this.stitches) return;
    const now = performance.now() / 1000;
    const scr = this.path.map((p) => o.project(p));
    o.glowLine(scr, 'rgba(255,154,46,0.45)', 2);
    if (now < this.t0) {
      const left = Math.ceil((this.t0 - now) / this.beat);
      const mid = scr[Math.floor(scr.length / 2)];
      o.text(left > 3 ? '准备' : String(left), { x: mid.x, y: mid.y - 50 }, '#fcee0a', 28);
    }
    for (const s of this.stitches) {
      const p = scr[s.idx];
      if (s.done) {
        const ok = s.offset !== null && Math.abs(s.offset) <= this.windowMs;
        const color = s.offset === null ? '#ff2a6d' : ok ? '#39ff14' : '#ff9a2e';
        o.glowLine([{ x: p.x - 7, y: p.y - 7 }, { x: p.x + 7, y: p.y + 7 }], color, 3);
        o.glowLine([{ x: p.x - 7, y: p.y + 7 }, { x: p.x + 7, y: p.y - 7 }], color, 3);
        continue;
      }
      o.circle(p, 6, '#fcee0a', 2, 'rgba(252,238,10,0.35)');
      const lead = s.time - now;
      if (lead < this.beat * 1.5 && lead > -this.beat * 0.5) {
        const k = Math.max(0, lead / (this.beat * 1.5));
        o.circle(p, 10 + 60 * k, '#05d9e8', 2, null, 0.4 + 0.6 * (1 - k));
      }
    }
  }

  dispose() {}
}
