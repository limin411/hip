# 领域 Facade 收敛：前端架构去分叉设计

**日期**：2026-06-06
**状态**：已批准设计，待实施计划
**类型**：架构重构（行为保持不变）

## 1. 背景与问题

`hip` 是三进程桌面 Agent 应用：Tauri 壳（Rust）/ React 前端 / Node sidecar（LangGraph WS 服务），前后端共享 `@hip/protocol` 契约。进程模型本身是健康的，`protocol` 是仓库里最稳的一块。

问题出在**前端存在两个平行世界**，共享同一个 `protocol`，但数据模型、组件树、状态形状已分头演化：

| | 已挂载世界（mock） | 孤立世界（real，但桩化） |
|---|---|---|
| 入口 | `main.tsx → App.tsx`（hash router）→ `routes/AppLayout` | `components/layout/AppShell`（未挂载） |
| Store | `uiStore`（UI 状态 + mock 数据，`Mock*` 类型） | `store/sessionStore`（`@hip/protocol` 类型，孤立） |
| "后端" | `hooks/useSimulatedStream`（setTimeout 假流）+ `mock/*` | `ipc/ws-client` + `hooks/useWebSocket`/`useSession` → 真 sidecar |
| 组件 | `chat/`、`artifact/`、`sidebar/`、`ui/` | `session/`、`layout/SessionTabs` |

这是 [`2026-06-05-ui-design-system.md`](2026-06-05-ui-design-system.md) 里有意为之的决定（逻辑层保留在磁盘但不再挂载，留待日后接回）。由此产生的结构性后果：

1. **同一概念两套领域模型**。Session/Message/Agent 在 `uiStore` 是 `MockSession/MockMessage/MockAgent`，在 `sessionStore` 是 protocol 类型，形状已不同（扁平 `messagesBySession` map vs 嵌套 `session.messages`；`MockAgent` 带 `elapsedMs/tokenCount` vs `AgentState` 带 `role/status/tokens`）。
2. **组件重复**。`chat/ChatPane`+`InputBar`（live）与 `session/ChatPane`+`InputBar`（孤立）是同一界面的两份实现；agent 可视化分裂为 `artifact/AgentDashboard`（live）vs `session/AgentTree`（孤立）。
3. **`uiStore` 揉杂两种关注点**：纯 UI 视图状态（`collapsed/panelOpen/activeTab/search`）与领域数据（`sessions/messages/agents`）耦合在同一 store。
4. **`components/layout/` 边界与挂载关系不一致**：`PageHeader` 是 live，`AppShell`/`SessionTabs` 是死代码。
5. **mock 流复制了协议语义**：`useSimulatedStream` 硬编码的 agent 状态机模仿的正是 sidecar 该发的事件，但用另一套类型，与真契约各自漂移。
6. **分叉在加速**：最近 20 个 commit 全是 UI，逻辑层冻结；sidecar 的 LangGraph 节点全是 `return { next: END }` 的 TODO，真实层本身还不能跑。唯一让"接回"可行的就是 `protocol` 这条缝清晰。

核心风险只有一个：**两个世界持续分叉，连接它们的契约虽好却无人使用，拖得越久接回成本越高。**

## 2. 目标与非目标

### 目标

- 把"两个世界"收敛成"一个世界 + 一个可替换的后端"。
- 单一领域源：所有 Session/Message/Agent 状态只有一处真相。
- mock 与真实 sidecar 之间是一条干净、可一键切换的缝。
- 引入领域 **facade** 层（方案三），UI 与"数据从哪来"彻底解耦。
- **行为保持不变**：重构后 mock UI 看起来、用起来完全一样。

### 非目标（明确范围外）

- **不改 `@hip/protocol`**（共享契约零改动）。
- **不实现 sidecar 逻辑**（LangGraph 节点仍是 TODO）。`WsTransport` 会建好就位，但本次默认仍用 `MockTransport`，**不切到 live**——切 live 是日后由后端进度决定的独立一步。本次成果是"缝存在且干净"，不是"现在就接通"。
- **不加 artifact 协议**（doc/files/diff 仍是 mock fixture）。
- 不动 `src-tauri`；无任何视觉/交互改动。

