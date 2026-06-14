# External Agent Framework Implementation Plan (Plan A of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users register external CLI agents in Settings and converse with them, switchable from the input box before a conversation starts, with the configured model + key pushed into the agent via env. Plan A delivers the full framework + a generic "Custom CLI agent" (a long-lived subprocess speaking a tiny stdin turn-loop). Plan B (separate) adds the OpenCode adapter.

**Architecture:** A new `AgentProvider` seam sits at the turn level inside the sidecar `Session`. The built-in LangGraph agent stays the default (unchanged, inline). When `SessionConfig.agentId` names an external agent, `runTurn` dispatches to a `LoopAgentProvider` that owns a long-lived child process and multiplexes turns over stdin/stdout framed by an end-of-turn sentinel, re-emitting the child's output through the existing `GraphEmit` pipeline (so streaming, and the per-turn git checkpoint, work unchanged). The agent registry persists to `~/.hip/config/hip-agents.json` (mirroring `hip-providers.json`); the sidecar reads it fresh per spawn via an injected `HIP_AGENTS_PATH`. The composer gets a draft-only agent picker; the choice rides into `SessionConfig` at commit.

**Tech Stack:** TypeScript, Node `child_process`, Zustand, Radix UI, Tauri (Rust commands), Vitest (node env, `*.test.ts` only — no component-test harness exists, so `.tsx` components are verified by manual GUI acceptance).

---

## Conventions & ground rules

- **Test command:** `yarn test` (runs `vitest run` across `src/**/*.test.ts` and `packages/sidecar/src/**/*.test.ts`). To run one file: `yarn test <path>` — **but** see the memory note: a bare `vitest run src …` substring-matches sidecar paths and can fire paid real-LLM suites. All tests in this plan are **paid-free** (no provider key needed); they pass with `~/.hip/config/auth.json` present or absent.
- **Commit cadence:** one commit per task (after its tests pass). Branch is `feat/external-agent-management` (already created; the spec doc lives there).
- **No component unit tests:** this repo has no jsdom/RTL and excludes `.tsx` from vitest `include`. UI tasks (T13–T16) are implemented and then verified by **manual GUI acceptance** — do not invent `.tsx` test files.
- **GraphEmit:** `packages/sidecar/src/session/graph.ts` defines `interface GraphEmit { token; reasoning; toolStarted; toolFinished; usage }`. Confirm it is `export`ed; if not, add `export` (T5 depends on importing it).

---

## File structure

**New (sidecar):**
- `packages/sidecar/src/session/agents/registry.ts` — read `hip-agents.json`; resolve a bound model to `{providerID, modelID, baseURL, apiKey}`.
- `packages/sidecar/src/session/agents/adapters.ts` — `buildModelEnv` (HIP_* env contract) + `parseRichLine` (rich JSON → event).
- `packages/sidecar/src/session/agents/loop-provider.ts` — `AgentProvider` interface + `LoopAgentProvider`.
- `packages/sidecar/src/session/agents/index.ts` — `createAgentProvider(agent, cwd, model)`.
- `packages/sidecar/src/session/agents/__fixtures__/echo-thin-agent.mjs` + `echo-rich-agent.mjs` — test stubs.

**New (UI):**
- `src/ipc/agentsConfig.ts` — Tauri IPC for the registry file.
- `src/store/agentsStore.ts` — Zustand store (CRUD + persist).
- `src/components/account/AgentManagement.tsx` — Settings page (card list + editor Modal).
- `src/components/composer/AgentPicker.tsx` — draft-only picker / committed locked badge.

**Modified:**
- `packages/protocol/src/index.ts` — `AgentTransport`, `BoundModel`, `AgentConfig`, `AgentsConfig`; `SessionConfig.agentId`.
- `packages/sidecar/src/config/providers.ts` — add `resolveProviderBaseURL`.
- `packages/sidecar/src/session/session.ts` — provider field, `runTurn` branch, `destroy` dispose.
- `src-tauri/src/paths.rs` — `agents_config_path`.
- `src-tauri/src/lib.rs` — `get_agents_config` / `set_agents_config` + handler registration.
- `src-tauri/src/sidecar.rs` — inject `HIP_AGENTS_PATH`.
- `src/store/draftStore.ts` — `agentId` field + `setAgentId`.
- `src/domain/sessionService.ts` — `configFromDraft` helper folds `agentId` on commit.
- `src/components/account/SettingsPanel.tsx` — append `agents` page.
- `src/components/composer/InputBar.tsx` — mount `AgentPicker` in `leftSlot`.
- `src/components/chat/*` (chat view) — reopen notice banner (T15).
- `src/i18n/{en,zh-CN,zh-TW}.ts` — `settings.agents.*` + `chat.agent*` keys.

---

## Task 1: Protocol types

**Files:**
- Modify: `packages/protocol/src/index.ts` (SessionConfig at lines 3-12; add new types near ProvidersConfig ~line 29)

- [ ] **Step 1: Add the agent types and the `agentId` field**

Add `agentId?: string` to `SessionConfig` (after `language` on line 12):

```typescript
export interface SessionConfig {
  llmProvider: string
  model: string
  baseURL?: string
  tools: string[]
  systemPrompt?: string
  cwd?: string
  thinking?: boolean
  language?: 'en' | 'zh-CN' | 'zh-TW'
  agentId?: string             // undefined / 'builtin' => built-in hip agent; else an AgentConfig.id
}
```

Add these new exports (place them alongside `ProvidersConfig`):

```typescript
export type AgentTransport = 'thin' | 'rich'

/** Which configured model an external agent should use. References hip-providers.json. */
export interface BoundModel { providerID: string; modelID: string }

export interface AgentConfig {
  id: string                          // nanoid
  name: string                        // display name
  kind: 'custom' | 'opencode'         // selects the provider/adapter; 'opencode' arrives in Plan B
  command: string                     // executable (PATH name or absolute path)
  args: string[]                      // static launch args
  transport: AgentTransport
  acceptsModelConfig: boolean
  boundModel?: BoundModel             // required iff acceptsModelConfig and the user picked a model
  env?: Record<string, string>        // advanced manual env overrides
  enabled: boolean
}

export interface AgentsConfig { agents: AgentConfig[] }
```

- [ ] **Step 2: Typecheck**

Run: `yarn tsc -p packages/protocol/tsconfig.json --noEmit` (or the repo's typecheck script, e.g. `yarn typecheck`).
Expected: PASS (no type errors). Pure additive type changes.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): AgentConfig/AgentsConfig types + SessionConfig.agentId"
```

---

## Task 2: `resolveProviderBaseURL` in the sidecar providers config

**Files:**
- Modify: `packages/sidecar/src/config/providers.ts`
- Test: `packages/sidecar/src/config/providers.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/sidecar/src/config/providers.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveProviderBaseURL } from './providers.js'

const tmps: string[] = []
function writeProviders(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'hip-prov-'))
  tmps.push(dir)
  const p = join(dir, 'hip-providers.json')
  writeFileSync(p, JSON.stringify(obj))
  return p
}
afterEach(() => { for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true }); delete process.env.HIP_PROVIDERS_PATH })

