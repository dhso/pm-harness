# Word（DOCX）参考

## 读取

先用以下命令了解文档结构和正文：

```bash
officecli view report.docx outline
officecli view report.docx text
officecli get report.docx '/body/p[1]' --depth 2 --json
```

需要定位样式、表格、页眉页脚或分节时，使用 `get` 展开对应节点；需要批量定位时使用 `query`。

## 创建与编辑

- 新文档：`officecli create report.docx`。
- 段落和标题：对 `/body` 使用 `add --type paragraph`，通过 `style` 设置标题层级。
- 表格、图片、页眉页脚和批注：先用 `officecli help docx <元素>` 确认属性，再用 `add`/`set`。
- 替换文本：优先使用 `set <文件> / --find <文本> --replace <文本>`；需要保留修订时指定修订作者。
- 复杂或不支持的结构：先 `dump` 保存可回放批量 JSON，再谨慎使用 `raw`/`raw-set`。

## 检查

完成后运行 `officecli validate report.docx` 和 `officecli view report.docx issues`。视觉要求高时生成 HTML 或 PDF 预览，并确认分页、标题层级、表格和图片没有异常。

路径使用 1 基索引；含括号的路径必须加引号。已批准的 Word 文件不得原地覆盖，修订要建立新版本和替代关系。
