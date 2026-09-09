# ChatGPT 后台自动化

这些接口只供 ChatGPT 在项目根目录调用。不得要求项目经理复制命令、编辑 JSON 或维护生成文件。运行环境需要 Node 20；缺失时停止结构化写入并向用户说明机械护栏不可用。

写入输入放在被 Git 忽略的 `.harness/tmp/`，完成后清理。失败时读取结构化错误并修正输入、补充审批或请求用户判断；不得绕过校验或无限重试。

## 统一 `record`

```text
node .harness/scripts/harness.mjs record --input .harness/tmp/operation.json
```

统一信封包含：

- `schema_version: 2`
- 稳定且可重放的 `operation_id`
- `type`
- `actor: { "kind": "user | agent | stakeholder" }`
- 非空 `reason`
- `source_ids`
- 高风险操作所需的 `approval`
- 类型化 `payload`

主要类型：`project.initialize`、`project.update`、`stakeholder.upsert`、`source.register`、`activity.record`、`schedule.upsert`、`schedule.baseline.approve`、`requirement.upsert`、`register.upsert`、`change.propose`、`change.approve`、`inbox.transition`、`deliverable.upsert`、`deliverable.transition`、`wiki.register`、`observation.record`、`rule.propose`、`rule.activate`、`rule.retire`、`workflow.apply`。

同一 `operation_id` 与相同请求再次提交时返回首次结果，不分配新 ID，也不重复记录活动；同一 ID 搭配不同请求摘要会报冲突。所有目标先写入临时事务目录；验证或替换任一目标失败时恢复整个操作。

批准信封至少包含实际业务批准人的 `approved_by_id`、`approved_at` 和用户确认该审批已发生的 `confirmed_by_user_at`。修改已批准对象时还需 `change_request_id`。变更请求必须为每个目标保存机器可比较的 `change_items: [{ target_id, before, after }]`；批准后摘要锁定，实际写入必须逐项一致，目标应用后不可复用。授予干系人审批范围和激活/退役规则只使用用户明确确认，不从邮件或截图推断。

会议纪要或其他需要同步多个事实源的工作使用 `workflow.apply`。其 `payload` 包含语义化 `kind` 和按依赖顺序排列的普通类型化 `operations`；嵌套工作流不支持。所有步骤共享一次最终事务，完整校验后统一提交，任一步失败整体回滚。受控步骤仍需各自有效的审批和变更请求，外层工作流不扩大权限。

## 兼容包装

以下入口保留给已有工作流，内部仍转换为统一 `record`：

```text
node .harness/scripts/harness.mjs init --input .harness/tmp/init.json
node .harness/scripts/harness.mjs source-add --input .harness/tmp/source.json
node .harness/scripts/harness.mjs activity-add --input .harness/tmp/activity.json
```

来源 `raw_path` 必须位于项目目录内，临时接收的附件优先放在被忽略的 `.harness/tmp/intake/`。原件复制到 `archive/files/<year>/`；结构化来源、收件箱条目和归档索引在同一事务中提交。不要未经用户授权删除原输入文件。

## 读取与维护

```text
node .harness/scripts/harness.mjs brief --json
node .harness/scripts/harness.mjs rebuild
node .harness/scripts/harness.mjs lint --json
node .harness/scripts/harness.mjs maintain
```

- `brief` 提供近期活动和不超过三个带原因的首要行动，不把完整 JSON 原样转给用户。
- `rebuild` 只重建甘特图、活动、知识、交付物和规则视图。
- `lint` 检查可执行数据契约、引用、审批、基线摘要、生命周期、Wiki/归档和 Git 范围。
- `maintain` 最多执行一次安全重建、一次完整检查、规则候选去重和到期规则复查，不启动后台循环。

## v1 → v2 迁移

第一次调用只返回影响和 `preview_digest`：

```text
node .harness/scripts/harness.mjs migrate --input .harness/tmp/migrate-preview.json
```

向用户展示影响后，再以 `confirmed: true` 和完全相同的 `preview_digest` 调用。迁移整体事务提交；旧基线日期标为 `needs_confirmation`。v1 中无法满足结构化权限的批准状态保留到 `legacy_approval`，但降回待批准阶段；旧干系人权限保留到 `legacy_approval_scopes` 且不激活。已是 v2 时安全返回 `already_migrated`。
