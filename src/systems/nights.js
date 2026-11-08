export function nightPlan(nights, night) {
  return nights.find((n) => n.night === night) ?? null;
}

export function parseEntry(entry) {
  if (entry.startsWith('revisit:')) return { type: 'revisit', id: entry.slice('revisit:'.length) };
  return { type: 'customer', id: entry };
}

// 回访：根据第一次手术的质量决定是来道谢还是来投诉
export function revisitOutcome(record, balance) {
  if (!record || record.quality === 'fail') return { kind: 'none' };
  if (record.quality === 'perfect' || record.quality === 'good') return { kind: 'thanks', tip: balance.revisit.tip };
  return { kind: 'complaint' };
}
