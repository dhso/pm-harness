---
name: pm-maintain
description: 审计项目管理 Harness，修复安全的索引漂移，整理记忆，并提出有证据支持的规则改进。重大里程碑、重复纠正、发现不一致或明确要求审计时使用。
metadata:
  kind: workflow
  domain: maintain
---

# 维护和演进 Harness

读取 `.harness/references/evolution-policy.md`、`.harness/references/git-policy.md`、生效规则、观察记录和最近的 lint 输出。

按照 `.harness/references/automation.md` 运行一次 `maintain` 流程。它会执行一次安全重建、完整 lint、去重后的规则候选生成和到期规则复查；不得启动重试或监听循环。只修复安全的机械漂移，不要靠猜测解决语义冲突。

检查观察记录中的重复失败模式。规则提案必须引用证据、说明适用范围、解释收益和副作用，并定义后续如何验证效果。新增规则前先去重或收窄提案。

规则激活、基线修复、大范围删除或记忆冲突解决必须在对话中呈现并获得批准。批准后通过类型化记录操作应用变更，记录决定并设置后续复查条件。`governance/rules.json` 是事实源，`rules.md` 是生成视图。

保持入口指令和始终加载的记忆精简。将条件性细节放入相关 Skill 参考文件，不要把 `AGENTS.md` 膨胀成手册。
