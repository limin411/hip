# hip 项目 Agent 指南

## 桌面 E2E 测试方法论（Tauri v2 + WebDriverIO）

### 架构概述

```
┌─────────────────┐     WebDriver协议      ┌─────────────────────────────┐
│  WebDriverIO    │ ◄────────────────────► │  tauri-plugin-wdio-webdriver│
│  (@wdio/cli)    │   (HTTP on port 4445)  │  (embedded in app binary)   │
└─────────────────┘                        └─────────────────────────────┘
         │                                              │
         │         @wdio/tauri-service                  │
         │    (spawns app + manages lifecycle)          │
         │                                              │
         └──────────────► ┌─────────────┐ ◄────────────┘
                        │   hip app     │
                        │  (WKWebView)  │
                        └─────────────┘
```

### 为什么用这个方案

macOS 不支持 `tauri-driver`（官方 CLI 工具），因此采用 `@wdio/tauri-service` 的 **embedded provider** 模式：
- `tauri-plugin-wdio-webdriver` (Rust) 编译进应用，内置 WebDriver 服务器
- `@wdio/tauri-plugin` (JS) 注入前端，提供 `window.__TAURI__.core.invoke` 通信能力
- `@wdio/tauri-service` 自动启停应用 + 连接 WebDriver

### 依赖清单

**JS 侧**（已安装）：
```
@wdio/cli
@wdio/local-runner
@wdio/mocha-framework
@wdio/spec-reporter
@wdio/tauri-service
@wdio/tauri-plugin
webdriverio
```

**Rust 侧**（已配置）：
```toml
# src-tauri/Cargo.toml
tauri-plugin-wdio-webdriver = "1"
```

**前端注入**（`src/main.tsx` 第一行）：
```tsx
import '@wdio/tauri-plugin'
```

### 构建与运行

```bash
# 1. 构建前端 + Tauri debug 包（内含所有资源）
cargo tauri build --debug

# 2. 运行 E2E 测试
yarn test:e2e
```

> **注意**：`cargo build` 不会嵌入前端资源，必须用 `cargo tauri build --debug`。

### 配置文件

`wdio.conf.ts` 核心配置：
```ts
services: [
  ['@wdio/tauri-service', {
    appBinaryPath: './src-tauri/target/debug/hip',
    driverProvider: 'embedded',
  }],
],
capabilities: [{
  browserName: 'tauri',
  'tauri:options': {
    application: './src-tauri/target/debug/hip',
  },
}],
```

### 已知问题与解决方案

#### 1. Zustand selector 返回新对象导致 React #185

**现象**：生产构建下页面崩溃，`Unexpected Application Error! Minified React error #185`

**根因**：Zustand v5 的 `useStore` 内部使用 `useSyncExternalStore`。Selector 若返回新对象（如 `(s) => ({ a: s.a })`），React 每次渲染都会判定为 state 变化 → 触发重渲染 → 再次调用 selector → 无限循环。

**dev 模式不崩的原因**：React StrictMode 的双挂载意外打破了循环时序。

**✅ 正确写法**：
```tsx
// 拆分为多个 primitive selector
const activeSessionId = useUiStore((s) => s.activeSessionId)
const messages = useUiStore((s) => s.messagesBySession[activeSessionId] ?? [])
```

**❌ 错误写法**：
```tsx
// 返回新对象！生产构建下会触发无限循环
const { activeSessionId, messages } = useUiStore((s) => ({
  activeSessionId: s.activeSessionId,
  messages: s.messagesBySession[s.activeSessionId] ?? [],
}))
```

#### 2. `core.invoke not available after 5s timeout`

**现象**：测试日志中反复出现此警告。

**影响**：不影响基本 WebDriver 操作（查找元素、点击、获取文本），但影响 `@wdio/tauri-service` 的高级功能（窗口管理、Tauri API 调用）。

**原因**：`@wdio/tauri-plugin` 前端注入后，`window.__TAURI__.core.invoke` 初始化失败或超时。

**处理**：当前未完全解决，但不阻塞基础 E2E 测试。如需 Tauri API 测试，需进一步排查插件初始化时机。

#### 3. 应用启动后 URL 为 `about:blank`

**现象**：WebDriver 连接成功，但 `browser.getUrl()` 返回 `about:blank`。

**原因**：`cargo build` 生成的二进制未嵌入前端资源，Tauri 找不到 `index.html`。

**解决**：必须使用 `cargo tauri build --debug`（或 `--release`），它会先运行 `yarn build` 再编译 Rust，确保资源正确打包。

#### 4. macOS `.app` bundle 与 raw binary

`cargo tauri build --debug` 会同时生成：
- `src-tauri/target/debug/hip` —— **E2E 测试实际使用的二进制**
- `src-tauri/target/debug/bundle/macos/hip.app` —— 可选的 `.app` 包

E2E 配置中的 `appBinaryPath` 指向 raw binary 即可，`.app` 包不参与测试。

### 测试用例结构

