# 操作契约字段参考

本文件由 `npm run docs:contract` 从 `.harness/lib/contracts.mjs` 的可执行操作契约生成，不要手改。
字段真相在可执行契约中；本文件只是按需查阅的索引，避免为写一次记录去读源码。

写入不确定字段时，直接提交并读结构化报错：`unknown_field` 会返回 `did_you_mean` 和完整 `supported_fields`。

## 统一信封

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `schema_version` | `1` | 是 | 固定为当前契约版本 |
| `operation_id` | `OP-…` | 是 | 稳定可重放；相同 ID 与相同请求返回首次结果 |
| `type` | 见下表 | 是 | 操作类型 |
| `actor` | `{ kind }` | 是 | `kind` 取 `user`、`agent` 或 `stakeholder` |
| `reason` | 非空字符串 | 是 | 写入原因 |
| `source_ids` | 字符串数组 | 是 | 支撑本次写入的来源 |
| `approval` | 对象 | 受控操作 | `approved_by_id`、`approved_at`、`confirmed_by_user_at`，改已批准对象另需 `change_request_id` |
| `payload` | 对象 | 是 | 类型化载荷，字段见下表 |

## 操作类型

### `project.initialize`

初始化项目事实；省略 id 时分配 PRJ-001。

必填：`name`、`timezone`、`objective`

可省略并由 Harness 补全：`id`、`status`、`scope_in`、`scope_out`、`success_criteria`、`constraints`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` |  |
| `name` | `string` | 是 |
| `status` | `string` |  |
| `timezone` | `string` | 是 |
| `objective` | `string` | 是 |
| `scope_in` | `stringArray` |  |
| `scope_out` | `stringArray` |  |
| `success_criteria` | `stringArray` |  |
| `constraints` | `stringArray` |  |

`project` 状态取值：`uninitialized`、`active`、`on_hold`、`completed`、`cancelled`

允许转换：`uninitialized` → `active`；`active` → `on_hold` | `completed` | `cancelled`；`on_hold` → `active` | `cancelled`

### `project.update`

只更新提供的字段；改变目标、范围、成功标准或预算需要对话确认。

| 字段 | 类型 | 必填 |
|---|---|---|
| `name` | `string` |  |
| `status` | `string` |  |
| `timezone` | `string` |  |
| `objective` | `string` |  |
| `scope_in` | `stringArray` |  |
| `scope_out` | `stringArray` |  |
| `success_criteria` | `stringArray` |  |
| `constraints` | `stringArray` |  |
| `budget` | `object` |  |

`project` 状态取值：`uninitialized`、`active`、`on_hold`、`completed`、`cancelled`

允许转换：`uninitialized` → `active`；`active` → `on_hold` | `completed` | `cancelled`；`on_hold` → `active` | `cancelled`

### `status.update`

以事务方式更新项目状态摘要；不改变结构化事实。

必填：`content`

| 字段 | 类型 | 必填 |
|---|---|---|
| `content` | `string` | 是 |

### `memory.current.update`

以事务方式更新短期工作记忆；内容受配置大小上限约束。

必填：`content`

| 字段 | 类型 | 必填 |
|---|---|---|
| `content` | `string` | 是 |

### `stakeholder.upsert`

新建记录时另需：`name`、`role`

更新记录时另需：`id`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` |  |
| `name` | `string` |  |
| `role` | `string` |  |
| `organization` | `nullableString` |  |
| `status` | `string` |  |
| `approval_scopes` | `approvalScopes` |  |
| `source_ids` | `stringArray` |  |
| `updated_at` | `timestamp` |  |

`stakeholder` 状态取值：`active`、`inactive`

### `source.register`

raw_path 必须位于项目目录内；items 为收件箱条目数组。

新建记录时另需：`type`

