# Office 编辑流程

输入：文件、修改要求与所选格式；格式命令和检查项使用调用方已选的格式参考。

```text
确认目标未被 Word/WPS/Excel/PowerPoint 占用 → 在任务沙箱复制/创建候选文件
→ create/add/set/move/swap/remove（多项变更优先 batch）
→ 按格式参考校验/预览 → 保存需保留的文件到 deliverables/current/
→ 返回路径、实际检查结果和未解决事项
```

- 不覆盖用户原始文件；已批准内容的版本边界按[交付物政策](../../../../.harness/references/deliverable-policy.md)处理。
- 分层策略：L1 读取/检查 → L2 DOM 编辑 → L3 原始 XML；仅上一层无法表达需求时才降级。`raw/raw-set` 前先读对应 XML part，并保留可回滚版本链。
- 批量默认原子处理；失败读 JSON 错误，不用相同输入无限重试。仅用户明确接受部分成功时使用 `--best-effort`。
- 长流程可用 `open` 驻留；`view/get/query` 可读最新编辑，交给外部程序读取前必须 `save` 或 `close`。
- 临时预览和检查文件留在任务沙箱；保存需保留的结果后按 `AGENTS.md` 清理本任务目录。检查失败或未覆盖部分如实交接，不声称通过。
