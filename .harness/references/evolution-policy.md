# 记忆与规则演进

## 记忆

记忆分四层，每层只有一个落点存储和一组类型化操作：

| 层 | 存储 | 操作 |
|---|---|---|
| 当前工作记忆 | `memory/current.md` | `memory.current.update` |
| 协作与交付偏好 | `memory/preferences.json`（生成 `memory/preferences.md`） | `memory.preference.upsert`、`memory.preference.retire` |
| 项目知识 | `knowledge/` | `source.register`、`inbox.transition`、`wiki.register` |
| 演进证据与规则 | `memory/observations.json`、`governance/` | `observation.record`、`rule.propose`、`rule.activate`、`rule.reject`、`rule.retire` |

已确认的项目事实不进记忆层：目标、范围、成功标准和约束用 `project.update`；干系人事实和审批范围用 `stakeholder.upsert`；已确认决定用 `register.upsert`；主题性知识用 `wiki.register`。

每条观察使用稳定 `pattern_key` 聚合同类问题，并记录 `open | resolved | dismissed` 状态。关联规则提案时，观察的 `proposal_id` 与提案的 `observation_ids` 应相互对应。问题解决后把观察转为 `resolved` 或 `dismissed`，不要只增不减。

不得把猜测、临时讨论或一次性措辞固化为记忆。

整理时按维护/lint 输出定位对象：当前记忆过期先查相关事实，再用 `memory.current.update` 更新，不编造内容消除告警。记忆冲突解决或大范围删除先展示影响并取得用户批准；机械漂移、基线修复与规则启停遵循 `AGENTS.md`。

## 偏好

偏好是用户表达或复盘确认的协作、写作和交付习惯，只保留 `scope`、`text` 和来源引用三样必要信息。`scope` 是自由分类，常用 `communication`、`document`、`schedule`、`collaboration`、`tooling`，遇到新形态（画图、评审、会议节奏）直接用贴切的词，不必挤进既有取值。

偏好不需要审批，也不进受控变更审计：用户说了就是权威，为记一句话开审批流会让 agent 宁可不记。三种动作的处理方式：

| 动作 | Harness 行为 | 对话方式 |
|---|---|---|
| 新增一条偏好 | 直接写入 | 事后回述记住了什么 |
| 补来源或调整分类 | 原地更新 | 无需提及 |
| 改写 `text` | 自动退役旧条、分配新 ID 并建立替代链 | 回述新旧两种表述 |
| 退役偏好 | 标记 `retired` 并记录原因 | 说明为什么不再适用 |

改写 `text` 等于换掉用户说过的话，所以旧条不被覆盖而是退役留档，`supersedes_id` 与 `superseded_by_id` 相互指向，操作结果的 `superseded` 字段给出被取代的原文供回述。生成视图只展示生效偏好；被取代和已退役的条目留在 `memory/preferences.json` 里可回溯。写错时直接撤销最近一次操作即可，不必留下退役记录。

`status`、替代链和退役字段由 Harness 维护，不在操作契约内，agent 无法直接改写状态。

语义冲突机器判断不了，所以写入前先 `query preference --where scope=<范围>`：新表述是旧表述的修订就提交同一个 id 让 Harness 走替代链，是并存的另一件事就新建。

活跃偏好数超过 `max_active_preferences`、lint 报 `preferences_over_budget` 时用 `query preference` 通读，合并语义重叠项并退役其余；冲突不自行合并。

## 规则提案

按 [AGENTS.md 的自我演进边界](../../AGENTS.md#自我演进)判断是否立项；提案包含：

- 证据与关联观察；
- 建议规则和适用范围；
- 预期收益和可能副作用；
- 验证指标和复查时间；
- 状态 `proposed`。

`governance/rules.json` 是规则事实源，`governance/rules.md` 自动生成。达到阈值时 `maintain` 只生成一份按 `pattern_key` 去重的提案，绝不自动激活。用户批准后才激活；后续比较规则生效后的同类观察，并建议保留、收窄、修订或退役。

提案生命周期为 `proposed → approved → active`，也可进入 `rejected` 或 `retired`。不采纳的提案用 `rule.reject` 记录理由并写入 `disposition_reason`，使其离开待批准队列；复盘确认但尚无重复观察的经验用 `manual_reason` 立项。批准时间、生效时间和复查时间分别记录；只有 `active` 规则进入生成视图。内置审批、事务和证据护栏不可由项目级规则覆盖。

处置维护输出时查询相关规则与观察，新增提案前先去重或收窄。对 `pending_proposals` 与 `rule_reviews_due` 逐项提出处理建议，用户决定后用 `rule.activate`、`rule.reject` 或 `rule.retire` 应用并设置复查条件；已解决观察按本文件关闭。各整理分支返回已处理对象和未解决事项，由调用方统一收尾。
