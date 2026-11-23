// 非阻断警告会随已知异常的数量线性增长。响应只带有界样本，审计只存计数，完整明细由 lint 按需查看。
// 按 code 分别限量：大量同类文件警告不能挤掉需要处置的视图警告。
export const WARNING_SAMPLE_PER_CODE = 3;
const DETAIL_FIX = "Run lint --json for the complete list; unrelated records may continue";

// 计数与展示方式无关，可持久化；omitted 与 fix 只在响应里按实际展示条数补充。
export function countWarnings(warnings) {
  const byCode = {};
  for (const item of warnings) byCode[item.code] = (byCode[item.code] || 0) + 1;
  return warnings.length ? { total: warnings.length, by_code: byCode } : null;
}

export function withDisplay({ total, by_code }, shown) {
  const omitted = total - shown;
  return { total, by_code, omitted, ...(omitted ? { fix: DETAIL_FIX } : {}) };
}

export function sampleWarnings(warnings, perCode = WARNING_SAMPLE_PER_CODE) {
  const seen = {};
  return warnings.filter((item) => (seen[item.code] = (seen[item.code] || 0) + 1) <= perCode);
}

// 响应字段：有警告时同时给出样本与摘要，摘要始终覆盖全部警告。
export function warningFields(warnings) {
  const counts = countWarnings(warnings);
  if (!counts) return {};
  const items = sampleWarnings(warnings);
  return { warnings: items, warning_summary: withDisplay(counts, items.length) };
}

// 并入后续阶段（视图刷新、原件核对）产生的警告，计数与原有部分合计。
export function appendWarnings(response, extra) {
  if (!extra.length) return response;
  const added = countWarnings(extra);
  const base = response.warning_summary;
  const byCode = { ...(base?.by_code || {}) };
  for (const [code, count] of Object.entries(added.by_code)) byCode[code] = (byCode[code] || 0) + count;
  response.warnings = [...(response.warnings || []), ...sampleWarnings(extra)];
  response.warning_summary = withDisplay({ total: (base?.total || 0) + added.total, by_code: byCode }, response.warnings.length);
  return response;
}
