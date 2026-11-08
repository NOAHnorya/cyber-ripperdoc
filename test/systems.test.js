import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { matchType, effectiveBudget, isOverloaded, shelfStatus, settleSurgery, nightLedger, rejectionRisk } from '../src/systems/economy.js';
import { incisionScore, removalScore, alignScore, wiringScore, sutureScore, surgeryQuality, gradeOf } from '../src/systems/scoring.js';
import { markVisited, coverage, nearestIndex, evenlySpacedIndices } from '../src/systems/pathMath.js';
import { makeWiring, isCorrect, wireCount } from '../src/systems/wiring.js';
import { nightPlan, parseEntry, revisitOutcome } from '../src/systems/nights.js';
import { upgradeFx, canBuy, propForLevel } from '../src/systems/upgrades.js';
import { mulberry32 } from '../src/core/rng.js';
import { Store } from '../src/core/store.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../src/data/${p}`, import.meta.url), 'utf8'));
const balance = load('balance.json');
const customers = load('customers.json');
const implants = load('implants.json');
const nights = load('nights.json');
const upgrades = load('upgrades.json');
const slots = load('slots.json');
const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
const C = byId(customers);
const I = byId(implants);

test('数据一致：每位客人的最佳方案存在且部位对得上', () => {
  for (const c of customers) {
    assert.ok(I[c.best], `${c.id} 的最佳方案 ${c.best} 不在 implants.json`);
    assert.equal(I[c.best].slot, c.slot);
    assert.ok(slots[c.slot], `部位 ${c.slot} 不在 slots.json`);
    assert.ok(I[c.best].price <= c.budget, `${c.id} 买不起自己的最佳方案`);
    assert.ok(I[c.best].load <= c.capacity, `${c.id} 的最佳方案会超载`);
  }
});

test('数据一致：夜晚队列里的客人都存在', () => {
  for (const n of nights) {
    for (const e of n.queue) {
      const { id } = parseEntry(e);
      assert.ok(C[id], `第 ${n.night} 晚的 ${id} 不存在`);
    }
  }
});

test('匹配类型', () => {
  assert.equal(matchType(C.aqiang, I.sprint_leg), 'best');
  assert.equal(matchType(C.xiaolin, I.blade_arm), 'ok');
  assert.equal(matchType(C.xiaolin, I.sprint_leg), 'mismatch');
});

test('货架状态：部位、预算、超载', () => {
  assert.equal(shelfStatus(C.aqiang, I.precision_arm).reason, '部位不对');
  assert.equal(shelfStatus(C.xiaolin, I.blade_arm).reason, '超预算');
  assert.equal(shelfStatus(C.xiaolin, I.precision_arm).selectable, true);
  assert.equal(effectiveBudget(C.xiaolin, { budgetBonus: 0.2 }), 3600);
  assert.equal(shelfStatus(C.xiaolin, I.blade_arm, { budgetBonus: 0.2 }).warning, '神经超载');
  assert.equal(isOverloaded(C.xiaolin, I.blade_arm), true);
});

test('结算：完美 + 最佳方案', () => {
  const r = settleSurgery({ customer: C.aqiang, implant: I.sprint_leg, quality: 'perfect', balance, rng: () => 0 });
  assert.equal(r.charged, 2160);
  assert.equal(r.tip, 216);
  assert.equal(r.cost, 990);
  assert.equal(r.repDelta, 0.5);
});

test('结算：失败退款并扣口碑', () => {
  const r = settleSurgery({ customer: C.aqiang, implant: I.sprint_leg, quality: 'fail', balance });
  assert.equal(r.charged, 0);
  assert.equal(r.repDelta, -1);
});

test('结算：能用但不对口打七折、没有小费', () => {
  const r = settleSurgery({ customer: C.daoba, implant: I.precision_arm, quality: 'good', balance, rng: () => 0.5 });
  assert.equal(r.match, 'ok');
  assert.equal(r.charged, Math.round(2800 * 0.7));
  assert.equal(r.tip, 0);
});

