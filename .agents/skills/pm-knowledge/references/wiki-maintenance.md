# Wiki 维护

```text
查 wiki.register 契约 → 按主题合并 → 用 wiki.register 同步正文及目录
收件项已应用 → inbox.transition(applied, applied_to_ids)
需用户判断 → inbox.transition(needs_confirmation, disposition_reason)
```

过时主张移至历史/已替代部分，不与现行结论混写；保留来源、关联对象、评审/复查信息及替代关系，不静默删除历史。原件归档；页面必须登记，不手改 JSON/生成索引；提交 `content` 会刷新复查时间。返回已维护页面、已处置条目和未解决事项，由调用方统一收尾。
