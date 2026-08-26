# 终端能力现代化升级 - 进度跟踪

- 系列：`docs/design/terminal-capability-upgrade/`
- 状态：Phase 2 已完成
- 日期：2026-08-25

---

## Phase 1: 渲染性能提升 ✅ 已完成

### 1.1 WebGL 渲染启用

**状态**：✅ 已完成

**变更**：
- 新增 `@xterm/addon-webgl@^0.19.0` 依赖
- 创建 `src/components/artifact/terminalEnhancements.ts` 模块
- 在 `XtermSurface.tsx` 中集成 WebGL addon 加载
- 添加 WebGL 上下文丢失处理（自动降级到 Canvas）

**配置项**：
- `hip.toml` → `[terminal] webgl = true/false`
- 默认启用，不支持时自动降级

**收益**：
- 渲染性能提升 3-10x
- GPU 卸载 CPU 渲染负担
- 60fps 目标帧率

### 1.2 字体连字支持

**状态**：⚠️ 部分完成（上游包问题）

**变更**：
- 新增 `@xterm/addon-ligatures@^0.10.0` 依赖
- 在 `terminalEnhancements.ts` 中实现加载逻辑
- **已知问题**：`@xterm/addon-ligatures@0.10.0` 有打包问题（`main` 字段指向不存在的 `.js` 文件）
- 临时禁用连字加载，等待上游修复

**配置项**：
- `hip.toml` → `[terminal] ligatures = true/false`
- 默认启用（当前实际为禁用状态）

**待办**：
- 监控上游 issue：https://github.com/xtermjs/xterm.js/issues
- 修复后重新启用

### 1.3 Unicode 11 宽度修正

**状态**：✅ 已完成

**变更**：
- 新增 `@xterm/addon-unicode11@^0.9.0` 依赖
- 在 `terminalEnhancements.ts` 中实现加载逻辑
- 自动设置 `term.unicode.activeVersion = '11'`

**配置项**：
- `hip.toml` → `[terminal] unicode_version = "11"` 或 `"6"`
- 默认 Unicode 11

**收益**：
- Emoji 宽度正确（2 列）
- CJK 字符对齐准确
- 与现代终端行为一致

---

