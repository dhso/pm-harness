# v2 数据模型

`.harness/lib/model.mjs` 是状态、ID、必填字段、日期、哈希和状态转换的唯一可执行契约。写入和 lint 共用它；不得另建一份需要人工同步的 Schema。

## 事实源

| 对象 | ID | 文件 |
|---|---|---|
| 项目 | `PRJ-###` | `project/project.json` |
| 干系人 | `STK-###` | `project/stakeholders.json` |
| 里程碑 / 任务 | `MS-###` / `TASK-###` | `project/schedule.json` |
| 需求 / 变更请求 | `REQ-###` / `CR-###` | `project/requirements.json` |
| 风险 / 问题 / 决定 | `RISK-###` / `ISSUE-###` / `DEC-###` | `project/registers.json` |
| 来源 / 收件条目 | `SRC-###` / `INB-###` | `knowledge/sources.json` / `knowledge/inbox.json` |
| Wiki | `WIKI-###` | `knowledge/catalog.json` |
| 活动 | `ACT-###` | `activity/log.json` |
| 交付物 | `DEL-###` | `deliverables/index.json` |
| 观察 / 规则 | `OBS-###` / `RULE-###` | `memory/observations.json` / `governance/*.json` |
| 受控变更 / 归档 | `CHG-###` / `ARC-###` | `governance/change-log.json` / `archive/index.json` |

ID 一经分配不得复用；标题或路径变化不改变 ID。规则与其来源提案有意共用同一个 `RULE-###`，其他跨集合 ID 必须唯一。

## 状态与转换

- 项目：`uninitialized → active ↔ on_hold → completed | cancelled`
- 任务：`not_started → in_progress | blocked → done`，活动项也可取消；完成/取消后不可重新打开。
- 需求：`candidate → proposed → approved → implemented → validated`，或进入 `rejected | superseded`。
- 变更请求：`proposed → impact_review → approved → implemented`，或 `rejected`。
- 决定：`proposed → approved → superseded`，或 `rejected`。
- 交付物：`requested → drafting → review → approved → delivered → accepted`，也可合法返回修改、取消或被替代。
- 收件箱：`new → triaged | needs_confirmation → applied | archived | rejected`；终态不重开。
- 规则提案：`proposed → approved → active → retired`，或 `rejected`；一次用户激活操作可连续完成批准和激活。

不要靠直接编辑绕过转换。受控状态还必须同时满足审批范围和时间顺序。

## 时间、引用与摘要

- 纯日期使用真实的 `YYYY-MM-DD`；事件使用可解析的 ISO 8601 时间戳。
- `source_time`、`captured_at`、`approved_at`、`confirmed_by_user_at`、`effective_at` 分别记录，不互相替代。
- 计划对象同时保留 `baseline_*`、`forecast_*`、`actual_*`。
- 跨文件关系只使用稳定 ID；失效来源、依赖、交付、Wiki、提案和替代引用会报错。
- `schedule.baseline.digest` 是所有基线日期字段的规范化 SHA-256；批准记录的 after hash 必须一致。
- 交付物的完成、批准、交付和验收时间必须依次发生；替代链不得自指或成环。
- 风险可使用 `probability`、`impact`、`trigger`、`response_due` 和 `next_review`；每日引导优先提示高概率/高影响或临近响应、复查时间的风险。

## 收件箱、Wiki 与记忆

- `applied` 收件条目必须有 `applied_to_ids` 和 `applied_at`。
- `needs_confirmation | archived | rejected` 必须保留 `disposition_reason`。
- Wiki 只能位于 `knowledge/wiki/*.md`，必须登记来源、关联对象、最近复查与下次复查；页面和目录相互校验。
- `memory/current.md` 必须保留“当前重点、待确认、下一步”和 ISO 更新时间，并受配置的大小上限约束。
- 机械代码只检查记忆结构，不覆盖人工确认的语义内容。

## 受控变更

`CR-###` 同时保存面向人的 before/after 摘要和每个目标的结构化 `change_items`。批准时锁定其摘要；应用值不一致、目标不完整或已消费时拒绝写入，全部目标应用后进入 `implemented`。

`CHG-###` 保存操作 ID、目标、before/after 摘要和哈希、来源、变更请求、实际批准人、生效与记录时间。`operations` 保存幂等键和首次结果。`workflow.apply` 可将多项普通操作纳入同一事务，但不会绕过各步骤的审批。高风险操作缺少合法数据时，在事务开始前失败。

v1 迁移不会伪造结构化审批。旧批准状态和时间完整保存在 `legacy_approval`，旧审批范围保存在 `legacy_approval_scopes`，但它们在用户按 v2 流程重新确认前不生效，并会出现在 lint 与日报待确认项中。
