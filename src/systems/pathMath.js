// 屏幕空间的路径计算：切开和缝合共用

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nearestIndex(points, p) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = dist(points[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, distance: bestD };
}

// 把 p 附近（tol 以内）的路径点标记为已经过，返回新标记的数量
export function markVisited(points, visited, p, tolPx) {
  let marked = 0;
  for (let i = 0; i < points.length; i++) {
    if (!visited[i] && dist(points[i], p) <= tolPx) {
      visited[i] = true;
      marked++;
    }
  }
  return marked;
}

export function coverage(visited) {
  if (!visited.length) return 0;
  return visited.filter(Boolean).length / visited.length;
}

// 沿折线均匀挑 n 个点的下标（缝合针脚）
export function evenlySpacedIndices(count, n) {
  if (n <= 0 || count <= 0) return [];
  if (n === 1) return [Math.floor((count - 1) / 2)];
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.round((i * (count - 1)) / (n - 1)));
  return out;
}
