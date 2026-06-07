# Remediation Phase 3 — Security & UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate the WebSocket channel, restore a CSP, surface connection state with auto-reconnect, and guard the `/app` route behind a (mock) login.

**Architecture:** The sidecar mints a random token at startup and prints it alongside the port; Rust relays `{port, token}` to the frontend via `get_sidecar_info`; the WS server rejects connections without the token or from an unexpected origin. The frontend WS client gains a resolver-driven reconnect loop that re-fetches `{port, token}` each attempt and publishes status into the domain store, which a header indicator renders. A tiny persisted auth store gates the `/app` route.

**Tech Stack:** Node.js (`ws`, `node:crypto`), Tauri v2 (Rust, serde), React + TypeScript, Zustand, Vitest.

**Spec:** [docs/superpowers/specs/2026-06-07-hip-remediation-design.md](../specs/2026-06-07-hip-remediation-design.md) (§W5, §W4, §W7)

**Depends on:** Phase 1 (`SidecarState`, `parse_port_line`, `get_sidecar_port`, managed spawn).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/sidecar/src/main.ts` | Mint token, print `{port, token}` | Modify |
| `packages/sidecar/src/server/ws-server.ts` | Accept token, validate token + origin | Modify |
| `src-tauri/src/sidecar.rs` | Parse `{port, token}` line, store both | Modify |
| `src-tauri/src/lib.rs` | `SidecarState.token`, `get_sidecar_info` command | Modify |
| `src-tauri/tauri.conf.json` | Replace `csp: null` with a real policy | Modify |
| `src/ipc/ws-client.ts` | Resolver-driven reconnect, status, guarded parse, token query | Modify |
| `src/domain/transport.ts` | Add `onStatus` to the seam | Modify |
| `src/domain/wsTransport.ts` | `get_sidecar_info` resolver + status passthrough | Modify |
| `src/domain/sessionService.ts` | Push transport status into the domain store | Modify |
| `src/components/chat/ChatHeader.tsx` | Connection indicator + retry | Modify |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | Connection strings | Modify |
| `src/store/authStore.ts` | Persisted mock auth flag | Create |
| `src/routes/RequireAuth.tsx` | Route guard | Create |
| `src/App.tsx` | Wrap `/app` in `RequireAuth` | Modify |
| `src/routes/LoginScreen.tsx` | `login()` on enter | Modify |
| `src/components/sidebar/UserMenu.tsx` | `logout()` action | Modify |

---

## Task 1: Sidecar mints a token and prints it with the port (W5)

**Files:**
- Modify: `packages/sidecar/src/main.ts`
- Modify: `packages/sidecar/src/server/ws-server.ts`

- [ ] **Step 1: Accept a token in WsServer**

In `packages/sidecar/src/server/ws-server.ts`, change the constructor to take a token and store it:

```ts
constructor(private readonly port: number, private readonly token: string) {
  this.wss = new WebSocketServer({ port })
  this.sessionManager = new SessionManager()
}
```

- [ ] **Step 2: Mint the token and include it in the stdout line**

Replace `packages/sidecar/src/main.ts` with:

```ts
import { randomUUID } from 'node:crypto'
import { WsServer } from './server/ws-server.js'

async function main(): Promise<void> {
  const port = await WsServer.findAvailablePort()
  const token = randomUUID()
  const server = new WsServer(port, token)
  await server.start()
  // Tauri reads this line from stdout to discover the WebSocket port + auth token
  process.stdout.write(JSON.stringify({ port, token }) + '\n')
}

main().catch((err) => {
  console.error('[sidecar] fatal', err)
  process.exit(1)
})
```

- [ ] **Step 3: Type-check**

Run: `yarn workspace @hip/sidecar type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/main.ts packages/sidecar/src/server/ws-server.ts
git commit -m "feat(sidecar): mint per-process WS auth token, print with port"
```

---

## Task 2: WS server validates token + origin (W5)

**Files:**
- Modify: `packages/sidecar/src/server/ws-server.ts`

- [ ] **Step 1: Validate on connection**

Replace `start()` and `handleConnection()` in `ws-server.ts`:

```ts
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { createServer } from 'net'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { SessionManager } from '../session/session-manager.js'

const ALLOWED_ORIGINS = new Set([
  'http://localhost:1420',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
])

export class WsServer {
  private readonly wss: WebSocketServer
  private readonly sessionManager: SessionManager

