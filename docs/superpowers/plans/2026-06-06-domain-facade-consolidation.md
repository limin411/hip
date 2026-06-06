# 领域 Facade 收敛 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把前端"两个平行世界"（mock UI + 孤立真实层）收敛成"一个 protocol 形状的领域层 + 一条可替换的 Transport 缝"，行为基本保持不变。

**Architecture:** 新建 `src/domain/`：`Transport` 接口（`MockTransport` 今天用 / `WsTransport` 日后用）→ `sessionService` facade → `useDomainStore`（protocol 形状）。mock 改成发 `ServerMessage` 事件，与真后端共用同一个 reducer。UI 只通过 domain hooks 读状态、调 `sessionService` action。`uiStore` 瘦成纯视图状态。删除孤立的 `session/`、`AppShell`、旧 hooks/store。

**Tech Stack:** React 18 + Zustand v5 + Vite + TypeScript（bundler mode）+ Vitest（node 环境）+ `@hip/protocol`。

**Spec:** [`docs/superpowers/specs/2026-06-06-domain-facade-consolidation-design.md`](../specs/2026-06-06-domain-facade-consolidation-design.md)

---

## 行为 Parity 注记（重要 —— 三处有意保留的细微 delta）

把假 UI 经由真 `protocol` 路由后，协议**不携带** mock 手写的展示数字，因此以下三处 agent 面板读数会从"手写值"变为"派生值"。**结构与所有交互行为完全不变**；这是把缝接到真契约的代价，已记录在案：

1. **Supervisor 卡片文本**：助手聊天回复现在作为 supervisor（a0）的 `token:stream` 流式输出（聊天区逐字流式 **保持不变**），因此 supervisor 卡片的 token 文本变为完整回复，而非旧的一句话摘要。
2. **`tokenCount`（仅发送后新流式的 agent）**：变为实际流式 token 长度（`tokens.length`），而非旧的手写值（142/318/1024/256）。**初始 seed 的 agent 卡片仍显示手写值**（store 内是存量数据）。
3. **`elapsedMs`（仅发送后新流式的 agent）**：变为实际流式时长（`finishedAt - startedAt`），而非旧的硬编码值。**初始 seed 的卡片仍显示手写值。**

会话列表（title/preview/updatedAt）、聊天流式、agent running/done 状态机、面板布局、所有点击交互 —— **逐项一致**。

---

## File Structure

**新建 `src/domain/`：**

| 文件 | 职责 |
|---|---|
| `transport.ts` | `Transport` 接口（纯类型） |
| `seed.ts` | `DEFAULT_CONFIG` + `seedSessions()`：把 `mock/*` 转成初始 `SessionVM[]` |
| `sessionStore.ts` | VM 类型 + 纯 reducer `applyServerMessage` + `useDomainStore`（Zustand）+ actions |
| `mockTransport.ts` | `MockTransport`：`connect()` no-op；收到 `message:send` 用计时器发协议事件 |
| `wsTransport.ts` | `WsTransport`：包 `ipc/ws-client` + sidecar 端口发现（日后用） |
| `sessionService.ts` | facade 单例：transport↔store 接线 + 高层 action |
| `hooks.ts` | `useSessions`/`useActiveSessionId`/`useActiveSession`/`useActiveMessages`/`useAgents`/`useConnectionStatus` |
| `index.ts` | barrel 导出 |

**修改：** `src/store/uiStore.ts`（瘦身）、`src/routes/AppLayout.tsx`（挂载时 `connect()`）、`src/lib/sessions.ts`（泛型化）、`chat/InputBar`·`chat/ChatPane`·`chat/ChatHeader`·`chat/MessageBubble`·`artifact/AgentDashboard`·`sidebar/SessionList`·`sidebar/SessionItem`·`sidebar/NewChatButton`（改接线）。

**删除：** `components/layout/AppShell.tsx`、`components/layout/SessionTabs.tsx`、`components/session/`（4 文件）、`store/sessionStore.ts`、`hooks/useSession.ts`、`hooks/useWebSocket.ts`、`hooks/useSimulatedStream.ts`。

**保留不动：** `ipc/ws-client.ts`（`WsTransport` 的底层线缆）、`mock/types.ts`（降级为 mock 源数据的形状，仅 `src/mock/` 与 `seed.ts` 引用）、`lib/stream.ts`（`tokenize` 供 `MockTransport`）、`@hip/protocol`、`src-tauri/`。

---

## Task A1: `Transport` 接口

**Files:**
- Create: `src/domain/transport.ts`

纯类型文件，无运行时逻辑，无需测试。

- [ ] **Step 1: 创建接口文件**

```ts
// src/domain/transport.ts
import type { ClientMessage, ServerMessage } from '@hip/protocol'

/** mock 与真后端共用的可替换缝。facade 只依赖这个接口。 */
export interface Transport {
  connect(): Promise<void>
  disconnect(): void
  send(msg: ClientMessage): void
  /** 注册入站 ServerMessage 处理器；返回取消订阅函数。 */
  onMessage(handler: (msg: ServerMessage) => void): () => void
}
```

- [ ] **Step 2: 类型检查**

Run: `yarn type-check`
Expected: PASS（无新错误；此文件仅被后续任务引用）

- [ ] **Step 3: 提交**

```bash
git add src/domain/transport.ts
git commit -m "feat(domain): add Transport interface (mock/live seam)"
```

---

## Task A2: domain 类型 + 纯 reducer

**Files:**
- Create: `src/domain/sessionStore.ts`（本任务先写 types + `applyServerMessage` + helpers）
- Test: `src/domain/sessionStore.test.ts`

domain 状态的核心：把 `ServerMessage` 归并成新状态的纯函数（注入 `now` 保证可测）。

- [ ] **Step 1: 写失败测试（reducer）**