describe('resolveProviderBaseURL', () => {
  it('reads the providers baseURL from HIP_PROVIDERS_PATH', () => {
    process.env.HIP_PROVIDERS_PATH = writeProviders({ providers: { acme: { enabled: true, baseURL: 'https://acme.test/v1' } } })
    expect(resolveProviderBaseURL('acme')).toBe('https://acme.test/v1')
  })
  it('falls back to the deepseek default when the provider/file is missing', () => {
    delete process.env.HIP_PROVIDERS_PATH
    expect(resolveProviderBaseURL('whatever')).toBe('https://api.deepseek.com/v1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test packages/sidecar/src/config/providers.test.ts`
Expected: FAIL — `resolveProviderBaseURL is not a function`.

- [ ] **Step 3: Implement**

Add to `packages/sidecar/src/config/providers.ts` (it already imports `readFileSync` and `ProvidersConfig`, and defines `DEEPSEEK_DEFAULT`):

```typescript
/** Resolve a provider's OpenAI-compatible base URL from HIP_PROVIDERS_PATH; deepseek default otherwise. */
export function resolveProviderBaseURL(providerID: string): string {
  const file = process.env.HIP_PROVIDERS_PATH?.trim()
  if (file) {
    try {
      const cfg = JSON.parse(readFileSync(file, 'utf8')) as ProvidersConfig
      const url = cfg.providers?.[providerID]?.baseURL
      if (url) return url
    } catch { /* fall through */ }
  }
  return DEEPSEEK_DEFAULT.baseURL
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test packages/sidecar/src/config/providers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/config/providers.ts packages/sidecar/src/config/providers.test.ts
git commit -m "feat(sidecar): resolveProviderBaseURL from HIP_PROVIDERS_PATH"
```

---

## Task 3: Agent registry reader + model resolution

**Files:**
- Create: `packages/sidecar/src/session/agents/registry.ts`
- Test: `packages/sidecar/src/session/agents/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/sidecar/src/session/agents/registry.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentConfig } from '@hip/protocol'
import { readAgentsConfig, resolveAgentModel } from './registry.js'

const tmps: string[] = []
function writeFile(name: string, obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'hip-agents-')); tmps.push(dir)
  const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.HIP_AGENTS_PATH; delete process.env.HIP_PROVIDERS_PATH; delete process.env.HIP_MODEL_ACME_API_KEY
})

const baseAgent: AgentConfig = { id: 'a1', name: 'A', kind: 'custom', command: 'x', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true }

describe('readAgentsConfig', () => {
  it('returns [] when HIP_AGENTS_PATH is unset', () => {
    delete process.env.HIP_AGENTS_PATH
    expect(readAgentsConfig()).toEqual([])
  })
  it('reads the agents array from the file', () => {
    process.env.HIP_AGENTS_PATH = writeFile('hip-agents.json', { agents: [baseAgent] })
    expect(readAgentsConfig()).toEqual([baseAgent])
  })
  it('returns [] on a corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-agents-')); tmps.push(dir)
    const p = join(dir, 'hip-agents.json'); writeFileSync(p, '{ not json'); process.env.HIP_AGENTS_PATH = p
    expect(readAgentsConfig()).toEqual([])
  })
})

describe('resolveAgentModel', () => {
  it('returns null when the agent has no bound model', () => {
    expect(resolveAgentModel(baseAgent)).toBeNull()
  })
  it('resolves baseURL (providers file) + apiKey (env) for the bound model', () => {
    process.env.HIP_PROVIDERS_PATH = writeFile('hip-providers.json', { providers: { acme: { enabled: true, baseURL: 'https://acme.test/v1' } } })
    process.env.HIP_MODEL_ACME_API_KEY = 'sk-acme'
    const agent: AgentConfig = { ...baseAgent, acceptsModelConfig: true, boundModel: { providerID: 'acme', modelID: 'acme-large' } }
    expect(resolveAgentModel(agent)).toEqual({ providerID: 'acme', modelID: 'acme-large', baseURL: 'https://acme.test/v1', apiKey: 'sk-acme' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test packages/sidecar/src/session/agents/registry.test.ts`
Expected: FAIL — cannot find module `./registry.js`.

- [ ] **Step 3: Implement**

```typescript
// packages/sidecar/src/session/agents/registry.ts
import { readFileSync } from 'node:fs'
import type { AgentConfig, AgentsConfig } from '@hip/protocol'
import { resolveApiKey } from '../../config/auth-file.js'
import { resolveProviderBaseURL } from '../../config/providers.js'

export interface ResolvedModel { providerID: string; modelID: string; baseURL: string; apiKey?: string }

/** Read the registered external agents from HIP_AGENTS_PATH. Missing/corrupt file → []. */
export function readAgentsConfig(): AgentConfig[] {
  const file = process.env.HIP_AGENTS_PATH?.trim()
  if (!file) return []
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as AgentsConfig
    return Array.isArray(cfg?.agents) ? cfg.agents : []
  } catch {
    return []
  }
}

/** Resolve an agent's bound model to a concrete {providerID, modelID, baseURL, apiKey}, or null. */
export function resolveAgentModel(agent: AgentConfig): ResolvedModel | null {
  if (!agent.boundModel) return null
  const { providerID, modelID } = agent.boundModel
  return { providerID, modelID, baseURL: resolveProviderBaseURL(providerID), apiKey: resolveApiKey(providerID) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test packages/sidecar/src/session/agents/registry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/agents/registry.ts packages/sidecar/src/session/agents/registry.test.ts
git commit -m "feat(sidecar): agent registry reader + bound-model resolution"
```

---

## Task 4: Adapter pure functions (env contract + rich line parser)

**Files:**
- Create: `packages/sidecar/src/session/agents/adapters.ts`
- Test: `packages/sidecar/src/session/agents/adapters.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/sidecar/src/session/agents/adapters.test.ts
import { describe, it, expect } from 'vitest'
import { buildModelEnv, parseRichLine } from './adapters.js'

describe('buildModelEnv', () => {
  it('maps a resolved model to the HIP_* env contract', () => {
    expect(buildModelEnv({ providerID: 'acme', modelID: 'acme-large', baseURL: 'https://acme.test/v1', apiKey: 'sk' }))
      .toEqual({ HIP_MODEL: 'acme-large', HIP_BASE_URL: 'https://acme.test/v1', HIP_API_KEY: 'sk' })
  })
  it('omits HIP_API_KEY when there is no key', () => {
    expect(buildModelEnv({ providerID: 'acme', modelID: 'm', baseURL: 'u' })).toEqual({ HIP_MODEL: 'm', HIP_BASE_URL: 'u' })
  })
})

describe('parseRichLine', () => {
  it('parses text / reasoning / tool / done events', () => {
    expect(parseRichLine('{"type":"text","delta":"hi"}')).toEqual({ kind: 'text', delta: 'hi' })
    expect(parseRichLine('{"type":"reasoning","delta":"mm"}')).toEqual({ kind: 'reasoning', delta: 'mm' })
    expect(parseRichLine('{"type":"tool_start","id":"t1","name":"edit","input":{"a":1}}')).toEqual({ kind: 'tool_start', id: 't1', name: 'edit', input: { a: 1 } })
    expect(parseRichLine('{"type":"tool_end","id":"t1","output":"done","ok":true}')).toEqual({ kind: 'tool_end', id: 't1', output: 'done', ok: true })
    expect(parseRichLine('{"type":"done"}')).toEqual({ kind: 'done' })
  })
  it('returns null for malformed JSON or unknown types (tolerate noise)', () => {
    expect(parseRichLine('not json')).toBeNull()
    expect(parseRichLine('{"type":"chatter"}')).toBeNull()
    expect(parseRichLine('{"type":"text"}')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test packages/sidecar/src/session/agents/adapters.test.ts`
Expected: FAIL — cannot find module `./adapters.js`.

- [ ] **Step 3: Implement**

```typescript
// packages/sidecar/src/session/agents/adapters.ts
import type { ResolvedModel } from './registry.js'

/** The standard env contract a custom external agent reads. A per-agent adapter (Plan B) may remap these. */
export function buildModelEnv(m: ResolvedModel): Record<string, string> {
  return {
    HIP_MODEL: m.modelID,
    HIP_BASE_URL: m.baseURL,
    ...(m.apiKey ? { HIP_API_KEY: m.apiKey } : {}),
  }
}

export type RichEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'reasoning'; delta: string }
  | { kind: 'tool_start'; id: string; name: string; input: unknown }
  | { kind: 'tool_end'; id: string; output?: string; ok: boolean }
  | { kind: 'done' }

/** Parse one newline-delimited rich-protocol line. Returns null for noise (logged & skipped upstream). */
export function parseRichLine(line: string): RichEvent | null {
  let o: Record<string, unknown>
  try { o = JSON.parse(line) as Record<string, unknown> } catch { return null }
  switch (o?.type) {
    case 'text': return typeof o.delta === 'string' ? { kind: 'text', delta: o.delta } : null
    case 'reasoning': return typeof o.delta === 'string' ? { kind: 'reasoning', delta: o.delta } : null
    case 'tool_start':
      return o.id != null && o.name != null
        ? { kind: 'tool_start', id: String(o.id), name: String(o.name), input: o.input }
        : null
    case 'tool_end':
      return o.id != null
        ? { kind: 'tool_end', id: String(o.id), output: o.output != null ? String(o.output) : undefined, ok: o.ok !== false }
        : null
    case 'done': return { kind: 'done' }
    default: return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test packages/sidecar/src/session/agents/adapters.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/agents/adapters.ts packages/sidecar/src/session/agents/adapters.test.ts
git commit -m "feat(sidecar): agent adapter env contract + rich line parser"
```

---

## Task 5: `LoopAgentProvider` (long-lived subprocess + turn-loop)

**Files:**
- Create: `packages/sidecar/src/session/agents/loop-provider.ts`
- Create: `packages/sidecar/src/session/agents/__fixtures__/echo-thin-agent.mjs`
- Create: `packages/sidecar/src/session/agents/__fixtures__/echo-rich-agent.mjs`
- Test: `packages/sidecar/src/session/agents/loop-provider.test.ts`
- (Prereq) Ensure `GraphEmit` is exported from `packages/sidecar/src/session/graph.ts`.

- [ ] **Step 1: Write the test fixtures (the stub agents)**

`echo-thin-agent.mjs` — reads a turn request terminated by RS (`\x1e`), replies `echo: <msg>` then RS:

```javascript
// packages/sidecar/src/session/agents/__fixtures__/echo-thin-agent.mjs
const RS = '\x1e'
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf(RS)) >= 0) {
    const req = buf.slice(0, i).replace(/^\n+|\n+$/g, '')
    buf = buf.slice(i + 1)
    if (!req) continue
    // Stream model env back too, so the test can assert env injection.
    const model = process.env.HIP_MODEL ? ` [model=${process.env.HIP_MODEL}]` : ''
    process.stdout.write(`echo: ${req}${model}` + RS)
  }
})
```

`echo-rich-agent.mjs` — reads a `{"type":"user","text":...}` line, emits rich events ending with `done`:

```javascript
// packages/sidecar/src/session/agents/__fixtures__/echo-rich-agent.mjs
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    const out = (s) => process.stdout.write(JSON.stringify(s) + '\n')
    out({ type: 'text', delta: `echo: ${msg.text}` })
    out({ type: 'tool_start', id: 't1', name: 'noop', input: { ok: 1 } })
    out({ type: 'tool_end', id: 't1', output: 'fine', ok: true })
    out({ type: 'done' })
  }
})
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/sidecar/src/session/agents/loop-provider.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { AgentConfig } from '@hip/protocol'
import { LoopAgentProvider } from './loop-provider.js'
import type { GraphEmit } from '../graph.js'

const here = dirname(fileURLToPath(import.meta.url))
const THIN = join(here, '__fixtures__', 'echo-thin-agent.mjs')
const RICH = join(here, '__fixtures__', 'echo-rich-agent.mjs')

interface Captured { text: string; reasoning: string; tools: Array<[string, string]>; toolEnds: Array<[string, string]> }
function captureEmit(): { emit: GraphEmit; cap: Captured } {
  const cap: Captured = { text: '', reasoning: '', tools: [], toolEnds: [] }
  const emit: GraphEmit = {
    token: (d) => { cap.text += d },
    reasoning: (d) => { cap.reasoning += d },
    toolStarted: (name, callId) => { cap.tools.push([callId, name]) },
    toolFinished: (callId, status) => { cap.toolEnds.push([callId, status]) },
    usage: () => {},
  }
  return { emit, cap }
}

const thinAgent: AgentConfig = { id: 'thin', name: 'Thin', kind: 'custom', command: 'node', args: [THIN], transport: 'thin', acceptsModelConfig: false, enabled: true }
const richAgent: AgentConfig = { id: 'rich', name: 'Rich', kind: 'custom', command: 'node', args: [RICH], transport: 'rich', acceptsModelConfig: false, enabled: true }

const providers: LoopAgentProvider[] = []
afterEach(() => { for (const p of providers.splice(0)) p.dispose() })

describe('LoopAgentProvider — thin', () => {
  it('streams the echoed text and reuses one process across turns', async () => {
    const p = new LoopAgentProvider(thinAgent, process.cwd(), null); providers.push(p)
    const a = captureEmit(); await p.runTurn('hello', a.emit, new AbortController().signal)
    expect(a.cap.text).toBe('echo: hello')
    const b = captureEmit(); await p.runTurn('again', b.emit, new AbortController().signal)
    expect(b.cap.text).toBe('echo: again')
  })

  it('injects the HIP_* model env when acceptsModelConfig', async () => {
    const p = new LoopAgentProvider({ ...thinAgent, acceptsModelConfig: true }, process.cwd(), { providerID: 'acme', modelID: 'acme-large', baseURL: 'u', apiKey: 'sk' })
    providers.push(p)
    const a = captureEmit(); await p.runTurn('hi', a.emit, new AbortController().signal)
    expect(a.cap.text).toBe('echo: hi [model=acme-large]')
  })
})

describe('LoopAgentProvider — rich', () => {
  it('maps rich events to emit calls', async () => {
    const p = new LoopAgentProvider(richAgent, process.cwd(), null); providers.push(p)
    const a = captureEmit(); await p.runTurn('hey', a.emit, new AbortController().signal)
    expect(a.cap.text).toBe('echo: hey')
    expect(a.cap.tools).toEqual([['t1', 'noop']])
    expect(a.cap.toolEnds).toEqual([['t1', 'finished']])
  })
})

describe('LoopAgentProvider — cancellation', () => {
  it('rejects with an AbortError when the signal aborts', async () => {
    // A fixture that never replies: use `cat` (echoes nothing until EOF) so the turn hangs.
    const hang: AgentConfig = { ...thinAgent, command: 'cat', args: [] }
    const p = new LoopAgentProvider(hang, process.cwd(), null); providers.push(p)
    const ac = new AbortController()
    const a = captureEmit()
    const turn = p.runTurn('hello', a.emit, ac.signal)
    ac.abort()
    await expect(turn).rejects.toMatchObject({ name: 'AbortError' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn test packages/sidecar/src/session/agents/loop-provider.test.ts`
Expected: FAIL — cannot find module `./loop-provider.js`.

- [ ] **Step 4: Implement**

```typescript
// packages/sidecar/src/session/agents/loop-provider.ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AgentConfig } from '@hip/protocol'
import type { GraphEmit } from '../graph.js'
import type { ResolvedModel } from './registry.js'
import { buildModelEnv, parseRichLine, type RichEvent } from './adapters.js'

const RS = '\x1e'              // end-of-turn sentinel (ASCII record separator)
const KILL_GRACE_MS = 2000

/** A turn-level agent. The built-in agent stays inline in Session; this is the external seam. */
export interface AgentProvider {
  runTurn(text: string, emit: GraphEmit, signal: AbortSignal): Promise<void>
  dispose(): void
}

function abortError(): Error {
  const e = new Error('aborted')
  e.name = 'AbortError'
  return e
}

/** Long-lived subprocess that multiplexes turns over stdin/stdout, framed by the RS sentinel. */
export class LoopAgentProvider implements AgentProvider {
  private child: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private stderrTail = ''
  private active: { emit: GraphEmit; signal: AbortSignal; onAbort: () => void; resolve: () => void; reject: (e: Error) => void } | null = null

  constructor(
    private readonly agent: AgentConfig,
    private readonly cwd: string,
    private readonly model: ResolvedModel | null,
  ) {}

  runTurn(text: string, emit: GraphEmit, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError())
    if (!this.child) this.child = this.spawnChild()
    this.buf = ''
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => { this.kill(); this.settle('reject', abortError()) }
      this.active = { emit, signal, onAbort, resolve, reject }
      signal.addEventListener('abort', onAbort, { once: true })
      const payload = this.agent.transport === 'rich'
        ? JSON.stringify({ type: 'user', text }) + '\n'
        : text + RS
      this.child!.stdin.write(payload)
    })
  }

  dispose(): void { this.kill() }

  private spawnChild(): ChildProcessWithoutNullStreams {
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (this.agent.acceptsModelConfig && this.model) Object.assign(env, buildModelEnv(this.model))
    if (this.agent.env) Object.assign(env, this.agent.env)
    const child = spawn(this.agent.command, this.agent.args, { cwd: this.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk))
    child.stderr.on('data', (chunk: string) => { this.stderrTail = (this.stderrTail + chunk).slice(-2000) })
    child.on('error', (err) => this.settle('reject', new Error(`agent process error: ${err.message}`)))
    child.on('exit', (code) => {
      this.child = null
      const tail = this.stderrTail.trim().slice(-500)
      this.settle('reject', new Error(`agent exited (code ${code ?? 'null'})${tail ? `: ${tail}` : ''}`))
    })
    return child
  }

  private onStdout(chunk: string): void {
    if (!this.active) return
    this.buf += chunk
    if (this.agent.transport === 'rich') {
      let nl: number
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim()
        this.buf = this.buf.slice(nl + 1)
        if (!line) continue
        const ev = parseRichLine(line)
        if (!ev) continue
        if (ev.kind === 'done') { this.settle('resolve'); return }
        this.applyRich(ev)
      }
    } else {
      const rs = this.buf.indexOf(RS)
      if (rs >= 0) {
        const text = this.buf.slice(0, rs)
        this.buf = this.buf.slice(rs + 1)
        if (text) this.active.emit.token(text)
        this.settle('resolve')
        return
      }
      if (this.buf) { this.active.emit.token(this.buf); this.buf = '' }
    }
  }

  private applyRich(ev: Exclude<RichEvent, { kind: 'done' }>): void {
    const emit = this.active!.emit
    switch (ev.kind) {
      case 'text': emit.token(ev.delta); break
      case 'reasoning': emit.reasoning(ev.delta); break
      case 'tool_start': emit.toolStarted(ev.name, ev.id, ev.input); break
      case 'tool_end': emit.toolFinished(ev.id, ev.ok ? 'finished' : 'error', ev.output, ev.ok ? undefined : (ev.output ?? 'error')); break
    }
  }

  private settle(how: 'resolve' | 'reject', err?: Error): void {
    const a = this.active
    if (!a) return
    this.active = null
    a.signal.removeEventListener('abort', a.onAbort)
    if (how === 'resolve') a.resolve()
    else a.reject(err ?? new Error('agent failed'))
  }

  private kill(): void {
    const c = this.child
    if (!c) return
    this.child = null
    try { c.kill('SIGINT') } catch { /* already gone */ }
    const t = setTimeout(() => { try { c.kill('SIGKILL') } catch { /* gone */ } }, KILL_GRACE_MS)
    t.unref?.()
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn test packages/sidecar/src/session/agents/loop-provider.test.ts`
Expected: PASS (4 tests). (Cancellation test relies on `cat` being on PATH — true on macOS/Linux dev machines.)

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/agents/loop-provider.ts packages/sidecar/src/session/agents/__fixtures__ packages/sidecar/src/session/agents/loop-provider.test.ts
git commit -m "feat(sidecar): LoopAgentProvider — long-lived subprocess turn-loop (thin+rich)"
```

---

## Task 6: Provider factory + wire into `Session`

**Files:**
- Create: `packages/sidecar/src/session/agents/index.ts`
- Modify: `packages/sidecar/src/session/session.ts`
- Test: `packages/sidecar/src/session/external-agent.integration.test.ts`

- [ ] **Step 1: Implement the factory**

```typescript
// packages/sidecar/src/session/agents/index.ts
import type { AgentConfig } from '@hip/protocol'
import { LoopAgentProvider, type AgentProvider } from './loop-provider.js'
import type { ResolvedModel } from './registry.js'

export { readAgentsConfig, resolveAgentModel, type ResolvedModel } from './registry.js'
export type { AgentProvider } from './loop-provider.js'

/** Build the provider for an external agent. Plan A supports 'custom'; 'opencode' arrives in Plan B. */
export function createAgentProvider(agent: AgentConfig, cwd: string, model: ResolvedModel | null): AgentProvider {
  switch (agent.kind) {
    case 'custom':
      return new LoopAgentProvider(agent, cwd, model)
    case 'opencode':
      throw new Error('OpenCode agent support is not available in this build (Plan B).')
    default:
      throw new Error(`Unknown agent kind: ${(agent as AgentConfig).kind}`)
  }
}
```

- [ ] **Step 2: Wire into `Session`** (`packages/sidecar/src/session/session.ts`)

(a) Add imports near the other session imports:

```typescript
import { createAgentProvider, readAgentsConfig, resolveAgentModel, type AgentProvider } from './agents/index.js'
import type { BaseMessage } from '@langchain/core/messages'
```

(b) Add a field beside the other private fields (~line 180-199):

```typescript
private externalProvider: AgentProvider | null = null
```

(c) Add helpers (place near `modelRunner()` ~line 233):

```typescript
private isExternalAgent(): boolean {
  const a = this._config.agentId
  return !!a && a !== 'builtin'
}

private ensureExternalProvider(): AgentProvider {
  if (!this.externalProvider) {
    const agent = readAgentsConfig().find((x) => x.id === this._config.agentId)
    if (!agent) throw new Error(`Unknown agent: ${this._config.agentId}`)
    if (agent.acceptsModelConfig && agent.boundModel && !resolveAgentModel(agent)?.baseURL) {
      throw new Error(`Agent "${agent.name}" has no resolvable model base URL`)
    }
    const model = agent.acceptsModelConfig ? resolveAgentModel(agent) : null
    this.externalProvider = createAgentProvider(agent, this._config.cwd ?? process.cwd(), model)
  }
  return this.externalProvider
}
```

(d) Add a module-level helper near the top of the file (after imports):

```typescript
/** Latest human-message text in a turn's message list. */
function lastUserText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.getType?.() === 'human' || (m as { _getType?: () => string })._getType?.() === 'human') {
      return typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }
  }
  return ''
}
```

(e) Branch the `try` block in `runTurn` (currently the `this.app.invoke(...)` block at ~line 683). Replace the body of the `try { ... }` up to (but not including) the `} catch (err) {` with:

```typescript
    try {
      if (this.isExternalAgent()) {
        const userText = lastUserText(base?.messages ?? this.messages)
        await this.ensureExternalProvider().runTurn(userText, emit, this.abortController.signal)
        closeReasoning('supervisor')
        finishRemaining()
      } else {
        const finalState = await this.app.invoke(
          { messages: [new SystemMessage(system), ...(base?.messages ?? this.messages)], steps: base?.steps ?? 0, recentSigs: [], nudgedSig: undefined, status: 'running' },
          { configurable: { ctx }, signal: this.abortController.signal, recursionLimit: recursionLimit() },
        )
        closeReasoning('supervisor')
        finishRemaining()
        if (finalState.status === 'awaiting_user') {
          this.paused = { messages: finalState.messages.slice(1), steps: finalState.steps }
          this.awaitingResume = true
          const stoppedText = this.finalizeAndPersist(send, turnId, supervisorText, trajectory, true, usageByAgent)
          send({ type: 'agent:interrupt', sessionId: this.id, turnId, agentId: 'supervisor', question: finalState.pendingQuestion ?? PAUSE_QUESTION })
          return stoppedText
        }
      }
    } catch (err) {
      // ...existing catch body unchanged...
```

The existing `catch` already treats `err.name === 'AbortError'` as a cancellation (persists partial `supervisorText` as a stopped turn) — which is exactly what `LoopAgentProvider` throws on abort, and a process-exit/error throw becomes `AGENT_ERROR`. The `finally` and the post-`try` `finalizeAndPersist` + `captureCheckpoint` (lines 712-721) run **unchanged** for both paths, so external-agent turns get streaming, persistence, and a git checkpoint for free.

(f) Dispose on destroy (`destroy()` ~line 779):

```typescript
destroy(): void {
  this.cancel()
  this.externalProvider?.dispose()
  this.externalProvider = null
}
```

> Note on cancellation semantics (consistent with the approved spec's "stop = abort"): aborting an external turn kills the child process; the next turn re-spawns it fresh (context reset). Acceptable for v1.

- [ ] **Step 3: Write the integration test**

```typescript
// packages/sidecar/src/session/external-agent.integration.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { nanoid } from 'nanoid'
import type { ServerMessage, SessionConfig, AgentsConfig } from '@hip/protocol'
import { SessionManager } from './session-manager.js'

const here = dirname(fileURLToPath(import.meta.url))
const THIN = join(here, 'agents', '__fixtures__', 'echo-thin-agent.mjs')

const tmps: string[] = []
afterEach(() => { for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true }); delete process.env.HIP_AGENTS_PATH })

function writeAgents(cfg: AgentsConfig): string {
  const dir = mkdtempSync(join(tmpdir(), 'hip-agents-')); tmps.push(dir)
  const p = join(dir, 'hip-agents.json'); writeFileSync(p, JSON.stringify(cfg)); return p
}
function tmpCwd(): string { const d = mkdtempSync(join(tmpdir(), 'hip-cwd-')); tmps.push(d); return d }

describe('external agent end-to-end through SessionManager', () => {
  it('routes a turn to the custom agent and streams its echo into a completed message', async () => {
    const agentId = 'agent-' + nanoid()
    process.env.HIP_AGENTS_PATH = writeAgents({ agents: [
      { id: agentId, name: 'Echo', kind: 'custom', command: 'node', args: [THIN], transport: 'thin', acceptsModelConfig: false, enabled: true },
    ] })

    const mgr = new SessionManager() // no store, default modelFactory
    const out: ServerMessage[] = []
    const sessionId = 's-' + nanoid()
    const config: SessionConfig = { llmProvider: 'deepseek', model: 'm', tools: [], cwd: tmpCwd(), agentId }

    const created = new Promise<void>((res) => {
      mgr.handle({ type: 'session:create', id: sessionId, config }, (m) => { out.push(m); if (m.type === 'session:created') res() })
    })
    await created

    const completed = new Promise<ServerMessage>((res) => {
      mgr.handle({ type: 'message:send', sessionId, id: nanoid(), content: 'ping', role: 'user' }, (m) => { out.push(m); if (m.type === 'message:complete') res(m) })
    })
    const done = await completed

    const streamed = out.filter((m) => m.type === 'token:stream').map((m) => (m as Extract<ServerMessage, { type: 'token:stream' }>).delta).join('')
    expect(streamed).toContain('echo: ping')
    expect(done.type).toBe('message:complete')
    if (done.type === 'message:complete') expect(done.message.content).toContain('echo: ping')
  })
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test packages/sidecar/src/session/external-agent.integration.test.ts`
Expected: PASS. (If `message:send` routing differs from assumptions, adjust the test to whatever public method the session-manager exposes — the assertions on `token:stream` / `message:complete` are the contract.)

- [ ] **Step 5: Full sidecar suite sanity check**

Run: `yarn test packages/sidecar`
Expected: all previously-green tests still pass (the builtin path is unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/agents/index.ts packages/sidecar/src/session/session.ts packages/sidecar/src/session/external-agent.integration.test.ts
git commit -m "feat(sidecar): dispatch external-agent turns through AgentProvider; dispose on destroy"
```

---

## Task 7: Rust — registry path, IPC commands, env injection

**Files:**
- Modify: `src-tauri/src/paths.rs` (after `providers_config_path`, ~line 42)
- Modify: `src-tauri/src/lib.rs` (commands near `set_providers_config` ~line 96; handler list ~line 160)
- Modify: `src-tauri/src/sidecar.rs` (env block, after the `HIP_PROVIDERS_PATH` injection ~line 32-35)

- [ ] **Step 1: Add the path helper** (`paths.rs`)

```rust
pub fn agents_config_path(app: &AppHandle) -> Option<PathBuf> {
    Some(config_dir(app)?.join("hip-agents.json"))
}
```

- [ ] **Step 2: Add the IPC commands** (`lib.rs`, mirroring providers)

```rust
#[tauri::command]
fn get_agents_config(app: tauri::AppHandle) -> Result<String, String> {
    match paths::agents_config_path(&app) {
        Some(p) => Ok(std::fs::read_to_string(&p).unwrap_or_default()),
        None => Ok(String::new()),
    }
}

#[tauri::command]
fn set_agents_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = paths::agents_config_path(&app).ok_or("no config dir")?;
    std::fs::write(&p, json).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register them in the handler list** (`lib.rs` ~line 160)

Add `get_agents_config,` and `set_agents_config` to the `tauri::generate_handler![ ... ]` macro (after `set_providers_config`):

```rust
            get_providers_config,
            set_providers_config,
            get_agents_config,
            set_agents_config
```

- [ ] **Step 4: Inject `HIP_AGENTS_PATH`** (`sidecar.rs`, after the providers-path block)

```rust
    // Point the sidecar at the external-agent registry (read fresh per external spawn).
    if let Some(p) = crate::paths::agents_config_path(app) {
        cmd = cmd.env("HIP_AGENTS_PATH", p.to_string_lossy().into_owned());
    }
```

- [ ] **Step 5: Build to verify**

Run: `yarn tauri build --debug` *or* `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors. (Heads-up from memory: a DMG bundling step can intermittently fail at `bundle_dmg.sh`; `cargo check` avoids that and is sufficient here.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/paths.rs src-tauri/src/lib.rs src-tauri/src/sidecar.rs
git commit -m "feat(tauri): hip-agents.json get/set commands + HIP_AGENTS_PATH injection"
```

---

## Task 8: UI IPC for the registry file

**Files:**
- Create: `src/ipc/agentsConfig.ts`
- Test: `src/ipc/agentsConfig.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/ipc/agentsConfig.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

beforeEach(() => invoke.mockReset())

describe('agentsConfig IPC', () => {
  it('getAgentsConfig parses the file payload', async () => {
    const { getAgentsConfig } = await import('./agentsConfig.js')
    invoke.mockResolvedValueOnce(JSON.stringify({ agents: [{ id: 'a', name: 'A', kind: 'custom', command: 'x', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true }] }))
    const cfg = await getAgentsConfig()
    expect(cfg.agents).toHaveLength(1)
    expect(invoke).toHaveBeenCalledWith('get_agents_config')
  })
  it('getAgentsConfig returns empty on blank/corrupt', async () => {
    const { getAgentsConfig } = await import('./agentsConfig.js')
    invoke.mockResolvedValueOnce('')
    expect((await getAgentsConfig()).agents).toEqual([])
    invoke.mockResolvedValueOnce('{ broken')
    expect((await getAgentsConfig()).agents).toEqual([])
  })
  it('setAgentsConfig stringifies and invokes set_agents_config', async () => {
    const { setAgentsConfig } = await import('./agentsConfig.js')
    invoke.mockResolvedValueOnce(undefined)
    await setAgentsConfig({ agents: [] })
    expect(invoke).toHaveBeenCalledWith('set_agents_config', { json: JSON.stringify({ agents: [] }, null, 2) })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/ipc/agentsConfig.test.ts`
Expected: FAIL — cannot find module `./agentsConfig.js`.

- [ ] **Step 3: Implement**

```typescript
// src/ipc/agentsConfig.ts
import { invoke } from '@tauri-apps/api/core'
import type { AgentsConfig } from '@hip/protocol'

export async function getAgentsConfig(): Promise<AgentsConfig> {
  const raw = await invoke<string>('get_agents_config')
  if (!raw.trim()) return { agents: [] }
  try {
    const parsed = JSON.parse(raw) as AgentsConfig
    return Array.isArray(parsed?.agents) ? parsed : { agents: [] }
  } catch {
    return { agents: [] }
  }
}

export async function setAgentsConfig(cfg: AgentsConfig): Promise<void> {
  await invoke<void>('set_agents_config', { json: JSON.stringify(cfg, null, 2) })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/ipc/agentsConfig.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ipc/agentsConfig.ts src/ipc/agentsConfig.test.ts
git commit -m "feat(ui): agentsConfig IPC (get/set hip-agents.json)"
```

---

## Task 9: `agentsStore` (Zustand)

**Files:**
- Create: `src/store/agentsStore.ts`
- Test: `src/store/agentsStore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/store/agentsStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getAgentsConfig = vi.fn()
const setAgentsConfig = vi.fn()
vi.mock('@/ipc/agentsConfig', () => ({
  getAgentsConfig: (...a: unknown[]) => getAgentsConfig(...a),
  setAgentsConfig: (...a: unknown[]) => setAgentsConfig(...a),
}))

beforeEach(async () => {
  getAgentsConfig.mockReset().mockResolvedValue({ agents: [] })
  setAgentsConfig.mockReset().mockResolvedValue(undefined)
  const { useAgentsStore } = await import('./agentsStore.js')
  useAgentsStore.setState({ agents: [], loaded: false })
})

describe('agentsStore', () => {
  it('load() hydrates from the IPC config', async () => {
    getAgentsConfig.mockResolvedValueOnce({ agents: [{ id: 'a', name: 'A', kind: 'custom', command: 'x', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true }] })
    const { useAgentsStore } = await import('./agentsStore.js')
    await useAgentsStore.getState().load()
    expect(useAgentsStore.getState().agents).toHaveLength(1)
    expect(useAgentsStore.getState().loaded).toBe(true)
  })
  it('addAgent persists and returns an id', async () => {
    const { useAgentsStore } = await import('./agentsStore.js')
    const id = await useAgentsStore.getState().addAgent({ name: 'New', kind: 'custom', command: 'mybin', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true })
    expect(typeof id).toBe('string')
    expect(useAgentsStore.getState().agents[0]).toMatchObject({ id, name: 'New' })
    expect(setAgentsConfig).toHaveBeenCalledWith({ agents: [expect.objectContaining({ id, name: 'New' })] })
  })
  it('updateAgent patches the matching agent', async () => {
    const { useAgentsStore } = await import('./agentsStore.js')
    const id = await useAgentsStore.getState().addAgent({ name: 'X', kind: 'custom', command: 'b', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true })
    await useAgentsStore.getState().updateAgent(id, { enabled: false })
    expect(useAgentsStore.getState().agents.find((a) => a.id === id)!.enabled).toBe(false)
  })
  it('removeAgent drops it', async () => {
    const { useAgentsStore } = await import('./agentsStore.js')
    const id = await useAgentsStore.getState().addAgent({ name: 'X', kind: 'custom', command: 'b', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true })
    await useAgentsStore.getState().removeAgent(id)
    expect(useAgentsStore.getState().agents).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/store/agentsStore.test.ts`
Expected: FAIL — cannot find module `./agentsStore.js`.

- [ ] **Step 3: Implement**

```typescript
// src/store/agentsStore.ts
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { AgentConfig } from '@hip/protocol'
import { getAgentsConfig, setAgentsConfig } from '@/ipc/agentsConfig'

interface AgentsStore {
  agents: AgentConfig[]
  loaded: boolean
  load: () => Promise<void>
  addAgent: (a: Omit<AgentConfig, 'id'>) => Promise<string>
  updateAgent: (id: string, patch: Partial<AgentConfig>) => Promise<void>
  removeAgent: (id: string) => Promise<void>
}

export const useAgentsStore = create<AgentsStore>((set, get) => ({
  agents: [],
  loaded: false,
  load: async () => {
    const cfg = await getAgentsConfig()
    set({ agents: cfg.agents, loaded: true })
  },
  addAgent: async (a) => {
    const id = nanoid()
    const next = [...get().agents, { ...a, id }]
    await setAgentsConfig({ agents: next })
    set({ agents: next })
    return id
  },
  updateAgent: async (id, patch) => {
    const next = get().agents.map((x) => (x.id === id ? { ...x, ...patch } : x))
    await setAgentsConfig({ agents: next })
    set({ agents: next })
  },
  removeAgent: async (id) => {
    const next = get().agents.filter((x) => x.id !== id)
    await setAgentsConfig({ agents: next })
    set({ agents: next })
  },
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/store/agentsStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/agentsStore.ts src/store/agentsStore.test.ts
git commit -m "feat(ui): agentsStore (CRUD + persist via agentsConfig IPC)"
```

---

## Task 10: Draft store gains `agentId`

**Files:**
- Modify: `src/store/draftStore.ts`
- Test: `src/store/draftStore.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// src/store/draftStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useDraftStore } from './draftStore'

beforeEach(() => useDraftStore.getState().reset())

describe('draftStore agentId', () => {
  it('setAgentId creates a draft if none and records the agent', () => {
    useDraftStore.getState().setAgentId('agent-1')
    expect(useDraftStore.getState().draft?.agentId).toBe('agent-1')
  })
  it('setAgentId preserves existing draft fields', () => {
    useDraftStore.getState().pickProject('/tmp/x')
    useDraftStore.getState().setAgentId('agent-2')
    const d = useDraftStore.getState().draft!
    expect(d.cwd).toBe('/tmp/x')
    expect(d.mode).toBe('project')
    expect(d.agentId).toBe('agent-2')
  })
  it('reset clears agentId', () => {
    useDraftStore.getState().setAgentId('agent-3')
    useDraftStore.getState().reset()
    expect(useDraftStore.getState().draft).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/store/draftStore.test.ts`
Expected: FAIL — `setAgentId is not a function`.

- [ ] **Step 3: Implement** — edit `src/store/draftStore.ts`:

(a) Add `agentId` to the `Draft` interface:

```typescript
export interface Draft {
  tempId: string
  mode: 'project' | 'chat'
  cwd?: string
  text: string
  agentId?: string             // 'builtin' / undefined => built-in agent; else an AgentConfig.id
}
```

(b) Add `setAgentId` to the `DraftStore` interface:

```typescript
  setAgentId: (agentId: string) => void
```

(c) Add the action inside the store (next to `pickProject`):

```typescript
      setAgentId: (agentId) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          return { draft: { ...base, agentId } }
        }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/store/draftStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/draftStore.ts src/store/draftStore.test.ts
git commit -m "feat(ui): draft store carries the chosen agentId"
```

---

## Task 11: Fold `agentId` into `SessionConfig` on commit

**Files:**
- Modify: `src/domain/sessionService.ts` (the `sendMessage` draft→commit block ~line 283-290)
- Test: `src/domain/sessionService.configFromDraft.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// src/domain/sessionService.configFromDraft.test.ts
import { describe, it, expect } from 'vitest'
import { configFromDraft } from './sessionService'

describe('configFromDraft', () => {
  it('null draft → default config, no agentId', () => {
    const cfg = configFromDraft(null)
    expect(cfg.agentId).toBeUndefined()
  })
  it('project draft keeps cwd', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'project', cwd: '/p', text: '' })
    expect(cfg.cwd).toBe('/p')
  })
  it('draft with an external agentId folds it in', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', agentId: 'agent-9' })
    expect(cfg.agentId).toBe('agent-9')
  })
  it("built-in agentId is treated as no external agent", () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', agentId: 'builtin' })
    expect(cfg.agentId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/domain/sessionService.configFromDraft.test.ts`
Expected: FAIL — `configFromDraft` is not exported.

- [ ] **Step 3: Implement** — in `src/domain/sessionService.ts`:

(a) Add the exported helper near `sendMessage` (it uses the existing `DEFAULT_CONFIG` and `Draft` type — import `Draft` from `@/store/draftStore` if not already in scope):

```typescript
import type { Draft } from '@/store/draftStore'

/** Build the committed SessionConfig from the current draft, folding in a chosen external agent. */
export function configFromDraft(draft: Draft | null): SessionConfig {
  const base: SessionConfig =
    draft?.mode === 'project' && draft.cwd ? { ...DEFAULT_CONFIG, cwd: draft.cwd } : DEFAULT_CONFIG
  return draft?.agentId && draft.agentId !== 'builtin' ? { ...base, agentId: draft.agentId } : base
}
```

(b) Replace the inline config assembly in `sendMessage` (the two lines currently computing `config`) with a call to the helper:

```typescript
  if (!activeSessionId) {
    const draft = useDraftStore.getState().draft
    const config: SessionConfig = configFromDraft(draft)
    activeSessionId = this.createSession(config)
    if (draft?.cwd) useFsStore.getState().clearSession(draft.cwd)
    useDraftStore.getState().reset()
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/domain/sessionService.configFromDraft.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionService.ts src/domain/sessionService.configFromDraft.test.ts
git commit -m "feat(ui): freeze the chosen agentId into SessionConfig on draft commit"
```

---

## Task 12: i18n keys

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`

- [ ] **Step 1: Add the `settings.agents` block and `chat.agent*` keys**

In `en.ts` add to `settings` (after `model`/`modelConfig`):

```typescript
  agentsLabel: 'Agent Management',
  agents: {
    title: 'Agent Management',
    intro: 'Register external agents. The built-in hip agent is always the default.',
    builtinName: 'hip (built-in)',
    builtinDesc: 'The default agent. Cannot be edited.',
    add: 'Add agent',
    addCustom: 'Custom CLI agent',
    empty: 'No external agents yet.',
    name: 'Name',
    command: 'Command',
    args: 'Arguments (space-separated)',
    transport: 'Protocol',
    transportThin: 'Thin (plain text)',
    transportRich: 'Rich (JSON events)',
    acceptsModel: 'Push my configured model + key',
    boundModel: 'Model',
    enabled: 'Enabled',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    error: 'Action failed. Please try again.',
  },
```

In `chat` (the namespace StylePicker uses) add:

```typescript
  agentHint: 'Switch agent (before the conversation starts)',
  agentBuiltin: 'hip',
  agentLocked: 'Agent is locked for this conversation',
  agentRestarted: 'External agent restarted — earlier context was not carried over.',
```

In `zh-CN.ts` (Simplified Chinese):

```typescript
  agentsLabel: '智能体管理',
  agents: {
    title: '智能体管理',
    intro: '接入外部智能体',
    builtinName: 'hip（内置）',
    builtinDesc: '默认智能体，不可编辑。',
    add: '添加智能体',
    addCustom: '自定义命令行智能体',
    empty: '暂无外部智能体。',
    name: '名称',
    command: '命令',
    args: '参数（空格分隔）',
    transport: '协议',
    transportThin: '精简（纯文本）',
    transportRich: '丰富（JSON 事件）',
    acceptsModel: '推送我配置的模型与密钥',
    boundModel: '模型',
    enabled: '启用',
    save: '保存',
    cancel: '取消',
    delete: '删除',
    edit: '编辑',
    error: '操作失败，请重试。',
  },
```

and in `chat`:

```typescript
  agentHint: '切换智能体（仅在对话开始前）',
  agentBuiltin: 'hip',
  agentLocked: '本次对话的智能体已锁定',
  agentRestarted: '外部智能体已重启 —— 之前的上下文未保留。',
```

In `zh-TW.ts` use the Traditional equivalents (智能體管理 / 接入外部命令列智能體 / 內建 / 參數（以空白分隔） / 精簡 / 豐富 / 推送我設定的模型與密鑰 / 啟用 / 儲存 / 取消 / 刪除 / 編輯 / 操作失敗，請重試。; chat: 切換智能體（僅在對話開始前）/ 本次對話的智能體已鎖定 / 外部智能體已重啟 —— 先前的上下文未保留。).

> ⚠️ bash/CJK note from memory: if you script any of this with `set -u` under the system bash 3.2, brace `${var}` before CJK punctuation. (Editing the TS files directly avoids this entirely.)

- [ ] **Step 2: Typecheck (i18n files are typed by the en shape)**

Run: `yarn typecheck` (or `yarn tsc --noEmit`)
Expected: PASS — the three locale objects share the same key shape.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(i18n): agent management + composer agent-picker strings"
```

---

## Task 13: Settings → Agent Management page (manual-GUI verified)

**Files:**
- Create: `src/components/account/AgentManagement.tsx`
- Modify: `src/components/account/SettingsPanel.tsx` (PAGES array + import; pick a lucide icon, e.g. `Bot`)

> No unit test (no component-test harness). Verified by manual GUI acceptance in Step 3.

- [ ] **Step 1: Implement the page** (mirror `ModelConfig.tsx` imports for `Modal`, button styles, and store usage)

```tsx
// src/components/account/AgentManagement.tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Pencil, Trash2, Plus } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { useProvidersStore } from '@/store/providersStore'
import { Modal } from '@/components/ui/Modal'

type Editing = { mode: 'add' } | { mode: 'edit'; agent: AgentConfig } | null

export function AgentManagement() {
  const { t } = useTranslation()
  const { agents, loaded, load, addAgent, updateAgent, removeAgent } = useAgentsStore()
  const [editing, setEditing] = useState<Editing>(null)

  useEffect(() => { if (!loaded) void load() }, [loaded, load])

  return (
    <div className="p-6">
      <h2 className="text-h3 font-semibold">{t('settings.agents.title')}</h2>
      <p className="mt-1 text-body text-secondary">{t('settings.agents.intro')}</p>

      <div className="mt-5 space-y-2">
        {/* Built-in, pinned, non-editable */}
        <div className="flex items-center justify-between rounded-lg border border-subtle bg-surface px-4 py-3">
          <div className="flex items-center gap-3">
            <Bot size={18} className="text-accent" />
            <div>
              <div className="text-body font-medium">{t('settings.agents.builtinName')}</div>
              <div className="text-meta text-tertiary">{t('settings.agents.builtinDesc')}</div>
            </div>
          </div>
        </div>

        {agents.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-lg border border-subtle px-4 py-3">
            <div>
              <div className="text-body font-medium">{a.name}{!a.enabled && <span className="ml-2 text-meta text-tertiary">(off)</span>}</div>
              <div className="text-meta text-tertiary">{a.command} {a.args.join(' ')} · {a.transport}{a.boundModel ? ` · ${a.boundModel.modelID}` : ''}</div>
            </div>
            <div className="flex items-center gap-2">
              <button className="rounded p-1.5 hover:bg-subtle" onClick={() => setEditing({ mode: 'edit', agent: a })} aria-label={t('settings.agents.edit')}><Pencil size={15} /></button>
              <button className="rounded p-1.5 hover:bg-subtle" onClick={() => void removeAgent(a.id)} aria-label={t('settings.agents.delete')}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}

        {agents.length === 0 && <div className="rounded-lg border border-dashed border-subtle px-4 py-6 text-center text-meta text-tertiary">{t('settings.agents.empty')}</div>}

        <button onClick={() => setEditing({ mode: 'add' })} className="mt-2 flex items-center gap-1.5 text-body font-medium text-accent hover:text-accent-hover">
          <Plus size={15} /> {t('settings.agents.add')}
        </button>
      </div>

      {editing && (
        <AgentEditor
          initial={editing.mode === 'edit' ? editing.agent : null}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            if (editing.mode === 'edit') await updateAgent(editing.agent.id, draft)
            else await addAgent(draft)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function AgentEditor({ initial, onSave, onCancel }: {
  initial: AgentConfig | null
  onSave: (draft: Omit<AgentConfig, 'id'>) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { config, catalog } = useProvidersStore()
  const [name, setName] = useState(initial?.name ?? '')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [args, setArgs] = useState((initial?.args ?? []).join(' '))
  const [transport, setTransport] = useState<AgentConfig['transport']>(initial?.transport ?? 'thin')
  const [acceptsModelConfig, setAccepts] = useState(initial?.acceptsModelConfig ?? false)
  const [boundModelKey, setBoundModelKey] = useState(initial?.boundModel ? `${initial.boundModel.providerID}/${initial.boundModel.modelID}` : '')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [busy, setBusy] = useState(false)

  // Flatten configured providers' models into provider/model options.
  const modelOptions: Array<{ key: string; label: string }> = Object.entries(catalog)
    .filter(([id]) => config.providers[id]?.enabled)
    .flatMap(([id, p]) => Object.keys(p.models ?? {}).map((m) => ({ key: `${id}/${m}`, label: `${p.name} · ${m}` })))

  const valid = name.trim() && command.trim() && (!acceptsModelConfig || boundModelKey)

  const submit = async () => {
    setBusy(true)
    try {
      const [providerID, modelID] = boundModelKey.split('/')
      await onSave({
        name: name.trim(),
        kind: 'custom',
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : [],
        transport,
        acceptsModelConfig,
        boundModel: acceptsModelConfig && boundModelKey ? { providerID, modelID } : undefined,
        enabled,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onCancel() }} title={t('settings.agents.addCustom')} resizable defaultSize={{ width: 560, height: 560 }} minSize={{ width: 480, height: 440 }}>
      <div className="space-y-4 p-5 text-body">
        <Field label={t('settings.agents.name')}><input className="ipt" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Agent" /></Field>
        <Field label={t('settings.agents.command')}><input className="ipt" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="/usr/local/bin/my-agent" /></Field>
        <Field label={t('settings.agents.args')}><input className="ipt" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="--loop --json" /></Field>
        <Field label={t('settings.agents.transport')}>
          <select className="ipt" value={transport} onChange={(e) => setTransport(e.target.value as AgentConfig['transport'])}>
            <option value="thin">{t('settings.agents.transportThin')}</option>
            <option value="rich">{t('settings.agents.transportRich')}</option>
          </select>
        </Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={acceptsModelConfig} onChange={(e) => setAccepts(e.target.checked)} /> {t('settings.agents.acceptsModel')}</label>
        {acceptsModelConfig && (
          <Field label={t('settings.agents.boundModel')}>
            <select className="ipt" value={boundModelKey} onChange={(e) => setBoundModelKey(e.target.value)}>
              <option value="">—</option>
              {modelOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </Field>
        )}
        <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t('settings.agents.enabled')}</label>

        <div className="flex justify-end gap-2 pt-2">
          <button className="h-8 rounded-md px-3 text-body hover:bg-subtle" onClick={onCancel}>{t('settings.agents.cancel')}</button>
          <button className="h-8 rounded-md bg-accent px-3 text-body font-medium text-white hover:bg-accent-hover disabled:opacity-50" disabled={busy || !valid} onClick={() => void submit()}>{t('settings.agents.save')}</button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-meta uppercase tracking-wide text-tertiary">{label}</label>
      {children}
    </div>
  )
}
```

> The `.ipt` class is a shorthand; if the project has no such utility, inline the input classes used in `ModelConfig.tsx` (`h-8 rounded-md border border-subtle bg-surface px-2 …`). Match the surrounding token names (`text-body`, `text-tertiary`, `bg-accent`, `border-subtle`) — confirm against `ModelConfig.tsx`/`tailwind.config`.

- [ ] **Step 2: Register the page** — in `src/components/account/SettingsPanel.tsx`, import and append:

```typescript
import { SlidersHorizontal, Cpu, Bot } from 'lucide-react'
import { AgentManagement } from './AgentManagement'

const PAGES = [
  { id: 'general', icon: SlidersHorizontal, labelKey: 'settings.general', Component: GeneralSettings },
  { id: 'model', icon: Cpu, labelKey: 'settings.model', Component: ModelConfig },
  { id: 'agents', icon: Bot, labelKey: 'settings.agentsLabel', Component: AgentManagement },
] as const
```

- [ ] **Step 3: Manual GUI verification**

Run the app (`yarn tauri dev`). Open Settings → **Agent Management**:
- The built-in hip card is pinned and has no edit/delete.
- "Add agent" → fill name + command (e.g. `node` + args pointing at a local echo script) → Save → it appears in the list and `~/.hip/config/hip-agents.json` is written.
- Toggle "Push my configured model + key" → a model dropdown (populated from configured providers) appears and is required.
- Edit and Delete work; reload the app and the list persists.

- [ ] **Step 4: Commit**

```bash
git add src/components/account/AgentManagement.tsx src/components/account/SettingsPanel.tsx
git commit -m "feat(ui): Agent Management settings page (card list + editor modal)"
```

---

## Task 14: Composer agent picker (manual-GUI verified)

**Files:**
- Create: `src/components/composer/AgentPicker.tsx`
- Modify: `src/components/composer/InputBar.tsx` (the `leftSlot` prop)

> Mirror `StylePicker.tsx` for the `ComposerChip`, `DropdownMenu*`, `cn`, `useTranslation`, `useActiveSession`/`useActiveSessionId` imports. No unit test — manual GUI in Step 3.

- [ ] **Step 1: Implement the picker**

```tsx
// src/components/composer/AgentPicker.tsx
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Check, Lock } from 'lucide-react'
import { useActiveSession, useActiveSessionId } from '@/domain'
import { useDraftStore } from '@/store/draftStore'
import { useAgentsStore } from '@/store/agentsStore'
import { cn } from '@/lib/utils' // use the same import StylePicker.tsx uses
import { ComposerChip } from './ComposerChip' // same import path StylePicker.tsx uses
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/DropdownMenu' // mirror StylePicker

export function AgentPicker() {
  const { t } = useTranslation()
  const activeId = useActiveSessionId()
  const session = useActiveSession()
  const agents = useAgentsStore((s) => s.agents)
  const loaded = useAgentsStore((s) => s.loaded)
  const load = useAgentsStore((s) => s.load)
  const draft = useDraftStore((s) => s.draft)
  const setAgentId = useDraftStore((s) => s.setAgentId)

  useEffect(() => { if (!loaded) void load() }, [loaded, load])

  // Committed session: locked, read-only badge — and only when an external agent was chosen.
  if (activeId && session) {
    const aid = session.config.agentId
    if (!aid || aid === 'builtin') return null
    const name = agents.find((a) => a.id === aid)?.name ?? aid
    return (
      <ComposerChip disabled active title={t('chat.agentLocked')} data-testid="agent-chip-locked">
        <Bot size={13} className="shrink-0" aria-hidden />
        <span className="max-w-[120px] truncate">{name}</span>
        <Lock size={11} className="shrink-0 opacity-60" aria-hidden />
      </ComposerChip>
    )
  }

  // Draft: interactive picker over built-in + enabled external agents.
  const enabled = agents.filter((a) => a.enabled)
  const currentId = draft?.agentId ?? 'builtin'
  const currentName = currentId === 'builtin'
    ? t('chat.agentBuiltin')
    : (enabled.find((a) => a.id === currentId)?.name ?? t('chat.agentBuiltin'))

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ComposerChip active={currentId !== 'builtin'} title={t('chat.agentHint')} data-testid="agent-chip">
          <Bot size={13} className="shrink-0" aria-hidden />
          <span className="max-w-[120px] truncate">{currentName}</span>
        </ComposerChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => setAgentId('builtin')}>
          <Check size={14} className={cn('shrink-0', currentId === 'builtin' ? 'opacity-100' : 'opacity-0')} />
          <span>{t('chat.agentBuiltin')}</span>
        </DropdownMenuItem>
        {enabled.map((a) => (
          <DropdownMenuItem key={a.id} onSelect={() => setAgentId(a.id)}>
            <Check size={14} className={cn('shrink-0', currentId === a.id ? 'opacity-100' : 'opacity-0')} />
            <span className="truncate">{a.name}</span>
            {a.boundModel && <span className="ml-2 text-meta text-tertiary">{a.boundModel.modelID}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: Mount it in the composer** — in `src/components/composer/InputBar.tsx`, change `leftSlot={<StylePicker />}` to render both (a fragment), so the draft shows the AgentPicker and the committed view shows StylePicker (+ the locked agent badge):

```tsx
import { AgentPicker } from './AgentPicker'
// ...
        leftSlot={<><AgentPicker /><StylePicker /></>}
```

- [ ] **Step 3: Manual GUI verification**

Run the app. With **no active conversation** (draft):
- The composer shows an agent chip defaulting to "hip". Open it → built-in + your enabled external agents listed, each with its bound model as subtext. Pick one → chip updates.
- Send the first message → the chip locks to a `via <agent> 🔒` badge and the dropdown no longer opens. Picking built-in then sending shows no agent badge (built-in is implicit).
- Confirm the external agent actually runs the turn (its echoed/real output streams into the assistant bubble) and a checkpoint appears in the git panel.

- [ ] **Step 4: Commit**

```bash
git add src/components/composer/AgentPicker.tsx src/components/composer/InputBar.tsx
git commit -m "feat(ui): draft-only composer agent picker; locks after commit"
```

---

## Task 15: Reopen notice banner (manual-GUI verified)

**Files:**
- Modify: the chat/transcript view component that handles `session:loaded` rendering (find via `grep -rn "session:loaded\|useActiveSession(" src/components/chat`).

> When a committed session that uses an external agent is reopened and already has prior assistant turns, show a subtle one-line banner (the external process is re-spawned fresh, per the approved spec).

- [ ] **Step 1: Implement** — in the chat view, derive and render the banner:

```tsx
// inside the transcript/chat component
const session = useActiveSession()
const showAgentRestart =
  !!session &&
  !!session.config.agentId &&
  session.config.agentId !== 'builtin' &&
  session.messages.some((m) => m.role === 'assistant')

// near the top of the message list:
{showAgentRestart && (
  <div className="mx-auto my-2 w-fit rounded-full bg-subtle px-3 py-1 text-meta text-tertiary">
    {t('chat.agentRestarted')}
  </div>
)}
```

- [ ] **Step 2: Manual GUI verification**

Start an external-agent conversation, send a couple of turns, switch away and reopen it from the session list → the subtle "external agent restarted" banner shows once at the top; a fresh (no-history) external conversation that you just started shows **no** banner.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(ui): subtle reopen notice for external-agent sessions"
```

---

## Task 16 (optional): paid-free wdio E2E

**Files:**
- Create/extend a wdio spec under the project's e2e dir (mirror an existing spec; see memory `e2e-gui-launch-gotchas`).

> Optional and heavier. Per project convention, this kind of non-LLM FS/UI flow is welcome as real-machine E2E, but the live-LLM path is accepted via manual GUI. This E2E uses a fake echo agent → **no paid calls**.

- [ ] **Step 1: Spec outline** — programmatically seed `~/.hip/config/hip-agents.json` with a custom echo agent (`command: node`, args: a bundled echo `.mjs`), launch the app, in a fresh draft open the agent picker, select the echo agent, send "ping", assert the transcript shows `echo: ping` and a checkpoint row appears. Follow the existing wdio+tauri launch recipe (dev-shim PATH fix; no keychain re-auth needed — keychain was removed).

- [ ] **Step 2: Run** (real machine): the project's e2e command (e.g. `yarn e2e`).
Expected: green, no paid calls.

- [ ] **Step 3: Commit.**

---

## Plan A self-review

**Spec coverage** (against `2026-06-14-external-agent-management-design.md`):
- §4.1 AgentProvider seam → T5/T6. ✓ (built-in stays inline; external dispatches through `AgentProvider` — a faithful, lower-risk realization of "built-in is just another provider".)
- §4.2 two-tier protocol (thin + rich) + turn framing/sentinel → T4/T5. ✓
- §4.3 model+key env injection → T3/T4/T5. ✓
- §4.4 data model → T1. ✓ (`boundModelId` refined to `boundModel: {providerID, modelID}` — needed because baseURL/key resolution is per-provider.)
- §4.5 registry plumbing (HIP_AGENTS_PATH, hip-agents.json) → T3/T7/T8/T9. ✓ (read fresh per spawn → no sidecar restart needed; `config:setAgent` IPC dropped — agentId rides in `session:create`'s config, which is simpler and correct since drafts are client-side. **Deviation from spec §4.5; see handoff note.**)
- §4.6 shared cwd + auto checkpoint → T6 (existing `captureCheckpoint` runs unchanged after the external branch). ✓
- §4.7 lifecycle + cancellation (SIGINT→SIGKILL, dispose on destroy, respawn fresh) → T5/T6. ✓
- §5.1 settings card-list + drawer → T13. ✓
- §5.2 draft-only picker + locked badge → T10/T11/T14. ✓
- §6 error handling (missing binary, no bound model, crash, malformed line, stop) → T4/T5/T6/T13. ✓
- §7 testing (stub child, multi-turn, env injection, cancellation, checkpoint, store CRUD, picker gating) → T2–T11 + manual GUI T13–T15. ✓
- §8 reopen notice → T15. ✓
- §8 file-change map → matches this plan's "File structure".

**Placeholder scan:** none — every code step has complete code; UI tasks without unit tests are explicitly manual-GUI by repo constraint (documented), not deferred.

**Type consistency:** `AgentConfig`/`AgentsConfig`/`BoundModel`/`AgentTransport`/`SessionConfig.agentId` (T1) used identically across registry (T3), adapters (T4), provider (T5), factory/session (T6), IPC (T8), store (T9), draft (T10), commit (T11), UI (T13/T14). `ResolvedModel` defined in T3, consumed by T4/T5. `AgentProvider`/`RichEvent` defined in T5/T4, consumed by T6.

**Deviations from the spec (carried to handoff):**
1. OpenCode is **deferred to Plan B** (its CLI is one-shot + `--session` resume, and its `--format json` schema is undocumented/unstable — needs the installed binary to verify). Plan A ships the full framework + "Custom CLI agent", which satisfies the "self-built agent" requirement end-to-end and is fully testable.
2. `boundModelId` → `boundModel: {providerID, modelID}` (per-provider key/baseURL resolution).
3. `config:setAgent` IPC dropped; the chosen `agentId` rides into `SessionConfig` at `session:create`.
4. UI components verified by manual GUI (no component-test harness in this repo).

---

## Plan B preview (separate plan, after Plan A lands)

OpenCode adapter as a second `AgentProvider` (`kind: 'opencode'`), implemented as **one-shot-with-session-resume** rather than the loop:
- Per turn: `opencode run --format <fmt> -m <providerID>/<modelID> [--session <sid> | --continue] <message>`, with a stable per-hip-session OpenCode session id for continuity.
- Model/key push: `-m provider/model` + provider-specific env (verify the exact env var OpenCode expects per provider; OpenCode reads provider keys from env / its own auth.json / `OPENCODE_CONFIG`).
- v1 of the adapter ships **thin** (capture stdout as the assistant bubble) — reliable today. The **rich** parser (mapping OpenCode's `--format json` events → hip tool cards/reasoning) is a follow-up gated on pinning OpenCode's event schema against the installed version (upstream issue noted that `run --format json` can exit before the final event).
- Curated catalog entry: add an "OpenCode" choice in the Agent Management "Add" flow (T13) that prefills `kind:'opencode'`, `command:'opencode'`, and locates the binary.
