# Agent 后台自动化

这些命令只由 ChatGPT/Codex 在项目根目录调用。不要要求项目经理复制或运行命令。

所有写入型命令从 `--input` 指定的 JSON 文件读取数据。临时输入放在 `.harness/tmp/`，成功后由 Agent 清理。脚本失败时先读取结构化错误，不要反复重试或绕过校验。

## 初始化

```text
node .harness/scripts/harness.mjs init --input .harness/tmp/init.json
```

输入字段：`name`、`objective`、`timezone`，以及可选的 `id`、`scope_in`、`scope_out`、`success_criteria`、`constraints`、`stakeholders`。已初始化项目会拒绝覆盖。

## 登记邮件、聊天、截图或附件

```text
node .harness/scripts/harness.mjs source-add --input .harness/tmp/source.json
```

示例数据形状：

```json
{
  "type": "email_screenshot",
  "title": "客户确认评审时间",
  "sender": "客户负责人",
  "channel": "email",
  "thread_id": "optional-thread-id",
  "source_time": "2026-09-09T10:00:00+08:00",
  "raw_path": "optional/local/screenshot.png",
  "source_locator": "optional-chat-attachment-reference",
  "summary": "客户建议周五评审",
  "items": [
    {
      "classification": "request",
      "summary": "将评审调整到周五",
      "quote": "我们周五评审可以吗？",
      "confidence": 1,
      "authority": "unknown",
      "related_ids": ["MS-001"],
      "proposed_action": "create_change_request"
    }
  ]
}
```

支持的 `type`：`email`、`email_screenshot`、`chat`、`chat_screenshot`、`daily_note`、`office_document`、`text_document`、`external_connector`、`other`。

脚本使用原件哈希、来源 locator 或线程+时间+发送者识别重复项。可访问的原件会复制到被 Git 忽略的 `archive/files/`，并同步更新归档索引。

## 追加实际活动

```text
node .harness/scripts/harness.mjs activity-add --input .harness/tmp/activity.json
```

字段：`timestamp`、`action`、`related_ids`、`outcome`、`evidence`、`next_action`。只记录结果，不传入完整聊天文本。

## 日常摘要、重建与检查

```text
node .harness/scripts/harness.mjs brief --json
node .harness/scripts/harness.mjs rebuild
node .harness/scripts/harness.mjs lint --json
```

`brief` 是给 Agent 的结构化输入，不应把完整 JSON 原样展示给用户。`rebuild` 生成甘特图、知识索引和交付物索引。`lint` 的 error 必须解决；warning 需要判断；info 用于延期、陈旧任务、缺失本地归档和规则候选提示。

若执行环境没有 Node 20，Agent 可以按相同数据契约直接维护文件，但必须明确说明机械检查未运行。

