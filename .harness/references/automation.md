# AI Agent 后台自动化

这些接口只供 AI Agent 在项目根目录调用。不得要求项目经理复制命令、编辑 JSON 或维护生成文件。运行环境需要 Node 20；缺失时停止结构化写入并向用户说明机械护栏不可用。

## 执行根与临时目录

执行根和清理边界见 `AGENTS.md`；外部工具与依赖按需读取[工具运行](tool-runtime.md)。Harness CLI 要求 cwd 精确等于项目根，相对输入路径也按项目根解析。

含用户原文或长文本的 Harness 输入放在 `tmp/harness/`，完成后清理；执行工具能直接写 stdin 时也可通过 stdin 传入。失败时读取结构化错误并修正输入、补充审批或请求用户判断；不得绕过校验或无限重试。

## 统一 `record`

入参支持三种方式。任意文本优先用文件或执行工具的直接 stdin，避免 shell 转义；`--data` 只用于不含外部原文的简短 JSON：

```text
node .harness/scripts/harness.mjs record --input tmp/harness/operation.json
node .harness/scripts/harness.mjs record --data '<short-json>'
# 或启动命令后通过执行工具直接写入 stdin
node .harness/scripts/harness.mjs record
```

写入前先按操作查询紧凑契约，避免读取整份参考或源码：

```text
node .harness/scripts/harness.mjs contract activity.record --compact
```

完整字段、必填项和状态转换见自动生成的 [operation-contract.md](operation-contract.md)。失败时按返回的 `code`、`fix` 和候选字段修正一次，不反复试错。

## 预演（`--dry-run`）

```text
node .harness/scripts/harness.mjs record --dry-run --data '<json>'
```

需要在对话中展示 before/after 再执行时，先用 `--dry-run` 预演。它按完全相同的路径执行审批校验、状态转换检查和工作区校验，只是不提交，返回：

- `changes`：记录级 `created | updated | removed`，更新项带 `fields` 与逐字段 `before` / `after`；
- `changed_stores` 和 `would_write`：将被写入的事实源；
- `warnings`：不阻塞但值得说明的问题。

预演不写任何文件，也不占用幂等表里的 `operation_id`；确认后用同一 `operation_id` 正常提交即可。`workflow.apply` 同样支持预演，一次返回全部步骤的合并变更。

预演不是审批旁路：缺少有效审批、非法状态转换和校验错误在预演阶段就会失败，与真实写入一致。受控变更仍需 `CR-###` 和用户确认的业务批准。

同一 `operation_id` 与相同请求再次提交时返回首次结果，不分配新 ID，也不重复记录活动；同一 ID 搭配不同请求摘要会报冲突。所有目标先写入临时事务目录；验证或替换任一目标失败时恢复整个操作。

审批字段和受控变更流程以 [operation-contract.md](operation-contract.md) 与 [change-control.md](change-control.md) 为准；不得从邮件或截图推断审批范围或批准事件。

同步多个事实源时使用 `workflow.apply`：按依赖顺序提交普通类型化操作，完整校验后一次提交，任一步失败整体回滚。工作流不能嵌套，也不扩大各步骤的审批权限。

## 兼容包装

以下入口保留给已有工作流，内部仍转换为统一 `record`：

```text
node .harness/scripts/harness.mjs init --input tmp/harness/init.json
node .harness/scripts/harness.mjs source-add --input tmp/harness/source.json
node .harness/scripts/harness.mjs activity-add --input tmp/harness/activity.json
```

来源 `raw_path` 必须位于项目目录内，临时接收的附件优先放在被忽略的 `tmp/harness/intake/`。原件复制到 `archive/files/<year>/`；结构化来源、收件箱条目和归档索引在同一事务中提交。不要未经用户授权删除原输入文件。

## 读取与维护

```text
node .harness/scripts/harness.mjs query <collection|ID> [--id ID] [--where field=value] [--fields a,b] [--limit n]
node .harness/scripts/harness.mjs contract <operation-type> [--compact]
node .harness/scripts/harness.mjs brief --json
node .harness/scripts/harness.mjs rebuild
node .harness/scripts/harness.mjs lint --json [--fast]
node .harness/scripts/harness.mjs maintain
node .harness/scripts/harness.mjs undo <operation_id> --dry-run
node .harness/scripts/harness.mjs undo <operation_id> --confirmed-at <ISO-8601>
```