## 3. 目标分层架构

```
┌─────────────────────────────────────────────────────────────┐
│  UI 层   chat/ · artifact/ · sidebar/ · routes/              │
│          只通过 domain hooks 读状态、调 facade action         │
└───────────────┬─────────────────────────────┬───────────────┘
                │ 读领域状态                    │ 读纯视图状态
                ▼                               ▼
┌───────────────────────────────┐   ┌─────────────────────────┐
│  Domain 层  src/domain/        │   │  uiStore（瘦身后）       │
│  · sessionService（facade）    │   │  collapsed / panelOpen /  │
│  · sessionStore（protocol 形状）│   │  panelFullscreen /        │
│  · hooks（useActiveSession…）  │   │  activeTab / search       │
└───────────────┬───────────────┘   └─────────────────────────┘
                │ send(ClientMessage) / onMessage(ServerMessage)
                ▼
┌───────────────────────────────┐
│  Transport 接口  src/domain/   │   ← facade 的可换后端（缝在这）
│  · MockTransport（计时器发事件）│   ← 今天用这个
│  · WsTransport（包 ipc/ws-client）│ ← 日后换这个 = 改一行
└───────────────┬───────────────┘
                ▼
        @hip/protocol  ← 共享契约，本次零改动
```

### 核心原则

1. **UI 只依赖 facade**，不直接碰 store/transport。组件 import 的是 `useActiveSession()`/`useAgents()` 等领域 hook，以及单例 `sessionService` 的 action；store 和 transport 是 domain 层私有实现。
2. **mock 与 live 都藏在 facade 后面的 Transport 缝上**。facade 只消费 `ServerMessage`、发 `ClientMessage`，不关心事件来自计时器还是 WebSocket。今天注入 `MockTransport`，接回真后端注入 `WsTransport`，facade 与所有 UI 一行不改。
3. **`protocol` 不动**。UI 才需要的派生字段由 facade 从协议事件算出并物化进领域对象，不污染共享契约。
4. **artifact 右栏不进缝**。doc/files/diff 是静态 mock 素材、后端暂不产出，留作 UI fixture。

## 4. 模块布局

### ① 新建 `src/domain/`

| 文件 | 职责 | 来源 |
|---|---|---|
| `transport.ts` | `Transport` 接口 | 新写 |
| `mockTransport.ts` | 实现 `Transport`：①`connect()` 时回放种子历史；②收到 `message:send` 时用计时器发出 agent 时间线 + token 流 + `message:complete` | 移植 `hooks/useSimulatedStream.ts` 时间线，产出协议事件 |
| `wsTransport.ts` | 实现 `Transport`，包 `ipc/ws-client` + 端口发现 | 吸收 `hooks/useWebSocket.ts` 的 `get_sidecar_port` |
| `sessionStore.ts` | protocol 形状领域状态 + reducer（消费 `ServerMessage`）+ 派生字段 | 提升 `store/sessionStore.ts` |
| `sessionService.ts` | **facade**：持有当前 transport，归并 `onMessage` 进 store，暴露高层 action + 连接状态 | 吸收 `hooks/useSession.ts` 接线 |
| `hooks.ts` | `useSessions`/`useActiveSession`/`useActiveMessages`/`useAgents`/`useConnectionStatus` | 新写薄封装 |

### ② 保留为底层线缆

- `src/ipc/ws-client.ts` —— 不动，作为 `wsTransport` 用的低层 WS 客户端。三层清晰：ipc=线缆，domain/transport=协议适配，domain/service=facade。

### ③ 删除（孤立重复件，被上面取代）

