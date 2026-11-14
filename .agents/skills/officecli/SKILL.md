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

OfficeCLI 处理 `.docx`、`.xlsx`、`.pptx`，不依赖本机 Office；交付物目的、版本和生命周期由 `pm-deliverable` 负责。目录与依赖按 `AGENTS.md` 的工具运行参考执行。

## 使用前

- 检查 `officecli --version`；缺失时停止依赖该工具的操作，取得安装授权后才运行 `npm install --global @officecli/officecli`，再复查版本。
- 不确定命令、路径或属性名称时，先运行 `officecli help` 或 `officecli help <格式> <元素>`，不要猜测。

## 标准流程

```text
view 结构/文本/issues → 必要时 get/query 定位
if 仅需读取/检查: 返回必要内容、来源位置和读取限制
else: 将文件、修改要求与所选格式交给「编辑流程」
      → 取得文件路径、检查结果和未解决事项，交回主工作流
```

创建或修改时读取[编辑流程](references/editing.md)；文件和生命周期由主工作流继续处理，不由本能力声称批准、交付或验收。

`officecli` 的路径通常从 `/` 开始；元素路径使用 1 基索引，`--index` 通常为 0 基索引。含 `[1]` 等括号的路径必须加引号。属性统一通过 `--prop` 传入，不要使用未定义的顶层参数。优先使用稳定的 `@id=` 或 `@name=` 路径，避免插入或删除后位置索引漂移。

## 按格式加载参考

- Word（DOCX）：读取[Word 参考](references/word.md)。
- PowerPoint（PPTX）：读取[PowerPoint 参考](references/pptx.md)。
- Excel（XLSX）：读取[Excel 参考](references/xlsx.md)。

## 专用能力

若 OfficeCLI 环境提供 `officecli load_skill <名称>`，根据文件和场景选择最具体的一个专用能力（例如 `word`、`pptx`、`excel`、`financial-model`、`data-dashboard`）。每个文件只加载一个专用能力，不要重复叠加；没有匹配项时使用格式默认能力。
