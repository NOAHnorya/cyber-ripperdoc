// 把各项升级的当前等级合并成一组效果参数，手术各步骤只读这组参数
export function upgradeFx(upgrades, levels = {}) {
  const fx = {};
  for (const up of upgrades) {
    const lv = Math.min(levels[up.key] ?? 0, up.levels.length - 1);
    Object.assign(fx, up.levels[lv]);
  }
  return fx;
}

export function canBuy(up, levels, money) {
  const lv = levels[up.key] ?? 0;
  if (lv >= up.levels.length - 1) return { ok: false, reason: '已满级' };
  if (money < up.price) return { ok: false, reason: '钱不够' };
  return { ok: true };
}

export function propForLevel(up, levels) {
  if (!up.props?.length) return null;
  const lv = Math.min(levels[up.key] ?? 0, up.props.length - 1);
  return up.props[lv];
}