```
e2e/
├── specs/
│   └── app-launch.spec.ts    # 应用启动 + 页面流转验证
└── (可按功能模块拆分更多 spec 文件)
```

### 扩展测试覆盖的建议

1. **会话操作**：新建会话、切换会话、删除会话
2. **侧边栏交互**：折叠/展开、搜索过滤
3. **右侧面板**：切换 Tab（文档/文件/智能体/Diff）、全屏/关闭
4. **用户菜单**：导航到个人资料/设置/账单/帮助
5. **Tauri API**：窗口最小化/最大化、系统菜单（需 `core.invoke` 修复后）

### 关于 `yarn tauri dev` 做 E2E

**不推荐**。原因：
1. `@wdio/tauri-service` 会自动启动应用，先跑 `yarn tauri dev` 会造成双进程冲突
2. `yarn tauri dev` 的 React StrictMode + HMR 会掩盖生产构建下的 bug（如 Zustand selector 问题）
3. 测试目标应为最终用户使用的生产包，而非开发服务器

---

## 前端状态管理规范

### Zustand Selector 最佳实践

本项目使用 Zustand v5。所有组件在使用 `useUiStore` 时，**必须遵守以下规则**：

**规则 1：每个 hook 调用只返回 primitive 或稳定引用**
```tsx
// ✅ 正确
const collapsed = useUiStore((s) => s.collapsed)
const sessions = useUiStore((s) => s.sessions)
const activeId = useUiStore((s) => s.activeSessionId)
```

**规则 2：禁止在单个 selector 中返回新对象/数组/函数**
```tsx
// ❌ 错误 —— 生产构建下可能导致 React #185
const { a, b } = useUiStore((s) => ({ a: s.a, b: s.b }))

// ❌ 错误 —— 即使解构内部也返回新对象
const data = useUiStore((s) => ({ x: s.x, y: s.y }))
```

**规则 3：如需动态 key 访问，先取 key 再取 value**
```tsx
// ✅ 正确 —— 分两步，确保每个 selector 返回稳定值
const activeSessionId = useUiStore((s) => s.activeSessionId)
const messages = useUiStore((s) => s.messagesBySession[activeSessionId] ?? [])
```

**规则 4：Store action 引用天然稳定，可单独抽取**
```tsx
// ✅ 正确 —— action 是 store 创建时定义的函数，引用稳定
const setCollapsed = useUiStore((s) => s.setCollapsed)
const togglePanel = useUiStore((s) => s.togglePanel)
```

### 为什么这个规则重要

- Zustand v5 使用 `useSyncExternalStore` 与 React 集成
- `useSyncExternalStore` 通过 `Object.is` 比较 snapshot
- 新对象 `{}` 或新数组 `[]` 每次比较都是 `false`
- 在生产模式（无 StrictMode）下，这会触发 >50 次重渲染，React 抛出 #185 错误

---

## 项目结构速查

```
hip/
├── e2e/
│   └── specs/
│       └── app-launch.spec.ts      # E2E 测试用例
├── src/
│   ├── main.tsx                     # 入口（含 @wdio/tauri-plugin 导入）
│   ├── routes/
│   │   ├── AppLayout.tsx            # 主布局（react-resizable-panels）
│   │   └── LoginScreen.tsx          # 登录页
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatPane.tsx         # 聊天面板（Zustand selector 修复处）
│   │   │   └── MessageBubble.tsx    # 消息气泡
│   │   └── sidebar/
│   │       └── ...
│   ├── domain/
│   │   ├── sessionService.ts        # App singleton (live WsTransport)
│   │   ├── sessionStore.ts          # Domain Zustand store
│   │   ├── transport.ts             # Transport interface
│   │   ├── wsTransport.ts           # Live WebSocket transport
│   │   ├── hooks.ts                 # Domain hooks (useSessions, useConnectionStatus, …)
│   │   └── index.ts                 # Re-exports
│   └── store/
│       └── uiStore.ts               # UI-chrome-only store (layout, panel state)
├── src-tauri/
│   ├── Cargo.toml                   # Rust 依赖（含 wdio plugin）
│   ├── src/lib.rs                   # Rust 入口（注册 plugin）
│   └── capabilities/default.json    # 权限配置
├── packages/
│   └── sidecar/                     # Node.js sidecar (LangGraph WS server)
│       └── src/session/
│           ├── session.ts           # Session (single-turn LLM interaction)
│           ├── agents.ts            # Supervisor + Planner/Coder/Reviewer sub-agents
│           └── session-manager.ts   # Multi-session registry
├── wdio.conf.ts                     # WebDriverIO 配置
└── AGENTS.md                        # 本文件
```

## 开发启动

创建 `.env.local` 文件（已 gitignored）：

```bash
cp .env.example .env
# 编辑 .env，填入你的 DeepSeek API Key
```

一键启动完整应用（自动清理 Vite 端口占用）：

```bash
yarn dev:live
```

或者临时通过环境变量启动：

```bash
DEEPSEEK_API_KEY=sk-xxx yarn dev:live
```
