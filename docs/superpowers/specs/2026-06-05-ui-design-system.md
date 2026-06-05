# hip — 三栏布局 UI 设计系统（纯界面 / Mock 数据）

**Date:** 2026-06-05
**Status:** Approved
**Scope:** 纯前端界面实现，亮色主题，纯 mock 数据，不连真实 WebSocket
**Stack:** React 18 · TypeScript · React Router · Tailwind CSS · shadcn/ui · react-resizable-panels

---

## Overview

为 `hip` 智能体编码桌面应用构建一套完整的三栏布局 UI。目标是**可交互的界面演示**：所有数据来自静态 mock，流式效果用 `setTimeout` 模拟，不调用真实 sidecar / WebSocket。现有逻辑层（`sessionStore`、`ws-client`、hooks）保留不动，新 UI 作为独立视图层，由 mock 数据驱动。

设计参考 Claude Desktop / Linear 的克制亮色风格：低饱和、留白充足、单一品牌强调色。

---

## 与现有代码的关系（并行共存）

- **保留不动：** `src/store/sessionStore.ts`、`src/ipc/ws-client.ts`、`src/hooks/useWebSocket.ts`、`src/hooks/useSession.ts`、`packages/*`、`src-tauri/*`
- **新增视图层：** 全部新 UI 组件 + mock 数据，独立于 ws-client
- **暂不调用：** `ws-client` 在本次 UI 中不发起连接；新 UI 用 mock 数据作为初始状态
- **可接回：** 逻辑层接口完好，后续可将 mock 替换为真实 store 数据

---

## 屏幕与路由

使用 **React Router**，两个顶层路由：

| 路由 | 屏幕 | 说明 |
|------|------|------|
| `/login` | `LoginScreen` | 全屏登录页 |
| `/app` | `AppLayout` | 三栏主界面 |

- 应用默认重定向到 `/login`
- 登录页任意登录方式（邮箱/GitHub/Google）或"跳过登录"均 `navigate('/app')`（纯 mock，不做真实鉴权）
- 无鉴权守卫（纯界面演示）

---

## 布局架构（三栏统一交互）

```
┌──────────┬───────────────────────────┬─────────────────────┐
│ 侧边栏    │      中心对话区             │  产物面板            │
│ Sidebar  │      ChatPane             │  ArtifactPanel       │
│ 默认240px │      flex-1              │  默认400px           │
│ 可拖拽    │                          │  可拖拽·可toggle·可全屏│
│ 可折叠56px│                          │  顶部4 tab切换        │
└──────────┴───────────────────────────┴─────────────────────┘
```

三种布局机制统一共存：

1. **可拖拽（基础机制）** — 用 `react-resizable-panels` 实现栏间拖动分隔条，实时调整宽度。
2. **固定比例 + toggle（默认行为）** — 侧边栏默认 240px、右侧面板默认 400px；右侧面板顶部有 toggle 按钮可整体收起，收起后中间对话区独占剩余空间。
3. **浮层 / 全屏（增强态）** — 右侧面板有"展开"按钮，点击后临时覆盖到接近全宽（查看大段 diff 或整页文档），再点收回；侧边栏可折叠为 56px 图标条。

约束范围：
- 侧边栏展开态可拖拽范围 `200~320px`，默认 240px；折叠态为固定 56px（由 toggle 切换，不参与拖拽）。
- 右侧面板可拖拽范围 `320~640px`，默认 400px；全屏态临时覆盖到容器宽度的 ~90%。
- 中间对话区有最小宽度 `400px`，拖拽时优先保证其不被压缩到该值以下。

---

## 设计 Token

写入 Tailwind config（`tailwind.config.js` 的 `theme.extend`）与 CSS 变量，组件一律引用 token，禁止硬编码颜色值。

### 颜色

| Token | 值 | 用途 |
|-------|-----|------|
| `--bg-app` | `#FFFFFF` | 主背景（对话区） |
| `--bg-subtle` | `#F7F7F8` | 侧边栏、右侧面板底色 |
| `--bg-muted` | `#F0F0F1` | hover、输入框 |
| `--border` | `#E6E6E8` | 分隔线、边框 |
| `--text-primary` | `#1A1A1A` | 正文 |
| `--text-secondary` | `#6B6B70` | 次要文字、标签 |
| `--text-tertiary` | `#9B9BA0` | placeholder、时间戳 |
| `--accent` | `#5B5BD6` | 主品牌色（按钮、激活态、链接） |
| `--accent-hover` | `#4A4AC4` | 按钮 hover |
| `--accent-subtle` | `#EEEEFB` | 激活态背景、选中会话 |
| `--success` | `#3D9A50` | agent 运行中、diff 新增 |
| `--danger` | `#D64545` | 错误、diff 删除 |
| `--warning` | `#C77A1A` | 等待、提示 |

