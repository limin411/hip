# hip Desktop Agent App — Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete skeleton (directory structure, TypeScript stubs, wired-up plumbing) for the hip desktop AI agent app — everything compiles and the app shell launches, but agent logic is empty.

**Architecture:** yarn workspaces monorepo. Root = Tauri frontend. `packages/protocol` = shared WS message types. `packages/sidecar` = Node.js LangGraph server. `src-tauri` Rust shell spawns the sidecar on startup and exposes the port via a Tauri command. Frontend connects via WebSocket and manages sessions in Zustand.

**Tech Stack:** Tauri 2, React 19, TypeScript 5.8, `@langchain/langgraph`, `ws`, Zustand 5, nanoid 5, tsx (sidecar dev), `@vercel/ncc` (sidecar prod bundle), yarn workspaces.

---

### Task 1: Monorepo root — yarn workspaces + tsconfig paths + vite alias

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Update root `package.json`**

Replace the full file contents:

```json
{
  "name": "hip",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "sidecar:dev": "yarn workspace @hip/sidecar dev",
    "sidecar:build": "yarn workspace @hip/sidecar build",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-opener": "^2",
    "@tauri-apps/plugin-shell": "^2",
    "@hip/protocol": "workspace:*",
    "zustand": "^5",
    "nanoid": "^5"
  },
  "devDependencies": {
    "@types/react": "^18.3.1",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "~5.6.2",
    "vite": "^6.0.3",
    "@tauri-apps/cli": "^2"
  }
}
```

- [ ] **Step 2: Update root `tsconfig.json`** — add `paths` for `@hip/protocol`