- `query` 只读取目标事实源，并按 ID 或过滤条件返回单条/少量记录。集合名用单数或复数皆可（`task`/`tasks`）；只给 ID 时按前缀自动定位。字段拼错会返回候选，不会静默产生空结果。例：`query REQ-003 --fields status,title`、`query tasks --where status=blocked`。
- `contract` 只返回一个操作的字段、必填项、默认值和状态转换；AI 优先使用 `--compact`。
- `brief` 把行动分为三组并跨组去重：`attention_actions`（需响应的风险与紧急工作，附 `attention_summary` 计数）、`top_actions`（常规行动，最多三项）和 `issue_actions`（open/monitoring 问题）。前后两组不设上限，不占常规额度；展示方式见 `pm-daily-brief`，不把完整 JSON 原样转给用户。
- `rebuild` 只重建甘特图、活动、知识、交付物、偏好和规则视图，不生成 `memory/current.md` 与 `project/status.md`（用各自的 `record` 操作更新）。视图未全部刷新时 `ok:false` 且退出码为 1。
- 事实与摘要先提交，派生视图随后刷新；视图失败不回滚事实，返回 `generated_views_pending` 警告。看到该警告：排除故障后运行一次 `rebuild`，不要重放已提交的 `record`。
- 无关记录的交付物、Wiki 正文缺失或不可读时，本次无关写入仍成功并返回 `outside_operation` 警告；操作涉及的对象缺文件则整体拒绝。向用户报告缺哪个文件并请其从原件或备份恢复，不要补造内容或改状态消除警告。
- 警告在响应里每类最多 3 条样本，另附 `warning_summary`（总数、各类数量、`omitted`）；完整清单用 `lint --json`。同一 `operation_id` 重试只返回原提交的计数，不重复展开。
- `source.register` 的哈希、去重和归档共用一次原件读取；每次请求独立保存 `raw_input_sha256`，即使按来源地址去重返回了旧版本也不混用内容哈希。提交后若临时原件已被清理，用同一 `operation_id` 和原请求重试会复用原记录并返回 `source_original_unavailable`；请求内容变化则报 `operation_id_conflict`。
- `lint` 检查数据契约、引用、审批、基线摘要、生命周期、Wiki/归档、补偿快照和环境，并列出相互独立的全部错误，不因一处错误隐藏其他诊断。问题的 `scope` 标明影响范围：`local`（只影响所指文件或摘要）、`environment`（Skill 与模块）、`outside_operation`（本次操作之外）；无 `scope` 的错误是全局问题。`--fast` 跳过归档与交付物的逐文件哈希校验，返回结果标记 `mode` 和被跳过的检查。
- `maintain` 单次执行重建、完整检查（含哈希）、规则候选去重和到期规则复查，不启动后台循环。只有无 `scope` 的错误或事务待恢复才会在修改前停止（`stopped_before_changes:true`）；带 `scope` 的问题不阻断提案落地。`ok` 表示整次维护是否完整通过，退出码非 0 表示仍有问题待处理，不要因此重放已提交记录。`pending_proposals` 是待处置提案的唯一入口，`pending_proposals_complete:false` 时不得把空数组当作没有提案；`rule_reviews_due` 给出到期规则的保留/收窄/退役建议。两者只报告事实，处置由用户决定。
- `status.update` 和 `memory.current.update` 用事务更新人读摘要；不要在事实 JSON 已提交后再用非事务方式覆盖这两个文件。
- `lint` 会提示过大的结构化 Store。读取优先使用 `query --fields ... --limit ...`，不要把完整 JSON 复制进对话；压缩或归档必须保留事实、ID 和审计可追溯性。
- `undo` 撤销最近一次可补偿写入；不知道 `operation_id` 时先用 `undo --latest --dry-run` 查找并预演（`--latest` 只能预演），用户确认后用返回的 ID 执行。用户要求撤销时读取[撤销流程](../../.agents/skills/pm-maintain/references/undo.md)。
- 修改 `.harness/lib/model.mjs` 或 `.harness/lib/contracts.mjs` 的契约后运行 `npm run docs:contract` 重新生成参考。
