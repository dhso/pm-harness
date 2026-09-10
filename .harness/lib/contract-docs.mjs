// 从可执行操作契约生成 payload 字段参考；本模块只做呈现。
import { nearestName, OPERATION_TYPES, STATUS, TRANSITIONS } from "./model.mjs";
import { COMPOSITE_TYPES, OPERATION_SPECS } from "./contracts.mjs";

const GENERATED_PATH = ".harness/references/operation-contract.md";

const ENVELOPE_ROWS = [
  ["`schema_version`", "`1`", "是", "固定为当前契约版本"],
  ["`operation_id`", "`OP-…`", "是", "稳定可重放；相同 ID 与相同请求返回首次结果"],
  ["`type`", "见下表", "是", "操作类型"],
  ["`actor`", "`{ kind }`", "是", "`kind` 取 `user`、`agent` 或 `stakeholder`"],
  ["`reason`", "非空字符串", "是", "写入原因"],
  ["`source_ids`", "字符串数组", "是", "支撑本次写入的来源"],
  ["`approval`", "对象", "受控操作", "`approved_by_id`、`approved_at`、`confirmed_by_user_at`，改已批准对象另需 `change_request_id`"],
  ["`payload`", "对象", "是", "类型化载荷，字段见下表"],
];

function fieldRow(field, spec) {
  return { field, type: spec.fields[field], required: (spec.required || []).includes(field) ? "是" : "" };
}

function operationSection(type) {
  const spec = OPERATION_SPECS[type];
  const allowed = Object.keys(spec?.fields || {});
  const lines = [`### \`${type}\``, ""];
  if (spec.note) lines.push(spec.note, "");
  if (!allowed.length) {
    lines.push("payload 无字段（空对象）。", "");
    return lines;
  }
  const rows = allowed.map((field) => fieldRow(field, spec));
  const required = rows.filter((row) => row.required).map((row) => `\`${row.field}\``);
  if (required.length) lines.push(`必填：${required.join("、")}`, "");
  if (spec.create_required?.length) lines.push(`新建记录时另需：${spec.create_required.map((field) => `\`${field}\``).join("、")}`, "");
  if (spec.update_required?.length) lines.push(`更新记录时另需：${spec.update_required.map((field) => `\`${field}\``).join("、")}`, "");
  if (spec.one_of?.length) for (const fields of spec.one_of) lines.push(`至少提供一项：${fields.map((field) => `\`${field}\``).join("、")}`, "");
  if (spec.defaults?.length) lines.push(`可省略并由 Harness 补全：${spec.defaults.map((field) => `\`${field}\``).join("、")}`, "");
  lines.push("| 字段 | 类型 | 必填 |", "|---|---|---|");
  for (const row of rows) lines.push(`| \`${row.field}\` | \`${row.type}\` | ${row.required} |`);
  lines.push("");
  // 复合类型只写类型名等于没写：元素结构必须就地展开，否则只能去反推数据文件。
  for (const type of [...new Set(rows.map((row) => row.type))].filter((type) => COMPOSITE_TYPES[type])) {
    const composite = COMPOSITE_TYPES[type];
    lines.push(`\`${type}\` 的元素是${composite.element}：`, "");
    lines.push(`可用字段：${composite.fields().map((field) => `\`${field}\``).join("、")}`, "");
    if (composite.required?.length) lines.push(`必填：${composite.required.map((field) => `\`${field}\``).join("、")}`, "");
    if (composite.defaults?.length) lines.push(`可省略并由 Harness 补全：${composite.defaults.map((field) => `\`${field}\``).join("、")}`, "");
    if (composite.generated?.length) lines.push(`由 Harness 补全，不要传：${composite.generated.map((field) => `\`${field}\``).join("、")}`, "");
    if (composite.record_fields) lines.push(`record 可用字段：${composite.record_fields().map((field) => `\`${field}\``).join("、")}`, "");
    if (composite.note) lines.push(composite.note, "");
  }
  for (const statusKind of spec.status_kinds || []) {
    lines.push(`\`${statusKind}\` 状态取值：${STATUS[statusKind].map((item) => `\`${item}\``).join("、")}`, "");
    const transitions = TRANSITIONS[statusKind];
    if (transitions) {
      const arrows = Object.entries(transitions).filter(([, to]) => to.length).map(([from, to]) => `\`${from}\` → ${to.map((item) => `\`${item}\``).join(" | ")}`);
      if (arrows.length) lines.push(`允许转换：${arrows.join("；")}`, "");
    }
  }
  return lines;
}

export function renderOperationContract() {
  const lines = [
    "# 操作契约字段参考",
    "",
    "本文件由 `npm run docs:contract` 从 `.harness/lib/contracts.mjs` 的可执行操作契约生成，不要手改。",
    "字段真相在可执行契约中；本文件只是按需查阅的索引，避免为写一次记录去读源码。",
    "",
    "写入不确定字段时，直接提交并读结构化报错：`unknown_field` 会返回 `did_you_mean` 和完整 `supported_fields`。",
    "",
    "## 统一信封",
    "",
    "| 字段 | 类型 | 必填 | 说明 |",
    "|---|---|---|---|",
    ...ENVELOPE_ROWS.map((row) => `| ${row.join(" | ")} |`),
    "",
    "## 操作类型",
    "",
  ];
  for (const type of OPERATION_TYPES) lines.push(...operationSection(type));
  return `${lines.join("\n").trimEnd()}\n`;
}

export function describeOperationContract(type) {
  const spec = OPERATION_SPECS[type];
  if (!spec) {
    const suggestion = type ? nearestName(String(type), OPERATION_TYPES) : null;
    throw new Error(JSON.stringify({ code: "unknown_operation_type", type, ...(suggestion ? { did_you_mean: suggestion } : {}), supported_types: [...OPERATION_TYPES] }));
  }
  const statuses = Object.fromEntries((spec.status_kinds || []).map((kind) => [kind, { values: STATUS[kind], transitions: TRANSITIONS[kind] || null }]));
  const composites = Object.fromEntries(Object.values(spec.fields || {})
    .filter((fieldType) => COMPOSITE_TYPES[fieldType])
    .map((fieldType) => {
      const composite = COMPOSITE_TYPES[fieldType];
      return [fieldType, { ...composite, fields: composite.fields(), ...(composite.record_fields ? { record_fields: composite.record_fields() } : {}) }];
    }));
  return { type, ...spec, statuses, ...(Object.keys(composites).length ? { composite_types: composites } : {}) };
}

export const OPERATION_CONTRACT_PATH = GENERATED_PATH;