- `src/components/layout/AppShell.tsx`
- `src/components/layout/SessionTabs.tsx`
- `src/components/session/`（`SessionView`/`ChatPane`/`InputBar`/`AgentTree`）
- `src/store/sessionStore.ts`、`src/hooks/useSession.ts`、`src/hooks/useWebSocket.ts`、`src/hooks/useSimulatedStream.ts`

### ④ `src/store/uiStore.ts` 瘦身

只留纯视图状态：`collapsed`/`panelOpen`/`panelFullscreen`/`activeTab`/`search` 及 setter。移走全部领域数据与动作。约 115 行 → 约 35 行。

### ⑤ 组件改接线（编辑，不挪位置）

| 组件 | 改动 |
|---|---|
| `chat/ChatPane` | 消息源 → `useActiveMessages()` |
| `chat/InputBar` | → `sessionService.sendMessage()` |
| `chat/ChatHeader` | 标题读 `useActiveSession()` 派生 title |
| `chat/MessageBubble` | 入参 `MockMessage` → protocol `Message` |
| `artifact/AgentDashboard` | agent 源 → `useAgents()` |
| `sidebar/SessionList`·`SessionItem`·`NewChatButton` | 列表/选中/新建 → `useSessions()` + `sessionService`；`search` 仍读 uiStore |

### ⑥ mock 数据归宿

- `mock/sessions.ts`·`mock/messages.ts`·`mock/agents.ts` → `MockTransport` 回放的种子（连接时 replay 成 `session:created`/`message:complete`/agent 事件时间线）。
- `mock/types.ts` 中 `MockSession/MockMessage/MockAgent` 退役；`FileNode/DiffLine/DiffFile` 保留。
- `mock/diff·doc·fileTree·billing·profile·settings·help·user` → 不动，仍是 artifact / 设置页 UI fixture。

## 5. 关键设计决策

### 5.1 Transport 接口

```ts
// src/domain/transport.ts
import type { ClientMessage, ServerMessage } from '@hip/protocol'

export interface Transport {
  connect(): Promise<void>
  disconnect(): void
  send(msg: ClientMessage): void
  onMessage(handler: (msg: ServerMessage) => void): () => void
}
```

`MockTransport` 与 `WsTransport` 各实现一份。切换 live 即在 `sessionService` 初始化处把 `new MockTransport(seed)` 换成 `new WsTransport()`。

关键在于 **mock 走的是与真后端完全相同的请求/响应回路**：UI 调 `sessionService.sendMessage()` → facade 发 `message:send`（`ClientMessage`）→ transport 接收 → `MockTransport` 用计时器回发 `agent:started`/`token:stream`/`agent:finished`/`message:complete`（`ServerMessage`）→ facade 的同一个 reducer 归并进 store。换成 `WsTransport` 时，唯一区别是这些事件来自 sidecar 而非计时器。

### 5.2 领域视图模型（前端 protocol 超集）

```ts
// src/domain/sessionStore.ts
import type { Message, SessionConfig, AgentRole } from '@hip/protocol'

export interface AgentVM {
  id: string
  role: AgentRole
  title: string          // 派生自 role（显示名映射）
  status: 'idle' | 'running' | 'done'
  tokens: string
  tokenCount: number     // 物化：tokens.length
  elapsedMs: number      // 物化：finished - started
}

export interface SessionVM {
  id: string
  config: SessionConfig
  title: string          // 派生：首条用户消息
  preview: string        // 派生：末条消息
  updatedAt: number      // 物化：最近事件时间
  messages: Message[]
  agents: AgentVM[]
  status: 'idle' | 'running' | 'error'
}
```

`title/preview/updatedAt/elapsedMs/tokenCount` 全部由 **reducer/facade 在写入时物化进对象**，而非在 selector 里现算（见 5.4）。

### 5.3 Facade 与 action 稳定性

`sessionService` 是模块级**单例**，其方法引用天然稳定：

