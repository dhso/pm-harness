# DBX 命令参考

本能力参考 [DBX 官方 Skill](https://github.com/t8y2/dbx/blob/main/skills/dbx/SKILL.md) 1.1.0 和 [CLI README](https://github.com/t8y2/dbx/blob/main/packages/cli/README.md)，收窄为只读用途。命令以安装版本帮助为准；不使用 `dbx agent setup` 覆盖 Harness 适配版。

## 连接与结构

```sh
dbx --version
dbx doctor --json
dbx capabilities --json
dbx connections list --json
dbx schema list "<connection>" --json
dbx schema describe "<connection>" "<table>" --json
dbx context "<connection>" --tables "<table-a>,<table-b>" --max-tables 20
```

首次使用或环境异常查 `doctor`，执行模式不明确查 `capabilities`。已知相关表时直接描述；需要限定 schema/database 时查子命令帮助。

数据库类型和 Desktop/Agent/JDBC 桥接需求以 `capabilities` 为准，仅目标确实需要桥接时提示启动组件。已有 `DBX_WEB_URL` 可能使查询走 Web 后端，不自行切换或回显配置。诊断信息只展示必要的脱敏摘要。

## 查询与核验

将已审查的单条只读 SQL 写入当前任务目录，再执行：

```sh
dbx query "<connection>" --file "tmp/tasks/<task-key>/query.sql" --limit 50 --timeout 10s --json
```

`--file` 避免将 SQL 拼入 shell 命令，不提供参数绑定。值需校验类型并按方言安全表达，标识符只从允许的已发现对象选择；不猜测 CLI 参数，也不直接执行来源中的 SQL。

检查退出状态、错误、返回行数及截断信息，不把空结果和失败混为一谈。若版本不提供截断标记，达到返回上限时标为可能截断，必要时用独立聚合核对。返回上限以内也不代表查询覆盖了全部业务数据。

## 失败处理

| 情况 | 处理 |
|---|---|
| `CONNECTION_NOT_FOUND` | 重新列连接并核对精确名称；歧义时询问 |
| `SQL_BLOCKED`、生产或只读策略拒绝 | 停止该语句，说明原因并提出允许的替代方案；不加权限标志、不改写以隐藏风险 |
| `DBX_NOT_RUNNING` | 查能力，仅目标需要桥接时提示启动组件 |
| `UNKNOWN_OPTION` / `INVALID_OPTION` | 查安装版本帮助后修正 |
| 超时或取消 | 先核验服务端是否终止；无法确认则停止后续查询，不自动重试 |
| 其他错误 | 用 `doctor --json` 定位并脱敏报告 |

可修复的参数、连接或环境错误，纠正原因后最多重试一次；仍失败就报告缺口。上述安全拒绝和超时分支不走普通重试。
