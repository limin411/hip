# Scenario: Probe hardening + metrics (free-form)

## Paste prompt

```
加固 make-stock-money 的端点探测（src-tauri/src/lib.rs probe 路径）：

1. 为 HTTP 探测增加可配置 timeout（默认保持现行为），并写单元测试
2. 记录最近 N 次探测历史到新表 probe_history（迁移 0003 或后续编号），含 source_id、latency_ms、status、checked_at
3. API：list_probe_history(source_id, limit)
4. 测试：内存库迁移 + history 写入/查询；现有 probe_tests 与 crud_e2e 仍绿
5. cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1

约束：不要破坏 DataSource 字段语义；不要 commit；长任务请分 phase + 持续跑测试。
```

## Focus

Exercises multi-file Rust, migrations checksum, and long verification loops.