可省略并由 Harness 补全：`id`、`title`、`captured_at`、`summary`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` |  |
| `type` | `sourceType` |  |
| `title` | `string` |  |
| `channel` | `nullableString` |  |
| `sender` | `nullableString` |  |
| `stakeholder_id` | `nullableString` |  |
| `thread_id` | `nullableString` |  |
| `source_time` | `nullableDateOrTimestamp` |  |
| `captured_at` | `timestamp` |  |
| `archived_path` | `nullableString` |  |
| `source_locator` | `nullableString` |  |
| `sha256` | `nullableHash` |  |
| `summary` | `string` |  |
| `raw_path` | `workspacePath` |  |
| `archive_reason` | `string` |  |
| `items` | `inboxItemArray` |  |

`inboxItemArray` 的元素是收件箱条目对象：

可用字段：`applied_at`、`applied_to_ids`、`authority`、`classification`、`confidence`、`disposition_reason`、`proposed_action`、`quote`、`related_ids`、`status`、`summary`

必填：`classification`、`summary`

可省略并由 Harness 补全：`authority`、`status`、`related_ids`、`applied_to_ids`

由 Harness 补全，不要传：`id`、`source_id`、`created_at`

authority 默认为 unknown，status 默认为 new；id、source_id、created_at 由 Harness 补全，传入会被拒。

### `activity.record`

必填：`action`、`outcome`

可省略并由 Harness 补全：`id`、`occurred_at`、`related_ids`、`source_ids`、`recorded_at`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` |  |
| `occurred_at` | `timestamp` |  |
| `action` | `string` | 是 |
| `outcome` | `string` | 是 |
| `related_ids` | `stringArray` |  |
| `source_ids` | `stringArray` |  |
| `evidence` | `nullableString` |  |
| `next_action` | `nullableString` |  |
| `recorded_at` | `timestamp` |  |
| `timestamp` | `timestamp` |  |

### `schedule.upsert`

记录字段可平铺或放入 record；create/update 必填字段指记录本身。

必填：`collection`

新建记录时另需：`title`

更新记录时另需：`id`

可省略并由 Harness 补全：`id`、`status`、`owner`、`progress`、`dependency_ids`、`requirement_ids`、`deliverable_ids`、`source_ids`、`next_action`、`updated_at`

| 字段 | 类型 | 必填 |
|---|---|---|
| `collection` | `tasks | milestones` | 是 |
| `record` | `object` |  |
| `id` | `string` |  |
| `title` | `string` |  |
| `status` | `string` |  |
| `owner` | `nullableString` |  |
| `progress` | `progress` |  |
| `baseline_start` | `nullableDate` |  |
| `baseline_end` | `nullableDate` |  |
| `forecast_start` | `nullableDate` |  |
| `forecast_end` | `nullableDate` |  |
| `actual_start` | `nullableDate` |  |
| `actual_end` | `nullableDate` |  |
| `dependency_ids` | `stringArray` |  |
| `requirement_ids` | `stringArray` |  |
| `deliverable_ids` | `stringArray` |  |
| `source_ids` | `stringArray` |  |
| `next_action` | `nullableString` |  |
| `evidence` | `nullableString` |  |
| `updated_at` | `timestamp` |  |

`task` 状态取值：`not_started`、`in_progress`、`blocked`、`done`、`cancelled`

允许转换：`not_started` → `in_progress` | `blocked` | `cancelled`；`in_progress` → `blocked` | `done` | `cancelled`；`blocked` → `in_progress` | `done` | `cancelled`

### `schedule.batch-upsert`

原子写入多个任务或里程碑；全部校验通过后统一提交。基线字段只产生一次修订和一条变更记录。

必填：`items`

| 字段 | 类型 | 必填 |
|---|---|---|
| `items` | `scheduleUpsertItemArray` | 是 |

`scheduleUpsertItemArray` 的元素是计划批量写入对象：

可用字段：`collection`、`record`

必填：`collection`、`record`

record 可用字段：`actual_end`、`actual_start`、`baseline_end`、`baseline_start`、`deliverable_ids`、`dependency_ids`、`evidence`、`forecast_end`、`forecast_start`、`id`、`next_action`、`owner`、`progress`、`requirement_ids`、`source_ids`、`status`、`title`、`updated_at`

collection 为 tasks 或 milestones；新建 record 需要 title，更新 record 需要 id。一次调用中的记录 ID 不得重复。

`task` 状态取值：`not_started`、`in_progress`、`blocked`、`done`、`cancelled`

