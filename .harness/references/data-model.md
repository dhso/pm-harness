# 数据模型

## 稳定 ID

- 项目：`PRJ-001`
- 里程碑：`MS-001`
- 任务：`TASK-001`
- 需求：`REQ-001`
- 变更请求：`CR-001`
- 风险：`RISK-001`
- 问题：`ISSUE-001`
- 决策：`DEC-001`
- 来源：`SRC-001`
- 收件箱条目：`INB-001`
- 交付物：`DEL-001`
- 观察、规则提案与归档记录：`OBS-001`、`RULE-001`、`ARC-001`

ID 一经分配不得复用。标题变化不改变 ID。

## 状态

- 项目：`uninitialized | active | on_hold | completed | cancelled`
- 任务：`not_started | in_progress | blocked | done | cancelled`
- 需求：`candidate | proposed | approved | implemented | validated | superseded | rejected`
- 变更请求：`proposed | impact_review | approved | rejected | implemented`
- 风险/问题：`open | monitoring | mitigated | resolved | accepted | closed`
- 交付物：`requested | drafting | review | approved | delivered | accepted | superseded | cancelled`
- 收件箱：`new | triaged | needs_confirmation | applied | archived | rejected`
- 观察：`open | resolved | dismissed`
- 规则提案：`proposed | approved | active | rejected | retired`

## 时间

- 持久化时间使用 ISO 8601。
- 纯日期使用 `YYYY-MM-DD`；具体事件使用带偏移量的时间戳。
- 同时保留来源时间 `source_time`、摄取时间 `captured_at` 和生效时间 `effective_at`。
- 计划对象分别保存 `baseline_*`、`forecast_*`、`actual_*`。

## 关系与证据

跨文件关系使用稳定 ID，不依赖标题或文件名。正式事实、需求、决定、任务完成和交付状态应尽量带 `source_ids`、`decision_ids` 或 `evidence` 路径。

推测必须标记为 `inferred`，不能写成已确认事实。

## 演进与替代关系

- 每条观察必须有可聚合的 `pattern_key`；关联提案时同时记录 `proposal_id`。
- 规则提案必须列出 `observation_ids`、规则正文、范围、收益、副作用、评价指标和复查时间。批准信息与生效信息分开记录。
- 每个受控交付版本使用独立 `DEL-###`，通过 `supersedes_id` / `superseded_by_id` 串联，避免覆盖历史版本。
- 每个归档文件使用独立 `ARC-###`，以 `logical_id` 指回来源或交付版本，并保存文件名、类型、SHA-256、归档时间、原因、替代对象和可用状态。