  constructor(private readonly port: number, private readonly token: string) {
    this.wss = new WebSocketServer({ port })
    this.sessionManager = new SessionManager()
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.on('listening', resolve)
      this.wss.on('connection', (ws, req) => this.handleConnection(ws, req))
    })
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    // Origin: allow native (no origin) or an allow-listed origin.
    const origin = req.headers.origin
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      ws.close(1008, 'origin not allowed')
      return
    }
    // Token: required, from the query string (?token=...).
    const url = new URL(req.url ?? '', 'ws://localhost')
    if (url.searchParams.get('token') !== this.token) {
      ws.close(1008, 'invalid token')
      return
    }

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

- [ ] **Step 2: Type-check**

Run: `yarn workspace @hip/sidecar type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/sidecar/src/server/ws-server.ts
git commit -m "feat(sidecar): reject WS connections without token / bad origin"
```

---

## Task 3: Rust parses `{port, token}` and exposes `get_sidecar_info` (W5)

**Files:**
- Modify: `src-tauri/src/sidecar.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Update the parser + its tests**

In `src-tauri/src/sidecar.rs`, replace `PortMsg` / `parse_port_line` and the test module:

```rust
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Clone)]
pub struct SidecarInfo {
    pub port: u16,
    pub token: String,
}

pub fn parse_info_line(line: &str) -> Option<SidecarInfo> {
    serde_json::from_str::<SidecarInfo>(line.trim()).ok()
}

#[cfg(test)]
mod tests {
    use super::parse_info_line;

    #[test]
    fn parses_port_and_token() {
        let info = parse_info_line("{\"port\":54321,\"token\":\"abc\"}").unwrap();
        assert_eq!(info.port, 54321);
        assert_eq!(info.token, "abc");
    }

    #[test]
    fn ignores_non_info_lines() {
        assert!(parse_info_line("starting up").is_none());
        assert!(parse_info_line("{\"port\":7}").is_none()); // missing token
    }
}
```

- [ ] **Step 2: Use the parser in `spawn_sidecar` and store both**

In `src-tauri/src/sidecar.rs`, change the spawn task to send a `SidecarInfo` over the oneshot and store the token. Replace the port oneshot type and the Stdout arm:

```rust
let (info_tx, info_rx) = tokio::sync::oneshot::channel::<SidecarInfo>();
// ...inside the spawned task, replace the Stdout arm's port handling:
CommandEvent::Stdout(bytes) => {
    let line = String::from_utf8_lossy(&bytes);
    if info_tx_slot.is_some() {
        if let Some(info) = parse_info_line(&line) {
            if let Some(tx) = info_tx_slot.take() {
                let _ = tx.send(info);
            }
            continue;
        }
    }
    print!("[sidecar] {line}");
}
```

(rename the local `mut port_tx = Some(port_tx)` to `mut info_tx_slot = Some(info_tx)`.) Then the return value:

```rust
let info = info_rx.await.map_err(|_| "sidecar exited before reporting info".to_string())?;
// store token; return info so callers can store the port
*app.state::<SidecarState>().token.lock().unwrap() = Some(info.token.clone());
Ok(info)
```

Change the function signature to `-> Result<SidecarInfo, String>`. Update the two callers (`setup` and `restart_sidecar` in `lib.rs`) to read `info.port`.

- [ ] **Step 3: Add `token` to `SidecarState` and the `get_sidecar_info` command**

In `src-tauri/src/lib.rs`:

```rust
pub struct SidecarState {
    pub port: Mutex<Option<u16>>,
    pub token: Mutex<Option<String>>,
    pub child: Mutex<Option<CommandChild>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self { port: Mutex::new(None), token: Mutex::new(None), child: Mutex::new(None) }
    }
}

#[tauri::command]
fn get_sidecar_info(state: tauri::State<SidecarState>) -> Option<sidecar::SidecarInfo> {
    let port = (*state.port.lock().unwrap())?;
    let token = (*state.token.lock().unwrap()).clone()?;
    Some(sidecar::SidecarInfo { port, token })
}
```

Update `setup` and `restart_sidecar` to store `info.port` (and the token is stored inside `spawn_sidecar`). Add `get_sidecar_info` to `generate_handler!`. Keep `get_sidecar_port` too (harmless) or remove it — the frontend switches to `get_sidecar_info` in Task 4, so remove `get_sidecar_port` and drop it from the handler list.

- [ ] **Step 4: Build + test**

Run: `cd src-tauri && cargo test parse_info_line && cargo build`
Expected: PASS (2 parser tests; crate builds).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat(tauri): relay sidecar {port, token} via get_sidecar_info"
```

---

## Task 4: Frontend WS client — reconnect, status, token (W4 + W5)

**Files:**
- Modify: `src/domain/transport.ts`
- Modify: `src/ipc/ws-client.ts`
- Modify: `src/domain/wsTransport.ts`

