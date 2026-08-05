# Scenario: Watchlist domain (free-form long task)

Use when driving hip **manually** or via `yarn dogfood:msm -- --scenario watchlist`.

## Bind

- Folder: `$HIP_EVAL_MSM_PATH` or an eval worktree under `~/.hip/eval-runs/`
- Surface: **Code**, permission: **edit** (or full for unrestricted)

## Paste prompt

```
在 make-stock-money（Tauri 2 + rusqlite + Leptos）上完成 Watchlist 领域切片。

成功标准：
1. 新迁移 0003_watchlist.sql，经 migrations.rs 应用
2. 表 watchlists + watchlist_items（FK、unique(watchlist_id,symbol)）
3. src-tauri/src/watchlist.rs：watchlist/item CRUD，校验错误前缀「参数错误:」
4. lib.rs 注册 Tauri commands
5. tests/watchlist_e2e.rs 覆盖 happy path、重复 symbol、删除清理
6. cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1 全绿
7. 不破坏现有 DataSource 测试
8. 写 docs/watchlist.md 说明 schema 与命令

流程：先短计划再实现；用 todo/goal；改完就跑测试；不要 commit/push。前端 UI 可选。
```

## Observe (hip bugs to journal)

- [ ] Auto-continue / goal 是否在 >20 分钟后仍指向正确目标
- [ ] Compact 后是否丢失 success criteria
- [ ] 并行 task 是否污染未隔离文件
- [ ] 测试失败是否重复同一命令空转
- [ ] 中断/steer 后能否恢复
- [ ] 用户可见 diff / 任务面板是否可理解

Log findings → `docs/design/msm-dogfood-journal.md`
