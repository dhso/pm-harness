# 交付物生命周期

## 状态

`requested → drafting → review → approved → delivered → accepted`

根据实际情况也可进入 `superseded` 或 `cancelled`。

## 必要元数据

- ID、标题、类型、格式、受众和用途；
- 当前版本、文件路径、状态；
- 需求/任务/来源关联；
- 计划完成、实际完成、交付和验收时间；
- 评审人/验收人、验收标准和证据；
- 变更摘要以及替代/被替代关系。

生成成功只表示 `drafting` 或 `review`。只有用户明确批准、确认已发送或确认已验收时，才更新对应状态。

批准后的二进制或文档不得原地覆盖。新修订生成递增版本并分配新的 `DEL-###`；新旧记录用 `supersedes_id` / `superseded_by_id` 串联。当前有效版本留在 `deliverables/current/`，批准终稿留在 `deliverables/final/`，不再需要 Git 跟踪的旧版本移入本地归档并以 `ARC-###` 保留哈希与替代关系。

## OfficeCLI

DOCX、XLSX、PPTX 优先使用 OfficeCLI。制作完成后运行结构校验和 issues 检查；适合视觉检查时生成临时截图到 `deliverables/.render/`。临时渲染不得进入 Git。

OfficeCLI 缺失时只在任务确实需要时提示用户，不自动安装。首版不声称支持 PDF 输入解析。
