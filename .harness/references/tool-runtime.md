# 外部工具运行

路径相对于项目根；`task-key` 为本任务唯一短名。按 `AGENTS.md` 从项目根调用工具，输入和输出使用显式路径。

```text
创建 tmp/tasks/<task-key>/ → 处理临时输入/脚本/候选文件/输出
→ 保存需保留的结果 → 只清理当前任务目录
```

任务目录不放依赖环境或包管理器缓存；清理边界以 `AGENTS.md` 为准。`tmp/harness/` 的输入、事务、写锁与摄取暂存由 Harness 管理。

| 依赖类型 | 位置与规则 |
|---|---|
| npm、pip 下载缓存 | 默认用户级缓存，不重定向到项目目录 |
| OfficeCLI 等稳定 CLI | 从已有 `PATH` 调用；安装或升级前取得用户授权，不使用 `sudo` 或系统 Python |
| Harness Node 依赖 | 根 `package.json`、锁文件和根 `node_modules/` |
| Harness Python 依赖 | 根 `.venv/` 和锁定的依赖清单，不修改系统 Python |
