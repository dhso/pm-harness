# 计划、甘特与活动政策

## 计划事实源

`project/schedule.json` 是唯一结构化时间事实源。`project/gantt.md` 是自动生成视图。`schedule.baseline` 保存 revision、当前基线字段 digest、批准人、批准时间和关联变更请求。

每个任务和里程碑至少包含：

- `id`、`title`、`status`、`owner`；
- `baseline_start/end`、`forecast_start/end`、`actual_start/end`；
- `dependency_ids`、`requirement_ids`、`deliverable_ids`；
- `progress`、`next_action`、`updated_at`；
- 完成时的 `evidence`。

## 更新时间

- 初始 baseline 可先作为草稿整体准备，再一次批准。baseline 批准后，新增、修改或删除任何基线事项都必须关联具有相同目标、审批范围和精确 before/after 的已批准变更请求。
- 同一批准或同一逻辑变更涉及多个计划条目时，使用 `schedule.batch-upsert` 一次预演、一次提交；不要循环调用 `schedule.upsert`。批量操作全部校验成功才写入，并只产生一个 baseline revision 和一条受控变更记录。
- 日常进展只更新 forecast、actual、progress、status 和 next action。
- `forecast_end` 晚于 `baseline_end` 时保留偏差，不移动 baseline 掩盖延期。
- 完成事项写 actual end，并链接交付物、决定或其他结果证据。

## 活动记录

`activity/log.json` 是唯一结构化活动事实源；日期 Markdown 和索引按项目时区自动生成。活动只写发生过的结果：时间、动作、关联 ID、来源、结果、证据和下一步。不得复制完整聊天或工具日志。

## 日常引导

读取近期活动、未来窗口内里程碑、逾期/阻塞任务、未完成依赖、开放风险、待决审批、未处理来源、待评审/交付物、Wiki 和规则复查。输出不超过三个首要行动，并说明为什么是现在。
