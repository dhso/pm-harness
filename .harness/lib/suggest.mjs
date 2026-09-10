// 名称相似度：让结构化报错能指回正确的字段、类型或集合名。
// 阈值刻意收紧——宁可不给建议，也不要把 `kind` 指成 `id` 这类误导性提示。

export function editDistance(a, b) {
  if (a === b) return 0;
  let previousPrevious = null;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // 常见手误是相邻字符颠倒（titel -> title）；按一次编辑处理。
      if (previousPrevious && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], previousPrevious[j - 2] + 1);
      }
    }
    previousPrevious = previous;
    previous = current;
  }
  return previous[b.length];
}

export function nearestName(key, candidates) {
  const threshold = Math.min(3, Math.max(1, Math.floor(key.length / 3)));
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= threshold ? best : null;
}