```ts
// src/domain/sessionStore.test.ts
import { describe, it, expect } from 'vitest'
import { applyServerMessage, type SessionVM } from './sessionStore'

function baseSession(over: Partial<SessionVM> = {}): SessionVM {
  return {
    id: 's1',
    config: { llmProvider: 'anthropic', model: 'm', tools: [] },
    title: 'T',
    preview: 'P',
    updatedAt: 'now',
    messages: [],
    agents: [],
    status: 'idle',
    ...over,
  }
}

describe('applyServerMessage', () => {
  it('agent:started adds a running agent with derived title and startedAt', () => {
    const next = applyServerMessage(
      { sessions: [baseSession()] },
      { type: 'agent:started', sessionId: 's1', agentId: 'a1', role: 'planner' },
      1000,
    )
    const a = next.sessions[0].agents[0]
    expect(a).toMatchObject({ id: 'a1', role: 'planner', title: 'Planner', status: 'running', startedAt: 1000 })
    expect(next.sessions[0].status).toBe('running')
  })

  it('token:stream accumulates agent tokens and tokenCount', () => {
    const s0 = { sessions: [baseSession({ agents: [{ id: 'a1', role: 'planner', title: 'Planner', status: 'running', tokens: '', tokenCount: 0, elapsedMs: 0, startedAt: 0 }] })] }
    const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'a1', delta: 'abc' }, 0)
    expect(next.sessions[0].agents[0].tokens).toBe('abc')
    expect(next.sessions[0].agents[0].tokenCount).toBe(3)
  })

  it('token:stream from a supervisor also streams into a new assistant message', () => {
    const s0 = { sessions: [baseSession({ agents: [{ id: 'a0', role: 'supervisor', title: 'Supervisor', status: 'running', tokens: '', tokenCount: 0, elapsedMs: 0, startedAt: 0 }], messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }] })] }
    const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'a0', delta: 'Hel' }, 5)
    const msgs = next.sessions[0].messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: 'Hel' })
  })

  it('supervisor token appends to the existing streaming assistant message', () => {
    const s0 = { sessions: [baseSession({ agents: [{ id: 'a0', role: 'supervisor', title: 'Supervisor', status: 'running', tokens: 'Hel', tokenCount: 3, elapsedMs: 0, startedAt: 0 }], messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 'asst', role: 'assistant', content: 'Hel', timestamp: 5 }] })] }
    const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'a0', delta: 'lo' }, 6)
    expect(next.sessions[0].messages).toHaveLength(2)
    expect(next.sessions[0].messages[1].content).toBe('Hello')
  })

  it('agent:finished marks done and materializes elapsedMs', () => {
    const s0 = { sessions: [baseSession({ agents: [{ id: 'a1', role: 'planner', title: 'Planner', status: 'running', tokens: 'x', tokenCount: 1, elapsedMs: 0, startedAt: 1000 }] })] }
    const next = applyServerMessage(s0, { type: 'agent:finished', sessionId: 's1', agentId: 'a1' }, 3400)
    expect(next.sessions[0].agents[0]).toMatchObject({ status: 'done', elapsedMs: 2400 })
  })

  it('message:complete replaces the streaming assistant message', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 'asst', role: 'assistant', content: 'partial', timestamp: 5 }] })] }
    const final = { id: 'final', role: 'assistant' as const, content: 'full reply', timestamp: 9 }
    const next = applyServerMessage(s0, { type: 'message:complete', sessionId: 's1', message: final }, 9)
    expect(next.sessions[0].messages).toHaveLength(2)
    expect(next.sessions[0].messages[1]).toEqual(final)
    expect(next.sessions[0].status).toBe('idle')
  })

  it('ignores events for unknown sessions', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'agent:finished', sessionId: 'nope', agentId: 'a1' }, 0)
    expect(next.sessions[0].agents).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn vitest run src/domain/sessionStore.test.ts`
Expected: FAIL（`applyServerMessage` / `SessionVM` 未定义）

- [ ] **Step 3: 实现 types + reducer + helpers**

```ts
// src/domain/sessionStore.ts
import type { AgentRole, Message, ServerMessage, SessionConfig } from '@hip/protocol'

export type AgentStatus = 'idle' | 'running' | 'done'

export interface AgentVM {
  id: string
  role: AgentRole
  title: string        // 派生自 role
  status: AgentStatus
  tokens: string
  tokenCount: number   // 物化：tokens.length
  elapsedMs: number    // 物化：finishedAt - startedAt
  startedAt: number    // 内部：agent:started 时的 now（不渲染）
}

export interface SessionVM {
  id: string
  config: SessionConfig
  title: string        // 展示字符串（seed 或 '新对话'，不派生）
  preview: string      // 展示字符串
  updatedAt: string    // 展示字符串（'2m ago' / 'now'）
  messages: Message[]
  agents: AgentVM[]
  status: 'idle' | 'running' | 'error'
}

const ROLE_TITLE: Record<AgentRole, string> = {
  supervisor: 'Supervisor',
  planner: 'Planner',
  coder: 'Coder',
  reviewer: 'Reviewer',
}

function upsertAgent(agents: AgentVM[], agent: AgentVM): AgentVM[] {
  return agents.some((a) => a.id === agent.id)
    ? agents.map((a) => (a.id === agent.id ? agent : a))
    : [...agents, agent]
}

function appendAssistantDelta(messages: Message[], delta: string, agentId: string, now: number): Message[] {
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant') {
    return [...messages.slice(0, -1), { ...last, content: last.content + delta }]
  }
  return [...messages, { id: `asst-${agentId}-${now}`, role: 'assistant', content: delta, agentId, timestamp: now }]
}

function finalizeAssistant(messages: Message[], message: Message): Message[] {
  const last = messages[messages.length - 1]
  return last && last.role === 'assistant' ? [...messages.slice(0, -1), message] : [...messages, message]
}

/** 把一条 ServerMessage 归并进状态。纯函数：now 由调用方注入。 */
export function applyServerMessage(
  state: { sessions: SessionVM[] },
  msg: ServerMessage,
  now: number,
): { sessions: SessionVM[] } {
  const update = (sessionId: string, fn: (s: SessionVM) => SessionVM): { sessions: SessionVM[] } => {
    if (!state.sessions.some((s) => s.id === sessionId)) return state
    return { sessions: state.sessions.map((s) => (s.id === sessionId ? fn(s) : s)) }
  }

  switch (msg.type) {
    case 'session:created':
      if (state.sessions.some((s) => s.id === msg.sessionId)) return state
      return { sessions: [...state.sessions, emptySession(msg.sessionId)] }

    case 'agent:started':
      return update(msg.sessionId, (s) => ({
        ...s,
        status: 'running',
        agents: upsertAgent(s.agents, {
          id: msg.agentId,
          role: msg.role,
          title: ROLE_TITLE[msg.role],
          status: 'running',
          tokens: '',
          tokenCount: 0,
          elapsedMs: 0,
          startedAt: now,
        }),
      }))

    case 'token:stream':
      return update(msg.sessionId, (s) => {
        const agent = s.agents.find((a) => a.id === msg.agentId)
        const agents = s.agents.map((a) =>
          a.id === msg.agentId ? { ...a, tokens: a.tokens + msg.delta, tokenCount: a.tokens.length + msg.delta.length } : a,
        )
        const messages =
          agent?.role === 'supervisor' ? appendAssistantDelta(s.messages, msg.delta, msg.agentId, now) : s.messages
        return { ...s, agents, messages }
      })

    case 'agent:finished':
      return update(msg.sessionId, (s) => ({
        ...s,
        agents: s.agents.map((a) => (a.id === msg.agentId ? { ...a, status: 'done', elapsedMs: now - a.startedAt } : a)),
      }))

    case 'message:complete':
      return update(msg.sessionId, (s) => ({ ...s, status: 'idle', messages: finalizeAssistant(s.messages, msg.message) }))

    case 'error':
      return msg.sessionId ? update(msg.sessionId, (s) => ({ ...s, status: 'error' })) : state

    default:
      return state
  }
}

export const DEFAULT_CONFIG: SessionConfig = { llmProvider: 'anthropic', model: 'claude-opus-4-8', tools: [] }

export function emptySession(id: string): SessionVM {
  return { id, config: DEFAULT_CONFIG, title: '新对话', preview: '开始一段新的对话…', updatedAt: 'now', messages: [], agents: [], status: 'idle' }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn vitest run src/domain/sessionStore.test.ts`