### Agent 角色色

| 角色 | 色值 |
|------|-----|
| supervisor | `#5B5BD6` |
| planner | `#1A8CD8` |
| coder | `#3D9A50` |
| reviewer | `#C77A1A` |

### 字体 / 字号

- UI 字体：`-apple-system, "Segoe UI", Roboto, sans-serif`
- 代码 / diff：`"SF Mono", "JetBrains Mono", monospace`
- 字号阶梯：`11 / 12 / 13 / 14 / 16 / 20 / 24`（基准 14）
- 字重：`400 / 500 / 600`

### 间距 / 圆角 / 阴影

- 间距（4px 基准）：`4 / 8 / 12 / 16 / 20 / 24 / 32`
- 圆角：`sm 6px · md 8px · lg 12px · full 9999px`
- 阴影：`sm`（弹层）`0 1px 3px rgba(0,0,0,.08)` · `md`（浮层面板）`0 8px 24px rgba(0,0,0,.12)`

---

## 组件清单

### 基础组件（shadcn/ui + 定制）

`Button`（primary / secondary / ghost / icon 变体）· `Input` · `Textarea` · `Avatar` · `Tabs` · `Tooltip` · `DropdownMenu` · `ScrollArea` · `Badge` · `Separator` · `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle`

### 业务组件

| 区域 | 组件 | 职责 |
|------|------|------|
| 登录 | `LoginScreen` | 左侧大图标块 + 右侧登录卡片，整体两栏 |
| 登录 | `AuthButton` | 单个登录方式按钮（图标 + 文字），4 种：邮箱 / GitHub / Google / 跳过登录 |
| 布局 | `AppLayout` | 三栏 `ResizablePanelGroup` 容器，管理折叠/toggle/全屏状态 |
| 侧边栏 | `Sidebar` | 容器，支持 240px ↔ 56px 折叠 |
| 侧边栏 | `NewChatButton` | 顶部"新对话"按钮 |
| 侧边栏 | `SearchBox` | 会话搜索输入框 |
| 侧边栏 | `SessionList` / `SessionItem` | 会话列表，选中态、hover 显示删除 |
| 侧边栏 | `UserMenu` | 底部头像，点击向上弹出页面列表菜单 |
| 对话 | `ChatPane` | 消息流容器，自动滚动到底 |
| 对话 | `MessageBubble` | 用户 / 助手气泡，助手支持 markdown + 代码块渲染 |
| 对话 | `InputBar` | 多行输入 + 发送按钮 + 模型选择下拉 |
| 对话 | `StreamingCursor` | 流式打字光标动画 |
| 右面板 | `ArtifactPanel` | 容器，顶部 4 tab + toggle + 全屏按钮 |
| 右面板 | `DocRenderer` | markdown 文档渲染 |
| 右面板 | `FileTree` | 可展开目录树 |
| 右面板 | `AgentDashboard` | 智能体并行卡片面板 |
| 右面板 | `DiffViewer` | git diff 行级渲染 |

---

## 右侧产物面板（4 个 Tab）

顶部 tab 切换（手动）：

| Tab | 组件 | Mock 渲染内容 |
|-----|------|--------------|
| 📄 文档 | `DocRenderer` | markdown 产物文档：标题、段落、列表、代码块、表格 |
| 🗂 文件树 | `FileTree` | 可展开目录树，文件类型图标，点击高亮选中 |
| 🔀 智能体 | `AgentDashboard` | supervisor 卡片 + 2~4 子 agent 并行卡片网格 |
| ± Git Diff | `DiffViewer` | 文件列表 + 行级 diff，绿色新增 / 红色删除 + 行号 |

### AgentDashboard（重点）

- 顶部一张 **supervisor** 卡片（角色色点 + 状态 + 当前决策文字）
- 下方 **2~4 张子 agent 卡片** 网格并排（planner / coder / reviewer）
- 每张卡片显示：角色色点、角色名、状态徽章（running 绿点脉冲 / done 灰勾 / idle）、最新 token 流（截断显示）、token 计数、耗时
- 体现"并行"：多张卡片可同时处于 running 状态

---

## Mock 数据（`src/mock/`，纯静态）

