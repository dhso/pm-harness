# AI Agent 后台自动化

这些接口只供 AI Agent 在项目根目录调用。不得要求项目经理复制命令、编辑 JSON 或维护生成文件。运行环境需要 Node 20；缺失时停止结构化写入并向用户说明机械护栏不可用。

## 执行根与临时目录

- 目录和依赖放置以 `AGENTS.md` 为准。Harness CLI 要求当前工作目录精确等于项目根；相对输入路径也按项目根解析。
- `tmp/harness/` 只用于 Harness 内部操作，`tmp/tasks/<task-key>/` 只用于单次外部任务。
- 包管理器使用默认用户级下载缓存；正式依赖放根依赖环境；任务沙箱不得包含依赖环境或包管理器缓存。
- 任务结束只清理当前 `tmp/tasks/<task-key>/`，不清理 `tmp/harness/`、`tmp/tasks/` 或其他任务目录。

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
- `brief` 提供近期活动和不超过三个带原因的首要行动，不把完整 JSON 原样转给用户。
- `rebuild` 只重建甘特图、活动、知识、交付物和规则视图。
- `lint` 检查可执行数据契约、引用、审批、基线摘要、生命周期、Wiki/归档和操作补偿快照，并提示任务沙箱根目录中残留的依赖环境或包管理器缓存。`--fast` 跳过归档与交付物的逐文件 SHA-256 校验，用于任务收尾；返回结果标记 `mode` 和被跳过的检查。
- `maintain` 最多执行一次安全重建、一次完整检查（含文件哈希）、规则候选去重和到期规则复查，不启动后台循环。返回的 `pending_proposals` 是待处置规则提案的唯一发现入口（含证据条数与 `overdue`），`pending_proposals_complete` 表示本次发现是否完整；为 `false` 时不得把空数组解释为没有提案。`rule_reviews_due` 给出到期规则的保留/收窄/退役建议；两者都只报告事实，处置须由用户决定。
- `status.update` 和 `memory.current.update` 用事务更新人读摘要；不要在事实 JSON 已提交后再用非事务方式覆盖这两个文件。
- `lint` 会提示过大的结构化 Store。读取优先使用 `query --fields ... --limit ...`，不要把完整 JSON 复制进对话；压缩或归档必须保留事实、ID 和审计可追溯性。
- `undo` 通过追加 `operation.compensate` 撤销最近一次可撤销写入，原操作始终保留。先用 `--dry-run` 展示将恢复或移除的事实及保留的归档原件；取得用户确认后用 `--confirmed-at` 传入确认发生的 ISO 8601 时间。实际执行缺少确认时间会被机器拒绝。受控变更、非最近有效操作、旧操作缺少补偿快照、目标发生后续冲突或操作写入人工文档内容时也会拒绝，按 `code` 和 `fix` 处理。原始归档不会被删除，结果中的 `retained_paths` 会明确列出。
- 修改 `.harness/lib/model.mjs` 或 `.harness/lib/contracts.mjs` 的契约后运行 `npm run docs:contract` 重新生成参考。