Expected: PASS（8 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "feat(domain): protocol-shaped VM types + applyServerMessage reducer"
```

---

## Task A3: domain store + actions

**Files:**
- Modify: `src/domain/sessionStore.ts`（追加 Zustand store）
- Modify: `src/domain/sessionStore.test.ts`（追加 store 测试）

> 注：`seedSessions` 在 Task A4 创建。本任务 store 的初始 `sessions` 先用空数组占位，A4 完成后改为 `seedSessions()`（A4 Step 5 完成该接线）。

- [ ] **Step 1: 写失败测试（store actions）**

在 `src/domain/sessionStore.test.ts` 末尾追加：

```ts
import { useDomainStore } from './sessionStore'

function reset() {
  useDomainStore.setState({ sessions: [], activeSessionId: null, connection: 'disconnected' }, true)
}

describe('useDomainStore actions', () => {
  it('createSession prepends and activates', () => {
    reset()
    const id = useDomainStore.getState().createSession('s-new', { llmProvider: 'anthropic', model: 'm', tools: [] })
    expect(useDomainStore.getState().sessions[0].id).toBe(id)
    expect(useDomainStore.getState().activeSessionId).toBe(id)
  })

  it('appendUserMessage adds a user message to the session', () => {
    reset()
    useDomainStore.getState().createSession('s1', { llmProvider: 'anthropic', model: 'm', tools: [] })
    useDomainStore.getState().appendUserMessage('s1', 'hello')
    const msgs = useDomainStore.getState().sessions.find((s) => s.id === 's1')!.messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'hello' })
  })

  it('deleteSession removes and reassigns active', () => {
    reset()
    useDomainStore.getState().createSession('s1', { llmProvider: 'anthropic', model: 'm', tools: [] })
    useDomainStore.getState().createSession('s2', { llmProvider: 'anthropic', model: 'm', tools: [] })
    useDomainStore.getState().deleteSession('s2')
    expect(useDomainStore.getState().sessions.map((s) => s.id)).toEqual(['s1'])
    expect(useDomainStore.getState().activeSessionId).toBe('s1')
  })

  it('apply routes a ServerMessage through the reducer', () => {
    reset()
    useDomainStore.getState().createSession('s1', { llmProvider: 'anthropic', model: 'm', tools: [] })
    useDomainStore.getState().apply({ type: 'agent:started', sessionId: 's1', agentId: 'a1', role: 'coder' })
    expect(useDomainStore.getState().sessions[0].agents[0].title).toBe('Coder')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn vitest run src/domain/sessionStore.test.ts`
Expected: FAIL（`useDomainStore` 未定义）

- [ ] **Step 3: 实现 store**

在 `src/domain/sessionStore.ts` 末尾追加（先用空初始 `sessions`，A4 再接 seed）：

```ts
import { create } from 'zustand'

export type Connection = 'connecting' | 'connected' | 'error' | 'disconnected'

interface DomainStore {
  sessions: SessionVM[]
  activeSessionId: string | null
  connection: Connection

  apply: (msg: ServerMessage) => void
  createSession: (id: string, config: SessionConfig) => string
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  appendUserMessage: (sessionId: string, content: string) => void
  setConnection: (c: Connection) => void
}

let userSeq = 0

export const useDomainStore = create<DomainStore>((set) => ({
  sessions: [], // ← Task A4 改为 seedSessions()
  activeSessionId: null, // ← Task A4 改为 seed 的首个会话 id
  connection: 'disconnected',

  apply: (msg) => set((s) => applyServerMessage(s, msg, Date.now())),

  createSession: (id, config) => {
    set((s) => ({ sessions: [{ ...emptySession(id), config }, ...s.sessions], activeSessionId: id }))
    return id
  },

  selectSession: (id) => set({ activeSessionId: id }),

  deleteSession: (id) =>
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id)
      const activeSessionId = s.activeSessionId === id ? (sessions[0]?.id ?? null) : s.activeSessionId
      return { sessions, activeSessionId }
    }),

  appendUserMessage: (sessionId, content) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : { ...sess, messages: [...sess.messages, { id: `u-${(userSeq += 1)}`, role: 'user' as const, content, timestamp: userSeq }] },
      ),
    })),

  setConnection: (connection) => set({ connection }),
}))
```

> 注：`apply` 的 `ServerMessage` 类型已由 Task A2 文件顶部的 `import type { … ServerMessage … } from '@hip/protocol'` 提供，无需额外 import。`create` 来自上面新增的 `import { create } from 'zustand'`。

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn vitest run src/domain/sessionStore.test.ts`
Expected: PASS（reducer + store 全绿）

- [ ] **Step 5: 提交**

```bash
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "feat(domain): zustand domain store with actions + apply()"
```

---

## Task A4: seed（初始会话列表）

**Files:**
- Create: `src/domain/seed.ts`
- Test: `src/domain/seed.test.ts`
- Modify: `src/domain/sessionStore.ts`（store 初始 state 接 seed）

把 `mock/sessions` + `mock/messages` + `mock/agents` 转成初始 `SessionVM[]`，**保留 title/preview/updatedAt 字符串**以维持侧栏 parity。

- [ ] **Step 1: 写失败测试**