允许转换：`not_started` → `in_progress` | `blocked` | `cancelled`；`in_progress` → `blocked` | `done` | `cancelled`；`blocked` → `in_progress` | `done` | `cancelled`

### `schedule.baseline.approve`

payload 为空对象；只确认已填写的草拟基线，不接受 change_request_id。重复批准相同快照会安全返回 already_approved，不新增修订；需要按变更请求修改日期时使用 schedule.batch-upsert。

payload 无字段（空对象）。

### `requirement.upsert`

新建记录时另需：`title`、`description`

更新记录时另需：`id`

可省略并由 Harness 补全：`id`、`status`、`acceptance_criteria`、`source_ids`、`updated_at`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` |  |
| `title` | `string` |  |
| `description` | `string` |  |
| `status` | `string` |  |
| `acceptance_criteria` | `stringArray` |  |
| `source_ids` | `stringArray` |  |
| `supersedes_id` | `nullableString` |  |
| `superseded_by_id` | `nullableString` |  |
| `approved_by_id` | `nullableString` |  |
| `approved_at` | `nullableTimestamp` |  |
| `updated_at` | `timestamp` |  |

`requirement` 状态取值：`candidate`、`proposed`、`approved`、`implemented`、`validated`、`superseded`、`rejected`

允许转换：`candidate` → `proposed` | `rejected`；`proposed` → `approved` | `rejected`；`approved` → `implemented` | `superseded`；`implemented` → `validated` | `superseded`；`validated` → `superseded`

### `register.upsert`

记录字段可平铺或放入 record；create/update 必填字段指记录本身。

必填：`collection`

新建记录时另需：`title`、`description`

更新记录时另需：`id`

可省略并由 Harness 补全：`id`、`status`、`owner`、`source_ids`、`updated_at`

| 字段 | 类型 | 必填 |
|---|---|---|
| `collection` | `risks | issues | decisions` | 是 |
| `record` | `object` |  |
| `id` | `string` |  |
| `title` | `string` |  |
| `description` | `string` |  |
| `status` | `string` |  |
| `owner` | `nullableString` |  |
| `source_ids` | `stringArray` |  |
| `probability` | `nullableRiskLevel` |  |
| `impact` | `nullableRiskLevel` |  |
| `trigger` | `nullableString` |  |
| `response` | `nullableString` |  |
| `response_due` | `nullableDate` |  |
| `next_review` | `nullableDate` |  |
| `resolution` | `nullableString` |  |
| `updated_at` | `timestamp` |  |
| `rationale` | `nullableString` |  |
| `approved_by_id` | `nullableString` |  |
| `approved_at` | `nullableTimestamp` |  |
| `superseded_by_id` | `nullableString` |  |

`register` 状态取值：`open`、`monitoring`、`mitigated`、`resolved`、`accepted`、`closed`

`decision` 状态取值：`proposed`、`approved`、`rejected`、`superseded`

允许转换：`proposed` → `approved` | `rejected`；`approved` → `superseded`

### `change.propose`

每个 target_id 必须有一条 change_items: [{ target_id, before, after }]。

必填：`title`、`approval_scope`、`target_ids`、`change_items`、`before`、`after`、`reason`、`impact`

可省略并由 Harness 补全：`id`、`source_ids`、`created_at`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` |  |
| `title` | `string` | 是 |
| `approval_scope` | `approvalScope` | 是 |
| `target_ids` | `stringArray` | 是 |
| `change_items` | `changeItems` | 是 |
| `before` | `string` | 是 |
| `after` | `string` | 是 |
| `reason` | `string` | 是 |
| `impact` | `string` | 是 |
| `source_ids` | `stringArray` |  |
| `created_at` | `timestamp` |  |

`changeItems` 的元素是逐项 before/after 对象：

可用字段：`target_id`、`before`、`after`

必填：`target_id`、`before`、`after`

target_id 为非空字符串且不得重复；before 与 after 必须是对象。每个 target_id 一条。

`change_request` 状态取值：`proposed`、`impact_review`、`approved`、`rejected`、`implemented`

允许转换：`proposed` → `impact_review` | `approved` | `rejected`；`impact_review` → `approved` | `rejected`；`approved` → `implemented`

