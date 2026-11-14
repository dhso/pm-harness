---
name: pm-knowledge
description: 依据项目记录回答问题、综合证据或整理 Wiki。项目查询、历史追溯和知识维护时使用；新来源摄取用 pm-source-intake。
metadata:
  kind: workflow
  domain: knowledge
---

# 项目问答与知识维护

遵循 `AGENTS.md`，检索流程如下（条件可组合）：

```text
范围 = 所问主题 + 时间 + 状态
if 当前情况且需 Wiki: query wiki --where status=active
if 完整清单: 查全范围，确认未截断
if 历史/原因/依据: 查相关历史各状态及来源
读取相关目录/字段 → 必要正文 → 核对关键事实
if 缺口/冲突影响结论: 定点补查历史或替代链
输出已知结论 + 必要来源 + 影响判断的缺口
```

旧结论注明时间；复查到期仅提示，不自动排除。仅查询不写入 Wiki 或活动。

按需读取：缺证据/冲突/归因 → [证据处理](references/answer-evidence.md)；知识整理或长期新结果 → [Wiki 维护](references/wiki-maintenance.md)。

维护分支交接主题、已确认结果和来源；取得页面/条目变化后由本流程按 `AGENTS.md` 收尾。