test('第 1 晚良好收尾约 2500', () => {
  const recs = [
    settleSurgery({ customer: C.aqiang, implant: I.sprint_leg, quality: 'good', balance, rng: () => 0 }),
    settleSurgery({ customer: C.jinya, implant: I.appraiser_eye, quality: 'good', balance, rng: () => 0 }),
  ];
  const ledger = nightLedger(recs, balance);
  const money = balance.startMoney + ledger.net;
  assert.ok(money >= 2400 && money <= 3200, `第 1 晚结束 ${money}`);
});

test('排异风险：鬼市 + 超载翻倍', () => {
  assert.equal(rejectionRisk({ implant: I.blade_arm, overloaded: true, quality: 'good', balance }), 0.6);
});

test('评分函数边界', () => {
  assert.equal(incisionScore(1, 0, 12), 100);
  assert.equal(incisionScore(0, 100, 12), 0);
  assert.equal(removalScore(0), 100);
  assert.equal(removalScore(5), 40);
  assert.equal(alignScore(0, 12, 1), 100);
  assert.equal(alignScore(12, 12, 2), 40);
  assert.equal(wiringScore(0), 100);
  assert.equal(wiringScore(10), 30);
  assert.equal(sutureScore([0, 30, null], 120), Math.round((100 + 100 + 30) / 3));
  assert.equal(gradeOf(85, balance.qualityThresholds), 'perfect');
  assert.equal(gradeOf(59, balance.qualityThresholds), 'poor');
  assert.deepEqual(surgeryQuality({ a: 90, b: 80 }, balance.qualityThresholds), { average: 85, quality: 'perfect' });
  assert.equal(surgeryQuality({ a: 90 }, balance.qualityThresholds, true).quality, 'fail');
});

test('路径：标记、覆盖率、最近点、等距下标', () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 0 }));
  const visited = new Array(10).fill(false);
  assert.equal(markVisited(pts, visited, { x: 0, y: 3 }, 12), 2);
  assert.equal(coverage(visited), 0.2);
  assert.equal(nearestIndex(pts, { x: 41, y: 2 }).index, 4);
  assert.deepEqual(evenlySpacedIndices(10, 4), [0, 3, 6, 9]);
});

test('接线表是一一对应的排列，并且可复现', () => {
  const w1 = makeWiring(6, mulberry32(42));
  const w2 = makeWiring(6, mulberry32(42));
  assert.deepEqual(w1, w2);
  assert.deepEqual([...w1.map((n) => n.port)].sort(), [0, 1, 2, 3, 4, 5]);
  assert.ok(isCorrect(w1, 'A', w1[0].port));
  assert.ok(!isCorrect(w1, 'A', (w1[0].port + 1) % 6));
  assert.equal(wireCount(I.precision_arm, true, balance), 8);
});

test('夜晚与回访', () => {
  assert.equal(nightPlan(nights, 1).queue.length, 2);
  assert.deepEqual(parseEntry('revisit:aqiang'), { type: 'revisit', id: 'aqiang' });
  assert.equal(revisitOutcome({ quality: 'good' }, balance).kind, 'thanks');
  assert.equal(revisitOutcome({ quality: 'poor' }, balance).kind, 'complaint');
  assert.equal(revisitOutcome(null, balance).kind, 'none');
});

test('升级效果合并与购买', () => {
  const fx0 = upgradeFx(upgrades, {});
  assert.equal(fx0.incisionTolPx, 12);
  assert.equal(fx0.anesthesiaSeconds, 90);
  const fx1 = upgradeFx(upgrades, { laser: 1, neon: 1 });
  assert.equal(fx1.incisionTolPx, 20);
  assert.equal(fx1.tipBonus, 0.2);
  const laser = upgrades.find((u) => u.key === 'laser');
  assert.equal(canBuy(laser, {}, 1000).reason, '钱不够');
  assert.equal(canBuy(laser, { laser: 1 }, 9999).reason, '已满级');
  assert.equal(propForLevel(laser, { laser: 1 }), 'laser_lv2');
});

test('存档：没有 localStorage 时不报错', () => {
  const s = new Store(balance);
  s.addMoney(100);
  s.addReputation(10);
  assert.equal(s.state.money, 2100);
  assert.equal(s.state.reputation, 5);
  s.save();
  assert.equal(s.load(), false);
  s.record({ customerId: 'aqiang', quality: 'good' });
  assert.equal(s.lastRecordFor('aqiang').quality, 'good');
});