### `change.approve`

批准后摘要锁定，实际写入必须逐项一致；approved_at 不得早于变更请求 created_at，同一 workflow 中建议显式使用递增时间戳。

必填：`id`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` | 是 |

`change_request` 状态取值：`proposed`、`impact_review`、`approved`、`rejected`、`implemented`

允许转换：`proposed` → `impact_review` | `approved` | `rejected`；`impact_review` → `approved` | `rejected`；`approved` → `implemented`

### `inbox.transition`

必填：`id`、`status`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` | 是 |
| `status` | `string` | 是 |
| `applied_to_ids` | `stringArray` |  |
| `applied_at` | `nullableTimestamp` |  |
| `disposition_reason` | `nullableString` |  |

`inbox` 状态取值：`new`、`triaged`、`needs_confirmation`、`applied`、`archived`、`rejected`

允许转换：`new` → `triaged` | `needs_confirmation` | `applied` | `archived` | `rejected`；`triaged` → `needs_confirmation` | `applied` | `archived` | `rejected`；`needs_confirmation` → `triaged` | `applied` | `archived` | `rejected`

### `deliverable.upsert`

新建记录时另需：`title`、`type`、`format`、`version`、`audience`、`purpose`

更新记录时另需：`id`

可省略并由 Harness 补全：`id`、`status`、`requirement_ids`、`source_ids`、`acceptance_criteria`、`reviewers`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` |  |
| `title` | `string` |  |
| `type` | `string` |  |
| `format` | `string` |  |
| `version` | `string` |  |
| `status` | `string` |  |
| `path` | `nullableString` |  |
| `content_sha256` | `nullableHash` |  |
| `audience` | `string` |  |
| `purpose` | `string` |  |
| `requirement_ids` | `stringArray` |  |
| `source_ids` | `stringArray` |  |
| `due_at` | `nullableDate` |  |
| `completed_at` | `nullableTimestamp` |  |
| `approved_by_id` | `nullableString` |  |
| `approved_at` | `nullableTimestamp` |  |
| `delivered_at` | `nullableTimestamp` |  |
| `accepted_by_id` | `nullableString` |  |
| `accepted_at` | `nullableTimestamp` |  |
| `acceptance_criteria` | `stringArray` |  |
| `acceptance_evidence` | `nullableString` |  |
| `reviewers` | `stringArray` |  |
| `supersedes_id` | `nullableString` |  |
| `superseded_by_id` | `nullableString` |  |

`deliverable` 状态取值：`requested`、`drafting`、`review`、`approved`、`delivered`、`accepted`、`superseded`、`cancelled`

允许转换：`requested` → `drafting` | `cancelled`；`drafting` → `review` | `cancelled`；`review` → `drafting` | `approved` | `cancelled`；`approved` → `delivered` | `superseded`；`delivered` → `accepted` | `superseded`；`accepted` → `superseded`

### `deliverable.transition`

必填：`id`、`status`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` | 是 |
| `title` | `string` |  |
| `type` | `string` |  |
| `format` | `string` |  |
| `version` | `string` |  |
| `status` | `string` | 是 |
| `path` | `nullableString` |  |
| `content_sha256` | `nullableHash` |  |
| `audience` | `string` |  |
| `purpose` | `string` |  |
| `requirement_ids` | `stringArray` |  |
| `source_ids` | `stringArray` |  |
| `due_at` | `nullableDate` |  |
| `completed_at` | `nullableTimestamp` |  |
| `approved_by_id` | `nullableString` |  |
| `approved_at` | `nullableTimestamp` |  |
| `delivered_at` | `nullableTimestamp` |  |
| `accepted_by_id` | `nullableString` |  |
| `accepted_at` | `nullableTimestamp` |  |
| `acceptance_criteria` | `stringArray` |  |
| `acceptance_evidence` | `nullableString` |  |
| `reviewers` | `stringArray` |  |
| `supersedes_id` | `nullableString` |  |
| `superseded_by_id` | `nullableString` |  |

`deliverable` 状态取值：`requested`、`drafting`、`review`、`approved`、`delivered`、`accepted`、`superseded`、`cancelled`

