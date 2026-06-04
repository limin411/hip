# hip — Desktop AI Agent App Design

**Date:** 2026-06-05  
**Status:** Approved  
**Stack:** Tauri 2 · React 18 · TypeScript · LangGraph.js · WebSocket

---

## Overview

`hip` is a desktop application modelled after Claude Code Desktop / Codex Desktop. It hosts a single long-lived Node.js sidecar process that manages multiple LangGraph agent instances. Each UI tab maps to an independent session; within each session a Supervisor agent can spawn and coordinate sub-agents in parallel.

---

## Architecture

### Process Model

Three OS processes communicate at runtime:

| Process | Runtime | Role |
|---------|---------|------|
| **Tauri Shell** | Rust | Window management, OS APIs, sidecar lifecycle |
| **React Frontend** | WebView (WebKit/Chromium) | UI: tabs, chat, agent execution tree |
| **Sidecar** | Node.js | LangGraph agent runtime, WebSocket server |

The Tauri shell spawns the sidecar on startup via `tauri-plugin-shell`. The sidecar starts a WebSocket server on a random available port and writes the port to stdout. The Rust side captures this port and exposes it to the frontend via a Tauri command (`get_sidecar_port`). The frontend then connects directly to `ws://localhost:{port}`.

### Monorepo Structure (yarn workspaces)

```
hip/                              # workspace root = Tauri frontend project
├── package.json                  # workspaces: ["packages/*"]
├── packages/
│   ├── protocol/                 # @hip/protocol — shared WS message types
│   │   ├── package.json
│   │   └── src/
│   │       └── index.ts
│   └── sidecar/                  # @hip/sidecar — LangGraph WS server
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── main.ts           # entry: start WS server, write port to stdout
│           ├── server/
│           │   └── ws-server.ts  # WebSocket server + message router
│           ├── session/
│           │   ├── session-manager.ts  # create/destroy session instances
│           │   └── session.ts          # single session state + graph runner
│           ├── agents/
│           │   ├── supervisor.ts       # LangGraph StateGraph: supervisor
│           │   └── sub-agents/
│           │       ├── planner.ts
│           │       ├── coder.ts
│           │       └── reviewer.ts
│           └── graph/
│               └── builder.ts    # LangGraph graph factory
├── src/                          # React frontend
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx      # root layout with tab bar
│   │   │   └── SessionTabs.tsx   # tab bar per session
│   │   └── session/
│   │       ├── SessionView.tsx   # single session container
│   │       ├── ChatPane.tsx      # message list
│   │       ├── InputBar.tsx      # user input
│   │       └── AgentTree.tsx     # sub-agent execution tree (collapsible)
│   ├── hooks/
│   │   ├── useWebSocket.ts       # low-level WS connection hook
│   │   └── useSession.ts         # per-session state hook
│   ├── store/
│   │   └── sessionStore.ts       # Zustand store: sessions[], activeId
│   └── ipc/
│       └── ws-client.ts          # typed WS client wrapping @hip/protocol
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        ├── lib.rs
        └── sidecar.rs            # spawn sidecar, capture port, expose command
```

---

## WebSocket Protocol

All messages are JSON. Defined in `packages/protocol/src/index.ts` and imported by both the frontend and sidecar.

### Frontend → Sidecar

```typescript
type ClientMessage =
  | { type: 'session:create';  id: string; config: SessionConfig }
  | { type: 'session:destroy'; sessionId: string }
  | { type: 'message:send';    sessionId: string; content: string; role: 'user' }
  | { type: 'message:cancel';  sessionId: string }
```

### Sidecar → Frontend

```typescript
type ServerMessage =
  | { type: 'session:created';   sessionId: string }
  | { type: 'agent:started';     sessionId: string; agentId: string; role: AgentRole }
  | { type: 'token:stream';      sessionId: string; agentId: string; delta: string }
  | { type: 'agent:finished';    sessionId: string; agentId: string }
  | { type: 'message:complete';  sessionId: string; message: Message }
  | { type: 'error';             sessionId?: string; code: string; message: string }

type AgentRole = 'supervisor' | 'planner' | 'coder' | 'reviewer'
```

### SessionConfig

```typescript
interface SessionConfig {
  llmProvider: 'anthropic' | 'openai' | 'ollama'
  model: string          // e.g. 'claude-opus-4-8', 'gpt-4o', 'llama3'
  tools: string[]        // tool names enabled for this session
}
```

---

## Session & Agent Model

Each session maps to a `SessionGraph` built by `graph/builder.ts`. On `message:send`, the session graph runs:

1. **Supervisor node** — decides if the task is simple (direct answer) or complex (delegate to sub-agents).
2. **Conditional edge** — if complex, fans out to Planner, Coder, Reviewer nodes in parallel.
3. **Aggregator node** — collects sub-agent outputs, synthesises final response.

Each LangGraph node emits `token:stream` events over WebSocket as it streams. The frontend `AgentTree` component renders each agent as a collapsible row showing its streaming output in real time.

---

## Sidecar Lifecycle

1. Tauri shell calls `sidecar.rs::spawn_sidecar()` on app startup.
2. Sidecar binds a WebSocket server on a random port; prints `{"port":PORT}` to stdout.
3. Rust captures stdout, parses the port, stores it in app state.
4. Frontend calls `invoke('get_sidecar_port')` → connects `ws://localhost:{port}`.
5. On app shutdown, Tauri shell sends SIGTERM to the sidecar child process.

For development: sidecar runs as `ts-node` via `yarn workspace @hip/sidecar dev`.  
For production: sidecar is compiled to a standalone JS bundle (via `@vercel/ncc`) and registered in `tauri.conf.json` as a sidecar binary.

---

## Frontend State (Zustand)

```typescript
interface SessionStore {
  sessions: Session[]
  activeSessionId: string | null
  createSession: (config: SessionConfig) => void
  destroySession: (id: string) => void
  setActive: (id: string) => void
}

interface Session {
  id: string
  config: SessionConfig
  messages: Message[]
  agents: AgentState[]       // live sub-agent states for AgentTree
  status: 'idle' | 'running' | 'error'
}
```

---

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@langchain/langgraph` | Agent graph orchestration |
| `@langchain/core` | LLM abstraction (ChatModel) |
| `ws` | WebSocket server in sidecar |
| `zustand` | Frontend state |
| `@tauri-apps/plugin-shell` | Sidecar spawn + port capture |

---

## Out of Scope (v1 skeleton)

- Auth / API key UI (env vars for now)
- Persistent conversation history (in-memory only)
- Tool implementations (file system, terminal, browser)
- LangGraph checkpoint persistence
- App auto-update