```ts
// src/domain/seed.test.ts
import { describe, it, expect } from 'vitest'
import { seedSessions } from './seed'

describe('seedSessions', () => {
  it('produces all 8 mock sessions preserving display strings', () => {
    const sessions = seedSessions()
    expect(sessions).toHaveLength(8)
    expect(sessions[0]).toMatchObject({ id: 's1', title: '重构 WebSocket 客户端', updatedAt: '2m ago' })
    expect(typeof sessions[0].preview).toBe('string')
  })

  it('seeds the first session with its message history and agents', () => {
    const s1 = seedSessions()[0]
    expect(s1.messages.length).toBeGreaterThan(0)
    expect(s1.messages[0]).toMatchObject({ role: 'user' })
    expect(s1.agents.map((a) => a.role)).toEqual(['supervisor', 'planner', 'coder', 'reviewer'])
  })

  it('leaves non-first sessions empty', () => {
    const s2 = seedSessions()[1]
    expect(s2.messages).toHaveLength(0)
    expect(s2.agents).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn vitest run src/domain/seed.test.ts`
Expected: FAIL（`seedSessions` 未定义）

- [ ] **Step 3: 实现 seed**

```ts
// src/domain/seed.ts
import type { Message } from '@hip/protocol'
import { mockSessions } from '@/mock/sessions'
import { mockMessages } from '@/mock/messages'
import { mockAgents } from '@/mock/agents'
import { DEFAULT_CONFIG, type AgentVM, type SessionVM } from './sessionStore'

function seedMessages(): Message[] {
  return mockMessages.map((m, i) => ({ id: m.id, role: m.role, content: m.content, timestamp: i }))
}

function seedAgentsVM(): AgentVM[] {
  // 初始 seed 卡片保留手写 tokenCount/elapsedMs（store 内存量数据，见 parity 注记）
  return mockAgents.map((a) => ({
    id: a.id,
    role: a.role,
    title: a.title,
    status: 'done',
    tokens: a.tokens,
    tokenCount: a.tokenCount,
    elapsedMs: a.elapsedMs,
    startedAt: 0,
  }))
}

export function seedSessions(): SessionVM[] {
  return mockSessions.map((s, i) => ({
    id: s.id,
    config: DEFAULT_CONFIG,
    title: s.title,
    preview: s.preview,
    updatedAt: s.updatedAt,
    messages: i === 0 ? seedMessages() : [],
    agents: i === 0 ? seedAgentsVM() : [],
    status: 'idle',
  }))
}

export { DEFAULT_CONFIG }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn vitest run src/domain/seed.test.ts`
Expected: PASS

- [ ] **Step 5: store 接 seed**

修改 `src/domain/sessionStore.ts` 的 store 初始 state（Task A3 的占位处）：

把
```ts
  sessions: [], // ← Task A4 改为 seedSessions()
  activeSessionId: null, // ← Task A4 改为 seed 的首个会话 id
```
改为
```ts
  sessions: seedSessions(),
  activeSessionId: 's1',
```

并在 `sessionStore.ts` 顶部 import 区加入：
```ts
import { seedSessions } from './seed'
```

> 循环依赖检查：`seed.ts` 只 import `sessionStore.ts` 的**类型**（`AgentVM`/`SessionVM`/`DEFAULT_CONFIG`），`sessionStore.ts` import `seed.ts` 的 `seedSessions`。`DEFAULT_CONFIG`/`emptySession` 在文件前半定义，`seedSessions()` 在模块求值时调用——因 `seedSessions` 是函数、延迟到 store 工厂执行时才调用，ESM 下安全。

- [ ] **Step 6: 运行全部 domain 测试确认通过**

Run: `yarn vitest run src/domain`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/domain/seed.ts src/domain/seed.test.ts src/domain/sessionStore.ts
git commit -m "feat(domain): seed initial session list from mock fixtures"
```

---

## Task A5: MockTransport

**Files:**
- Create: `src/domain/mockTransport.ts`
- Test: `src/domain/mockTransport.test.ts`

`connect()` no-op（会话已 seed 进 store）；收到 `message:send` 时用计时器发出 agent 时间线 + supervisor token 流（即助手回复）+ `message:complete`。

- [ ] **Step 1: 写失败测试（用假计时器断言事件序列）**

```ts
// src/domain/mockTransport.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ServerMessage } from '@hip/protocol'
import { MockTransport } from './mockTransport'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function collect(): { events: ServerMessage[]; transport: MockTransport } {
  const events: ServerMessage[] = []
  const transport = new MockTransport()
  transport.onMessage((m) => events.push(m))
  return { events, transport }
}