| 文件 | 内容 |
|------|------|
| `sessions.ts` | `mockSessions`：6~8 个会话（id、标题、时间戳、最后消息预览） |
| `messages.ts` | `mockMessages`：一段完整对话（用户提问 + 助手含代码块的长回复） |
| `agents.ts` | `mockAgents`：supervisor + planner/coder/reviewer，各带状态与 token 片段 |
| `fileTree.ts` | `mockFileTree`：一个 React 项目目录树（嵌套结构） |
| `diff.ts` | `mockDiff`：2~3 个文件的 git diff（含新增/删除行） |
| `doc.ts` | `mockDoc`：一篇 markdown 产物文档字符串 |
| `user.ts` | `mockUser`：头像、用户名、邮箱 |

---

## 关键交互

| 交互 | 效果 |
|------|------|
| 登录页任意按钮 | `navigate('/app')` 进入主界面 |
| 新对话 | 会话列表顶部插入新项并选中，对话区清空 |
| 点击会话 | 切换选中态，对话区载入该会话 mock 消息 |
| 搜索框输入 | 实时过滤会话列表（按标题） |
| 点击头像 | 向上弹出 `DropdownMenu`，含页面列表（个人资料 / 设置 / 退出登录等） |
| 发送消息 | 输入内容变用户气泡 → 模拟流式：助手回复逐字打出（`setTimeout`）+ 右侧 AgentDashboard 卡片依次 running → done |
| 右侧 tab 切换 | 切换文档 / 文件树 / agent / diff 内容 |
| 右侧 toggle | 收起 / 展开右侧面板 |
| 右侧全屏 | 面板覆盖到接近全宽 / 收回 |
| 拖拽分隔条 | 实时调整栏宽 |
| 侧边栏折叠 | 240px ↔ 56px 图标条切换 |

### 动效

- 流式打字光标闪烁（CSS animation）
- agent running 绿点脉冲（CSS animation）
- 面板展开/折叠 200ms ease
- hover 过渡 150ms
- 流式逐字用 `setTimeout` 模拟，不连真实 WS

---

## 文件结构（新增）

```
src/
├── App.tsx                      # 改为 React Router 根
├── main.tsx                     # 保留
├── routes/
│   ├── LoginScreen.tsx
│   └── AppLayout.tsx
├── components/
│   ├── ui/                      # shadcn/ui 基础组件
│   ├── login/
│   │   └── AuthButton.tsx
│   ├── sidebar/
│   │   ├── Sidebar.tsx
│   │   ├── NewChatButton.tsx
│   │   ├── SearchBox.tsx
│   │   ├── SessionList.tsx
│   │   ├── SessionItem.tsx
│   │   └── UserMenu.tsx
│   ├── chat/
│   │   ├── ChatPane.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── InputBar.tsx
│   │   └── StreamingCursor.tsx
│   └── artifact/
│       ├── ArtifactPanel.tsx
│       ├── DocRenderer.tsx
│       ├── FileTree.tsx
│       ├── AgentDashboard.tsx
│       └── DiffViewer.tsx
├── mock/
│   ├── sessions.ts
│   ├── messages.ts
│   ├── agents.ts
│   ├── fileTree.ts
│   ├── diff.ts
│   ├── doc.ts
│   └── user.ts
├── store/
│   └── uiStore.ts               # 新增：UI 本地状态（mock 驱动，Zustand）
└── styles/
    └── tokens.css               # CSS 变量 token
```

新增 UI 状态用独立的 `uiStore.ts`（Zustand），与现有 `sessionStore.ts` 区分开，避免污染逻辑层。

---

## 依赖新增

| 包 | 用途 |
|----|------|
| `react-router-dom` | 路由 |
| `tailwindcss` `postcss` `autoprefixer` | 样式 |
| `react-resizable-panels` | 可拖拽三栏 |
| `lucide-react` | 图标 |
| `clsx` `tailwind-merge` | className 合并（shadcn 依赖） |
| `class-variance-authority` | 组件变体（shadcn 依赖） |
| `@radix-ui/*` | shadcn/ui 底层（按需） |
| `react-markdown` | markdown 渲染（DocRenderer / MessageBubble） |

---

## Out of Scope

- 真实鉴权 / OAuth 流程（登录纯 mock 跳转）
- 真实 WebSocket / sidecar 数据（流式用 setTimeout 模拟）
- 暗色主题（仅亮色）
- 持久化（刷新后回到初始 mock 状态）
- 移动端 / 响应式（桌面固定布局）
- 真实文件系统 / git 集成