Replace full file:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "paths": {
      "@hip/protocol": ["packages/protocol/src/index.ts"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Update `vite.config.ts`** — add alias for `@hip/protocol`

Replace full file:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@hip/protocol": resolve(__dirname, "packages/protocol/src/index.ts"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
```

- [ ] **Step 4: Run install** (packages/protocol doesn't exist yet — yarn warns but does not error)

```bash
yarn install
```

Expected: installs without fatal errors. Workspace symlinks for `@hip/protocol` and `@hip/sidecar` appear after those packages are created.

---

### Task 2: `packages/protocol` — shared WebSocket message types

**Files:**
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/src/index.ts`

- [ ] **Step 1: Create `packages/protocol/package.json`**

```json
{
  "name": "@hip/protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 2: Create `packages/protocol/src/index.ts`**

```typescript
export type AgentRole = 'supervisor' | 'planner' | 'coder' | 'reviewer'

export interface SessionConfig {
  llmProvider: 'anthropic' | 'openai' | 'ollama'
  model: string
  tools: string[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentId?: string
  timestamp: number
}

export type ClientMessage =
  | { type: 'session:create'; id: string; config: SessionConfig }
  | { type: 'session:destroy'; sessionId: string }
  | { type: 'message:send'; sessionId: string; content: string; role: 'user' }
  | { type: 'message:cancel'; sessionId: string }

export type ServerMessage =
  | { type: 'session:created'; sessionId: string }
  | { type: 'agent:started'; sessionId: string; agentId: string; role: AgentRole }
  | { type: 'token:stream'; sessionId: string; agentId: string; delta: string }
  | { type: 'agent:finished'; sessionId: string; agentId: string }
  | { type: 'message:complete'; sessionId: string; message: Message }
  | { type: 'error'; sessionId?: string; code: string; message: string }
```

- [ ] **Step 3: Re-run install to register workspace symlink**

```bash
yarn install
```

Expected: `node_modules/@hip/protocol` symlink appears.

---

### Task 3: `packages/sidecar` — project setup

**Files:**
- Create: `packages/sidecar/package.json`
- Create: `packages/sidecar/tsconfig.json`

- [ ] **Step 1: Create `packages/sidecar/package.json`**

```json
{
  "name": "@hip/sidecar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/main.ts",
    "build": "ncc build src/main.ts -o dist",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@hip/protocol": "workspace:*",
    "@langchain/langgraph": "^1.3",
    "@langchain/core": "^1.1",
    "@langchain/anthropic": "^1.4",
    "@langchain/openai": "^1.4",
    "ws": "^8"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/ws": "^8",
    "tsx": "^4",
    "typescript": "~5.6.2",
    "@vercel/ncc": "^0.38"
  }
}
```

- [ ] **Step 2: Create `packages/sidecar/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "paths": {
      "@hip/protocol": ["../protocol/src/index.ts"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install sidecar dependencies**

```bash
yarn install
```

Expected: `@langchain/langgraph`, `ws`, `tsx`, etc. appear in `packages/sidecar/node_modules`.

---

### Task 4: Sidecar — WebSocket server + main entry

**Files:**
- Create: `packages/sidecar/src/main.ts`
- Create: `packages/sidecar/src/server/ws-server.ts`

- [ ] **Step 1: Create `packages/sidecar/src/server/ws-server.ts`**

```typescript
import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'net'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { SessionManager } from '../session/session-manager.js'

export class WsServer {
  private readonly wss: WebSocketServer
  private readonly sessionManager: SessionManager

  constructor(private readonly port: number) {
    this.wss = new WebSocketServer({ port })
    this.sessionManager = new SessionManager()
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.on('listening', resolve)
      this.wss.on('connection', (ws) => this.handleConnection(ws))
    })
  }

  private handleConnection(ws: WebSocket): void {
    const send = (msg: ServerMessage) => ws.send(JSON.stringify(msg))
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage
        this.sessionManager.handle(msg, send)
      } catch (err) {
        send({ type: 'error', code: 'PARSE_ERROR', message: String(err) })
      }
    })
    ws.on('error', (err) => console.error('[ws] client error', err))
  }

  static findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer()
      srv.listen(0, () => {
        const addr = srv.address()
        if (!addr || typeof addr === 'string') return reject(new Error('no address'))
        srv.close(() => resolve(addr.port))
      })
      srv.on('error', reject)
    })
  }
}
```

- [ ] **Step 2: Create `packages/sidecar/src/main.ts`**

```typescript
import { WsServer } from './server/ws-server.js'

async function main(): Promise<void> {
  const port = await WsServer.findAvailablePort()
  const server = new WsServer(port)
  await server.start()
  // Tauri reads this line from stdout to discover the WebSocket port
  process.stdout.write(JSON.stringify({ port }) + '\n')
}

main().catch((err) => {
  console.error('[sidecar] fatal', err)
  process.exit(1)
})
```

- [ ] **Step 3: Type-check** (errors expected for missing `SessionManager`)

```bash
yarn workspace @hip/sidecar type-check 2>&1 | head -20
```

Expected: errors mentioning `../session/session-manager.js` not found — that's correct, created in Task 5.

---

### Task 5: Sidecar — SessionManager + Session

**Files:**
- Create: `packages/sidecar/src/session/session-manager.ts`
- Create: `packages/sidecar/src/session/session.ts`

- [ ] **Step 1: Create `packages/sidecar/src/session/session.ts`**

```typescript
import type { ServerMessage, SessionConfig } from '@hip/protocol'
import { buildAgentGraph } from '../graph/builder.js'

type SendFn = (msg: ServerMessage) => void

export class Session {
  private readonly graph: ReturnType<typeof buildAgentGraph>
  private abortController: AbortController | null = null

  constructor(
    readonly id: string,
    readonly config: SessionConfig,
  ) {
    this.graph = buildAgentGraph(config)
  }

  async sendMessage(content: string, send: SendFn): Promise<void> {
    this.abortController = new AbortController()
    try {
      for await (const _event of this.graph.streamEvents(
        { messages: [{ role: 'user', content }] },
        { signal: this.abortController.signal, version: 'v2' },
      )) {
        // TODO: map LangGraph event types to ServerMessage and call send()
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        send({ type: 'error', sessionId: this.id, code: 'GRAPH_ERROR', message: err.message })
      }
    }
  }

  cancel(): void {
    this.abortController?.abort()
  }

  destroy(): void {
    this.cancel()
  }
}
```

- [ ] **Step 2: Create `packages/sidecar/src/session/session-manager.ts`**

```typescript
import type { ClientMessage, ServerMessage, SessionConfig } from '@hip/protocol'
import { Session } from './session.js'

type SendFn = (msg: ServerMessage) => void

export class SessionManager {
  private readonly sessions = new Map<string, Session>()

  handle(msg: ClientMessage, send: SendFn): void {
    switch (msg.type) {
      case 'session:create':
        this.createSession(msg.id, msg.config, send)
        break
      case 'session:destroy':
        this.destroySession(msg.sessionId)
        break
      case 'message:send':
        this.sessions.get(msg.sessionId)?.sendMessage(msg.content, send)
        break
      case 'message:cancel':
        this.sessions.get(msg.sessionId)?.cancel()
        break
    }
  }

  private createSession(id: string, config: SessionConfig, send: SendFn): void {
    const session = new Session(id, config)
    this.sessions.set(id, session)
    send({ type: 'session:created', sessionId: id })
  }

  private destroySession(id: string): void {
    this.sessions.get(id)?.destroy()
    this.sessions.delete(id)
  }
}
```

- [ ] **Step 3: Type-check** (errors expected for missing `buildAgentGraph`)

```bash
yarn workspace @hip/sidecar type-check 2>&1 | head -20
```

Expected: errors mentioning `../graph/builder.js` — correct, created in Task 6.

---

### Task 6: Sidecar — LangGraph graph builder + agent stubs

**Files:**
- Create: `packages/sidecar/src/graph/builder.ts`
- Create: `packages/sidecar/src/agents/supervisor.ts`
- Create: `packages/sidecar/src/agents/sub-agents/planner.ts`
- Create: `packages/sidecar/src/agents/sub-agents/coder.ts`
- Create: `packages/sidecar/src/agents/sub-agents/reviewer.ts`

- [ ] **Step 1: Create `packages/sidecar/src/graph/builder.ts`**

```typescript
import { Annotation, StateGraph, START, END } from '@langchain/langgraph'
import { BaseMessage } from '@langchain/core/messages'
import type { SessionConfig } from '@hip/protocol'
import { supervisorNode } from '../agents/supervisor.js'
import { plannerNode } from '../agents/sub-agents/planner.js'
import { coderNode } from '../agents/sub-agents/coder.js'
import { reviewerNode } from '../agents/sub-agents/reviewer.js'

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  next: Annotation<string>({
    reducer: (_x, y) => y,
    default: () => END,
  }),
})

export type AgentStateType = typeof AgentState.State

export function buildAgentGraph(config: SessionConfig) {
  const graph = new StateGraph(AgentState)

  graph.addNode('supervisor', supervisorNode(config))
  graph.addNode('planner', plannerNode(config))
  graph.addNode('coder', coderNode(config))
  graph.addNode('reviewer', reviewerNode(config))

  graph.addEdge(START, 'supervisor')
  graph.addConditionalEdges('supervisor', (state) => state.next, {
    planner: 'planner',
    coder: 'coder',
    reviewer: 'reviewer',
    [END]: END,
  })
  graph.addEdge('planner', 'supervisor')
  graph.addEdge('coder', 'supervisor')
  graph.addEdge('reviewer', 'supervisor')

  return graph.compile()
}
```

- [ ] **Step 2: Create `packages/sidecar/src/agents/supervisor.ts`**

```typescript
import { END } from '@langchain/langgraph'
import type { SessionConfig } from '@hip/protocol'
import type { AgentStateType } from '../graph/builder.js'

export function supervisorNode(_config: SessionConfig) {
  return async (_state: AgentStateType): Promise<Partial<AgentStateType>> => {
    // TODO: call LLM to route to 'planner' | 'coder' | 'reviewer' | END
    return { next: END }
  }
}
```

- [ ] **Step 3: Create `packages/sidecar/src/agents/sub-agents/planner.ts`**

```typescript
import type { SessionConfig } from '@hip/protocol'
import type { AgentStateType } from '../../graph/builder.js'

export function plannerNode(_config: SessionConfig) {
  return async (_state: AgentStateType): Promise<Partial<AgentStateType>> => {
    // TODO: call LLM to produce a plan; push result to messages
    return {}
  }
}
```

- [ ] **Step 4: Create `packages/sidecar/src/agents/sub-agents/coder.ts`**

```typescript
import type { SessionConfig } from '@hip/protocol'
import type { AgentStateType } from '../../graph/builder.js'

export function coderNode(_config: SessionConfig) {
  return async (_state: AgentStateType): Promise<Partial<AgentStateType>> => {
    // TODO: call LLM to generate code; push result to messages
    return {}
  }
}
```

- [ ] **Step 5: Create `packages/sidecar/src/agents/sub-agents/reviewer.ts`**

```typescript
import type { SessionConfig } from '@hip/protocol'
import type { AgentStateType } from '../../graph/builder.js'

export function reviewerNode(_config: SessionConfig) {
  return async (_state: AgentStateType): Promise<Partial<AgentStateType>> => {
    // TODO: call LLM to review and critique; push result to messages
    return {}
  }
}
```

- [ ] **Step 6: Full sidecar type-check — must pass clean**

```bash
yarn workspace @hip/sidecar type-check
```

Expected: 0 errors.

- [ ] **Step 7: Commit packages/**

```bash
git add packages/
git commit -m "feat: add @hip/protocol types and @hip/sidecar LangGraph skeleton"
```

---

### Task 7: Rust — sidecar lifecycle integration

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/sidecar.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Update `src-tauri/Cargo.toml`** — add shell plugin + tokio

Replace the `[dependencies]` section:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["sync"] }
```

- [ ] **Step 2: Create `src-tauri/src/sidecar.rs`**

```rust
use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Deserialize)]
struct PortMsg {
    port: u16,
}

pub async fn spawn_sidecar(app: &AppHandle) -> Result<u16, String> {
    let (mut rx, _child) = app
        .shell()
        .sidecar("sidecar")
        .map_err(|e| e.to_string())?
        .spawn()
        .map_err(|e| e.to_string())?;

    while let Some(event) = rx.recv().await {
        if let tauri_plugin_shell::process::CommandEvent::Stdout(line) = event {
            let text = String::from_utf8_lossy(&line);
            if let Ok(msg) = serde_json::from_str::<PortMsg>(text.trim()) {
                return Ok(msg.port);
            }
        }
    }
    Err("sidecar exited before reporting port".into())
}
```

- [ ] **Step 3: Replace `src-tauri/src/lib.rs`**

```rust
mod sidecar;

use std::sync::Mutex;

pub struct SidecarPort(pub Mutex<Option<u16>>);

#[tauri::command]
fn get_sidecar_port(state: tauri::State<SidecarPort>) -> Option<u16> {
    *state.0.lock().unwrap()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarPort(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match sidecar::spawn_sidecar(&handle).await {
                    Ok(port) => {
                        *handle.state::<SidecarPort>().0.lock().unwrap() = Some(port);
                        println!("[tauri] sidecar ready on port {port}");
                    }
                    Err(e) => eprintln!("[tauri] sidecar failed: {e}"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_sidecar_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Update `src-tauri/tauri.conf.json`** — register sidecar binary + shell plugin

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "hip",
  "version": "0.1.0",
  "identifier": "com.ljm.app",
  "build": {
    "beforeDevCommand": "yarn dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "yarn build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      { "title": "hip", "width": 1800, "height": 1200, "maximized": true }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["binaries/sidecar"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "shell": {
      "open": true,
      "sidecar": true
    }
  }
}
```

- [ ] **Step 5: Cargo check**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: compiles cleanly. If `tauri-plugin-shell` crate version is not found, run `cargo update` first.

- [ ] **Step 6: Commit Rust changes**

```bash
git add src-tauri/
git commit -m "feat(rust): wire sidecar lifecycle and get_sidecar_port command"
```

---

### Task 8: Frontend — ipc + hooks

**Files:**
- Create: `src/ipc/ws-client.ts`
- Create: `src/hooks/useWebSocket.ts`
- Create: `src/hooks/useSession.ts`

- [ ] **Step 1: Create `src/ipc/ws-client.ts`**

```typescript
import type { ClientMessage, ServerMessage } from '@hip/protocol'

type MessageHandler = (msg: ServerMessage) => void

class WsClient {
  private ws: WebSocket | null = null
  private readonly handlers = new Set<MessageHandler>()

  connect(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${port}`)
      this.ws.onopen = () => resolve()
      this.ws.onerror = (e) => reject(e)
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as ServerMessage
        this.handlers.forEach((h) => h(msg))
      }
    })
  }

  send(msg: ClientMessage): void {
    this.ws?.send(JSON.stringify(msg))
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }
}

export const wsClient = new WsClient()
```

- [ ] **Step 2: Create `src/hooks/useWebSocket.ts`**

```typescript
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { wsClient } from '../ipc/ws-client'

export type WsStatus = 'connecting' | 'connected' | 'error' | 'disconnected'

async function getSidecarPort(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const port = await invoke<number | null>('get_sidecar_port')
    if (port !== null) return port
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('sidecar port not available after 10 s')
}

export function useWebSocket() {
  const [status, setStatus] = useState<WsStatus>('disconnected')

  useEffect(() => {
    let cancelled = false

    async function init() {
      setStatus('connecting')
      try {
        const port = await getSidecarPort()
        if (cancelled) return
        await wsClient.connect(port)
        if (!cancelled) setStatus('connected')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    init()
    return () => {
      cancelled = true
      wsClient.disconnect()
      setStatus('disconnected')
    }
  }, [])

  return { status }
}
```

- [ ] **Step 3: Create `src/hooks/useSession.ts`**

```typescript
import { useEffect } from 'react'
import type { ServerMessage } from '@hip/protocol'
import { wsClient } from '../ipc/ws-client'
import { useSessionStore } from '../store/sessionStore'

export function useSessionSync() {
  const store = useSessionStore()

  useEffect(() => {
    return wsClient.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'session:created':
          break
        case 'agent:started':
          store.setAgentStarted(msg.sessionId, msg.agentId, msg.role)
          break
        case 'token:stream':
          store.appendToken(msg.sessionId, msg.agentId, msg.delta)
          break
        case 'agent:finished':
          store.setAgentFinished(msg.sessionId, msg.agentId)
          break
        case 'message:complete':
          store.addMessage(msg.sessionId, msg.message)
          break
        case 'error':
          console.error('[ws] server error', msg)
          break
      }
    })
  }, [store])
}
```

---

### Task 9: Frontend — Zustand store

**Files:**
- Create: `src/store/sessionStore.ts`

- [ ] **Step 1: Create `src/store/sessionStore.ts`**

```typescript
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { AgentRole, Message, SessionConfig } from '@hip/protocol'

export interface AgentState {
  id: string
  role: AgentRole
  status: 'running' | 'finished'
  tokens: string
}

export interface Session {
  id: string
  config: SessionConfig
  messages: Message[]
  agents: AgentState[]
  status: 'idle' | 'running' | 'error'
}

interface SessionStore {
  sessions: Session[]
  activeSessionId: string | null
  createSession: (config: SessionConfig) => string
  destroySession: (id: string) => void
  setActive: (id: string) => void
  addMessage: (sessionId: string, message: Message) => void
  setAgentStarted: (sessionId: string, agentId: string, role: AgentRole) => void
  setAgentFinished: (sessionId: string, agentId: string) => void
  appendToken: (sessionId: string, agentId: string, delta: string) => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  activeSessionId: null,

  createSession: (config) => {
    const id = nanoid()
    set((s) => ({
      sessions: [...s.sessions, { id, config, messages: [], agents: [], status: 'idle' }],
      activeSessionId: s.activeSessionId ?? id,
    }))
    return id
  },

  destroySession: (id) =>
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.id !== id),
      activeSessionId: s.activeSessionId === id ? (s.sessions[0]?.id ?? null) : s.activeSessionId,
    })),

  setActive: (id) => set({ activeSessionId: id }),

  addMessage: (sessionId, message) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : { ...sess, messages: [...sess.messages, message], status: 'idle', agents: [] },
      ),
    })),

  setAgentStarted: (sessionId, agentId, role) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : {
              ...sess,
              status: 'running',
              agents: [...sess.agents, { id: agentId, role, status: 'running', tokens: '' }],
            },
      ),
    })),

  setAgentFinished: (sessionId, agentId) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : {
              ...sess,
              agents: sess.agents.map((a) => (a.id !== agentId ? a : { ...a, status: 'finished' })),
            },
      ),
    })),

  appendToken: (sessionId, agentId, delta) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId
          ? sess
          : {
              ...sess,
              agents: sess.agents.map((a) =>
                a.id !== agentId ? a : { ...a, tokens: a.tokens + delta },
              ),
            },
      ),
    })),
}))
```

---

### Task 10: Frontend — component skeletons

**Files:**
- Create: `src/components/layout/AppShell.tsx`
- Create: `src/components/layout/SessionTabs.tsx`
- Create: `src/components/session/SessionView.tsx`
- Create: `src/components/session/ChatPane.tsx`
- Create: `src/components/session/InputBar.tsx`
- Create: `src/components/session/AgentTree.tsx`

- [ ] **Step 1: Create `src/components/layout/AppShell.tsx`**

```tsx
import { useWebSocket } from '../../hooks/useWebSocket'
import { useSessionSync } from '../../hooks/useSession'
import { SessionTabs } from './SessionTabs'
import { SessionView } from '../session/SessionView'
import { useSessionStore } from '../../store/sessionStore'

export function AppShell() {
  const { status } = useWebSocket()
  useSessionSync()
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d0d0d', color: '#eee' }}>
      <div style={{ padding: '2px 8px', fontSize: 11, color: '#555', borderBottom: '1px solid #1a1a1a' }}>
        sidecar: {status}
      </div>
      <SessionTabs />
      {activeSessionId && <SessionView sessionId={activeSessionId} />}
      {!activeSessionId && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}>
          No session — press ＋ to start
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/layout/SessionTabs.tsx`**

```tsx
import { useSessionStore } from '../../store/sessionStore'
import { wsClient } from '../../ipc/ws-client'

const DEFAULT_CONFIG = {
  llmProvider: 'anthropic' as const,
  model: 'claude-opus-4-8',
  tools: [],
}

export function SessionTabs() {
  const { sessions, activeSessionId, setActive, destroySession, createSession } = useSessionStore()

  function newSession() {
    const id = createSession(DEFAULT_CONFIG)
    wsClient.send({ type: 'session:create', id, config: DEFAULT_CONFIG })
  }

  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #222', background: '#111' }}>
      {sessions.map((s) => (
        <div
          key={s.id}
          onClick={() => setActive(s.id)}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            cursor: 'pointer',
            background: s.id === activeSessionId ? '#1e1e1e' : 'transparent',
            borderRight: '1px solid #222',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <span>Session {s.id.slice(0, 6)}</span>
          <span
            onClick={(e) => { e.stopPropagation(); destroySession(s.id) }}
            style={{ color: '#555', cursor: 'pointer' }}
          >
            ×
          </span>
        </div>
      ))}
      <button
        onClick={newSession}
        style={{ padding: '6px 12px', background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16 }}
      >
        ＋
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/components/session/SessionView.tsx`**

```tsx
import { useSessionStore } from '../../store/sessionStore'
import { ChatPane } from './ChatPane'
import { AgentTree } from './AgentTree'
import { InputBar } from './InputBar'

interface Props { sessionId: string }

export function SessionView({ sessionId }: Props) {
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === sessionId))
  if (!session) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <ChatPane messages={session.messages} />
      <AgentTree agents={session.agents} />
      <InputBar sessionId={sessionId} disabled={session.status === 'running'} />
    </div>
  )
}
```

- [ ] **Step 4: Create `src/components/session/ChatPane.tsx`**

```tsx
import type { Message } from '@hip/protocol'

interface Props { messages: Message[] }

export function ChatPane({ messages }: Props) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
      {messages.length === 0 && (
        <div style={{ color: '#333', fontSize: 13 }}>Send a message to begin.</div>
      )}
      {messages.map((m) => (
        <div key={m.id} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>{m.role}</div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{m.content}</div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Create `src/components/session/InputBar.tsx`**

```tsx
import { useState } from 'react'
import { wsClient } from '../../ipc/ws-client'

interface Props { sessionId: string; disabled: boolean }

export function InputBar({ sessionId, disabled }: Props) {
  const [value, setValue] = useState('')

  function submit() {
    if (!value.trim() || disabled) return
    wsClient.send({ type: 'message:send', sessionId, content: value.trim(), role: 'user' })
    setValue('')
  }

  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid #1a1a1a' }}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
        disabled={disabled}
        placeholder={disabled ? 'Running…' : 'Message (Enter to send, Shift+Enter for newline)'}
        rows={3}
        style={{ width: '100%', resize: 'none', background: '#111', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: 10, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }}
      />
    </div>
  )
}
```

- [ ] **Step 6: Create `src/components/session/AgentTree.tsx`**

```tsx
import type { AgentState } from '../../store/sessionStore'

interface Props { agents: AgentState[] }

export function AgentTree({ agents }: Props) {
  if (agents.length === 0) return null

  return (
    <div style={{ borderTop: '1px solid #1a1a1a', padding: '8px 16px', fontSize: 12, color: '#555' }}>
      {agents.map((a) => (
        <div key={a.id} style={{ display: 'flex', gap: 10, marginBottom: 2, alignItems: 'baseline' }}>
          <span style={{ color: '#6c63ff', minWidth: 70 }}>[{a.role}]</span>
          <span style={{ color: a.status === 'running' ? '#3adc8c' : '#444' }}>{a.status}</span>
          {a.tokens && (
            <span style={{ color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
              {a.tokens.slice(-80)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
```

---

### Task 11: Wire `App.tsx` + final type-check + commit

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace `src/App.tsx`**

```tsx
import { AppShell } from './components/layout/AppShell'

function App() {
  return <AppShell />
}

export default App
```

- [ ] **Step 2: Frontend type-check**

```bash
yarn type-check
```

Expected: 0 errors.

- [ ] **Step 3: Sidecar type-check**

```bash
yarn workspace @hip/sidecar type-check
```

Expected: 0 errors.

- [ ] **Step 4: Commit frontend skeleton**

```bash
git add src/ package.json tsconfig.json vite.config.ts
git commit -m "feat(frontend): add component skeletons, Zustand store, WS client"
```

---

## Post-skeleton checklist

After all tasks pass:

- [ ] `yarn install` resolves without errors
- [ ] `yarn type-check` — 0 errors (frontend)
- [ ] `yarn workspace @hip/sidecar type-check` — 0 errors (sidecar)
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` — 0 errors (Rust)
- [ ] `yarn sidecar:dev` — sidecar starts and prints `{"port":XXXX}`
- [ ] `yarn tauri dev` — app window opens, sidecar status shows `connected`, ＋ button creates a session tab