describe('MockTransport', () => {
  it('emits supervisor start immediately on message:send', () => {
    const { events, transport } = collect()
    transport.send({ type: 'message:send', sessionId: 's1', content: 'hi', role: 'user' })
    expect(events[0]).toEqual({ type: 'agent:started', sessionId: 's1', agentId: 'a0', role: 'supervisor' })
  })

  it('starts all four agents and finishes them, ending with message:complete', () => {
    const { events, transport } = collect()
    transport.send({ type: 'message:send', sessionId: 's1', content: 'hi', role: 'user' })
    vi.advanceTimersByTime(10_000)

    const started = events.filter((e) => e.type === 'agent:started').map((e) => (e as any).role)
    expect(new Set(started)).toEqual(new Set(['supervisor', 'planner', 'coder', 'reviewer']))

    const finished = events.filter((e) => e.type === 'agent:finished').map((e) => (e as any).agentId)
    expect(new Set(finished)).toEqual(new Set(['a0', 'a1', 'a2', 'a3']))

    const last = events[events.length - 1]
    expect(last.type).toBe('message:complete')
    expect((last as any).message.role).toBe('assistant')
    expect((last as any).message.content.length).toBeGreaterThan(0)
  })

  it('streams the assistant reply as supervisor (a0) tokens', () => {
    const { events, transport } = collect()
    transport.send({ type: 'message:send', sessionId: 's1', content: 'hi', role: 'user' })
    vi.advanceTimersByTime(10_000)
    const a0Tokens = events.filter((e) => e.type === 'token:stream' && (e as any).agentId === 'a0')
    expect(a0Tokens.length).toBeGreaterThan(5)
  })

  it('disconnect cancels pending timers (no late emissions)', () => {
    const { events, transport } = collect()
    transport.send({ type: 'message:send', sessionId: 's1', content: 'hi', role: 'user' })
    const countAfterStart = events.length
    transport.disconnect()
    vi.advanceTimersByTime(10_000)
    expect(events.length).toBe(countAfterStart)
  })

  it('ignores non-message:send client messages', () => {
    const { events, transport } = collect()
    transport.send({ type: 'session:destroy', sessionId: 's1' })
    vi.advanceTimersByTime(10_000)
    expect(events).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn vitest run src/domain/mockTransport.test.ts`
Expected: FAIL（`MockTransport` 未定义）

- [ ] **Step 3: 实现 MockTransport**

```ts
// src/domain/mockTransport.ts
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { tokenize } from '@/lib/stream'
import { CANNED_REPLY } from '@/mock/messages'
import type { Transport } from './transport'

let replySeq = 0

export class MockTransport implements Transport {
  private readonly handlers = new Set<(m: ServerMessage) => void>()
  private timers: ReturnType<typeof setTimeout>[] = []

  async connect(): Promise<void> {
    // 会话列表已 seed 进 domain store；mock 无需回放历史。
  }

  disconnect(): void {
    this.timers.forEach((t) => clearTimeout(t))
    this.timers = []
  }

  onMessage(handler: (m: ServerMessage) => void): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  send(msg: ClientMessage): void {
    if (msg.type === 'message:send') this.runTimeline(msg.sessionId)
    // session:create / session:destroy / message:cancel 对 mock 无副作用
  }

  private emit(m: ServerMessage): void {
    this.handlers.forEach((h) => h(m))
  }

  private at(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms))
  }

  private runTimeline(sessionId: string): void {
    this.timers.forEach((t) => clearTimeout(t))
    this.timers = []

    // t0：supervisor 立即开始
    this.emit({ type: 'agent:started', sessionId, agentId: 'a0', role: 'supervisor' })

    this.at(300, () => {
      this.emit({ type: 'agent:started', sessionId, agentId: 'a1', role: 'planner' })
      this.emit({ type: 'token:stream', sessionId, agentId: 'a1', delta: '拆解任务边界：3 个子模块。' })
    })
    this.at(600, () => {
      this.emit({ type: 'agent:started', sessionId, agentId: 'a2', role: 'coder' })
      this.emit({ type: 'token:stream', sessionId, agentId: 'a2', delta: '生成实现代码与组合层。' })
    })
    this.at(900, () => {
      this.emit({ type: 'agent:started', sessionId, agentId: 'a3', role: 'reviewer' })
      this.emit({ type: 'token:stream', sessionId, agentId: 'a3', delta: '审查边界条件与正确性。' })
    })

    // 助手回复作为 supervisor(a0) token 流（聊天区据此逐字流式）
    const chunks = tokenize(CANNED_REPLY, 2)
    chunks.forEach((chunk, i) => {
      this.at(1000 + i * 28, () => this.emit({ type: 'token:stream', sessionId, agentId: 'a0', delta: chunk }))
    })

    this.at(2000, () => this.emit({ type: 'agent:finished', sessionId, agentId: 'a1' }))
    this.at(2400, () => this.emit({ type: 'agent:finished', sessionId, agentId: 'a3' }))

    const total = 1000 + chunks.length * 28
    this.at(total + 100, () => this.emit({ type: 'agent:finished', sessionId, agentId: 'a0' }))
    this.at(total + 200, () => {
      this.emit({ type: 'agent:finished', sessionId, agentId: 'a2' })
      this.emit({
        type: 'message:complete',
        sessionId,
        message: { id: `a-${(replySeq += 1)}`, role: 'assistant', content: CANNED_REPLY, agentId: 'a0', timestamp: replySeq },
      })
    })
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn vitest run src/domain/mockTransport.test.ts`
Expected: PASS（5 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/domain/mockTransport.ts src/domain/mockTransport.test.ts
git commit -m "feat(domain): MockTransport emits protocol events on message:send"
```

---

## Task A6: sessionService（facade）

**Files:**
- Create: `src/domain/sessionService.ts`
- Test: `src/domain/sessionService.test.ts`

facade 把 transport 入站事件灌进 store，并对外暴露高层 action。导出 `class` 供测试注入 fake transport，导出单例供 app 使用。

- [ ] **Step 1: 写失败测试（注入 fake transport）**

```ts
// src/domain/sessionService.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { SessionService } from './sessionService'
import { useDomainStore } from './sessionStore'
import type { Transport } from './transport'

class FakeTransport implements Transport {
  sent: ClientMessage[] = []
  private handler: ((m: ServerMessage) => void) | null = null
  async connect() {}
  disconnect() {}
  send(msg: ClientMessage) { this.sent.push(msg) }
  onMessage(h: (m: ServerMessage) => void) { this.handler = h; return () => { this.handler = null } }
  push(m: ServerMessage) { this.handler?.(m) }
}

beforeEach(() => {
  useDomainStore.setState({ sessions: [{ id: 's1', config: { llmProvider: 'anthropic', model: 'm', tools: [] }, title: 'T', preview: 'P', updatedAt: 'now', messages: [], agents: [], status: 'idle' }], activeSessionId: 's1', connection: 'disconnected' }, true)
})

describe('SessionService', () => {
  it('sendMessage optimistically appends user message and sends message:send', () => {
    const t = new FakeTransport()
    const svc = new SessionService(t)
    svc.sendMessage('  hello  ')
    expect(useDomainStore.getState().sessions[0].messages.at(-1)).toMatchObject({ role: 'user', content: 'hello' })
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', sessionId: 's1', content: 'hello' })
  })

  it('sendMessage ignores blank input', () => {
    const t = new FakeTransport()
    new SessionService(t).sendMessage('   ')
    expect(t.sent).toHaveLength(0)
  })

  it('inbound ServerMessage flows into the store', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'agent:started', sessionId: 's1', agentId: 'a1', role: 'planner' })
    expect(useDomainStore.getState().sessions[0].agents[0].title).toBe('Planner')
  })

  it('createSession sends session:create and activates', () => {
    const t = new FakeTransport()
    const id = new SessionService(t).createSession()
    expect(useDomainStore.getState().activeSessionId).toBe(id)
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:create', id })
  })

  it('connect updates connection status', async () => {
    const t = new FakeTransport()
    await new SessionService(t).connect()
    expect(useDomainStore.getState().connection).toBe('connected')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `yarn vitest run src/domain/sessionService.test.ts`
Expected: FAIL（`SessionService` 未定义）

- [ ] **Step 3: 实现 facade**

```ts
// src/domain/sessionService.ts
import type { ServerMessage, SessionConfig } from '@hip/protocol'
import type { Transport } from './transport'
import { MockTransport } from './mockTransport'
import { useDomainStore, DEFAULT_CONFIG } from './sessionStore'

let sessionSeq = 0

export class SessionService {
  private readonly transport: Transport

  constructor(transport: Transport) {
    this.transport = transport
    this.transport.onMessage((msg: ServerMessage) => this.receive(msg))
  }

  async connect(): Promise<void> {
    const store = useDomainStore.getState()
    store.setConnection('connecting')
    try {
      await this.transport.connect()
      store.setConnection('connected')
    } catch {
      store.setConnection('error')
    }
  }

  private receive(msg: ServerMessage): void {
    useDomainStore.getState().apply(msg)
  }

  createSession(config: SessionConfig = DEFAULT_CONFIG): string {
    const id = `s-new-${(sessionSeq += 1)}`
    useDomainStore.getState().createSession(id, config)
    this.transport.send({ type: 'session:create', id, config })
    return id
  }

  selectSession(id: string): void {
    useDomainStore.getState().selectSession(id)
  }

  deleteSession(id: string): void {
    useDomainStore.getState().deleteSession(id)
    this.transport.send({ type: 'session:destroy', sessionId: id })
  }

  sendMessage(content: string): void {
    const text = content.trim()
    if (!text) return
    const { activeSessionId, appendUserMessage } = useDomainStore.getState()
    if (!activeSessionId) return
    appendUserMessage(activeSessionId, text)
    this.transport.send({ type: 'message:send', sessionId: activeSessionId, content: text, role: 'user' })
  }

  cancel(): void {
    const { activeSessionId } = useDomainStore.getState()
    if (activeSessionId) this.transport.send({ type: 'message:cancel', sessionId: activeSessionId })
  }
}

/** App 单例：默认接 MockTransport。切 live = 改成 `new WsTransport()`。 */
export const sessionService = new SessionService(new MockTransport())
```

- [ ] **Step 4: 运行测试确认通过**

Run: `yarn vitest run src/domain/sessionService.test.ts`
Expected: PASS（5 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/domain/sessionService.ts src/domain/sessionService.test.ts
git commit -m "feat(domain): sessionService facade wiring transport <-> store"
```

---

## Task A7: domain hooks + barrel

**Files:**
- Create: `src/domain/hooks.ts`
- Create: `src/domain/index.ts`

React 读领域状态的薄封装。**严守 AGENTS.md selector 纪律**：每个 hook 只返回 primitive 或 store 内已存在的引用，绝不在 selector 里构造新对象/数组。vitest 为 node 环境、无 RTL，故 hooks 由 `type-check` + 应用运行验证，不写单测。

- [ ] **Step 1: 实现 hooks**

```ts
// src/domain/hooks.ts
import type { Message } from '@hip/protocol'
import { useDomainStore, type AgentVM, type SessionVM } from './sessionStore'

const EMPTY_MESSAGES: Message[] = []
const EMPTY_AGENTS: AgentVM[] = []

export function useSessions(): SessionVM[] {
  return useDomainStore((s) => s.sessions)
}

export function useActiveSessionId(): string | null {
  return useDomainStore((s) => s.activeSessionId)
}

export function useActiveSession(): SessionVM | null {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId) ?? null)
}

export function useActiveMessages(): Message[] {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.messages ?? EMPTY_MESSAGES)
}

export function useAgents(): AgentVM[] {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.agents ?? EMPTY_AGENTS)
}

export function useConnectionStatus(): string {
  return useDomainStore((s) => s.connection)
}
```

> 为什么安全：`find(...)` 返回的是 `s.sessions` 里**已存在**的对象引用，仅当该会话被不可变更新时才换新引用（此时本就该重渲染）；`?? EMPTY_*` 用模块级常量，不构造新数组。无单个 selector 返回新对象 → 不触发 React #185。

- [ ] **Step 2: barrel 导出**

```ts
// src/domain/index.ts
export { sessionService } from './sessionService'
export { useSessions, useActiveSessionId, useActiveSession, useActiveMessages, useAgents, useConnectionStatus } from './hooks'
export type { SessionVM, AgentVM, AgentStatus } from './sessionStore'
```

- [ ] **Step 3: 类型检查**

Run: `yarn type-check`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/domain/hooks.ts src/domain/index.ts
git commit -m "feat(domain): React hooks + barrel (selector-discipline safe)"
```

---

## Task A8: WsTransport（建好就位，本次不启用）

**Files:**
- Create: `src/domain/wsTransport.ts`

吸收旧 `hooks/useWebSocket.ts` 的端口发现，包 `ipc/ws-client`。需 Tauri 运行时，故只做 `type-check`，不写单测。本次**不**接入单例（单例仍是 `MockTransport`）。

- [ ] **Step 1: 实现 WsTransport**

```ts
// src/domain/wsTransport.ts
import { invoke } from '@tauri-apps/api/core'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { wsClient } from '@/ipc/ws-client'
import type { Transport } from './transport'

async function getSidecarPort(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const port = await invoke<number | null>('get_sidecar_port')
    if (port !== null) return port
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('sidecar port not available after 10 s')
}

/** 真后端缝。日后把 sessionService 单例从 MockTransport 换成它即可。 */
export class WsTransport implements Transport {
  async connect(): Promise<void> {
    const port = await getSidecarPort()
    await wsClient.connect(port)
  }
  disconnect(): void {
    wsClient.disconnect()
  }
  send(msg: ClientMessage): void {
    wsClient.send(msg)
  }
  onMessage(handler: (m: ServerMessage) => void): () => void {
    return wsClient.onMessage(handler)
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `yarn type-check`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/domain/wsTransport.ts
git commit -m "feat(domain): WsTransport (ready for live swap, not yet wired)"
```

---

## Task B: 接线 chat 面 + 启动连接

**Files:**
- Modify: `src/components/chat/InputBar.tsx`
- Modify: `src/components/chat/ChatPane.tsx`
- Modify: `src/components/chat/ChatHeader.tsx`
- Modify: `src/components/chat/MessageBubble.tsx`
- Modify: `src/routes/AppLayout.tsx`

无单测（无 RTL）；以 `type-check` + 手动 parity 验证。

- [ ] **Step 1: InputBar → facade**

把 `src/components/chat/InputBar.tsx` 顶部
```ts
import { useSimulatedStream } from '@/hooks/useSimulatedStream'
```
改为
```ts
import { sessionService } from '@/domain'
```
把
```ts
  const { send } = useSimulatedStream()

  function submit() {
    const text = value.trim()
    if (!text) return
    send(text)
    setValue('')
  }
```
改为
```ts
  function submit() {
    const text = value.trim()
    if (!text) return
    sessionService.sendMessage(text)
    setValue('')
  }
```

- [ ] **Step 2: ChatPane → useActiveMessages**

把 `src/components/chat/ChatPane.tsx` 顶部
```ts
import { useUiStore } from '@/store/uiStore'
import { MessageBubble } from './MessageBubble'

const EMPTY: never[] = []

export function ChatPane() {
  const activeSessionId = useUiStore((s) => s.activeSessionId)
  const messages = useUiStore((s) => s.messagesBySession[activeSessionId] ?? EMPTY)
```
改为
```ts
import { useActiveSessionId, useActiveMessages } from '@/domain'
import { MessageBubble } from './MessageBubble'

export function ChatPane() {
  const activeSessionId = useActiveSessionId()
  const messages = useActiveMessages()
```
（`bottomRef`、`useEffect`、渲染体保持不变；`key` 里的 `activeSessionId` 现在可能为 `null`，模板字符串会渲染成 `"null-..."`，无碍。）

- [ ] **Step 3: ChatHeader → useActiveSession**

把 `src/components/chat/ChatHeader.tsx`：
```ts
import { useUiStore } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'

export function ChatHeader() {
  const sessions = useUiStore((s) => s.sessions)
  const activeSessionId = useUiStore((s) => s.activeSessionId)
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed)
  const togglePanel = useUiStore((s) => s.togglePanel)

  const active = sessions.find((s) => s.id === activeSessionId)
```
改为
```ts
import { useUiStore } from '@/store/uiStore'
import { useActiveSession } from '@/domain'
import { Button } from '@/components/ui/Button'

export function ChatHeader() {
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed)
  const togglePanel = useUiStore((s) => s.togglePanel)
  const active = useActiveSession()
```
（`active?.title ?? '对话'` 一行不变。）

- [ ] **Step 4: MessageBubble → protocol Message**

把 `src/components/chat/MessageBubble.tsx`：
```ts
import type { MockMessage } from '@/mock/types'
```
改为
```ts
import type { Message } from '@hip/protocol'
```
把
```ts
interface MessageBubbleProps {
  message: MockMessage
  streaming?: boolean
}
```
改为
```ts
interface MessageBubbleProps {
  message: Message
  streaming?: boolean
}
```
（其余使用 `message.role` / `message.content`，protocol `Message` 兼容，不变。）

- [ ] **Step 5: AppLayout 挂载时连接**

在 `src/routes/AppLayout.tsx` 的 import 区加：
```ts
import { sessionService } from '@/domain'
```
在组件体内、`return` 前加一个挂载副作用（与现有 `useEffect` 并列）：
```ts
  useEffect(() => {
    sessionService.connect()
  }, [])
```
（`useEffect` 已在文件顶部 import。）

- [ ] **Step 6: 类型检查**

Run: `yarn type-check`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/components/chat/InputBar.tsx src/components/chat/ChatPane.tsx src/components/chat/ChatHeader.tsx src/components/chat/MessageBubble.tsx src/routes/AppLayout.tsx
git commit -m "refactor(chat): read from domain layer; connect on mount"
```

---

## Task C: 接线 sidebar 面

**Files:**
- Modify: `src/lib/sessions.ts`
- Modify: `src/components/sidebar/SessionList.tsx`
- Modify: `src/components/sidebar/SessionItem.tsx`
- Modify: `src/components/sidebar/NewChatButton.tsx`
- Modify: `src/lib/sessions.test.ts`（若引用 `MockSession` 需改类型 import）

- [ ] **Step 1: filterSessions 泛型化**

把 `src/lib/sessions.ts` 整文件替换为：
```ts
// 仅依赖 title/preview 两个展示字段，对 MockSession / SessionVM 通用
export function filterSessions<T extends { title: string; preview: string }>(sessions: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return sessions
  return sessions.filter((s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q))
}
```

- [ ] **Step 2: 确认 sessions 测试仍通过**

Run: `yarn vitest run src/lib/sessions.test.ts`
Expected: PASS（`filterSessions` 行为不变；若该测试文件 import 了 `MockSession` 类型，保持不动即可，泛型对 `MockSession` 兼容）

- [ ] **Step 3: SessionList → domain**

把 `src/components/sidebar/SessionList.tsx` 整文件替换为：
```ts
import { useUiStore } from '@/store/uiStore'
import { useSessions, useActiveSessionId, sessionService } from '@/domain'
import { filterSessions } from '@/lib/sessions'
import { SessionItem } from './SessionItem'

export function SessionList() {
  const sessions = useSessions()
  const search = useUiStore((s) => s.search)
  const activeSessionId = useActiveSessionId()

  const filtered = filterSessions(sessions, search)

  if (filtered.length === 0) {
    return <div className="px-2.5 py-4 text-[12px] text-ink-tertiary">没有匹配的会话</div>
  }

  return (
    <div className="flex flex-col gap-0.5">
      {filtered.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          active={session.id === activeSessionId}
          onSelect={() => sessionService.selectSession(session.id)}
          onDelete={() => sessionService.deleteSession(session.id)}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: SessionItem → SessionVM 类型**

把 `src/components/sidebar/SessionItem.tsx`：
```ts
import type { MockSession } from '@/mock/types'
import { cn } from '@/lib/utils'

interface SessionItemProps {
  session: MockSession
```
改为
```ts
import type { SessionVM } from '@/domain'
import { cn } from '@/lib/utils'

interface SessionItemProps {
  session: SessionVM
```
（渲染 `session.title` / `session.preview` / `session.updatedAt` 均为 string，不变。）

- [ ] **Step 5: NewChatButton → facade**

把 `src/components/sidebar/NewChatButton.tsx` 整文件替换为：
```ts
import { Plus } from 'lucide-react'
import { sessionService } from '@/domain'

export function NewChatButton() {
  return (
    <button
      onClick={() => sessionService.createSession()}
      className="flex h-9 w-full items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
      title="新对话"
    >
      <Plus size={18} />
      <span>新对话</span>
    </button>
  )
}
```

- [ ] **Step 6: 类型检查**

Run: `yarn type-check`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/lib/sessions.ts src/components/sidebar/SessionList.tsx src/components/sidebar/SessionItem.tsx src/components/sidebar/NewChatButton.tsx
git commit -m "refactor(sidebar): read sessions from domain; actions via facade"
```

---

## Task D: 接线 artifact AgentDashboard

**Files:**
- Modify: `src/components/artifact/AgentDashboard.tsx`

- [ ] **Step 1: AgentDashboard → useAgents + AgentVM**

把 `src/components/artifact/AgentDashboard.tsx` 顶部：
```ts
import type { MockAgent, Role } from '@/mock/types'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

const ROLE_COLOR: Record<Role, string> = {
```
改为
```ts
import type { AgentRole } from '@hip/protocol'
import type { AgentVM } from '@/domain'
import { useAgents } from '@/domain'
import { cn } from '@/lib/utils'

const ROLE_COLOR: Record<AgentRole, string> = {
```
把两处 `MockAgent` 类型注解改为 `AgentVM`：
```ts
function StatusDot({ status, color }: { status: MockAgent['status']; color: string }) {
```
→
```ts
function StatusDot({ status, color }: { status: AgentVM['status']; color: string }) {
```
和
```ts
function AgentCard({ agent }: { agent: MockAgent }) {
```
→
```ts
function AgentCard({ agent }: { agent: AgentVM }) {
```
把
```ts
export function AgentDashboard() {
  const agents = useUiStore((s) => s.agents)
```
改为
```ts
export function AgentDashboard() {
  const agents = useAgents()
```
（`ROLE_COLOR`、`StatusDot`、`AgentCard` 渲染体不变；`AgentVM` 同样有 `role/title/status/tokens/tokenCount/elapsedMs`。）

- [ ] **Step 2: 类型检查**

Run: `yarn type-check`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/components/artifact/AgentDashboard.tsx
git commit -m "refactor(artifact): AgentDashboard reads agents from domain"
```

---

## Task E: 瘦身 uiStore + 删除孤立件

**Files:**
- Modify: `src/store/uiStore.ts`
- Delete: `src/components/layout/AppShell.tsx`, `src/components/layout/SessionTabs.tsx`, `src/components/session/SessionView.tsx`, `src/components/session/ChatPane.tsx`, `src/components/session/InputBar.tsx`, `src/components/session/AgentTree.tsx`, `src/store/sessionStore.ts`, `src/hooks/useSession.ts`, `src/hooks/useWebSocket.ts`, `src/hooks/useSimulatedStream.ts`

- [ ] **Step 1: uiStore 瘦成纯视图状态**

把 `src/store/uiStore.ts` 整文件替换为：
```ts
import { create } from 'zustand'
import type { ArtifactTab } from '@/mock/types'

interface UiState {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  toggleCollapsed: () => void

  search: string
  setSearch: (q: string) => void

  panelOpen: boolean
  panelFullscreen: boolean
  activeTab: ArtifactTab
  setTab: (t: ArtifactTab) => void
  togglePanel: () => void
  setPanelOpen: (v: boolean) => void
  toggleFullscreen: () => void
}

export const useUiStore = create<UiState>((set) => ({
  collapsed: false,
  setCollapsed: (v) => set((s) => (s.collapsed === v ? s : { collapsed: v })),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),

  search: '',
  setSearch: (q) => set({ search: q }),

  panelOpen: true,
  panelFullscreen: false,
  activeTab: 'agents',
  setTab: (t) => set({ activeTab: t }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelOpen: (v) => set((s) => (s.panelOpen === v ? s : { panelOpen: v })),
  toggleFullscreen: () => set((s) => ({ panelFullscreen: !s.panelFullscreen })),
}))
```

- [ ] **Step 2: 删除孤立文件**

Run:
```bash
git rm src/components/layout/AppShell.tsx src/components/layout/SessionTabs.tsx \
  src/components/session/SessionView.tsx src/components/session/ChatPane.tsx \
  src/components/session/InputBar.tsx src/components/session/AgentTree.tsx \
  src/store/sessionStore.ts src/hooks/useSession.ts src/hooks/useWebSocket.ts \
  src/hooks/useSimulatedStream.ts
rmdir src/components/session src/hooks 2>/dev/null || true
```

- [ ] **Step 3: 类型检查（捕获任何遗漏引用）**

Run: `yarn type-check`
Expected: PASS。若报某处仍 import 已删模块或 `uiStore` 已删字段，按提示改到 domain 等价物（预期无残留——所有引用已在 Task B–D 迁移）。

- [ ] **Step 4: 全量单测**

Run: `yarn test`
Expected: PASS（domain 套件 + 现有 mock/lib 套件全绿）

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: slim uiStore to view-state; delete orphaned real-layer dupes"
```

---

## Task F: 全量验证

**Files:** 无（仅验证）

- [ ] **Step 1: 类型检查（含 sidecar 工作区）**

Run: `yarn type-check`
Expected: PASS

- [ ] **Step 2: 单元测试**

Run: `yarn test`
Expected: PASS

- [ ] **Step 3: 生产构建（验证无 Zustand #185 类问题的前置：构建本身通过）**

Run: `yarn build`
Expected: `tsc && vite build` 成功产出 `dist/`，无类型/构建错误。

- [ ] **Step 4: E2E（行为不变护栏）**

Run:
```bash
cargo tauri build --debug
yarn test:e2e
```
Expected: `app-launch.spec.ts` 通过（应用启动 + 页面流转与重构前一致）。

> 若 `cargo tauri build --debug` 环境不可用，至少完成 Step 1–3，并手动 `yarn tauri dev` 跑一遍 parity 检查清单（见下）。

- [ ] **Step 5: 手动 parity 检查清单**

`yarn tauri dev` 后逐项确认与重构前一致：
- [ ] 初始加载：侧栏 8 个会话（标题/预览/时间一致）；聊天区显示 s1 的历史消息；右栏「智能体」面板显示 4 张卡片
- [ ] 发送一条消息：用户气泡立即出现 → 助手回复**逐字流式** → 子 agent 卡片依次 running→done
- [ ] 新建会话 / 切换会话 / 删除会话
- [ ] 侧栏搜索过滤
- [ ] 右栏 Tab 切换（文档/文件/智能体/Diff）、全屏、关闭；侧栏折叠/展开
- [ ] （已知 delta）supervisor 卡片文本为完整回复；发送后新流式 agent 的 tokenCount/elapsed 为派生值

- [ ] **Step 6: 收尾提交（若 parity 检查触发任何小修）**

```bash
git add -A
git commit -m "test: verify domain-facade consolidation parity (type-check, unit, e2e)"
```

---

## Self-Review 覆盖核对

- **Spec §3 分层** → Task A1–A8（transport/store/seed/mockTransport/service/hooks/ws）。
- **Spec §4 模块布局**（新建/保留/删除/瘦身/改接线）→ Task A*（新建）、B–D（改接线）、E（瘦身+删除）。
- **Spec §5.1 Transport 缝** → A1 + A5 + A8；切 live 即 A6 单例一行（验收 §9）。
- **Spec §5.2 VM 视图模型** → A2（含派生 title 改为存量展示串的 parity 修正，记于上方注记）。
- **Spec §5.3 facade 单例 action** → A6；UI 直接 import 单例（B–D）。
- **Spec §5.4 Zustand 纪律** → A7（hooks 只返回存量引用/常量）。
- **Spec §6 测试** → A2/A3/A4/A5/A6 单测 + F 的 type-check/build/e2e。
- **Spec §7 风险** → #185（A7）、行为漂移（F Step 4–5 护栏）、activeSessionId 可空（A2/A3/B 的 null 防御）。
- **Spec §8 顺序** → Task A→B→C→D→E→F 与 spec 增量顺序一致。
- **Spec §9 验收** → F Step 1–5 全覆盖；"切 WsTransport = 一行" 由 A6 单例 + A8 就位保证。
