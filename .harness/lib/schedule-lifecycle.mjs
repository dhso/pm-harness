import { assertTransition, isTimestamp } from "./model.mjs";
import { defaultScheduleRecord, localDate, normalizeArray, validateOrThrow } from "./helpers.mjs";

function fail(code, details) {
  throw new Error(JSON.stringify({ code, ...details }));
}

export function assertScheduleActuals(record) {
  if (record.status === "in_progress" && !record.actual_start) {
    fail("in_progress_without_actual_start", { id: record.id, fix: "进入 in_progress 时提供 actual_start，或使用 schedule.transition 并提供 occurred_at" });
  }
  if (record.status === "done" && !record.actual_start) {
    fail("done_without_actual_start", { id: record.id, fix: "完成事项前必须先记录 actual_start" });
  }
  if (record.status === "done" && !record.actual_end) {
    fail("done_without_actual", { id: record.id, fix: "进入 done 时提供 actual_end，或使用 schedule.transition 并提供 occurred_at" });
  }
  if (record.actual_start && record.actual_end && record.actual_end < record.actual_start) {
    fail("actual_date_order", { id: record.id, actual_start: record.actual_start, actual_end: record.actual_end, fix: "actual_end 不得早于 actual_start" });
  }
}

export function applyScheduleTransition({ envelope, data, now, changedStores, resultIds }) {
  const payload = envelope.payload;
  if (!isTimestamp(payload.occurred_at)) fail("schedule_transition_time_invalid", { occurred_at: payload.occurred_at, fix: "提供实际状态变化发生的 ISO 8601 时间戳" });
  const matches = ["tasks", "milestones"].flatMap((collection) => {
    const record = (data.schedule[collection] || []).find((item) => item.id === payload.id);
    return record ? [{ collection, record }] : [];
  });
  if (matches.length !== 1) {
    fail(matches.length ? "schedule_target_ambiguous" : "schedule_target_missing", { id: payload.id, fix: "使用现有 TASK-### 或 MS-###" });
  }
  const { collection, record: existing } = matches[0];
  const kind = collection === "tasks" ? "task" : "milestone";
  const previousStatus = existing.status;
  assertTransition(kind, existing.status, payload.status, existing.id);
  const eventDate = localDate(data.project.timezone || data.config.default_timezone || "UTC", new Date(payload.occurred_at));
  const values = {
    ...existing,
    status: payload.status,
    progress: payload.progress ?? existing.progress,
    evidence: payload.evidence ?? existing.evidence,
    next_action: payload.next_action ?? existing.next_action,
    source_ids: normalizeArray([...(existing.source_ids || []), ...(envelope.source_ids || [])]),
    updated_at: now,
  };
  if (payload.status === "in_progress" && !values.actual_start) values.actual_start = eventDate;
  if (payload.status === "done") values.actual_end = eventDate;
  const record = defaultScheduleRecord(values, kind, now);
  delete record._kind;
  validateOrThrow(kind, record);
  assertScheduleActuals(record);
  Object.assign(existing, record);
  changedStores.add("schedule");
  resultIds.push(record.id);
  return { schedule_item: record, transition: { from: previousStatus, to: record.status, occurred_at: payload.occurred_at } };
}