## 代码变更清单

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/components/artifact/terminalEnhancements.ts` | 终端增强 addon 加载模块 |
| `src/components/artifact/terminalEnhancements.test.ts` | 单元测试 |
| `src/components/artifact/terminalOsc8.ts` | OSC 8 超链接支持 |
| `src/components/artifact/terminalOsc52.ts` | OSC 52 剪贴板支持 |
| `src/components/artifact/terminalSyncOutput.ts` | Synchronized Output 支持 |
| `src/components/artifact/terminalProtocols.ts` | 协议统一管理 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `package.json` | 新增 3 个 xterm addon 依赖 |
| `src/components/artifact/XtermSurface.tsx` | 集成终端增强 addon 和协议处理器 |
| `packages/protocol/src/hip-config.ts` | 扩展 `TerminalConfig` 类型定义（+clipboardRead） |
| `src/i18n/en.ts` | 添加英文翻译 keys |
| `src/i18n/zh-CN.ts` | 添加中文翻译 keys |
| `src/components/account/GeneralSettings.tsx` | 添加 GPU 加速和连字配置 UI |

---

## 验收清单

### Phase 1: 渲染性能提升

| # | 验收点 | 状态 | 备注 |
|---|--------|------|------|
| 1 | WebGL addon 加载成功 | ✅ | 测试环境通过 |
| 2 | WebGL 上下文丢失自动降级 | ✅ | 已实现 onContextLoss 处理 |
| 3 | 连字 addon 加载 | ⚠️ | 上游包问题，临时禁用 |
| 4 | Unicode 11 addon 加载 | ✅ | 测试环境通过 |
| 5 | Emoji 宽度正确 | ✅ | Unicode 11 设置生效 |
| 6 | 配置项持久化 | ✅ | hip.toml 支持 |
| 7 | 设置 UI | ✅ | GeneralSettings 已添加 |
| 8 | 单元测试通过 | ✅ | 11 个测试全部通过 |
| 9 | 类型检查通过 | ✅ | tsc --noEmit 无错误 |

### Phase 2: 协议支持补全

| # | 验收点 | 状态 | 备注 |
|---|--------|------|------|
| 10 | OSC 8 超链接解析 | ✅ | 支持 http/https/mailto/file |
| 11 | 链接悬停检测 | ✅ | xterm.js LinkProvider |
| 12 | 链接点击打开 | ✅ | Tauri opener 降级 window.open |
| 13 | OSC 52 剪贴板读写 | ✅ | 读取/写入均支持 |
| 14 | 剪贴板安全策略 | ✅ | ask/allow/deny 配置 |
| 15 | Synchronized Output | ✅ | xterm.js 5.5.0 内置支持 |
| 16 | 协议统一管理 | ✅ | terminalProtocols.ts |
| 17 | XtermSurface 集成 | ✅ | 自动加载和清理 |
| 18 | 类型检查通过 | ✅ | tsc --noEmit 无错误 |

---

## 技术细节

### addon 加载架构

```typescript
// terminalEnhancements.ts
export async function loadTerminalEnhancements(term: XTerm): Promise<LoadedAddons> {
  const [webgl, ligatures, unicode11] = await Promise.all([
    loadWebGLAddon(term),      // 可选，失败不影响其他
    loadLigaturesAddon(term),  // 可选，当前禁用
    loadUnicode11Addon(term),  // 可选，失败不影响其他
  ])
  return { webgl, ligatures, unicode11 }
}
```

### 配置读取

```typescript
function getRenderingConfig() {
  const config = useHipConfigStore.getState().config
  const terminal = config.terminal
  return {
    webgl: terminal?.webgl ?? true,
    ligatures: terminal?.ligatures ?? true,
    unicodeVersion: terminal?.unicodeVersion ?? '11',
  }
}
```

### 清理机制

```typescript
// XtermSurface.tsx cleanup
return () => {
  // ... existing cleanup
  if (enhancementAddonsRef.current) {
    disposeTerminalEnhancements(enhancementAddonsRef.current)
    enhancementAddonsRef.current = null
  }
}
```

---

## Phase 2: 协议支持补全 ✅ 已完成

### 2.1 OSC 8 超链接

**状态**：✅ 已完成

**变更**：
- 创建 `src/components/artifact/terminalOsc8.ts` 模块
- 实现 OSC 8 解析器（params;URI 格式）
- 实现链接悬停检测（xterm.js LinkProvider）
- 实现点击打开（Tauri opener 降级 window.open）
- URI 安全验证（仅 http/https/mailto/file）

**收益**：
- `ls`、`git log`、`npm outdated` 等输出中的 URL 可点击
- 与 Kitty/Alacritty/WezTerm 行为一致

### 2.2 OSC 52 剪贴板补全

**状态**：✅ 已完成

**变更**：
- 创建 `src/components/artifact/terminalOsc52.ts` 模块
- 实现剪贴板读取/写入
- 实现安全策略（ask/allow/deny）
- 实现确认回调机制
- 大小限制（1MB）

**配置项**：
- `hip.toml` → `[terminal] clipboard_read = "ask"` 或 `"allow"` 或 `"deny"`

**收益**：
- TUI 应用（如 vim）可访问系统剪贴板
- 安全可控的剪贴板访问

### 2.3 Synchronized Output

**状态**：✅ 已完成

**变更**：
- 创建 `src/components/artifact/terminalSyncOutput.ts` 模块
- 验证 xterm.js 5.5.0 内置支持
- 提供 `createSyncUpdate` 辅助函数

**收益**：
- 消除 TUI 应用（vim、htop、tmux）的闪烁
- 帧完整性保证

### 2.4 协议统一管理

**状态**：✅ 已完成

**变更**：
- 创建 `src/components/artifact/terminalProtocols.ts` 模块
- 统一加载/清理所有协议处理器
- 集成到 XtermSurface.tsx

**收益**：
- 统一的协议管理架构
- 自动加载和清理

## 下一步：Phase 3

### 3.1 Sixel 图片支持

**任务**：
- [ ] 评估 `xterm-addon-sixel` 社区包
- [ ] 实现/集成 Sixel 解析
- [ ] 性能优化
- [ ] SSH 通道测试
- [ ] 集成测试

### 3.2 标签页架构

**任务**：
- [ ] 设计数据模型
- [ ] 实现标签页状态管理
- [ ] 实现标签页 UI
- [ ] 实现快捷键
- [ ] 实现拖拽排序
- [ ] 集成测试

---

## 已修复问题

### 1. WebGL addon 双重 dispose 错误（2026-08-25）

**问题**：终端关闭时出现 `Cannot read properties of undefined (reading '_isDisposed')` 错误。

**根因**：清理顺序错误，`term.dispose()` 会自动清理 addon，手动再次调用导致双重 dispose。

**修复**：
- 不再手动调用 `disposeTerminalEnhancements()`
- 只清空引用，让 `term.dispose()` 自动处理
- 协议处理器（非 addon）仍需手动清理

### 2. WebGL addon dispose 内部错误（2026-08-25）

**问题**：即使修复了双重 dispose，WebGL addon 在 `term.dispose()` 时仍然抛出错误。

**根因**：`@xterm/addon-webgl@0.19.0` 内部 bug，在某些情况下（如 WebGL context 已丢失）dispose 方法会尝试访问 undefined 对象。

**修复**：
- 升级到 xterm.js 6.0.0，包含修复 #5305 (Fix issue where listeners remain after WebglRenderer throws)
- 移除 try-catch 临时方案
- xterm.js 6.0.0 正式修复了此问题

**状态**：✅ 已修复（通过升级 xterm.js 6.0.0）

---

## 已知问题

### 1. @xterm/addon-ligatures 打包问题

**问题**：`@xterm/addon-ligatures@0.10.0` 的 `package.json` 中 `main` 字段指向 `lib/addon-ligatures.js`，但实际只有 `lib/addon-ligatures.mjs` 文件。

**影响**：Vite 无法解析该包，导致连字功能暂时不可用。

**解决方案**：
- 临时禁用连字加载
- 监控上游 issue
- 考虑使用其他连字实现（如 font-ligatures 直接集成）

### 2. WebGL 在 WKWebView 中的兼容性

**问题**：macOS WKWebView 的 WebGL 支持有限制。

**影响**：在某些 macOS 版本上可能无法使用 WebGL。

**解决方案**：
- 自动检测 WebGL 支持
- 不支持时静默降级到 Canvas
- 提供配置项强制禁用 WebGL

### 3. OSC 52 剪贴板安全提示

**问题**：某些终端应用频繁使用 OSC 52 读取剪贴板，可能影响用户体验。

**影响**：用户可能被频繁询问是否允许读取剪贴板。

**解决方案**：
- 默认策略为 `ask`（询问用户）
- 用户可在设置中选择 `allow`（始终允许）或 `deny`（始终拒绝）
- 考虑添加“记住本次会话选择”选项

---

## 性能基准

### 测试环境

- OS: Windows 11
- Browser: Chrome 120 (Electron)
- GPU: NVIDIA GeForce RTX 3060

### 测试场景

1. **高频输出**：`cat /dev/urandom | base64`
2. **大文件显示**：`cat large-file.txt` (10MB)
3. **TUI 应用**：htop 运行 30 秒

### 预期结果

| 场景 | Canvas (当前) | WebGL (升级后) | 提升 |
|------|--------------|----------------|------|
| 高频输出帧率 | ~15fps | ~45fps | 3x |
| 大文件滚动 | 卡顿 | 流畅 | 显著 |
| TUI 响应延迟 | ~50ms | ~15ms | 3x |

---

## 依赖变更

### Phase 1 & 2 新增依赖

```json
{
  "@xterm/addon-webgl": "^0.19.0",
  "@xterm/addon-ligatures": "^0.10.0",
  "@xterm/addon-unicode11": "^0.9.0"
}
```

### xterm.js 6.0 升级（2026-08-25）

```json
{
  "@xterm/xterm": "^6.0.0",
  "@xterm/addon-fit": "^0.11.0"
}
```

**升级原因**：
- 修复 WebGL addon dispose 错误 (#5305)
- 获得最新功能和性能优化
- 官方支持 Synchronized Output (DECSET 2026)

**关键变更**：
- 移除了 canvas renderer（只保留 DOM 和 WebGL）
- 滚动条行为变化（集成 VS Code 基础设施）
- 移除了 `windowsMode` 和 `fastScrollModifier` 属性
- OSC 52 剪贴板原生支持 (#4220)

### 依赖大小

| 包 | 大小 (gzip) |
|----|-------------|
| @xterm/addon-webgl | ~50KB |
| @xterm/addon-ligatures | ~30KB |
| @xterm/addon-unicode11 | ~15KB |
| **总计** | ~95KB |

---

## 交付物

### 代码

**Phase 1: 渲染性能提升**
- [x] `src/components/artifact/terminalEnhancements.ts`
- [x] `src/components/artifact/terminalEnhancements.test.ts`
- [x] `src/components/artifact/XtermSurface.tsx` (修改)
- [x] `packages/protocol/src/hip-config.ts` (修改)
- [x] `src/components/account/GeneralSettings.tsx` (修改)

**Phase 2: 协议支持补全**
- [x] `src/components/artifact/terminalOsc8.ts`
- [x] `src/components/artifact/terminalOsc52.ts`
- [x] `src/components/artifact/terminalSyncOutput.ts`
- [x] `src/components/artifact/terminalProtocols.ts`
- [x] `src/components/artifact/XtermSurface.tsx` (修改)
- [x] `packages/protocol/src/hip-config.ts` (修改)

### 文档

- [x] `docs/design/terminal-capability-upgrade/terminal-capability-upgrade-spec.md`
- [x] `docs/design/terminal-capability-upgrade/terminal-capability-upgrade-plan.md`
- [x] `docs/design/terminal-capability-upgrade/terminal-capability-upgrade-preview.html`
- [x] `docs/design/terminal-capability-upgrade/terminal-capability-upgrade-progress.md`

### 测试

**Phase 1**
- [x] 单元测试：11 个测试全部通过
- [x] 类型检查：tsc --noEmit 无错误

**Phase 2**
- [x] 类型检查：tsc --noEmit 无错误
- [ ] 单元测试：待补充
