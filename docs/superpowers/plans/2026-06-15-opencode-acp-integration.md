# OpenCode ACP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenCode a first-class, discoverable agent driven over ACP from the Node sidecar — one warm `opencode acp` process multiplexing many conversations — with streaming reasoning/tools, dual auth, live model selection, HITL permission prompts, graceful cancel/steer, and session reopen.

**Architecture:** A generic `AcpAgentProvider implements AgentProvider` (per hip `Session`) borrows an ACP session from a module-singleton `AcpConnectionManager` that owns one warm child + JSON-RPC connection per agent-config (`Map<acpSessionId, …>`). ACP `session/update` notifications map 1:1 onto the existing `GraphEmit`; two new control-plane message pairs carry HITL permission and model-selector traffic. Persistence/turn-assembly/WS-streaming are reused unchanged; OpenCode is the first `kind:'acp'` instance, with per-agent quirks isolated in a profile map.

**Tech Stack:** TypeScript (Node sidecar, ESM, `node:` built-ins), `@agentclientprotocol/sdk` (pin `0.25.x`), `node:sqlite` (`DatabaseSync`), Vitest, React + Zustand frontend, Tauri/Rust shell (env injection only).

**Spec:** [2026-06-15-opencode-acp-integration-design.md](../specs/2026-06-15-opencode-acp-integration-design.md)

---

## Conventions (read once)

- **Tests run from the REPO ROOT with an explicit file path.** vitest config + `setupFiles` live only at the repo root, so `yarn workspace @hip/sidecar vitest run …` fails (wrong CWD / missing setup file). Use: `yarn vitest run <full/path/from/root/to/file.test.ts>` — e.g. `yarn vitest run packages/sidecar/src/session/agents/acp-provider.test.ts` or `yarn vitest run src/store/agentsStore.test.ts`. **NEVER run `vitest run src` (a bare directory token)** — it substring-matches `packages/sidecar/src` and fires PAID real-LLM suites (`vitest.setup.ts` re-seeds the key from `~/.hip/config/auth.json`). An explicit single-file path runs only that file and is paid-free. All tests in this plan use a **mock ACP agent** (no LLM).
- **ESM import suffix:** intra-package imports use `.js` (e.g. `from './registry.js'`), even from `.ts` files.
- **Type-check:** sidecar → `yarn workspace @hip/sidecar exec tsc --noEmit`; protocol/frontend → `yarn type-check` (root `tsc --noEmit`). `@hip/protocol` is raw TS (`main: src/index.ts`, no build script, no own tsconfig) — it is validated transitively by the sidecar and root type-checks. There is **no** `@hip/protocol build`.
- **Commit** after each task's tests pass. Conventional-commit style: `feat(acp): …`.
- **Branch:** work on `feat/opencode-acp-integration` (already created; the spec commit `fcb2548` is its first commit).

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `packages/sidecar/package.json` | Modify | add `@agentclientprotocol/sdk` dep |
| `packages/protocol/src/index.ts` | Modify | `AgentConfig.kind` += `'acp'`; `AgentConfig.authMode?`, `quirks?`; new message types (`permission:request/respond`, `agent:configOptions/setConfigOption`); `AcpConfigOption`, `PermissionRequestPayload` types |
| `packages/sidecar/src/session/agents/acp-quirks.ts` | Create | per-agent quirk profiles (only `opencode` filled) |
| `packages/sidecar/src/session/agents/acp-connection.ts` | Create | `AcpConnection` (one warm child + JSON-RPC) + `AcpConnectionManager` (singleton pool keyed by agent-config) |
| `packages/sidecar/src/session/agents/acp-provider.ts` | Create | `AcpAgentProvider implements AgentProvider`; borrows a session, maps updates→emit, drives cancel/permission/config |
| `packages/sidecar/src/session/agents/acp-config.ts` | Create | build spawn env + `OPENCODE_CONFIG` file for the two auth modes |
| `packages/sidecar/src/session/agents/index.ts` | Modify | `createAgentProvider`: `case 'acp'` replaces the `'opencode'` Plan-B throw |
| `packages/sidecar/src/session/agents/types.ts` | Create | `ExternalAgentHooks` interface; widen `AgentProvider` |
| `packages/sidecar/src/session/session.ts` | Modify | external branch builds `hooks`; `pendingPermissions` map; `respondPermission()`, `setAgentConfigOption()` |
| `packages/sidecar/src/session/session-manager.ts` | Modify | route `permission:respond`, `agent:setConfigOption` |
| `packages/sidecar/src/persistence/schema.ts` | Modify | migration v9: `ALTER TABLE sessions ADD COLUMN acp_session_id TEXT` |
| `packages/sidecar/src/persistence/store.ts` | Modify | `setAcpSessionId()`, `getAcpSessionId()` |
| `packages/sidecar/src/session/agents/__fixtures__/mock-acp-agent.mjs` | Create | paid-free ACP agent over stdio for tests |
| `src/store/agentsStore.ts` | Modify | surface OpenCode as a built-in enable-able `kind:'acp'` agent |
| `src/components/chat/AgentPicker.tsx` | Modify | list the OpenCode acp agent |
| `src/components/chat/ComposerConfigSelectors.tsx` | Create | model/mode dropdowns from `agent:configOptions` |
| `src/components/chat/PermissionModal.tsx` | Create | HITL approval modal |
| `src/domain/sessionStore.ts` | Modify | intercept `agent:configOptions` + `permission:request` in `apply()` |
| `src/domain/sessionService.ts` | Modify | `respondPermission()`, `setAgentConfigOption()` send helpers |

---

## SLICE 0 — Dependency + mock ACP agent fixture

### Task 0.1: Add the ACP SDK dependency

**Files:**
- Modify: `packages/sidecar/package.json`

- [ ] **Step 1: Add the dependency**

Run: `yarn workspace @hip/sidecar add @agentclientprotocol/sdk@0.25.1`

- [ ] **Step 2: Verify it resolves**

Run: `yarn workspace @hip/sidecar exec node -e "import('@agentclientprotocol/sdk').then(m=>console.log(Object.keys(m).filter(k=>/Connection|ndJson|PROTOCOL/.test(k))))"`
Expected: prints `[ 'AgentSideConnection', 'ClientSideConnection', 'ndJsonStream', 'PROTOCOL_VERSION' ]` (order may vary)

- [ ] **Step 3: Commit**

```bash
git add packages/sidecar/package.json yarn.lock
git commit -m "feat(acp): add @agentclientprotocol/sdk dependency"
```

### Task 0.2: Mock ACP agent fixture (test backbone)

A standalone Node script that speaks ACP over stdio, scripted by env vars so each test drives a deterministic scenario without an LLM. Mirrors the existing `__fixtures__/mock-opencode-server.mjs` convention.

**Files:**
- Create: `packages/sidecar/src/session/agents/__fixtures__/mock-acp-agent.mjs`
- Test: `packages/sidecar/src/session/agents/__fixtures__/mock-acp-agent.test.ts`

- [ ] **Step 1: Write the fixture**

```js
#!/usr/bin/env node
// Minimal ACP AGENT over stdio for paid-free tests. Uses @agentclientprotocol/sdk's
// AgentSideConnection. Behaviour is scripted via env:
//   MOCK_ACP_THINK=1        -> emit an agent_thought_chunk before the answer
//   MOCK_ACP_TOOL=1         -> emit a tool_call + tool_call_update(completed)
//   MOCK_ACP_PERMISSION=1   -> call session/request_permission before the tool runs
//   MOCK_ACP_AUTH_REQUIRED=1-> newSession throws auth_required until authenticate() is called
//   MOCK_ACP_SLOW_MS=<n>    -> delay between answer chunks (so cancel can land mid-stream)
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'

const env = process.env
let authed = !env.MOCK_ACP_AUTH_REQUIRED
let model = 'mock/base'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const agent = {
  async initialize() {
    return {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      authMethods: env.MOCK_ACP_AUTH_REQUIRED ? [{ id: 'mock-login', name: 'Mock Login' }] : [],
    }
  },
  async authenticate() { authed = true; return {} },
  async newSession() {
    if (!authed) { const e = new Error('auth_required'); e.code = -32000; e.data = { authRequired: true }; throw e }
    return {
      sessionId: 'mock-sess-1',
      configOptions: [{ type: 'select', id: 'model', name: 'Model', category: 'model', currentValue: model,
        options: [{ value: 'mock/base', name: 'Base' }, { value: 'mock/other', name: 'Other' }] }],
    }
  },
  async loadSession(p) {
    // replay one prior turn
    await conn.sessionUpdate({ sessionId: p.sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'prior question' } } })
    await conn.sessionUpdate({ sessionId: p.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'prior answer' } } })
    return {}
  },
  async setSessionConfigOption(p) {
    model = p.value
    return { configOptions: [{ type: 'select', id: 'model', name: 'Model', category: 'model', currentValue: model,
      options: [{ value: 'mock/base', name: 'Base' }, { value: 'mock/other', name: 'Other' }] }] }
  },
  async setSessionMode() { return {} },
  async cancel(p) { cancelled.add(p.sessionId) },
  async prompt(p) {
    const sid = p.sessionId
    cancelled.delete(sid)
    if (env.MOCK_ACP_THINK) await conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking… ' } } })
    if (env.MOCK_ACP_PERMISSION) {
      const res = await conn.requestPermission({ sessionId: sid, toolCall: { toolCallId: 't1', title: 'edit hello.txt', kind: 'edit' },
        options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }] })
      if (res.outcome?.outcome !== 'selected') return { stopReason: 'cancelled' }
    }
    if (env.MOCK_ACP_TOOL) {
      await conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'edit hello.txt', kind: 'edit', status: 'in_progress' } })
      await conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'wrote file' } }] } })
    }
    const words = [`answer(${model}): `, 'hello', ' ', 'world']
    for (const w of words) {
      if (cancelled.has(sid)) return { stopReason: 'cancelled' }
      await conn.sessionUpdate({ sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: w } } })
      if (env.MOCK_ACP_SLOW_MS) await sleep(Number(env.MOCK_ACP_SLOW_MS))
    }
    return { stopReason: 'end_turn' }
  },
}
const cancelled = new Set()
const conn = new AgentSideConnection(() => agent, ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
```

