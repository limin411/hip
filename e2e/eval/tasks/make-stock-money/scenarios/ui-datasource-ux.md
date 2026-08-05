# Scenario: Leptos UI UX polish (frontend-heavy)

## Paste prompt

```
改进 make-stock-money 前端（src/app.rs + styles.css）数据源管理体验：

1. 列表支持按 kind 筛选（若后端尚无 list_by_kind，先补后端再接 UI）
2. 空状态文案与加载/错误态更清晰
3. 删除确认保留；编辑表单校验与后端 1..=5 priority 一致
4. 不引入 npm 依赖；保持 wasm-bindgen invoke 风格
5. 后端测试仍须全绿：cargo test --manifest-path src-tauri/Cargo.toml

这是跨前后端任务：先探索代码再改；用 todo 跟踪；完成后总结改动文件列表。
```

## Focus

Cross-stack long task; watch context window on large `app.rs`.