```ts
// src/domain/sessionService.ts
export interface SessionService {
  createSession(config?: SessionConfig): string
  selectSession(id: string): void
  deleteSession(id: string): void
  sendMessage(content: string): void   // 作用于 active session：乐观追加用户消息 + 发 message:send
  cancel(): void
}
export const sessionService: SessionService /* = … */
```

UI **直接 import 单例调 action**（`sessionService.sendMessage(...)`），不经 hook/selector——从根上避开 5.4 的 #185 风险。状态走 hook，动作走单例。

### 5.4 Zustand selector 纪律（硬约束）

遵守 [`AGENTS.md`](../../../AGENTS.md) 的规则：单个 selector 禁止返回新对象/数组。因此：

- domain hooks 一律只返回 store 内**已存在**的对象或 primitive，绝不在 selector 里 `{...}`/`[...]`。
- `useActiveSession()` 用 `sessions.find(...)` 返回 store 内对象（引用稳定，仅该会话更新时才变）——安全。
- 所有派生显示字段在 reducer 写入时物化，selector 只做属性访问。
- action 不经 selector，走单例 import。

## 6. 测试策略

facade 化最大的红利是领域层可脱离 React 纯 TS 测：

- **Transport 契约测**：`MockTransport` 发出的事件序列合法（`session:created → agent:started → token:stream* → agent:finished → message:complete`）。
- **Reducer 测**：把 `ServerMessage` 喂进 `sessionStore`，断言状态迁移（token 累加、message 追加、status 翻转、派生字段物化正确）。
- **Facade 测**：`sendMessage` 乐观追加用户消息 + 发 `message:send`；`createSession/selectSession/deleteSession` 正确。
- **现有 vitest 保持绿**：`stream.ts` 的 `tokenize` 留用给 `MockTransport`；`mock.test` 等按需改接。
- **E2E（wdio `app-launch.spec`）不变**——行为保持，应原样通过，是"行为不变"的护栏。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| **Zustand #185**（selector 返回新对象触发生产构建无限重渲染） | 派生字段物化进 store；hooks 只返回已存在对象/primitive；action 走单例不经 selector（见 5.3/5.4） |
| **接线时行为漂移**（mock a0–a3 时序移植到 `MockTransport` 后效果变样） | 保持同一时间线；E2E + 手动 parity 校验 |
| **`activeSessionId` 由 `string` 变 `string\|null`** | 连接时由 `MockTransport` 种入一个会话；组件做 null 防御 |
| **大改动一次性落地** | 增量实施（见 §8），每步 app 可跑可回归 |

## 8. 实施顺序（增量，全程 app 可回归）

1. 建 `src/domain/`（transport + mockTransport 发协议事件 + 提升 sessionStore + sessionService + hooks），与旧路径并存，UI 不变。
2. 改 chat 面（ChatPane/InputBar/ChatHeader/MessageBubble）读 domain；验证 parity。
3. 改 sidebar（SessionList/SessionItem/NewChatButton）读 domain；验证。
4. 改 artifact `AgentDashboard` 读 domain；验证。
5. 瘦 uiStore（移除领域片）+ 删孤立件（`session/`、`AppShell`、`SessionTabs`、旧 hooks/store）。
6. 测试 + E2E 绿。

## 9. 验收标准

- [ ] mock UI 行为与重构前**逐项一致**（发消息、流式回复、agent dashboard、会话切换/新建/删除、侧栏搜索、面板开合）。
- [ ] 全仓只有**一个**领域源（`src/domain/sessionStore`）；`Mock*` 领域类型退役。
- [ ] `chat/` 与 `session/` 的重复组件只剩一套；`AppShell`/`SessionTabs`/孤立 hooks/store 已删。
- [ ] `uiStore` 仅含视图状态。
- [ ] 切换到 `WsTransport` 是 `sessionService` 初始化处的**一行改动**（无需触碰 UI 或 facade）。
- [ ] `@hip/protocol` 与 `src-tauri/` 未改动。
- [ ] `yarn type-check`、`yarn test`、`yarn test:e2e` 全绿。
