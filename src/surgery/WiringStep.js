import { makeWiring, isCorrect } from '../systems/wiring.js';
import { wiringScore } from '../systems/scoring.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// 第 4 步 接线：把左边每根神经拖到右边对应颜色的端口
export class WiringStep {
  static key = 'wiring';
  static title = '接线';
  static hint = '从左边的神经拖线到右边同色的端口';

  constructor(ctx) {
    this.ctx = ctx;
  }

  start() {
    const { game, implant, wires, fx, overloaded } = this.ctx;
    this.wiring = makeWiring(wires, Math.random);
    this.hidden = implant.wiringHidden && !fx.wiringRevealHidden;
    this.mistakes = 0;
    this.connected = new Set();
    this.revealed = new Set();

    const panel = game.ui.mountPanel('wiring');
    this.panel = panel;
    const title = document.createElement('div');
    title.className = 'wiring-title';
    title.textContent = `${implant.name} · ${wires} 根神经`;
    panel.append(title);
    if (this.hidden) {
      const w = document.createElement('div');
      w.className = 'wiring-warn';
      w.textContent = '鬼市货没有接线图：端口颜色未知，只能一个个试，接错会扣麻醉时间';
      panel.append(w);
    }
    if (overloaded) {
      const w = document.createElement('div');
      w.className = 'wiring-warn';
      w.textContent = '神经超载：比平时多 2 根线';
      panel.append(w);
    }

    const rowH = 44;
    const W = 340;
    const H = 30 + wires * rowH;
    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    panel.append(root);
    this.svg = root;
    this.lines = svg('g');
    root.append(this.lines);
    this.temp = svg('line', { stroke: '#ffffff', 'stroke-width': 3, 'stroke-dasharray': '6 5', visibility: 'hidden' });
    root.append(this.temp);

    this.nerveEls = new Map();
    this.portEls = new Map();
    const y = (i) => 26 + i * rowH;
    this.wiring.forEach((n, i) => {
      const c = svg('circle', { cx: 40, cy: y(i), r: 12, fill: n.color, stroke: '#111', 'stroke-width': 2, 'data-nerve': n.id, style: 'cursor:grab' });
      root.append(c);
      const t = svg('text', { x: 14, y: y(i) + 5, class: 'nerve-label' });
      t.textContent = n.id;
      root.append(t);
      this.nerveEls.set(n.id, { el: c, x: 40, y: y(i) });
    });
    for (let p = 0; p < wires; p++) {
      const owner = this.wiring.find((n) => n.port === p);
      const r = svg('rect', {
        x: W - 52,
        y: y(p) - 13,
        width: 26,
        height: 26,
        fill: this.hidden ? '#2a2a33' : owner.color,
        stroke: '#05d9e8',
        'stroke-width': 1.5,
        'data-port': p,
      });
      root.append(r);
      const t = svg('text', { x: W - 18, y: y(p) + 5, class: 'port-label' });
      t.textContent = this.hidden ? '?' : String(p + 1);
      root.append(t);
      this.portEls.set(p, { el: r, label: t, x: W - 52, y: y(p), owner });
    }

    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', () => this.cancel());
    return new Promise((resolve) => (this.resolve = resolve));
  }

  local(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  down(e) {
    const id = e.target.getAttribute?.('data-nerve');
    if (!id || this.connected.has(id)) return;
    this.dragging = id;
    this.svg.setPointerCapture(e.pointerId);
    const n = this.nerveEls.get(id);
    const p = this.local(e);
    const color = this.wiring.find((w) => w.id === id).color;
    Object.entries({ x1: n.x, y1: n.y, x2: p.x, y2: p.y, stroke: color, visibility: 'visible' }).forEach(([k, v]) => this.temp.setAttribute(k, v));
  }

  move(e) {
    if (!this.dragging) return;
    const p = this.local(e);
    this.temp.setAttribute('x2', p.x);
    this.temp.setAttribute('y2', p.y);
  }

  onPause() {
    this.cancel();
  }

  cancel() {
    this.dragging = null;
    this.temp.setAttribute('visibility', 'hidden');
  }

  up(e) {
    if (!this.dragging) return;
    const id = this.dragging;
    this.cancel();
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const portAttr = target?.getAttribute?.('data-port');
    if (portAttr === null || portAttr === undefined) return;
    const port = Number(portAttr);
    const p = this.portEls.get(port);
    const n = this.nerveEls.get(id);
    if (isCorrect(this.wiring, id, port)) {
      this.connected.add(id);
      const color = this.wiring.find((w) => w.id === id).color;
      this.lines.append(svg('line', { x1: n.x, y1: n.y, x2: p.x, y2: p.y, stroke: color, 'stroke-width': 4 }));
      n.el.setAttribute('style', 'cursor:default;opacity:0.6');
      if (this.hidden) {
        p.el.setAttribute('fill', color);
        p.label.textContent = String(port + 1);
      }
      this.ctx.game.sfx.wireOk();
      if (this.connected.size === this.wiring.length) this.finish();
    } else {
      this.mistakes++;
      const bad = svg('line', { x1: n.x, y1: n.y, x2: p.x, y2: p.y, stroke: '#ff2a6d', 'stroke-width': 4 });
      this.lines.append(bad);
      setTimeout(() => bad.remove(), 300);
      this.ctx.penalize('接错线，放电了');
    }
  }

  finish() {
    setTimeout(() => {
      this.dispose();
      this.resolve({ score: wiringScore(this.mistakes) });
    }, 350);
  }

  auto() {
    return { score: 85 + Math.round(Math.random() * 15) };
  }

  draw() {}

  dispose() {
    this.panel?.remove();
    this.panel = null;
  }
}
