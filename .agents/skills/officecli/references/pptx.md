# PowerPoint（PPTX）参考

## 读取

先读取大纲、统计和每页形状：

```bash
officecli view deck.pptx outline
officecli view deck.pptx stats
officecli get deck.pptx '/slide[1]' --depth 1 --json
```

需要查找特定文字、填充色或形状时使用 `query`；批量编辑优先使用稳定的 `@id=` 或 `@name=` 路径。

## 创建与编辑

```bash
officecli create deck.pptx
officecli add deck.pptx / --type slide --prop title="项目进展"
officecli add deck.pptx '/slide[1]' --type shape --prop text="关键结论" --prop x=2cm --prop y=5cm
```

- 使用 `add slide`、`shape`、`picture`、`chart`、`table` 和 `set` 组合创建内容。
- 需要多项修改时使用 `batch`，默认保持原子性。
- 先读大纲和现有版式，再决定新增或复用形状；不要依赖会因插入而变化的位置索引。
- 流程图或结构图可使用 OfficeCLI 的 `diagram` 能力；属性不确定时先运行 `officecli help pptx diagram`。

## 检查

完成后运行 `officecli validate deck.pptx`，再用 `view deck.pptx issues` 和 HTML/图片预览检查文字溢出、遮挡、对齐、字体和图表可读性。正式交付前由 `pm-deliverable` 管理版本、审批和验收。