- [ ] **Step 1: Extend the Transport seam with status**

In `src/domain/transport.ts`:

```ts
import type { ClientMessage, ServerMessage } from '@hip/protocol'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface Transport {
  connect(): Promise<void>
  disconnect(): void
  send(msg: ClientMessage): void
  onMessage(handler: (msg: ServerMessage) => void): () => void
  onStatus(handler: (s: ConnectionStatus) => void): () => void
}
```

- [ ] **Step 2: Rewrite ws-client with a resolver-driven reconnect loop**

Replace `src/ipc/ws-client.ts`:

```ts
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import type { ConnectionStatus } from '@/domain/transport'

type MessageHandler = (msg: ServerMessage) => void
type StatusHandler = (s: ConnectionStatus) => void
type Resolver = () => Promise<{ port: number; token: string }>

const MAX_BACKOFF_MS = 10_000

class WsClient {
  private ws: WebSocket | null = null
  private resolver: Resolver | null = null
  private readonly handlers = new Set<MessageHandler>()
  private readonly statusHandlers = new Set<StatusHandler>()
  private backoff = 500
  private stopped = false

  /** Begin the connect/reconnect loop. Resolves on the FIRST successful open. */
  start(resolver: Resolver): Promise<void> {
    this.resolver = resolver
    this.stopped = false
    return new Promise<void>((resolveOnce) => {
      let settled = false
      const onceConnected = () => { if (!settled) { settled = true; resolveOnce() } }
      this.connectLoop(onceConnected)
    })
  }

  private async connectLoop(onConnected: () => void): Promise<void> {
    if (this.stopped) return
    this.setStatus('connecting')
    try {
      const { port, token } = await this.resolver!()
      const ws = new WebSocket(`ws://localhost:${port}/?token=${encodeURIComponent(token)}`)
      this.ws = ws
      ws.onopen = () => { this.backoff = 500; this.setStatus('connected'); onConnected() }
      ws.onmessage = (e) => {
        let msg: ServerMessage
        try { msg = JSON.parse(e.data as string) as ServerMessage } catch { return }
        this.handlers.forEach((h) => h(msg))
      }
      ws.onerror = () => this.setStatus('error')
      ws.onclose = () => { this.ws = null; this.setStatus('disconnected'); this.scheduleReconnect(onConnected) }
    } catch {
      this.setStatus('error')
      this.scheduleReconnect(onConnected)
    }
  }

  private scheduleReconnect(onConnected: () => void): void {
    if (this.stopped) return
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
    setTimeout(() => this.connectLoop(onConnected), delay)
  }

  send(msg: ClientMessage): void { this.ws?.send(JSON.stringify(msg)) }
  onMessage(h: MessageHandler): () => void { this.handlers.add(h); return () => this.handlers.delete(h) }
  onStatus(h: StatusHandler): () => void { this.statusHandlers.add(h); return () => this.statusHandlers.delete(h) }
  private setStatus(s: ConnectionStatus): void { this.statusHandlers.forEach((h) => h(s)) }

  disconnect(): void { this.stopped = true; this.ws?.close(); this.ws = null }
}

export const wsClient = new WsClient()
```

- [ ] **Step 3: Update WsTransport to resolve `{port, token}` and passthrough status**

Replace `src/domain/wsTransport.ts`:

```ts
import { invoke } from '@tauri-apps/api/core'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { wsClient } from '@/ipc/ws-client'
import type { Transport, ConnectionStatus } from './transport'

interface SidecarInfo { port: number; token: string }

