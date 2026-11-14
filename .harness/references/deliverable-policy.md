# 交付物生命周期

## 状态

`requested → drafting → review → approved → delivered → accepted`

根据实际情况也可进入 `superseded` 或 `cancelled`。

元数据字段按 `deliverable.upsert` 或 `deliverable.transition` 紧凑契约查询；关联相关需求、任务、来源、验收标准和证据。

生成成功只表示 `drafting` 或 `review`。批准必须来自具有 `deliverable` 范围的 active 干系人；验收必须来自具有 `acceptance` 范围的 active 干系人，且用户确认对应业务事件确已发生。确认已发送后才能记录 `delivered`。

文件使用稳定命名和递增版本；批准后的二进制或文档不得原地覆盖。新修订分配新的 `DEL-###`；新旧记录用 `supersedes_id` / `superseded_by_id` 双向串联，链条不得自指或成环。可评审或继续使用的文件进入 `deliverables/current/`，批准终稿留在 `deliverables/final/`，旧版本移入本地归档并以 `ARC-###` 保留哈希与替代关系。完成、批准、交付和验收时间必须依次发生。

## OfficeCLI

DOCX、XLSX、PPTX 使用 `officecli` Skill 完成文件处理与检查，再将需保留的文件移入 `deliverables/current/`；临时预览和检查文件不作为项目资料。目录和依赖遵循 `AGENTS.md`。

OfficeCLI 缺失时只在任务确实需要时提示用户，不自动安装。首版不声称支持 PDF 输入解析。
