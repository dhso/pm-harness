# Excel（XLSX）参考

## 读取

先查看工作表结构、数据和问题：

```bash
officecli view data.xlsx outline
officecli view data.xlsx stats
officecli get data.xlsx '/Sheet1/A1:D20' --json
officecli query data.xlsx 'cell[value>5000]'
```

需要处理整行、列名、合并区域、表格或图表时，先用 `officecli help xlsx <元素>` 查询确切属性。

## 创建与编辑

```bash
officecli create data.xlsx
officecli set data.xlsx /Sheet1/A1 --prop value="名称" --prop bold=true
officecli set data.xlsx /Sheet1/A2 --prop value="Alice"
```

- 用 `set` 修改单元格值、公式、样式和批注；用 `add`/`remove` 管理行列。
- 多单元格或多工作表变更使用 `batch`，默认原子提交。
- 排序、筛选、合并、图表、透视表和条件格式均先查帮助，不凭经验猜属性。
- 公式和命名区域可能随插入、移动而变化；修改后重新读取关键公式和引用。

## 检查

运行 `officecli validate data.xlsx`，检查 `view ... issues`、公式、合并区域、列宽、打印设置和图表。将数据分析结果写入 PPT 或报告时，保留来源范围和计算口径，避免把推断写成事实。