允许转换：`requested` → `drafting` | `cancelled`；`drafting` → `review` | `cancelled`；`review` → `drafting` | `approved` | `cancelled`；`approved` → `delivered` | `superseded`；`delivered` → `accepted` | `superseded`；`accepted` → `superseded`

### `wiki.register`

新页面必须提供 content；更新已有页面时可省略。

新建记录时另需：`title`、`path`

更新记录时另需：`id`

可省略并由 Harness 补全：`id`、`status`、`source_ids`、`related_ids`、`last_reviewed_at`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` |  |
| `title` | `string` |  |
| `path` | `string` |  |
| `status` | `string` |  |
| `source_ids` | `stringArray` |  |
| `related_ids` | `stringArray` |  |
| `owner` | `nullableString` |  |
| `last_reviewed_at` | `nullableTimestamp` |  |
| `review_due_at` | `nullableDate` |  |
| `supersedes_id` | `nullableString` |  |
| `superseded_by_id` | `nullableString` |  |
| `content` | `string` |  |

`wiki` 状态取值：`active`、`superseded`、`archived`

允许转换：`active` → `superseded` | `archived`；`superseded` → `archived`

### `observation.record`

必填：`title`、`pattern_key`、`evidence`

可省略并由 Harness 补全：`id`、`status`、`created_at`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` |  |
| `title` | `string` | 是 |
| `pattern_key` | `string` | 是 |
| `status` | `string` |  |
| `evidence` | `string` | 是 |
| `suggested_rule` | `nullableString` |  |
| `proposal_id` | `nullableString` |  |
| `created_at` | `timestamp` |  |
| `resolved_at` | `nullableTimestamp` |  |

`observation` 状态取值：`open`、`resolved`、`dismissed`

### `rule.propose`

必须关联 observation_ids，或提供 manual_reason。

必填：`title`、`proposed_rule`、`scope`、`expected_benefit`、`possible_side_effects`、`evaluation_metric`、`review_at`

至少提供一项：`observation_ids`、`manual_reason`

可省略并由 Harness 补全：`id`、`observation_ids`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` |  |
| `title` | `string` | 是 |
| `observation_ids` | `stringArray` |  |
| `proposed_rule` | `string` | 是 |
| `scope` | `string` | 是 |
| `expected_benefit` | `string` | 是 |
| `possible_side_effects` | `string` | 是 |
| `evaluation_metric` | `string` | 是 |
| `review_at` | `dateOrTimestamp` | 是 |
| `manual_reason` | `nullableString` |  |
| `pattern_key` | `nullableString` |  |

`proposal` 状态取值：`proposed`、`approved`、`active`、`rejected`、`retired`

允许转换：`proposed` → `approved` | `rejected`；`approved` → `active` | `rejected`；`active` → `retired`

### `rule.activate`

必须由用户明确确认。

必填：`id`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` | 是 |

`proposal` 状态取值：`proposed`、`approved`、`active`、`rejected`、`retired`

允许转换：`proposed` → `approved` | `rejected`；`approved` → `active` | `rejected`；`active` → `retired`

### `rule.retire`

必须由用户明确确认。

必填：`id`

| 字段 | 类型 | 必填 |
|---|---|---|
| `id` | `string` | 是 |

`rule` 状态取值：`active`、`retired`

### `operation.compensate`

实际执行需要 approval.confirmed_by_user_at；追加补偿操作来撤销最近一次可撤销写入，原操作保留；受控变更和人工维护的文档不可直接补偿，状态与当前记忆摘要可以事务撤销。

必填：`operation_id`

| 字段 | 类型 | 必填 |
|---|---|---|
| `operation_id` | `string` | 是 |

### `workflow.apply`

operations 按依赖顺序排列；不支持嵌套工作流。

必填：`kind`、`operations`

| 字段 | 类型 | 必填 |
|---|---|---|
| `kind` | `string` | 是 |
| `operations` | `operationArray` | 是 |

`operationArray` 的元素是工作流步骤对象：

可用字段：`approval`、`payload`、`reason`、`source_ids`、`type`

必填：`type`、`payload`

reason、source_ids、approval 省略时继承外层信封；不支持嵌套 workflow.apply。
