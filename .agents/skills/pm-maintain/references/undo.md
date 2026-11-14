# 撤销最近一次项目写入

```text
node .harness/scripts/harness.mjs undo --latest --dry-run
→ 展示将恢复/移除的事实，以及 retained_paths 中保留的归档原件；
  目标 operation_id 取自结果的 compensation.compensated_operation_id
→ 用户确认后执行，使用预演得到的 ID（--latest 不能直接执行）：
node .harness/scripts/harness.mjs undo <operation_id> --confirmed-at <确认发生的 ISO-8601 时间>
```

已知 `operation_id` 时可直接 `undo <operation_id> --dry-run` 预演。`undo` 追加 `operation.compensate`，保留原操作和归档，不用 Git 或删除历史替代补偿。

缺少用户确认时间、受控变更、非最近有效操作、缺少补偿快照、后续冲突或写入人工文档内容时会拒绝。按 `code` 和 `fix` 正向修正，不绕过护栏；`no_undoable_operation` 表示没有可撤销的写入。撤销失败不声称已经恢复。
