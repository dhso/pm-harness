---
name: officecli
description: 使用 OfficeCLI 读取、检查、创建和修改 DOCX、XLSX、PPTX 文件。用户要求处理 Word、Excel、PowerPoint 或其他 Office 交付物时使用。
metadata:
  kind: capability
  domain: office
  owner: pm-deliverable
  formats: docx,xlsx,pptx
---

# 处理 Office 文件

OfficeCLI 用于处理 `.docx`、`.xlsx` 和 `.pptx`，不依赖本机安装 Office。交付物目的、版本和生命周期仍由 `pm-deliverable` 负责。

## 使用前

- 先检查 `officecli --version`。工具不可用时说明阻塞，不要未经授权自动安装或联网下载。
- 不确定命令、路径或属性名称时，先运行 `officecli help` 或 `officecli help <格式> <元素>`，不要猜测。
- 优先使用分层策略：L1 读取/检查，L2 DOM 编辑，L3 原始 XML；只有上一层无法表达需求时才降级。
- 长流程可用 `open` 和 `close` 保持驻留；交给其他程序读取前必须 `save` 或 `close`。

## 标准流程

1. 用 `view` 检查结构、文本和 issues，必要时用 `get` 或 `query` 精确定位。
2. 用 `create`、`add`、`set`、`move`、`swap` 或 `remove` 创建和修改；多项变更优先使用 `batch`。
3. 用 `validate` 和/或 `view <文件> issues` 检查结构、内容与格式；视觉要求高时生成临时预览。
4. 保存到 `deliverables/current/`，将文件路径和检查结果交回 `pm-deliverable` 完成登记。

`officecli` 的路径通常从 `/` 开始；元素路径使用 1 基索引，`--index` 通常为 0 基索引。含 `[1]` 等括号的路径必须加引号。属性统一通过 `--prop` 传入，不要使用未定义的顶层参数。优先使用稳定的 `@id=` 或 `@name=` 路径，避免插入或删除后位置索引漂移。

## 按格式加载参考

- Word（DOCX）：读取[Word 参考](references/word.md)。
- PowerPoint（PPTX）：读取[PowerPoint 参考](references/pptx.md)。
- Excel（XLSX）：读取[Excel 参考](references/xlsx.md)。

## 安全与质量

- 修改前确认目标文件未被 Word/WPS/Excel/PowerPoint 占用；不要覆盖用户原始文件或已批准版本。
- 批量操作默认应保持原子性；失败时检查 JSON 错误，不用相同输入无限重试。只有用户明确接受部分成功时才使用 `--best-effort`。
- `raw`/`raw-set` 只在 L2 无法满足需求时使用；修改前先读取对应 XML part，并保留可回滚的版本链。
- `view`/`get`/`query` 能读取驻留中的最新编辑；交给 Python、Office、渲染器或上传程序前执行 `save` 或 `close`。
- OfficeCLI 只负责文件内容；批准、交付和验收状态由 `pm-deliverable` 记录。

## 专用能力

若 OfficeCLI 环境提供 `officecli load_skill <名称>`，根据文件和场景选择最具体的一个专用能力（例如 `word`、`pptx`、`excel`、`financial-model`、`data-dashboard`）。每个文件只加载一个专用能力，不要重复叠加；没有匹配项时使用格式默认能力。