- [ ] **Step 2: Write the smoke test (failing)**

```ts
import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const here = dirname(fileURLToPath(import.meta.url))
const AGENT = join(here, 'mock-acp-agent.mjs')

describe('mock-acp-agent fixture', () => {
  it('initializes, creates a session, and streams an answer', async () => {
    const child = spawn('node', [AGENT], { stdio: ['pipe', 'pipe', 'inherit'] })
    const updates: any[] = []
    const conn = new ClientSideConnection(
      () => ({ async sessionUpdate(p) { updates.push(p) }, async requestPermission() { return { outcome: { outcome: 'cancelled' } } } }),
      ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
    )
    await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const s = await conn.newSession({ cwd: process.cwd(), mcpServers: [] })
    const res = await conn.prompt({ sessionId: s.sessionId, prompt: [{ type: 'text', text: 'hi' }] })
    child.kill('SIGTERM')
    expect(res.stopReason).toBe('end_turn')
    const text = updates.filter((u) => u.update?.sessionUpdate === 'agent_message_chunk').map((u) => u.update.content.text).join('')
    expect(text).toContain('hello world')
  })
})
```

- [ ] **Step 3: Run — expect FAIL** (fixture not yet executable / wiring)

Run: `yarn vitest run packages/sidecar/src/session/agents/__fixtures__/mock-acp-agent.test.ts`
Expected: FAIL initially if any wiring is off; iterate the fixture until green.

- [ ] **Step 4: Make executable + run — expect PASS**

Run: `chmod +x packages/sidecar/src/session/agents/__fixtures__/mock-acp-agent.mjs && yarn vitest run packages/sidecar/src/session/agents/__fixtures__/mock-acp-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/agents/__fixtures__/mock-acp-agent.mjs packages/sidecar/src/session/agents/__fixtures__/mock-acp-agent.test.ts
git commit -m "test(acp): paid-free mock ACP agent fixture over stdio"
```

---

## SLICE 1 — Protocol types, connection manager, provider skeleton, factory wiring

### Task 1.1: Extend `AgentConfig` for `kind:'acp'` + authMode + quirks

**Files:**
- Modify: `packages/protocol/src/index.ts:649-660` (the `AgentConfig` interface)
- Test: `packages/protocol/src/agent-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import type { AgentConfig } from './index.js'

describe('AgentConfig acp kind', () => {
  it('accepts an acp agent with authMode and quirks', () => {
    const a: AgentConfig = {
      id: 'opencode', name: 'OpenCode', kind: 'acp', command: 'opencode', args: ['acp', '--pure'],
      transport: 'rich', acceptsModelConfig: true, authMode: 'opencode-self', quirks: 'opencode', enabled: true,
    }
    expect(a.kind).toBe('acp')
    expect(a.authMode).toBe('opencode-self')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (type error: `'acp'` not assignable, `authMode`/`quirks` unknown)

Run: `yarn vitest run packages/protocol/src/agent-config.test.ts`
Expected: FAIL (TS2322 / excess property)

- [ ] **Step 3: Edit the type**

In `packages/protocol/src/index.ts`, change the `AgentConfig` interface:

```ts
export type AgentAuthMode = 'hip-managed' | 'opencode-self'

