# 记忆与规则演进

## 记忆

- `memory/current.md`：当前重点、阻塞、未决问题和下一步，保持短小。
- `memory/facts.md`：已经确认且跨会话有价值的项目事实。
- `memory/preferences.md`：用户明确确认或反复体现的协作和交付偏好。
- `memory/lessons.md`：复盘确认、可在本项目复用的经验。
- `memory/observations.json`：一次性失败、纠错、异常和改进信号。

每条观察使用稳定 `pattern_key` 聚合同类问题，并记录 `open | resolved | dismissed` 状态。关联规则提案时，观察的 `proposal_id` 与提案的 `observation_ids` 应相互对应。

不得把猜测、临时讨论、一次性措辞或敏感秘密固化为记忆。

## 规则提案

只有同类观察重复出现，或复盘明确确认 Harness 缺陷时，才生成提案。提案包含：

- 证据与关联观察；
- 建议规则和适用范围；
- 预期收益和可能副作用；
- 验证指标和复查时间；
- 状态 `proposed`。

`governance/rules.json` 是规则事实源，`governance/rules.md` 自动生成。达到阈值时 `maintain` 只生成一份按 `pattern_key` 去重的提案，绝不自动激活。用户批准后才激活；后续比较规则生效后的同类观察，并建议保留、收窄、修订或退役。

提案生命周期为 `proposed → approved → active`，也可进入 `rejected` 或 `retired`。批准时间、生效时间和复查时间分别记录；只有 `active` 规则进入生成视图。内置审批、事务、证据和 Git 护栏不可由项目级规则覆盖。