async function getSidecarInfo(): Promise<SidecarInfo> {
  for (let i = 0; i < 20; i++) {
    const info = await invoke<SidecarInfo | null>('get_sidecar_info')
    if (info) return info
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('sidecar info not available after 10 s')
}

export class WsTransport implements Transport {
  connect(): Promise<void> {
    return wsClient.start(getSidecarInfo)
  }
  disconnect(): void { wsClient.disconnect() }
  send(msg: ClientMessage): void { wsClient.send(msg) }
  onMessage(handler: (m: ServerMessage) => void): () => void { return wsClient.onMessage(handler) }
  onStatus(handler: (s: ConnectionStatus) => void): () => void { return wsClient.onStatus(handler) }
}
```

- [ ] **Step 4: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/transport.ts src/ipc/ws-client.ts src/domain/wsTransport.ts
git commit -m "feat(ipc): token-authed WS with resolver-driven reconnect + status"
```

---

## Task 5: Publish status to the store + header indicator (W4)

**Files:**
- Modify: `src/domain/sessionService.ts`
- Modify: `src/components/chat/ChatHeader.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`

- [ ] **Step 1: Subscribe to transport status in the service**

In `src/domain/sessionService.ts`, in the constructor after the `onMessage` subscription, add status passthrough; and simplify `connect()` (status now comes from the loop):

```ts
constructor(transport: Transport) {
  this.transport = transport
  this.unsubscribe = this.transport.onMessage((msg) => this.receive(msg))
  this.unsubStatus = this.transport.onStatus((s) => useDomainStore.getState().setConnection(s))
}

async connect(): Promise<void> {
  try {
    await this.transport.connect()
  } catch (e) {
    console.error('[SessionService] connect failed', e)
    useDomainStore.getState().setConnection('error')
  }
}

reconnect(): void {
  void this.connect()
}
```

Add `private readonly unsubStatus: () => void` field and call it in `dispose()`. (The `setConnection` signature already accepts `'connecting'|'connected'|'error'|'disconnected'` — matches `ConnectionStatus`.)

- [ ] **Step 2: Add i18n strings**

Add under `chat` (or a new `connection`) in each i18n file (English shown; translate for zh):

```ts
connectionConnected: 'Connected',
connectionConnecting: 'Connecting…',
connectionDisconnected: 'Disconnected',
connectionError: 'Connection error',
connectionRetry: 'Retry',
```

zh-CN: `已连接` / `连接中…` / `已断开` / `连接错误` / `重试`. zh-TW: `已連線` / `連線中…` / `已斷開` / `連線錯誤` / `重試`.

- [ ] **Step 3: Render the indicator in ChatHeader**

In `src/components/chat/ChatHeader.tsx`, add the status dot + retry. Add imports and use `useConnectionStatus`:

```tsx
import { PanelRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import { useActiveSession, useConnectionStatus } from '@/domain'
import { sessionService } from '@/domain'
import { Button } from '@/components/ui/Button'

const DOT: Record<string, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-ink-tertiary',
  error: 'bg-red-500',
}

export function ChatHeader() {
  const { t } = useTranslation()
  const togglePanel = useUiStore((s) => s.togglePanel)
  const active = useActiveSession()
  const status = useConnectionStatus()

  return (
    <div data-tauri-drag-region className="relative flex h-11 shrink-0 items-center border-b border-border bg-surface pl-14 pr-3">
      <span className="pointer-events-none absolute left-1/2 max-w-[50%] -translate-x-1/2 truncate text-[13px] font-medium text-ink">
        {active?.title ?? t('chat.title')}
      </span>
      <div className="flex items-center gap-1.5" data-tauri-drag-region="false">
        <span className={`h-2 w-2 rounded-full ${DOT[status] ?? DOT.disconnected}`} />
        <span className="text-[11px] text-ink-tertiary">{t(`chat.connection${status[0].toUpperCase()}${status.slice(1)}`)}</span>
        {(status === 'error' || status === 'disconnected') && (
          <button onClick={() => sessionService.reconnect()} className="text-[11px] text-accent hover:underline">
            {t('chat.connectionRetry')}
          </button>
        )}
      </div>
      <div className="flex-1" />
      <Button variant="ghost" size="icon" onClick={togglePanel} title={t('chat.togglePanel')} data-tauri-drag-region="false">
        <PanelRight size={17} />
      </Button>
    </div>
  )
}
```

> The i18n key is built as `chat.connectionConnected` etc. Ensure the keys in Step 2 are nested under `chat`.

- [ ] **Step 4: Type-check + visual**

Run: `yarn type-check`
Expected: PASS. Then in the preview, confirm the dot shows green "Connected" when the sidecar is up, and that killing the sidecar flips it to "Disconnected" with a Retry link.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionService.ts src/components/chat/ChatHeader.tsx src/i18n/
git commit -m "feat(chat): connection status indicator with retry"
```

---

## Task 6: Restore a Content-Security-Policy (W5)

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Replace `csp: null`**

In `src-tauri/tauri.conf.json`, set `app.security.csp` to:

```json
"csp": "default-src 'self'; connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:"
```

- [ ] **Step 2: Verify dev + prod for CSP violations**

Run dev: `yarn tauri dev` → open devtools console.
Expected: no `Refused to ... because it violates the Content Security Policy` errors; chat + sidecar WS work.
If violations appear (e.g. Vite HMR, inline styles), widen the offending directive minimally (Tauri injects script nonces for the bundled app; `style-src 'unsafe-inline'` covers the inline `style={{...}}` attributes used by components). Re-test until clean.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "security(tauri): restore a Content-Security-Policy"
```

---

## Task 7: Auth route guard (W7)

**Files:**
- Create: `src/store/authStore.ts`
- Create: `src/routes/RequireAuth.tsx`
- Modify: `src/App.tsx`
- Modify: `src/routes/LoginScreen.tsx`
- Modify: `src/components/sidebar/UserMenu.tsx`

- [ ] **Step 1: Create the persisted (mock) auth store**

```ts
// src/store/authStore.ts
// NOTE: demo/mock auth only — a real OAuth/IdP flow is a separate project.
import { create } from 'zustand'

const KEY = 'hip.authed'

interface AuthState {
  authed: boolean
  login: () => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  authed: localStorage.getItem(KEY) === '1',
  login: () => { localStorage.setItem(KEY, '1'); set({ authed: true }) },
  logout: () => { localStorage.removeItem(KEY); set({ authed: false }) },
}))
```

- [ ] **Step 2: Create the guard**

```tsx
// src/routes/RequireAuth.tsx
import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/store/authStore'

export function RequireAuth({ children }: { children: ReactNode }) {
  const authed = useAuthStore((s) => s.authed)
  return authed ? <>{children}</> : <Navigate to="/login" replace />
}
```

- [ ] **Step 3: Wrap the `/app` route**

In `src/App.tsx`:

```tsx
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom'
import { LoginScreen } from './routes/LoginScreen'
import { AppLayout } from './routes/AppLayout'
import { RequireAuth } from './routes/RequireAuth'

const router = createHashRouter([
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/login', element: <LoginScreen /> },
  { path: '/app', element: <RequireAuth><AppLayout /></RequireAuth> },
])

function App() {
  return <RouterProvider router={router} />
}

export default App
```

- [ ] **Step 4: Set authed on login**

In `src/routes/LoginScreen.tsx`, change `enter` to set auth before navigating:

```tsx
import { useAuthStore } from '@/store/authStore'
// ...
const login = useAuthStore((s) => s.login)
const enter = () => { login(); navigate('/app') }
```

- [ ] **Step 5: Add logout to UserMenu**

In `src/components/sidebar/UserMenu.tsx`, wire a logout item to `useAuthStore().logout()` then `navigate('/login')`. (Read the file first; add a menu item consistent with its existing dropdown items, calling `logout()` and `useNavigate()`.)

- [ ] **Step 6: Type-check + verify guard**

Run: `yarn type-check`
Expected: PASS. Then in the preview: visit `/#/app` directly in a fresh session (clear localStorage) → redirected to `/login`; after clicking a login button → lands on `/app`; logout → back to `/login`.

- [ ] **Step 7: Commit**

```bash
git add src/store/authStore.ts src/routes/RequireAuth.tsx src/App.tsx src/routes/LoginScreen.tsx src/components/sidebar/UserMenu.tsx
git commit -m "feat(auth): guard /app behind a persisted mock login"
```

---

## Task 8: Phase verification

**Files:** none (verification only)

- [ ] **Step 1: Security smoke test — token required**

With the app running, find the sidecar port from the terminal log, then from a normal browser console run `new WebSocket('ws://localhost:PORT')` (no token).
Expected: the connection closes (code 1008). With the correct `?token=` it would stay open — confirms the auth gate.

- [ ] **Step 2: Reconnect smoke test**

Kill the sidecar process (`pkill -f sidecar`) → header shows "Disconnected"; the managed lifecycle / Retry restarts it → header returns to "Connected".

- [ ] **Step 3: Full gate**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check && (cd src-tauri && cargo build && cargo test)`
Expected: all PASS.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §W5 → Tasks 1-3 (token mint/relay/validate) + Task 6 (CSP); §W4 → Tasks 4-5 (reconnect, status, guarded parse, retry) + AppLayout connect cleanup is folded into the reconnect loop (stop on disconnect); §W7 → Task 7. ✅
- **Type consistency:** `ConnectionStatus` defined once in `transport.ts` and imported by `ws-client.ts`/`wsTransport.ts`; `SidecarInfo {port, token}` shape matches across sidecar JSON, Rust `SidecarInfo`, and the frontend `get_sidecar_info` invoke. `get_sidecar_port` removed in Task 3 and replaced everywhere by `get_sidecar_info` (Task 4). ✅
- **i18n keys:** `chat.connection*` keys added in Task 5 Step 2 match the dynamic `t(\`chat.connection${...}\`)` usage; `connectionRetry` is referenced explicitly. ✅
- **No placeholders:** every step has complete code or an explicit file-read instruction (UserMenu Step 5 reads the file first to match its existing dropdown pattern). ✅
- **CSP risk flagged:** Task 6 Step 2 is an explicit tune-against-console loop (CSP always needs environment-specific iteration). ✅