export interface AgentConfig {
  id: string                          // nanoid
  name: string                        // display name
  kind: 'custom' | 'opencode' | 'acp' // selects the provider/adapter
  command: string                     // executable (PATH name or absolute path)
  args: string[]                      // static launch args
  transport: AgentTransport
  acceptsModelConfig: boolean
  boundModel?: BoundModel             // required iff acceptsModelConfig and the user picked a model
  authMode?: AgentAuthMode            // acp only: who supplies the model+key (default 'opencode-self')
  quirks?: string                     // acp only: per-agent quirk-profile key (e.g. 'opencode')
  env?: Record<string, string>        // advanced manual env overrides
  enabled: boolean
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `yarn vitest run packages/protocol/src/agent-config.test.ts && yarn type-check`
Expected: PASS + clean build

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/index.ts packages/protocol/src/agent-config.test.ts
git commit -m "feat(acp): AgentConfig gains kind:'acp', authMode, quirks"
```

### Task 1.2: New protocol message + payload types

**Files:**
- Modify: `packages/protocol/src/index.ts` (ClientMessage union ~209-238, ServerMessage union ~240-276, add payload types near `TurnUsage`)
- Test: `packages/protocol/src/acp-messages.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import type { ClientMessage, ServerMessage, AcpConfigOption, PermissionRequestPayload } from './index.js'

describe('acp control-plane messages', () => {
  it('types the new server/client messages', () => {
    const req: ServerMessage = { type: 'permission:request', sessionId: 's', turnId: 't', requestId: 'r',
      tool: { title: 'edit', kind: 'edit' }, options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }] }
    const resp: ClientMessage = { type: 'permission:respond', sessionId: 's', requestId: 'r', optionId: 'once' }
    const opts: ServerMessage = { type: 'agent:configOptions', sessionId: 's', options: [] }
    const set: ClientMessage = { type: 'agent:setConfigOption', sessionId: 's', configId: 'model', value: 'mock/other' }
    const o: AcpConfigOption = { id: 'model', name: 'Model', category: 'model', currentValue: 'a', options: [{ value: 'a', name: 'A' }] }
    const p: PermissionRequestPayload = req.type === 'permission:request' ? req.tool : { title: '', kind: 'other' }
    expect([req, resp, opts, set, o, p]).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `yarn vitest run packages/protocol/src/acp-messages.test.ts`
Expected: FAIL (unknown types / members)

- [ ] **Step 3: Add the payload types** (near `TurnUsage`, ~line 75)

```ts
/** One agent-advertised session config selector (model/mode/reasoning level). */
export interface AcpConfigOption {
  id: string
  name: string
  category?: 'model' | 'mode' | 'thought_level' | string
  currentValue: string
  options: Array<{ value: string; name: string; description?: string }>
}

/** The tool a permission request is gating, rendered in the HITL modal. */
export interface PermissionRequestPayload {
  title: string
  kind: string                      // read|edit|delete|execute|fetch|other
  diff?: { path: string; oldText: string; newText: string }
  content?: string
}

/** A choice the agent offers for a permission request. */
export interface PermissionOption {
  optionId: string
  name: string
  kind: string                      // allow_once|allow_always|reject_once|reject_always
}
```

- [ ] **Step 4: Add the ClientMessage arms** (inside the `ClientMessage` union, ~line 209-238)

```ts
  | { type: 'permission:respond'; sessionId: string; requestId: string; optionId?: string; cancelled?: boolean }
  | { type: 'agent:setConfigOption'; sessionId: string; configId: string; value: string }
```

- [ ] **Step 5: Add the ServerMessage arms** (inside the `ServerMessage` union, ~line 240-276)

```ts
  | { type: 'permission:request'; sessionId: string; turnId: string; requestId: string; tool: PermissionRequestPayload; options: PermissionOption[] }
  | { type: 'agent:configOptions'; sessionId: string; options: AcpConfigOption[] }
```

- [ ] **Step 6: Run — expect PASS**

Run: `yarn vitest run packages/protocol/src/acp-messages.test.ts && yarn type-check`
Expected: PASS + clean build

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/index.ts packages/protocol/src/acp-messages.test.ts
git commit -m "feat(acp): permission + configOptions message types"
```

### Task 1.3: `ExternalAgentHooks` + widen `AgentProvider`

**Files:**
- Create: `packages/sidecar/src/session/agents/types.ts`
- Modify: `packages/sidecar/src/session/agents/loop-provider.ts:13-15` (the `AgentProvider` interface) — move/re-export it, or widen in place
- Test: `packages/sidecar/src/session/agents/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import type { AgentProvider, ExternalAgentHooks } from './types.js'
import type { GraphEmit } from '../graph.js'

describe('AgentProvider widened contract', () => {
  it('allows an optional hooks arg and optional control methods', () => {
    const hooks: ExternalAgentHooks = { requestPermission: async () => ({ cancelled: true }), configOptions: () => {} }
    const p: AgentProvider = {
      async runTurn(_t: string, _e: GraphEmit, _s: AbortSignal, _h?: ExternalAgentHooks) {},
      dispose() {},
      async setConfigOption() {},
      respondPermission() {},
    }
    expect(typeof p.runTurn).toBe('function')
    expect(hooks).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `yarn vitest run packages/sidecar/src/session/agents/types.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Create `types.ts`**

```ts
import type { GraphEmit } from '../graph.js'
import type { AcpConfigOption, PermissionRequestPayload, PermissionOption } from '@hip/protocol'

export type PermissionChoice = { optionId: string } | { cancelled: true }

/** Out-of-band sinks an external provider may drive during a turn (beyond GraphEmit). */
export interface ExternalAgentHooks {
  /** Agent → client permission request; resolves with the user's choice. Blocks the agent's tool. */
  requestPermission(req: { requestId: string; tool: PermissionRequestPayload; options: PermissionOption[] }): Promise<PermissionChoice>
  /** Agent advertises/updates its session config selectors (model/mode). */
  configOptions(options: AcpConfigOption[]): void
}

/** A turn-level agent. The built-in agent stays inline in Session; this is the external seam. */
export interface AgentProvider {
  runTurn(text: string, emit: GraphEmit, signal: AbortSignal, hooks?: ExternalAgentHooks): Promise<void>
  dispose(): void
  /** ACP control-plane: switch the live model/mode. Optional (custom CLI agents omit it). */
  setConfigOption?(configId: string, value: string): Promise<void>
}
```

> Pending-permission state lives in `Session` (resolved by `Session.respondPermission`, wired via `ExternalAgentHooks.requestPermission`), NOT in the provider — so `AgentProvider` needs no `respondPermission`. `PermissionChoice` is still exported for the hooks return type.

- [ ] **Step 4: Re-export from `loop-provider.ts`**

In `packages/sidecar/src/session/agents/loop-provider.ts`, delete the local `AgentProvider` interface (lines ~11-15) and replace with:

```ts
import type { AgentProvider } from './types.js'
export type { AgentProvider } from './types.js'
```

Update the class declaration to `export class LoopAgentProvider implements AgentProvider` (unchanged); its `runTurn(text, emit, signal)` still satisfies the widened interface because `hooks` is optional.

- [ ] **Step 5: Run — expect PASS**

Run: `yarn vitest run packages/sidecar/src/session/agents/types.test.ts && yarn workspace @hip/sidecar exec tsc --noEmit`
Expected: PASS + clean type-check (LoopAgentProvider still compiles)

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/agents/types.ts packages/sidecar/src/session/agents/loop-provider.ts packages/sidecar/src/session/agents/types.test.ts
git commit -m "feat(acp): ExternalAgentHooks + widened AgentProvider contract"
```

### Task 1.4: `acp-quirks.ts`

**Files:**
- Create: `packages/sidecar/src/session/agents/acp-quirks.ts`
- Test: `packages/sidecar/src/session/agents/acp-quirks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { quirksFor } from './acp-quirks.js'

describe('acp quirks', () => {
  it('returns the opencode profile', () => {
    const q = quirksFor('opencode')
    expect(q.cancelReportsEndTurn).toBe(true)
    expect(q.defaultModelIsBilled).toBe(true)
  })
  it('returns safe defaults for unknown keys', () => {
    const q = quirksFor(undefined)
    expect(q.cancelReportsEndTurn).toBe(false)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-quirks.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

```ts
export interface AcpQuirks {
  /** Agent returns stopReason 'end_turn' (not 'cancelled') on a genuine cancel — rely on our own abort flag. */
  cancelReportsEndTurn: boolean
  /** Agent's default model is billed/hosted — Mode A must set an explicit model. */
  defaultModelIsBilled: boolean
}

const DEFAULTS: AcpQuirks = { cancelReportsEndTurn: false, defaultModelIsBilled: false }

const PROFILES: Record<string, Partial<AcpQuirks>> = {
  opencode: { cancelReportsEndTurn: true, defaultModelIsBilled: true },
}

export function quirksFor(key: string | undefined): AcpQuirks {
  return { ...DEFAULTS, ...(key ? PROFILES[key] ?? {} : {}) }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-quirks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/agents/acp-quirks.ts packages/sidecar/src/session/agents/acp-quirks.test.ts
git commit -m "feat(acp): per-agent quirks profile (opencode)"
```

### Task 1.5: `AcpConnection` + `AcpConnectionManager` (warm process, many sessions)

**Files:**
- Create: `packages/sidecar/src/session/agents/acp-connection.ts`
- Test: `packages/sidecar/src/session/agents/acp-connection.test.ts`

- [ ] **Step 1: Write the failing test** (one child, two sessions, refcount keeps it warm)

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chmodSync } from 'node:fs'
import { AcpConnectionManager } from './acp-connection.js'

const here = dirname(fileURLToPath(import.meta.url))
const AGENT = join(here, '__fixtures__', 'mock-acp-agent.mjs')
chmodSync(AGENT, 0o755)

const mgr = new AcpConnectionManager()
afterEach(() => mgr.disposeAll())

function agentCfg(): any {
  return { id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT], transport: 'rich', acceptsModelConfig: false, enabled: true }
}

describe('AcpConnectionManager', () => {
  it('multiplexes two sessions over ONE child process', async () => {
    const conn = await mgr.acquire(agentCfg(), null)
    const a = await conn.newSession(process.cwd())
    const b = await conn.newSession(process.cwd())
    expect(conn.childPid).toBeGreaterThan(0)
    expect(a).not.toBe(b)
    expect(conn.sessionCount).toBe(2)
    conn.releaseSession(a)
    expect(conn.sessionCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-connection.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `acp-connection.ts`**

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { AgentConfig } from '@hip/protocol'
import type { ResolvedModel } from './registry.js'
import { buildAcpSpawn } from './acp-config.js'

/** Per-ACP-session handlers, registered by the provider for the duration of a turn. */
export interface AcpSessionSink {
  onUpdate(update: any): void
  onPermission(req: any): Promise<{ outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } }>
}

/** One warm `<agent> acp` child + JSON-RPC connection, multiplexing many ACP sessions. */
export class AcpConnection {
  private child: ChildProcessWithoutNullStreams
  private conn: ClientSideConnection
  private initPromise: Promise<void> | null = null
  private readonly sinks = new Map<string, AcpSessionSink>()
  private refs = 0

  constructor(private readonly agent: AgentConfig, private readonly model: ResolvedModel | null) {
    const { command, args, env } = buildAcpSpawn(agent, model)
    this.child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stderr.setEncoding('utf8')
    this.conn = new ClientSideConnection(
      () => ({
        sessionUpdate: async (p: any) => { this.sinks.get(p.sessionId)?.onUpdate(p.update) },
        requestPermission: async (p: any) => {
          const sink = this.sinks.get(p.sessionId)
          if (!sink) return { outcome: { outcome: 'cancelled' } }
          return sink.onPermission(p)
        },
        readTextFile: async () => ({ content: '' }),
        writeTextFile: async () => ({}),
      }),
      ndJsonStream(Writable.toWeb(this.child.stdin), Readable.toWeb(this.child.stdout)),
    )
  }

  get childPid(): number { return this.child.pid ?? -1 }
  get sessionCount(): number { return this.sinks.size }

  private ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.conn
        .initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } })
        .then(() => undefined)
    }
    return this.initPromise
  }

  /** Create a new ACP session (cwd-scoped). Authenticates on demand if the agent demands it. */
  async newSession(cwd: string): Promise<string> {
    await this.ensureInit()
    try {
      const r = await this.conn.newSession({ cwd, mcpServers: [] })
      return r.sessionId
    } catch (e: any) {
      if (this.isAuthRequired(e)) {
        await this.conn.authenticate({ methodId: await this.firstAuthMethod() })
        const r = await this.conn.newSession({ cwd, mcpServers: [] })
        return r.sessionId
      }
      throw e
    }
  }

  async loadSession(acpSessionId: string, cwd: string): Promise<void> {
    await this.ensureInit()
    await this.conn.loadSession({ sessionId: acpSessionId, cwd, mcpServers: [] })
  }

  async newSessionWithOptions(cwd: string): Promise<{ sessionId: string; configOptions: any[] }> {
    await this.ensureInit()
    const r = await this.conn.newSession({ cwd, mcpServers: [] })
    return { sessionId: r.sessionId, configOptions: r.configOptions ?? [] }
  }

  registerSink(acpSessionId: string, sink: AcpSessionSink): void { this.sinks.set(acpSessionId, sink); this.refs++ }
  releaseSession(acpSessionId: string): void { if (this.sinks.delete(acpSessionId)) this.refs = Math.max(0, this.refs - 1) }

  prompt(acpSessionId: string, text: string): Promise<{ stopReason: string }> {
    return this.conn.prompt({ sessionId: acpSessionId, prompt: [{ type: 'text', text }] }) as Promise<{ stopReason: string }>
  }
  cancel(acpSessionId: string): Promise<void> { return this.conn.cancel({ sessionId: acpSessionId }) as Promise<void> }
  setConfigOption(acpSessionId: string, configId: string, value: string): Promise<any> {
    return this.conn.setSessionConfigOption({ sessionId: acpSessionId, configId, value })
  }

  get isIdle(): boolean { return this.refs === 0 }
  dispose(): void { try { this.child.kill('SIGTERM') } catch { /* already dead */ } }

  private isAuthRequired(e: any): boolean {
    return !!(e && (e.data?.authRequired || /auth_required|authentication required/i.test(String(e.message ?? ''))))
  }
  private async firstAuthMethod(): Promise<string> {
    // initialize() result isn't retained here; OpenCode advertises 'opencode-login'. Re-init is cheap.
    const r = await this.conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    return r.authMethods?.[0]?.id ?? 'login'
  }
}

/** Module-singleton pool: one AcpConnection per agent-config key, shared across hip Sessions. */
export class AcpConnectionManager {
  private readonly conns = new Map<string, AcpConnection>()

  private key(agent: AgentConfig, model: ResolvedModel | null): string {
    return JSON.stringify([agent.id, agent.authMode ?? 'opencode-self', agent.boundModel ?? null, model ?? null, agent.command, agent.args, agent.env ?? null])
  }

  async acquire(agent: AgentConfig, model: ResolvedModel | null): Promise<AcpConnection> {
    const k = this.key(agent, model)
    let c = this.conns.get(k)
    if (!c) { c = new AcpConnection(agent, model); this.conns.set(k, c) }
    return c
  }

  disposeAll(): void { for (const c of this.conns.values()) c.dispose(); this.conns.clear() }
}

/** Process-wide pool. Disposed on sidecar shutdown (see main.ts). */
export const acpConnections = new AcpConnectionManager()
```

- [ ] **Step 4: Run — expect PASS**

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-connection.test.ts`
Expected: PASS (note: this depends on Task 3.1's `acp-config.ts`; if not yet created, add a temporary stub `export function buildAcpSpawn(agent, _m){ return { command: agent.command, args: agent.args, env: { ...process.env } } }` and replace it in Task 3.1)

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/agents/acp-connection.ts packages/sidecar/src/session/agents/acp-connection.test.ts
git commit -m "feat(acp): warm AcpConnection + AcpConnectionManager (one child, many sessions)"
```

### Task 1.6: `AcpAgentProvider` skeleton + factory wiring

**Files:**
- Create: `packages/sidecar/src/session/agents/acp-provider.ts`
- Modify: `packages/sidecar/src/session/agents/index.ts:8-18` (factory `case 'acp'`)
- Test: `packages/sidecar/src/session/agents/acp-provider.test.ts`

- [ ] **Step 1: Write the failing test** (basic turn: text streams through `cap()` emit)

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chmodSync } from 'node:fs'
import type { GraphEmit } from '../graph.js'
import { AcpAgentProvider } from './acp-provider.js'
import { acpConnections } from './acp-connection.js'

const here = dirname(fileURLToPath(import.meta.url))
const AGENT = join(here, '__fixtures__', 'mock-acp-agent.mjs'); chmodSync(AGENT, 0o755)
afterEach(() => acpConnections.disposeAll())

function cap() {
  const out = { text: '', reasoning: '', tools: [] as string[][], toolEnds: [] as string[][] }
  const emit: GraphEmit = { token: (d) => { out.text += d }, reasoning: (d) => { out.reasoning += d },
    toolStarted: (n, id) => { out.tools.push([id, n]) }, toolFinished: (id, s) => { out.toolEnds.push([id, s]) }, usage: () => {} }
  return { emit, out }
}
function cfg(extra: any = {}): any {
  return { id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT], transport: 'rich', acceptsModelConfig: false, enabled: true, ...extra }
}

describe('AcpAgentProvider', () => {
  it('streams an answer through emit.token and resolves on end_turn', async () => {
    const p = new AcpAgentProvider(cfg(), process.cwd(), null)
    const a = cap()
    await p.runTurn('hi', a.emit, new AbortController().signal)
    expect(a.out.text).toContain('hello world')
    p.dispose()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-provider.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `acp-provider.ts`** (skeleton — streaming map filled in Slice 2/4/5; this version handles text + done)

```ts
import type { AgentConfig } from '@hip/protocol'
import type { GraphEmit } from '../graph.js'
import type { AgentProvider, ExternalAgentHooks, PermissionChoice } from './types.js'
import type { ResolvedModel } from './registry.js'
import { acpConnections, type AcpConnection } from './acp-connection.js'
import { quirksFor } from './acp-quirks.js'

function abortError(): Error { const e = new Error('aborted'); e.name = 'AbortError'; return e }

export class AcpAgentProvider implements AgentProvider {
  private conn: AcpConnection | null = null
  private acpSessionId: string | null = null
  private readonly quirks = quirksFor(this.agent.quirks)
  private currentHooks: ExternalAgentHooks | null = null

  constructor(
    private readonly agent: AgentConfig,
    private readonly cwd: string,
    private readonly model: ResolvedModel | null,
    /** When set, reopen this prior ACP session via loadSession instead of newSession. */
    private resumeAcpSessionId: string | null = null,
  ) {}

  /** Exposed so Session can persist the ACP session id after the first turn. */
  get sessionId(): string | null { return this.acpSessionId }

  private async ensureSession(): Promise<{ conn: AcpConnection; sid: string }> {
    if (!this.conn) this.conn = await acpConnections.acquire(this.agent, this.model)
    if (!this.acpSessionId) {
      if (this.resumeAcpSessionId) {
        await this.conn.loadSession(this.resumeAcpSessionId, this.cwd)
        this.acpSessionId = this.resumeAcpSessionId
      } else {
        const { sessionId, configOptions } = await this.conn.newSessionWithOptions(this.cwd)
        this.acpSessionId = sessionId
        this.currentHooks?.configOptions(normalizeConfigOptions(configOptions))
      }
    }
    return { conn: this.conn, sid: this.acpSessionId }
  }

  async runTurn(text: string, emit: GraphEmit, signal: AbortSignal, hooks?: ExternalAgentHooks): Promise<void> {
    if (signal.aborted) throw abortError()
    this.currentHooks = hooks ?? null
    const { conn, sid } = await this.ensureSession()

    conn.registerSink(sid, {
      onUpdate: (u) => this.applyUpdate(u, emit),
      onPermission: async (p) => {
        const choice = hooks
          ? await hooks.requestPermission({ requestId: p.toolCall?.toolCallId ?? `perm-${Date.now()}`, tool: mapTool(p.toolCall), options: p.options ?? [] })
          : ({ cancelled: true } as PermissionChoice)
        return 'optionId' in choice
          ? { outcome: { outcome: 'selected', optionId: choice.optionId } }
          : { outcome: { outcome: 'cancelled' } }
      },
    })

    let aborted = false
    const onAbort = () => { aborted = true; void conn.cancel(sid) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      await conn.prompt(sid, text)
      // Do NOT trust stopReason for cancellation (quirks.cancelReportsEndTurn): rely on our own flag.
      if (aborted) throw abortError()
    } finally {
      signal.removeEventListener('abort', onAbort)
      conn.releaseSession(sid)
    }
  }

  private applyUpdate(u: any, emit: GraphEmit): void {
    switch (u?.sessionUpdate) {
      case 'agent_message_chunk': { const t = textOf(u.content); if (t) emit.token(t); break }
      case 'agent_thought_chunk': { const t = textOf(u.content); if (t) emit.reasoning(t); break }
      // tool + configOptions handled in Slice 2/4
    }
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    if (!this.conn || !this.acpSessionId) return
    const res = await this.conn.setConfigOption(this.acpSessionId, configId, value)
    this.currentHooks?.configOptions(normalizeConfigOptions(res?.configOptions ?? []))
  }

  dispose(): void {
    if (this.conn && this.acpSessionId) this.conn.releaseSession(this.acpSessionId)
    // The connection stays warm for other conversations; the manager disposes it on shutdown.
    this.conn = null
  }
}

function textOf(content: any): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content.type === 'text' ? (content.text ?? '') : ''
}
function mapTool(tc: any) {
  return { title: tc?.title ?? tc?.kind ?? 'tool', kind: tc?.kind ?? 'other' }
}
function normalizeConfigOptions(opts: any[]): any[] {
  return (opts ?? []).filter((o) => o?.type === 'select').map((o) => ({
    id: o.id, name: o.name, category: o.category, currentValue: o.currentValue,
    options: (Array.isArray(o.options) ? o.options : []).map((x: any) => ({ value: x.value, name: x.name, description: x.description })),
  }))
}
```

> Note: the `pendingPerm`/`requestPermission` wiring is completed in Slice 5; the skeleton's `onPermission` resolves immediately via `hooks.requestPermission`, which Slice 5 makes round-trip to the UI.

- [ ] **Step 4: Wire the factory** — edit `packages/sidecar/src/session/agents/index.ts`

```ts
import type { AgentConfig } from '@hip/protocol'
import { LoopAgentProvider } from './loop-provider.js'
import { AcpAgentProvider } from './acp-provider.js'
import type { ResolvedModel } from './registry.js'
import type { AgentProvider } from './types.js'

export { readAgentsConfig, resolveAgentModel, type ResolvedModel } from './registry.js'
export type { AgentProvider } from './types.js'

export function createAgentProvider(agent: AgentConfig, cwd: string, model: ResolvedModel | null): AgentProvider {
  switch (agent.kind) {
    case 'custom':
      return new LoopAgentProvider(agent, cwd, model)
    case 'acp':
    case 'opencode': // legacy alias → ACP
      return new AcpAgentProvider(agent, cwd, model)
    default:
      throw new Error(`Unknown agent kind: ${(agent as { kind?: string }).kind}`)
  }
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-provider.test.ts && yarn workspace @hip/sidecar exec tsc --noEmit`
Expected: PASS + clean type-check

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/agents/acp-provider.ts packages/sidecar/src/session/agents/index.ts packages/sidecar/src/session/agents/acp-provider.test.ts
git commit -m "feat(acp): AcpAgentProvider skeleton + factory kind:'acp' (replaces Plan-B throw)"
```

### Task 1.7: Connection-fault handling (spec §12 fan-out)

When the warm `opencode acp` child dies, in-flight prompts must reject (so the turn surfaces a structured error, not a hang) and the dead connection must be evicted from the manager so the next `acquire` spawns fresh.

**Files:**
- Modify: `packages/sidecar/src/session/agents/acp-connection.ts` (child `exit`/`error` listeners; manager eviction callback)
- Test: `packages/sidecar/src/session/agents/acp-connection.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
it('evicts a dead connection so the next acquire spawns a fresh child', async () => {
  const conn = await mgr.acquire(agentCfg(), null)
  const pid1 = conn.childPid
  conn.dispose()                       // simulate death
  await new Promise((r) => setTimeout(r, 100))
  const conn2 = await mgr.acquire(agentCfg(), null)
  expect(conn2.childPid).not.toBe(pid1) // fresh child, not the dead one
})
```

- [ ] **Step 2: Run — expect FAIL** (manager returns the same dead connection)

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-connection.test.ts -t 'evicts'`
Expected: FAIL

- [ ] **Step 3: Add `onClosed` + child listeners to `AcpConnection`** (in the constructor, after `this.child = spawn(...)`):

```ts
    this.child.on('exit', () => this.handleClosed(new Error('acp agent process exited')))
    this.child.on('error', (err) => this.handleClosed(new Error(`acp agent process error: ${err.message}`)))
```

Add the field + handler + eviction hook to `AcpConnection`:

```ts
  private closed = false
  /** Set by the manager so a dead child evicts itself from the pool. */
  onClosed: (() => void) | null = null
  private handleClosed(_err: Error): void {
    if (this.closed) return
    this.closed = true
    this.sinks.clear()
    this.onClosed?.()
    // In-flight conn.prompt(...) promises reject on their own when the ndJson stream closes.
  }
  get isClosed(): boolean { return this.closed }
```

In `AcpConnectionManager.acquire`, evict closed connections and register the eviction callback:

```ts
  async acquire(agent: AgentConfig, model: ResolvedModel | null): Promise<AcpConnection> {
    const k = this.key(agent, model)
    let c = this.conns.get(k)
    if (c?.isClosed) { this.conns.delete(k); c = undefined }
    if (!c) {
      c = new AcpConnection(agent, model)
      c.onClosed = () => { if (this.conns.get(k) === c) this.conns.delete(k) }
      this.conns.set(k, c)
    }
    return c
  }
```

- [ ] **Step 4: Run — expect PASS**

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-connection.test.ts && yarn workspace @hip/sidecar exec tsc --noEmit`
Expected: PASS + clean type-check

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/agents/acp-connection.ts packages/sidecar/src/session/agents/acp-connection.test.ts
git commit -m "feat(acp): evict dead ACP connections + reject in-flight on child death"
```

---

## SLICE 2 — Streaming map (tools) + cancel + e2e

### Task 2.1: Map tool_call / tool_call_update → emit

**Files:**
- Modify: `packages/sidecar/src/session/agents/acp-provider.ts` (`applyUpdate`)
- Test: `packages/sidecar/src/session/agents/acp-provider.test.ts` (add cases)

- [ ] **Step 1: Add the failing tests**

```ts
it('maps thought chunks to reasoning and tool calls to toolStarted/toolFinished', async () => {
  const p = new AcpAgentProvider(cfg(), process.cwd(), null)
  const a = cap()
  // drive the mock to emit a thought + a tool by spawning it with env via a dedicated agent cfg
  process.env.MOCK_ACP_THINK = '1'; process.env.MOCK_ACP_TOOL = '1'
  await p.runTurn('hi', a.emit, new AbortController().signal)
  delete process.env.MOCK_ACP_THINK; delete process.env.MOCK_ACP_TOOL
  expect(a.out.reasoning).toContain('thinking')
  expect(a.out.tools).toEqual([['t1', 'edit hello.txt']])
  expect(a.out.toolEnds).toEqual([['t1', 'finished']])
  p.dispose()
})
```

> The mock reads `MOCK_ACP_*` from its own `process.env`; since the provider inherits `process.env` when spawning (see `buildAcpSpawn`), setting them in the test before `runTurn` is sufficient. (If `buildAcpSpawn` later sanitizes env, pass them via `cfg({ env: { MOCK_ACP_THINK: '1', MOCK_ACP_TOOL: '1' } })` instead.)

- [ ] **Step 2: Run — expect FAIL** (tools/reasoning empty)

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-provider.test.ts -t 'tool calls'`
Expected: FAIL

- [ ] **Step 3: Extend `applyUpdate`**

```ts
  private applyUpdate(u: any, emit: GraphEmit): void {
    switch (u?.sessionUpdate) {
      case 'agent_message_chunk': { const t = textOf(u.content); if (t) emit.token(t); break }
      case 'agent_thought_chunk': { const t = textOf(u.content); if (t) emit.reasoning(t); break }
      case 'tool_call':
        emit.toolStarted(u.title ?? u.kind ?? 'tool', u.toolCallId, u.rawInput ?? u.kind ?? '')
        break
      case 'tool_call_update':
        if (u.status === 'completed' || u.status === 'failed') {
          const out = toolText(u.content) ?? (u.rawOutput !== undefined ? JSON.stringify(u.rawOutput) : undefined)
          emit.toolFinished(u.toolCallId, u.status === 'completed' ? 'finished' : 'error', out, u.status === 'failed' ? (out ?? 'error') : undefined)
        }
        break
      case 'config_option_update':
        this.currentHooks?.configOptions(normalizeConfigOptions(u.configOptions ?? []))
        break
    }
  }
```

Add the helper:

```ts
function toolText(content: any): string | undefined {
  if (!Array.isArray(content)) return undefined
  const parts = content.map((c) => (c?.type === 'content' ? textOf(c.content) : c?.type === 'diff' ? `--- ${c.path}\n${c.newText ?? ''}` : '')).filter(Boolean)
  return parts.length ? parts.join('\n') : undefined
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-provider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/agents/acp-provider.ts packages/sidecar/src/session/agents/acp-provider.test.ts
git commit -m "feat(acp): map tool_call/tool_call_update + config_option_update"
```

### Task 2.2: Cancel via abort flag (don't trust stopReason)

**Files:**
- Test: `packages/sidecar/src/session/agents/acp-provider.test.ts`

The provider logic from Task 1.6 already sends `conn.cancel(sid)` on abort and throws `abortError()` when `aborted`. This task locks it with a test against the slow mock.

- [ ] **Step 1: Add the failing test**

```ts
it('cancel mid-stream rejects with AbortError even though the agent reports end_turn', async () => {
  const p = new AcpAgentProvider(cfg({ env: { MOCK_ACP_SLOW_MS: '200' } }), process.cwd(), null)
  const ac = new AbortController()
  const a = cap()
  const turn = p.runTurn('hi', a.emit, ac.signal)
  setTimeout(() => ac.abort(), 120) // abort after the first chunk
  await expect(turn).rejects.toThrowError(/abort/i)
  p.dispose()
})
```

- [ ] **Step 2: Run — expect PASS** (logic already present)

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-provider.test.ts -t 'cancel mid-stream'`
Expected: PASS. If FAIL, verify `runTurn` re-throws `abortError()` when `aborted` is true after `conn.prompt` resolves.

- [ ] **Step 3: Commit**

```bash
git add packages/sidecar/src/session/agents/acp-provider.test.ts
git commit -m "test(acp): cancel rejects with AbortError despite end_turn stopReason"
```

### Task 2.3: Wire `hooks` into Session's external branch + e2e

**Files:**
- Modify: `packages/sidecar/src/session/session.ts` (external branch ~714-721; build `hooks`; add `pendingPermissions` field + `respondPermission`/`setAgentConfigOption` methods — permission round-trip completed in Slice 5 but the hooks object is built here)
- Test: `packages/sidecar/src/session/external-acp.integration.test.ts`

- [ ] **Step 1: Build `hooks` in the external branch**

In `session.ts`, locate the external branch (~714-721):

```ts
if (this.isExternalAgent()) {
  // No awaiting_user path — external agents drive HITL via the hooks below.
  const hooks: ExternalAgentHooks = {
    requestPermission: (req) => new Promise((resolve) => {
      this.pendingPermissions.set(req.requestId, resolve)
      send({ type: 'permission:request', sessionId: this.id, turnId, requestId: req.requestId, tool: req.tool, options: req.options })
    }),
    configOptions: (options) => send({ type: 'agent:configOptions', sessionId: this.id, options }),
  }
  await this.ensureExternalProvider().runTurn(userText, emit, this.abortController.signal, hooks)
  closeReasoning('supervisor'); finishRemaining()
}
```

Add the field + methods to the `Session` class (near other fields ~210, and as public methods):

```ts
  private readonly pendingPermissions = new Map<string, (c: { optionId: string } | { cancelled: true }) => void>()

  respondPermission(requestId: string, choice: { optionId: string } | { cancelled: true }): void {
    const resolve = this.pendingPermissions.get(requestId)
    if (resolve) { this.pendingPermissions.delete(requestId); resolve(choice) }
  }

  async setAgentConfigOption(configId: string, value: string): Promise<void> {
    await this.externalProvider?.setConfigOption?.(configId, value)
  }
```

Add the import at the top of `session.ts`:

```ts
import type { ExternalAgentHooks } from './agents/types.js'
```

- [ ] **Step 2: Write the failing e2e test** (mirrors `external-agent.integration.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chmodSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'
import { acpConnections } from './agents/acp-connection.js'

const here = dirname(fileURLToPath(import.meta.url))
const AGENT = join(here, 'agents', '__fixtures__', 'mock-acp-agent.mjs'); chmodSync(AGENT, 0o755)

describe('external ACP agent through SessionManager', () => {
  it('routes a turn to the acp agent and streams reasoning + text + tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
    const agentsPath = join(dir, 'hip-agents.json')
    writeFileSync(agentsPath, JSON.stringify({ agents: [{
      id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT],
      transport: 'rich', acceptsModelConfig: false, enabled: true, env: { MOCK_ACP_THINK: '1', MOCK_ACP_TOOL: '1' },
    }] }))
    process.env.HIP_AGENTS_PATH = agentsPath

    const mgr = new SessionManager(undefined, () => undefined, dir)
    const out: ServerMessage[] = []
    mgr.handle({ type: 'session:create', id: 's1', config: { agentId: 'mock', cwd: dir } as any }, (m) => out.push(m))
    await mgr.handle({ type: 'message:send', sessionId: 's1', id: 'm1', content: 'hi', role: 'user' } as any, (m) => out.push(m))
    // settle
    await new Promise((r) => setTimeout(r, 500))
    acpConnections.disposeAll()

    expect(out.some((m) => m.type === 'reasoning:delta')).toBe(true)
    expect(out.some((m) => m.type === 'token:stream' && m.delta.includes('hello'))).toBe(true)
    expect(out.some((m) => m.type === 'tool:started')).toBe(true)
    expect(out.some((m) => m.type === 'message:complete')).toBe(true)
  }, 20000)
})
```

- [ ] **Step 2b: Run — expect FAIL** then iterate

Run: `yarn vitest run packages/sidecar/src/session/external-acp.integration.test.ts`
Expected: FAIL until the hooks wiring + factory route are correct, then PASS.

- [ ] **Step 3: Type-check + run — expect PASS**

Run: `yarn workspace @hip/sidecar exec tsc --noEmit && yarn vitest run packages/sidecar/src/session/external-acp.integration.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/external-acp.integration.test.ts
git commit -m "feat(acp): wire ExternalAgentHooks into Session; e2e through SessionManager"
```

---

## SLICE 3 — Auth modes at spawn + first-class registration

### Task 3.1: `acp-config.ts` — build spawn env/config for both auth modes

**Files:**
- Create: `packages/sidecar/src/session/agents/acp-config.ts` (replaces the temp stub from Task 1.5)
- Test: `packages/sidecar/src/session/agents/acp-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { buildAcpSpawn } from './acp-config.js'

const baseAgent: any = { id: 'opencode', name: 'OpenCode', kind: 'acp', command: 'opencode', args: ['acp', '--pure'], transport: 'rich', enabled: true, quirks: 'opencode' }

describe('buildAcpSpawn', () => {
  it('opencode-self mode: no key, no OPENCODE_CONFIG', () => {
    const { command, args, env } = buildAcpSpawn({ ...baseAgent, authMode: 'opencode-self', acceptsModelConfig: false }, null)
    expect(command).toBe('opencode')
    expect(args).toEqual(['acp', '--pure'])
    expect(env.OPENCODE_CONFIG).toBeUndefined()
  })

  it('hip-managed mode: writes an OPENCODE_CONFIG file with model + key env', () => {
    const model = { providerID: 'deepseek', modelID: 'deepseek-chat', baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-test' }
    const { env } = buildAcpSpawn({ ...baseAgent, authMode: 'hip-managed', acceptsModelConfig: true, boundModel: { providerID: 'deepseek', modelID: 'deepseek-chat' } }, model)
    expect(env.OPENCODE_CONFIG).toBeTruthy()
    expect(existsSync(env.OPENCODE_CONFIG!)).toBe(true)
    const cfg = JSON.parse(readFileSync(env.OPENCODE_CONFIG!, 'utf8'))
    expect(cfg.model).toBe('deepseek/deepseek-chat')        // G1: model MUST be set
    expect(cfg.provider.deepseek.options.apiKey).toBe('{env:DEEPSEEK_API_KEY}') // G3: substitution via file, not CONTENT
    expect(env.DEEPSEEK_API_KEY).toBe('sk-test')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-config.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `acp-config.ts`**

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentConfig } from '@hip/protocol'
import type { ResolvedModel } from './registry.js'

/** Provider id → the env var OpenCode auto-recognizes for that provider's key. */
function providerEnvVar(providerID: string): string {
  return `${providerID.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`
}

export interface AcpSpawn { command: string; args: string[]; env: NodeJS.ProcessEnv }

export function buildAcpSpawn(agent: AgentConfig, model: ResolvedModel | null): AcpSpawn {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(agent.env ?? {}) }

  if (agent.authMode === 'hip-managed' && model) {
    // G3: {env:} substitution does NOT run for OPENCODE_CONFIG_CONTENT — use a written file via OPENCODE_CONFIG.
    const keyEnv = providerEnvVar(model.providerID)
    const cfg: Record<string, unknown> = {
      $schema: 'https://opencode.ai/config.json',
      model: `${model.providerID}/${model.modelID}`, // G1: always set a model (else opencode/big-pickle bills)
      provider: { [model.providerID]: { options: { apiKey: `{env:${keyEnv}}`, ...(model.baseURL ? { baseURL: model.baseURL } : {}) } } },
    }
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-cfg-'))
    const file = join(dir, 'opencode.json')
    writeFileSync(file, JSON.stringify(cfg, null, 2))
    env.OPENCODE_CONFIG = file
    if (model.apiKey) env[keyEnv] = model.apiKey
  }
  // opencode-self mode: inject nothing key-related; OpenCode reads its own auth.json.

  return { command: agent.command, args: agent.args, env }
}
```

- [ ] **Step 4: Replace the temp stub** — ensure `acp-connection.ts` imports the real `buildAcpSpawn` (it already does from `./acp-config.js`). Delete any stub created in Task 1.5.

- [ ] **Step 5: Run — expect PASS**

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-config.test.ts && yarn workspace @hip/sidecar exec tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/agents/acp-config.ts packages/sidecar/src/session/agents/acp-config.test.ts
git commit -m "feat(acp): dual auth-mode spawn config (hip-managed file injection + opencode-self)"
```

### Task 3.2: First-class OpenCode agent in Settings (frontend)

OpenCode appears as a built-in, enable-able `kind:'acp'` agent (no hand-typed path). The `agentsStore` seeds it; the user toggles enabled + picks authMode/model.

**Files:**
- Modify: `src/store/agentsStore.ts` (seed/normalize a built-in OpenCode entry; persist via existing `set_agents_config`)
- Modify: `src/components/settings/AgentManagement.tsx` (or wherever 智能体管理 renders — grep `智能体管理`) to show the authMode selector for `kind:'acp'`
- Test: `src/store/agentsStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { withBuiltinOpencode } from './agentsStore'

describe('built-in opencode agent', () => {
  it('injects an opencode acp entry when absent, preserving user entries', () => {
    const list = withBuiltinOpencode([{ id: 'x', kind: 'custom' } as any])
    const oc = list.find((a) => a.id === 'opencode')
    expect(oc).toMatchObject({ kind: 'acp', command: 'opencode', args: ['acp', '--pure'], authMode: 'opencode-self' })
    expect(list.find((a) => a.id === 'x')).toBeTruthy()
  })
  it('does not duplicate an existing opencode entry', () => {
    const list = withBuiltinOpencode([{ id: 'opencode', kind: 'acp', enabled: true } as any])
    expect(list.filter((a) => a.id === 'opencode')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `yarn vitest run src/store/agentsStore.test.ts` *(frontend tests are paid-free; the paid trap is sidecar-only)*
Expected: FAIL (export missing)

- [ ] **Step 3: Implement `withBuiltinOpencode` in `agentsStore.ts`**

```ts
import type { AgentConfig } from '@hip/protocol'

const BUILTIN_OPENCODE: AgentConfig = {
  id: 'opencode', name: 'OpenCode', kind: 'acp', command: 'opencode', args: ['acp', '--pure'],
  transport: 'rich', acceptsModelConfig: true, authMode: 'opencode-self', quirks: 'opencode', enabled: false,
}

/** Ensure the built-in OpenCode agent is present exactly once, without clobbering user edits. */
export function withBuiltinOpencode(agents: AgentConfig[]): AgentConfig[] {
  return agents.some((a) => a.id === 'opencode') ? agents : [BUILTIN_OPENCODE, ...agents]
}
```

Call `withBuiltinOpencode(loaded)` in the store's load/normalize path so the UI always lists it.

- [ ] **Step 4: Run — expect PASS**

Run: `yarn vitest run src/store/agentsStore.test.ts`
Expected: PASS

- [ ] **Step 5: UI — authMode selector** (in the agent edit form, gated to `kind==='acp'`): a two-option radio (`opencode-self` / `hip-managed`); when `hip-managed`, reuse the existing model picker to set `boundModel` + `acceptsModelConfig: true`. Follow the existing form patterns in the 智能体管理 modal. No test (pure presentational); verify in Step 6.

- [ ] **Step 6: Verify in browser preview** (per preview workflow): open Settings → 智能体管理, confirm OpenCode is listed, toggle enabled, switch authMode, screenshot.

- [ ] **Step 7: Commit**

```bash
git add src/store/agentsStore.ts src/store/agentsStore.test.ts src/components/settings/
git commit -m "feat(acp): first-class built-in OpenCode agent + authMode selector"
```

---

## SLICE 4 — Live model/mode selectors

### Task 4.1: Route `agent:setConfigOption` in SessionManager

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts` (add a `case` in `handleAsync`)
- Test: `packages/sidecar/src/session/agents/acp-provider.test.ts` (model switch) + a manager-routing assertion in the e2e

- [ ] **Step 1: Add the failing provider test** (switch model, answer reflects it)

```ts
it('switches the live model via setConfigOption and the backend uses it', async () => {
  const p = new AcpAgentProvider(cfg(), process.cwd(), null)
  const a = cap()
  await p.runTurn('first', a.emit, new AbortController().signal) // answer(mock/base): ...
  await p.setConfigOption('model', 'mock/other')
  const b = cap()
  await p.runTurn('second', b.emit, new AbortController().signal)
  expect(b.out.text).toContain('mock/other')  // backend actually switched (mock echoes model)
  p.dispose()
})
```

- [ ] **Step 2: Run — expect FAIL/PASS** — `setConfigOption` exists from Task 1.6; this asserts the mock honors it.

Run: `yarn vitest run packages/sidecar/src/session/agents/acp-provider.test.ts -t 'switches the live model'`
Expected: PASS (the mock's `setSessionConfigOption` updates `model`, which `prompt` echoes). If FAIL, confirm `AcpConnection.setConfigOption` calls `conn.setSessionConfigOption`.

- [ ] **Step 3: Add the SessionManager route** — in `handleAsync`'s switch (after `message:resume`):

```ts
      case 'agent:setConfigOption':
        await this.ensureSession(msg.sessionId).setAgentConfigOption(msg.configId, msg.value)
        break
      case 'permission:respond':
        this.sessions.get(msg.sessionId)?.respondPermission(msg.requestId, msg.cancelled ? { cancelled: true } : { optionId: msg.optionId! })
        break
```

- [ ] **Step 4: Run — expect PASS**

Run: `yarn workspace @hip/sidecar exec tsc --noEmit && yarn vitest run packages/sidecar/src/session/agents/acp-provider.test.ts`
Expected: PASS + clean type-check

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/agents/acp-provider.test.ts
git commit -m "feat(acp): route agent:setConfigOption + permission:respond; live model switch"
```

### Task 4.2: Composer selectors (frontend)

**Files:**
- Create: `src/components/chat/ComposerConfigSelectors.tsx`
- Modify: `src/domain/sessionStore.ts` (intercept `agent:configOptions` in `apply()`, store per-session)
- Modify: `src/domain/sessionService.ts` (add `setAgentConfigOption(sessionId, configId, value)` → `transport.send`)
- Test: `src/domain/sessionStore.test.ts`

- [ ] **Step 1: Write the failing reducer test**

```ts
import { describe, it, expect } from 'vitest'
import { applyServerMessage } from './sessionStore'  // or the store's apply entrypoint

describe('agent:configOptions reducer', () => {
  it('stores config options for the session', () => {
    const state = applyServerMessage(initialState(), { type: 'agent:configOptions', sessionId: 's', options: [
      { id: 'model', name: 'Model', category: 'model', currentValue: 'a', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] },
    ] })
    expect(state.configOptionsBySession['s'][0].currentValue).toBe('a')
  })
})
```

*(Adapt `initialState`/`applyServerMessage` to the store's actual test seam — see existing `sessionStore.test.ts`.)*

- [ ] **Step 2: Run — expect FAIL**, then add the interceptor in `apply()` (mirroring how `config:activeModel` is handled) writing `configOptionsBySession[sessionId] = msg.options`.

Run: `yarn vitest run src/domain/sessionStore.test.ts`
Expected: FAIL → PASS after edit.

- [ ] **Step 3: `setAgentConfigOption` in sessionService**

```ts
export function setAgentConfigOption(sessionId: string, configId: string, value: string): void {
  transport.send({ type: 'agent:setConfigOption', sessionId, configId, value })
}
```

- [ ] **Step 4: `ComposerConfigSelectors.tsx`** — render a dropdown per option from `configOptionsBySession[activeSessionId]`, grouped by `category` (model/mode); on change call `setAgentConfigOption`. Follow the `AgentPicker` DropdownMenu pattern (`modal={false}`). Mount it in the composer toolbar next to `AgentPicker`, only when options exist.

- [ ] **Step 5: Verify in browser preview** — start an OpenCode conversation, confirm the model dropdown appears and switching it persists. Screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/ComposerConfigSelectors.tsx src/domain/sessionStore.ts src/domain/sessionService.ts src/domain/sessionStore.test.ts
git commit -m "feat(acp): composer model/mode selectors from agent:configOptions"
```

---

## SLICE 5 — HITL permission round-trip

### Task 5.1: Provider holds pending permission until UI responds

**Files:**
- Modify: `packages/sidecar/src/session/agents/acp-provider.ts` (`onPermission` registers a pending resolver via `hooks.requestPermission`, which now genuinely round-trips because Session holds the resolver — already wired in Slice 2/Task 2.3)
- Test: `packages/sidecar/src/session/external-acp.integration.test.ts` (add HITL case)

The Slice 2 wiring already makes `hooks.requestPermission` register `Session.pendingPermissions` and emit `permission:request`. This task verifies the full loop and that `respondPermission` releases the tool.

- [ ] **Step 1: Add the failing e2e test**

```ts
it('emits permission:request and proceeds when the client responds', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
  const agentsPath = join(dir, 'hip-agents.json')
  writeFileSync(agentsPath, JSON.stringify({ agents: [{
    id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT],
    transport: 'rich', acceptsModelConfig: false, enabled: true, env: { MOCK_ACP_PERMISSION: '1', MOCK_ACP_TOOL: '1' },
  }] }))
  process.env.HIP_AGENTS_PATH = agentsPath
  const mgr = new SessionManager(undefined, () => undefined, dir)
  const out: ServerMessage[] = []
  const send = (m: ServerMessage) => {
    out.push(m)
    if (m.type === 'permission:request') mgr.handle({ type: 'permission:respond', sessionId: m.sessionId, requestId: m.requestId, optionId: 'once' } as any, send)
  }
  mgr.handle({ type: 'session:create', id: 's1', config: { agentId: 'mock', cwd: dir } as any }, send)
  await mgr.handle({ type: 'message:send', sessionId: 's1', id: 'm1', content: 'edit', role: 'user' } as any, send)
  await new Promise((r) => setTimeout(r, 800))
  acpConnections.disposeAll()
  expect(out.some((m) => m.type === 'permission:request')).toBe(true)
  expect(out.some((m) => m.type === 'tool:finished' && m.status === 'finished')).toBe(true)
  expect(out.some((m) => m.type === 'message:complete')).toBe(true)
}, 20000)
```

- [ ] **Step 2: Run — expect FAIL then iterate**

Run: `yarn vitest run packages/sidecar/src/session/external-acp.integration.test.ts -t 'permission:request'`
Expected: FAIL until `onPermission` correctly uses `hooks.requestPermission` and Session resolves the pending map; then PASS.

> The provider's `onPermission` simply `await hooks.requestPermission({...})`. That hook (built in `Session`, Task 2.3) registers the resolver in `Session.pendingPermissions` and emits `permission:request`; `SessionManager` routes `permission:respond` → `Session.respondPermission` → resolves the pending promise → the provider returns the ACP outcome → the agent's blocked tool proceeds. The provider holds NO pending-permission state.

- [ ] **Step 3: Run — expect PASS**

Run: `yarn workspace @hip/sidecar exec tsc --noEmit && yarn vitest run packages/sidecar/src/session/external-acp.integration.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/session/agents/acp-provider.ts packages/sidecar/src/session/external-acp.integration.test.ts
git commit -m "feat(acp): HITL permission round-trip through SessionManager"
```

### Task 5.2: Permission modal (frontend)

**Files:**
- Create: `src/components/chat/PermissionModal.tsx`
- Modify: `src/domain/sessionStore.ts` (intercept `permission:request` in `apply()`, store a pending-permission queue)
- Modify: `src/domain/sessionService.ts` (`respondPermission(sessionId, requestId, choice)` → `transport.send`)
- Test: `src/domain/sessionStore.test.ts`

- [ ] **Step 1: Write the failing reducer test**

```ts
it('queues a permission request and clears it on respond', () => {
  let s = applyServerMessage(initialState(), { type: 'permission:request', sessionId: 's', turnId: 't', requestId: 'r',
    tool: { title: 'edit hello.txt', kind: 'edit' }, options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }] })
  expect(s.pendingPermission?.requestId).toBe('r')
  s = clearPermission(s, 'r')
  expect(s.pendingPermission).toBeNull()
})
```

- [ ] **Step 2: Run — expect FAIL**, then add the interceptor + `clearPermission` reducer.

Run: `yarn vitest run src/domain/sessionStore.test.ts`
Expected: FAIL → PASS.

- [ ] **Step 3: `respondPermission` in sessionService**

```ts
export function respondPermission(sessionId: string, requestId: string, choice: { optionId: string } | { cancelled: true }): void {
  transport.send({ type: 'permission:respond', sessionId, requestId, ...('optionId' in choice ? { optionId: choice.optionId } : { cancelled: true }) })
}
```

- [ ] **Step 4: `PermissionModal.tsx`** — when `pendingPermission` is set, render a modal showing `tool.title`/`kind` (+ diff if present) and a button per `option` (group `allow_*` vs `reject_*`); on click call `respondPermission` then `clearPermission`. Reuse the existing Modal primitive. **Important (per project memory): if this modal is opened from a Radix DropdownMenu/ContextMenu, set `modal={false}` on that menu to avoid the stuck `body{pointer-events:none}` freeze** — but a standalone modal mounted at the chat root is fine.

- [ ] **Step 5: Verify in browser preview** — drive a tool-permission turn (or mock), confirm the modal appears and approving lets the turn proceed. Screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/PermissionModal.tsx src/domain/sessionStore.ts src/domain/sessionService.ts src/domain/sessionStore.test.ts
git commit -m "feat(acp): HITL permission modal + respond wiring"
```

---

## SLICE 6 — ACP session persistence + reopen

### Task 6.1: Migration v9 — `acp_session_id` column

**Files:**
- Modify: `packages/sidecar/src/persistence/schema.ts` (append `version < 9` block to `migrate`)
- Modify: `packages/sidecar/src/persistence/store.ts` (`setAcpSessionId`, `getAcpSessionId`)
- Test: `packages/sidecar/src/persistence/store.test.ts` (or wherever persistence tests live)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { openDatabase } from './open.js'
import { SessionStore } from './store.js'

describe('acp_session_id persistence', () => {
  it('stores and reads the acp session id', () => {
    const db = openDatabase(':memory:')
    const store = new SessionStore(db, false)
    store.insertSession('s1', 'title', JSON.stringify({ agentId: 'opencode' }))
    expect(store.getAcpSessionId('s1')).toBeNull()
    store.setAcpSessionId('s1', 'ses_abc')
    expect(store.getAcpSessionId('s1')).toBe('ses_abc')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (paid-free: pure SQLite)

Run: `yarn vitest run packages/sidecar/src/persistence/store.test.ts -t 'acp_session_id'`
Expected: FAIL

- [ ] **Step 3: Append the migration** — at the END of `migrate(db)` in `schema.ts`:

```ts
  if (version < 9) {
    db.exec('BEGIN')
    try {
      db.exec('ALTER TABLE sessions ADD COLUMN acp_session_id TEXT')
      db.exec('PRAGMA user_version = 9')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK'); throw e
    }
  }
```

- [ ] **Step 4: Add store methods** in `store.ts`:

```ts
  setAcpSessionId(id: string, acpSessionId: string): void {
    this.db.prepare('UPDATE sessions SET acp_session_id = ? WHERE id = ?').run(acpSessionId, id)
  }
  getAcpSessionId(id: string): string | null {
    const row = this.db.prepare('SELECT acp_session_id FROM sessions WHERE id = ?').get(id) as { acp_session_id: string | null } | undefined
    return row?.acp_session_id ?? null
  }
```

- [ ] **Step 5: Run — expect PASS**

Run: `yarn vitest run packages/sidecar/src/persistence/store.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/persistence/schema.ts packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
git commit -m "feat(acp): persist acp_session_id per session (migration v9)"
```

### Task 6.2: Persist on first turn + reopen via loadSession

**Files:**
- Modify: `packages/sidecar/src/session/session.ts` (`ensureExternalProvider` passes the persisted acpSessionId; after the first turn, persist `provider.sessionId`)
- Test: `packages/sidecar/src/session/external-acp.integration.test.ts` (reopen case)

- [ ] **Step 1: Thread the persisted id into the provider** — in `ensureExternalProvider()` (session.ts ~257-265):

```ts
  private ensureExternalProvider(): AgentProvider {
    if (!this.externalProvider) {
      const agent = readAgentsConfig().find((a) => a.id === this.config.agentId)
      if (!agent) throw new Error(`Unknown agent: ${this.config.agentId}`)
      const model = agent.acceptsModelConfig ? resolveAgentModel(agent) : null
      const resume = this.store?.getAcpSessionId(this.id) ?? null
      this.externalProvider = createAgentProvider(agent, this.resolveCwd(), model)
      // createAgentProvider doesn't take resume; pass it via an optional setter to avoid widening the factory.
      ;(this.externalProvider as { setResumeSessionId?: (id: string | null) => void }).setResumeSessionId?.(resume)
    }
    return this.externalProvider
  }
```

Add a setter to `AcpAgentProvider`:

```ts
  setResumeSessionId(id: string | null): void { if (!this.acpSessionId) this.resumeAcpSessionId = id }
```

After the external `runTurn` completes (in the external branch, after `finishRemaining()`), persist the id:

```ts
  const acpId = (this.externalProvider as { sessionId?: string | null }).sessionId
  if (acpId && this.store) this.store.setAcpSessionId(this.id, acpId)
```

- [ ] **Step 2: Write the failing reopen test**

```ts
it('reopens a prior ACP session via loadSession and replays history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hip-acp-'))
  // seed the store with a session that already has an acp_session_id
  const db = openDatabase(':memory:'); const store = new SessionStore(db, false)
  store.insertSession('s1', 't', JSON.stringify({ agentId: 'mock', cwd: dir }))
  store.setAcpSessionId('s1', 'mock-sess-1')
  writeFileSync(join(dir, 'hip-agents.json'), JSON.stringify({ agents: [{ id: 'mock', name: 'Mock', kind: 'acp', command: 'node', args: [AGENT], transport: 'rich', acceptsModelConfig: false, enabled: true }] }))
  process.env.HIP_AGENTS_PATH = join(dir, 'hip-agents.json')
  const mgr = new SessionManager(store, () => undefined, dir)
  const out: ServerMessage[] = []
  await mgr.handle({ type: 'message:send', sessionId: 's1', id: 'm1', content: 'continue', role: 'user' } as any, (m) => out.push(m))
  await new Promise((r) => setTimeout(r, 800))
  acpConnections.disposeAll()
  // the mock's loadSession replays 'prior answer'; then the new turn answers
  expect(out.some((m) => m.type === 'token:stream' && m.delta.includes('hello'))).toBe(true)
}, 20000)
```

- [ ] **Step 3: Run — expect FAIL then iterate to PASS**

Run: `yarn workspace @hip/sidecar exec tsc --noEmit && yarn vitest run packages/sidecar/src/session/external-acp.integration.test.ts -t 'reopens'`
Expected: PASS (the provider calls `loadSession('mock-sess-1')` then prompts)

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/external-acp.integration.test.ts packages/sidecar/src/session/agents/acp-provider.ts
git commit -m "feat(acp): persist + reopen ACP sessions via loadSession"
```

### Task 6.3: Dispose the connection pool on sidecar shutdown

**Files:**
- Modify: `packages/sidecar/src/main.ts` (or the shutdown path / `ws-server.ts` close) — call `acpConnections.disposeAll()`
- Test: manual (covered by integration tests calling `disposeAll()`)

- [ ] **Step 1: Find the shutdown hook** — grep `HIP_PARENT_WATCH` / process exit / `ws.on('close'` in `packages/sidecar/src/main.ts` and `server/ws-server.ts`.

- [ ] **Step 2: Call disposeAll on shutdown**

```ts
import { acpConnections } from './session/agents/acp-connection.js'
// in the existing SIGTERM/parent-watch/exit handler:
process.on('exit', () => acpConnections.disposeAll())
process.on('SIGTERM', () => { acpConnections.disposeAll(); process.exit(0) })
```

- [ ] **Step 3: Type-check + full sidecar test run (paid-free)** — move auth.json aside first:

```bash
mv ~/.hip/config/auth.json ~/.hip/config/auth.json.bak 2>/dev/null || true
yarn workspace @hip/sidecar exec tsc --noEmit && yarn vitest run packages/sidecar/src/session/agents src/session/external-acp.integration.test.ts src/persistence
mv ~/.hip/config/auth.json.bak ~/.hip/config/auth.json 2>/dev/null || true
```

Expected: PASS, clean type-check.

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/main.ts
git commit -m "feat(acp): dispose warm ACP connections on sidecar shutdown"
```

---

## Final verification

- [ ] **Full type-check:** `yarn type-check && yarn workspace @hip/sidecar exec tsc --noEmit && yarn tsc --noEmit` (frontend)
- [ ] **Paid-free test sweep** (auth.json moved aside): `yarn vitest run packages/sidecar/src/session src/persistence && yarn vitest run src/store src/domain`
- [ ] **Frontend build:** `yarn build`
- [ ] **Manual `yarn tauri dev` acceptance** (real reasoning model; GUI > real-LLM automation): enable OpenCode (Mode B first), start a conversation, confirm: thinking streams; tool cards render; a permission prompt round-trips; cancel mid-turn stops the turn and you can immediately re-prompt; switching the model in the composer changes the answering model; closing + reopening the conversation rehydrates. Then test Mode A (hip-managed key + bound DeepSeek model) and confirm it does NOT fall back to `opencode/big-pickle`.
- [ ] **Per-slice GUI checks** were done inline; this is the end-to-end pass.

## Notes carried from the spec/spike

- **Cancel:** OpenCode returns `stopReason:'end_turn'` on a genuine cancel — the provider relies on its own abort flag, never on stopReason (Task 2.2).
- **G1:** Mode A MUST set an explicit model or OpenCode silently bills `opencode/big-pickle` (Task 3.1 enforces).
- **G2:** authenticate only on `auth_required` (handled in `AcpConnection.newSession`).
- **G3:** `OPENCODE_CONFIG_CONTENT` skips `{env:}` substitution; use a written `OPENCODE_CONFIG` file (Task 3.1).
- **Pin** `@agentclientprotocol/sdk` and OpenCode versions; both are pre-1.0.
- **Warm process:** the single most important property — `AcpConnectionManager` keeps one child per agent-config across conversations (Task 1.5); verify two conversations share one PID during manual acceptance.
