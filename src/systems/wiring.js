import { shuffle } from '../core/rng.js';

export const NERVE_COLORS = ['#ff2a6d', '#05d9e8', '#fcee0a', '#39ff14', '#b967ff', '#ff8c1a', '#ffffff', '#3d7bff'];

// 生成接线表：第 i 根神经要接到 port 号端口
export function makeWiring(count, rng = Math.random) {
  const ports = shuffle([...Array(count).keys()], rng);
  return Array.from({ length: count }, (_, i) => ({
    id: String.fromCharCode(65 + i),
    color: NERVE_COLORS[i % NERVE_COLORS.length],
    port: ports[i],
  }));
}

export function isCorrect(wiring, nerveId, port) {
  const nerve = wiring.find((n) => n.id === nerveId);
  return Boolean(nerve) && nerve.port === port;
}

export function wireCount(implant, overloaded, balance) {
  return implant.wires + (overloaded ? balance.extraWiresOnOverload : 0);
}
