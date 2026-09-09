# 计划、甘特与活动政策

## 计划事实源

`project/schedule.json` 是唯一结构化时间事实源。`project/gantt.md` 是自动生成视图。

每个任务和里程碑至少包含：

- `id`、`title`、`status`、`owner`；
- `baseline_start/end`、`forecast_start/end`、`actual_start/end`；
- `dependency_ids`、`requirement_ids`、`deliverable_ids`；
- `progress`、`next_action`、`updated_at`；
- 完成时的 `evidence`。

## 更新时间

- 批准计划时设置 baseline；除非变更请求获批，否则保持不变。
- 日常进展只更新 forecast、actual、progress、status 和 next action。
- `forecast_end` 晚于 `baseline_end` 时保留偏差，不移动 baseline 掩盖延期。
- 完成事项写 actual end，并链接交付物、决定或其他结果证据。

## 活动记录

活动记录只写发生过的结果：时间、动作、关联 ID、结果、证据和下一步。不得复制完整聊天或工具日志。

## 日常引导

读取未来窗口内里程碑、逾期/阻塞任务、开放风险、待决变更、收件箱和待评审/交付物。输出不超过三个首要行动，并说明为什么是现在。

