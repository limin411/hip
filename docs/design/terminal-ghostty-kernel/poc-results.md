# PR-0 PoC 验证结果

- 日期：2026-08-28
- libghostty-vt 版本：0.2.1
- Zig 版本：0.15.2
- 平台：Windows x86_64

## 验证结果

| # | 验证项 | 结果 | 备注 |
|---|--------|------|------|
| V1 | Terminal::new() + vt_write() | ✅ 通过 | 基本文本和 ANSI 序列处理正常 |
| V2 | RenderState 脏区域跟踪 | ✅ 通过 | Full/Partial/Clean 状态正确 |
| V3 | Grid Cell 遍历 | ✅ 通过 | 能读回写入的内容和样式 |
| V4 | 颜色和样式读取 | ✅ 通过 | 24-bit RGB、粗体、下划线均可检测 |
| V5 | Effect 回调 | ✅ 通过 | bell/title_changed/pty_write 全部触发 |
| V6 | 光标状态 | ✅ 通过 | cursor_visible + cursor_viewport 正确 |
| V7 | Scrollback | ✅ 通过 | 滚动回退正常，viewport 滚动正常 |
| V8 | Resize | ✅ 通过 | 调整尺寸后内容保持，Grid 重排正常 |
| V9 | RenderState Cell 回读 | ✅ 通过 | 带颜色的 Cell 全部可读 |
| V10 | 多终端实例 (8) | ✅ 通过 | 每个 Terminal 独立状态 |
| V11 | Effect Channel 模式 | ✅ 通过 | Rc<RefCell<Vec>> 模式模拟 channel |
| V12 | 性能基准 | ✅ 通过 | 见下方性能数据 |
| V13 | 压缩 API | ⚠️ Unsupported | CompressionMode::Incremental 返回 Unsupported |
| V14 | libghostty-vt-sys 链接 | ✅ 通过 | FFI 边界正常工作 |

## 性能数据 (Debug Build)

| 指标 | 数值 | 说明 |
|------|------|------|
| vt_write 吞吐 | ~0.15 MB/s | Debug 构建，Release 预期 5-10x |
| RenderState 更新 | ~120µs | 10K 行 scrollback |
| Cell 遍历 | ~370µs | 4134 cells (40x5 viewport + scrollback) |
| 脏区域检测 | ~6µs | 单行增量更新 |

## 关键发现

1. **API 版本差异**：实际 API 与 docs.rs 文档略有差异
   - `Terminal::new(Options { cols, rows, max_scrollback })` 而非 `(cols, rows)`
   - 所有访问器返回 `Result<T>` 而非直接 `T`
   - `compress()` 存在但返回 `Unsupported`（压缩功能未实现）

2. **构建依赖**：
   - 需要 Zig 0.15.2（不是 0.16）
   - Zig HTTP 客户端不支持 HTTP 代理
   - 需要手动用 curl 下载 35 个依赖并用 `zig fetch` 缓存

3. **RenderState 工作模式**：
   - `RenderState::new()` 创建
   - `render_state.update(&terminal)` 获取快照
   - 快照提供 `dirty()`、`colors()`、`cursor_viewport()` 等
   - `RowIterator` + `CellIterator` 遍历 Grid

4. **Effect 回调模式**：
   - `terminal.on_bell(|term| { ... })` 注册回调
   - 回调在 `vt_write()` 期间同步调用
   - 适合用 `Rc<Cell/RefCell>` 或 channel 模式收集事件

## 决策

**PoC 验证通过，可以进入 PR-1（Rust Terminal 后端）阶段。**

主要风险已缓解：
- ✅ libghostty-vt 在 Windows 可构建
- ✅ 核心 API 可工作
- ✅ RenderState 可用于增量渲染
- ⚠️ 压缩功能暂不可用（非阻塞）
