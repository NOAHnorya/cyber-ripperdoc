import { markVisited, coverage, nearestIndex } from '../systems/pathMath.js';
import { incisionScore } from '../systems/scoring.js';
import { buildIncisionPath, burnLine } from './paths.js';

// 第 1 步 切开：按住鼠标沿发光虚线描一圈
export class IncisionStep {
  static key = 'incision';
  static title = '切开';
  static hint = '按住鼠标，沿发光虚线描一遍';

  constructor(ctx) {
    this.ctx = ctx;
  }

  start() {
    const { game, slotDef, calibSlot, fx, tolFactor } = this.ctx;
    game.rig.root.updateMatrixWorld(true);
    const path = buildIncisionPath(slotDef, calibSlot, game.rig.bodyRoot.matrixWorld, game.renderer.camera.position);
    this.ctx.incisionPath = path;
    this.points = path.points;
    this.closed = path.closed;
    this.visited = new Array(this.points.length).fill(false);
    this.screen = [];
    this.deviations = [];
    this.tol = fx.incisionTolPx * tolFactor;
    this.snap = Boolean(fx.incisionSnap);
    this.down = false;
    this.pointer = null;
    this.lastMistake = 0;
    this.done = false;
    return new Promise((resolve) => (this.resolve = resolve));
  }

  update() {
    if (!this.points) return;
    this.screen = this.points.map((p) => this.ctx.game.overlay.project(p));
  }

  handle(p) {
    if (!this.screen.length) this.update();
    const { index, distance } = nearestIndex(this.screen, p);
    const q = this.snap && distance < this.tol * 2.5 ? this.screen[index] : p;
    this.pointer = q;
    const marked = markVisited(this.screen, this.visited, q, this.tol);
    this.deviations.push(Math.min(this.snap && distance < this.tol * 2.5 ? 0 : distance, this.tol * 3));
    if (marked) this.ctx.game.sfx.laser();
    const now = performance.now();
    if (distance > this.tol * 2.2 && now - this.lastMistake > 700) {
      this.lastMistake = now;
      this.ctx.game.particles.sparks(this.points[index]);
      this.ctx.penalize('切偏了');
    }
    if (coverage(this.visited) >= 0.98) this.finish();
  }

  onPointerDown(p) {
    this.down = true;
    this.lastRaw = p;
    this.handle(p);
  }

  onPointerMove(p) {
    if (!this.down) {
      this.pointer = p;
      return;
    }
    // 鼠标移动快时两次事件之间会跳过一段路径：在中间补点，只计覆盖，不计偏差
    const last = this.lastRaw;
    if (last && this.screen?.length) {
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      const n = Math.min(60, Math.floor(Math.hypot(dx, dy) / (this.tol * 0.5)));
      for (let i = 1; i <= n; i++) {
        const q = { x: last.x + (dx * i) / (n + 1), y: last.y + (dy * i) / (n + 1) };
        if (nearestIndex(this.screen, q).distance < this.tol * 2.2) markVisited(this.screen, this.visited, q, this.tol);
      }
    }
    this.lastRaw = p;
    this.handle(p);
  }

  onPause() {
    this.down = false;
  }

  onPointerUp() {
    this.down = false;
    this.lastRaw = null;
    if (coverage(this.visited) >= 0.85) this.finish();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    const meanDev = this.deviations.length ? this.deviations.reduce((s, v) => s + v, 0) / this.deviations.length : this.tol;
    this.complete();
    this.resolve({ score: incisionScore(coverage(this.visited), meanDev, this.tol) });
  }

  complete() {
    const { game, cutMode } = this.ctx;
    if (cutMode === 'volume') {
      game.rig.openCut();
    } else {
      this.ctx.burn = burnLine(this.points, this.closed);
      game.renderer.scene.add(this.ctx.burn);
    }
  }

  auto() {
    const { game, slotDef, calibSlot } = this.ctx;
    game.rig.root.updateMatrixWorld(true);
    const path = buildIncisionPath(slotDef, calibSlot, game.rig.bodyRoot.matrixWorld, game.renderer.camera.position);
    this.ctx.incisionPath = path;
    this.points = path.points;
    this.closed = path.closed;
    this.complete();
    return { score: 80 + Math.round(Math.random() * 20) };
  }

  draw(o) {
    if (!this.screen?.length) return;
    const pts = this.closed ? [...this.screen, this.screen[0]] : this.screen;
    const vis = this.closed ? [...this.visited, this.visited[0]] : this.visited;
    o.glowLine(pts, '#05d9e8', 2, [6, 6], 0.85);
    for (let i = 0; i < pts.length - 1; i++) {
      if (vis[i] && vis[i + 1]) o.glowLine([pts[i], pts[i + 1]], '#ff9a2e', 4);
    }
    const start = this.screen[0];
    o.circle(start, 7, '#fcee0a', 2);
    if (this.pointer && this.down) {
      o.circle(this.pointer, 5, '#ffd27a', 2, '#ffb347');
      o.circle(this.pointer, this.tol, 'rgba(255,180,80,0.5)', 1);
    }
    const c = Math.round(coverage(this.visited) * 100);
    const label = this.screen[Math.floor(this.screen.length / 2)];
    o.text(`${c}%`, { x: label.x, y: label.y - 18 }, '#fcee0a', 14);
  }

  dispose() {}
}
