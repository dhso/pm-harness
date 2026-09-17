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

生成成功只表示 `drafting` 或 `review`。批准必须来自具有 `deliverable` 范围的 active 干系人；验收必须来自具有 `acceptance` 范围的 active 干系人，且用户确认对应业务事件确已发生。确认已发送后才能记录 `delivered`。

批准后的二进制或文档不得原地覆盖。新修订生成递增版本并分配新的 `DEL-###`；新旧记录用 `supersedes_id` / `superseded_by_id` 双向串联，链条不得自指或成环。当前有效版本留在 `deliverables/current/`，批准终稿留在 `deliverables/final/`，旧版本移入本地归档并以 `ARC-###` 保留哈希与替代关系。完成、批准、交付和验收时间必须依次发生。

## OfficeCLI

- DOCX、XLSX、PPTX 优先使用 OfficeCLI。
- 按 `AGENTS.md` 从项目根调用工具，以显式路径使用任务沙箱；不得在任务沙箱安装可复用依赖。
- OfficeCLI 从已有 `PATH` 调用；辅助工具依赖按 `AGENTS.md` 放置，不进入任务沙箱或 `tmp/harness/`。
- 完成结构校验和 issues 检查后，将需保留的文件移入 `deliverables/current/`。
- `tmp/tasks/<task-key>/` 下的临时预览和检查文件不作为项目资料。

OfficeCLI 缺失时只在任务确实需要时提示用户，不自动安装。首版不声称支持 PDF 输入解析。
