# Remediation Phase 2 — Real Multi-Agent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidecar actually run a Supervisor that delegates to Planner / Coder / Reviewer sub-agents, and surface each sub-agent's lifecycle and token stream as the protocol events the UI already renders.

**Architecture:** Use deepagents' built-in sub-agent delegation (`createDeepAgent({ subagents })`). Consume the compiled graph's event stream, attribute each token/lifecycle event to a `(agentId, role)` via a pure attribution helper, and emit the existing `agent:started` / `token:stream` / `agent:finished` / `message:complete` protocol messages. Sub-agents are reasoning-only (no real file/exec tools this phase).

**Tech Stack:** Node.js, `deepagents` ^1.10, `@langchain/langgraph` ^1.3, `@langchain/core` ^1.1, `@langchain/openai` ^1.4 (DeepSeek), Vitest.

**Spec:** [docs/superpowers/specs/2026-06-07-hip-remediation-design.md](../specs/2026-06-07-hip-remediation-design.md) (§W1)

**Depends on:** Phase 1 (real API key path — required to debug this phase against DeepSeek).

---

## ⚠️ Why this phase starts with a spike

The current [session.ts](../../../packages/sidecar/src/session/session.ts) uses a **non-standard** streaming call (`streamEvents(..., { version: 'v3' })` then `for await (const msg of run.messages)`), which does not match the LangChain Runnable API. Three things must be confirmed against the *locked* dependency versions before writing the real streaming code:

1. The correct token-streaming method and event shape.
2. How a sub-agent is identified in event metadata (which field, what value).
3. The exact `createDeepAgent({ subagents })` config field names.

Task 1 is a throwaway spike that answers these with the real DeepSeek API (you authorized real-LLM debugging). Its findings are recorded back into this plan and the spec, then Tasks 2-7 implement against the confirmed API. The implementation tasks below are written against the **most likely** API (`streamEvents` v2); the ≤4 points to confirm are marked `🔎 SPIKE`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/sidecar/scripts/spike-stream.ts` | Throwaway: print raw stream events to learn the API | Create (delete after Task 1) |
| `packages/sidecar/src/session/agents.ts` | Sub-agent definitions (planner/coder/reviewer) + role map | Create |
| `packages/sidecar/src/session/attribution.ts` | Pure: stream event → `{ agentId, role, kind }` | Create |
| `packages/sidecar/src/session/attribution.test.ts` | Unit tests for attribution (synthetic events) | Create |
| `packages/sidecar/src/session/session.ts` | Build deep agent with subagents; emit per-agent protocol events | Modify |
| `packages/sidecar/src/session/multiagent.integration.test.ts` | Real-LLM test: multiple roles emit events (skipIf no key) | Create |

---

## Task 1: Spike — confirm the streaming + sub-agent API (real DeepSeek)

**Files:**
- Create (throwaway): `packages/sidecar/scripts/spike-stream.ts`

- [ ] **Step 1: Write the spike script**

```ts
// packages/sidecar/scripts/spike-stream.ts — THROWAWAY, delete after recording findings
import { createDeepAgent } from 'deepagents'
import { ChatOpenAI } from '@langchain/openai'

const model = new ChatOpenAI({
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
})

// 🔎 SPIKE Q3: confirm the subagent config field names (name/description/prompt?).
const agent = createDeepAgent({
  model,
  systemPrompt: 'You are a Supervisor. Delegate planning to the "planner" subagent, then answer.',
  subagents: [
    { name: 'planner', description: 'Breaks a task into steps', prompt: 'You are a planner. Output a short numbered plan.' },
  ],
})

async function main() {
  // 🔎 SPIKE Q1: is this the right call? Try streamEvents v2.
  const stream = agent.streamEvents(
    { messages: [{ role: 'user', content: 'Plan and then say hello.' }] },
    { version: 'v2' },
  )
  for await (const ev of stream) {
    // 🔎 SPIKE Q1/Q2: log event type, name, and metadata to learn token + attribution shape.
    if (ev.event === 'on_chat_model_stream') {
      console.log('TOKEN', JSON.stringify({ name: ev.name, meta: ev.metadata, chunk: ev.data?.chunk?.content }))
    } else if (ev.event === 'on_chain_start' || ev.event === 'on_chain_end') {
      console.log(ev.event.toUpperCase(), JSON.stringify({ name: ev.name, meta: ev.metadata }))
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run it against the real API**

Run: `cd packages/sidecar && DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY yarn tsx scripts/spike-stream.ts`
Expected: a stream of `TOKEN` / `ON_CHAIN_START` / `ON_CHAIN_END` lines.

- [ ] **Step 3: Record findings (the deliverable)**

From the output, determine and write down (append a `## W1 Spike Findings (2026-06-07)` block to the spec file [docs/superpowers/specs/2026-06-07-hip-remediation-design.md](../specs/2026-06-07-hip-remediation-design.md)):
- **Q1** the streaming call + how to read a token delta (e.g. `ev.data.chunk.content` for `on_chat_model_stream`).
- **Q2** the field that identifies the active sub-agent (likely `ev.metadata.langgraph_node` or `ev.metadata.checkpoint_ns`) and what value each sub-agent / the supervisor produces.
- **Q3** the confirmed `subagents` config shape (field names).
- **Q4** whether delegating to two sub-agents interleaves their token events (parallel) or serializes them.

- [ ] **Step 4: Delete the spike + commit the findings**

```bash
rm packages/sidecar/scripts/spike-stream.ts
git add docs/superpowers/specs/2026-06-07-hip-remediation-design.md
git commit -m "docs(spec): record W1 streaming/sub-agent spike findings"
```

---

## Task 2: Define the sub-agents

**Files:**
- Create: `packages/sidecar/src/session/agents.ts`

- [ ] **Step 1: Create the sub-agent definitions and role map**

> 🔎 SPIKE Q2/Q3: the `name` values here MUST match what the attribution helper looks for, and the object shape (`prompt` vs `systemPrompt`) must match the confirmed deepagents API. Adjust both together if the spike says otherwise.

```ts
// packages/sidecar/src/session/agents.ts
import type { AgentRole } from '@hip/protocol'

/** Sub-agent definitions passed to createDeepAgent({ subagents }). Reasoning-only (no tools this phase). */
export const SUBAGENTS = [
  {
    name: 'planner',
    description: 'Breaks the request into a short ordered plan before any code is written.',
    prompt: 'You are the Planner. Produce a concise numbered plan. Do not write code.',
  },
  {
    name: 'coder',
    description: 'Writes or edits code to satisfy the plan.',
    prompt: 'You are the Coder. Implement the plan. Output code and a one-line summary.',
  },
  {
    name: 'reviewer',
    description: 'Reviews the coder output for correctness and risks.',
    prompt: 'You are the Reviewer. Critically review the code for bugs and risks. Be concise.',
  },
] as const

export const SUPERVISOR_PROMPT =
  'You are the Supervisor. Coordinate the planner, coder, and reviewer sub-agents to answer the user, then give a final synthesized response.'

/** Map a deepagents node/sub-agent name to a protocol AgentRole. */
const NAME_TO_ROLE: Record<string, AgentRole> = {
  planner: 'planner',
  coder: 'coder',
  reviewer: 'reviewer',
}

export function roleForName(name: string | undefined): AgentRole {
  if (name && name in NAME_TO_ROLE) return NAME_TO_ROLE[name]
  return 'supervisor'
}
```

- [ ] **Step 2: Type-check**

Run: `yarn workspace @hip/sidecar type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/sidecar/src/session/agents.ts
git commit -m "feat(sidecar): define planner/coder/reviewer sub-agents"
```

---

## Task 3: Attribution helper (pure, TDD)

**Files:**
- Create: `packages/sidecar/src/session/attribution.ts`
- Create: `packages/sidecar/src/session/attribution.test.ts`

- [ ] **Step 1: Write failing tests**

> The shape of `StreamEv` below models the fields we depend on. 🔎 SPIKE Q1/Q2: align `tokenName`/`metaNodeKey` extraction with the confirmed event shape; the tests assert behavior of the helper, which stays valid regardless of field source.

```ts
// packages/sidecar/src/session/attribution.test.ts
import { describe, it, expect } from 'vitest'
import { attribute, agentIdForRole } from './attribution.js'

describe('attribute', () => {
  it('maps a chat-model token to the active node role + a stable agentId', () => {
    const r = attribute({ event: 'on_chat_model_stream', name: 'ChatOpenAI', metadata: { langgraph_node: 'planner' }, data: { chunk: { content: 'hi' } } })
    expect(r).toEqual({ kind: 'token', role: 'planner', agentId: 'planner', delta: 'hi' })
  })

  it('treats an unknown / top-level node as the supervisor', () => {
    const r = attribute({ event: 'on_chat_model_stream', name: 'ChatOpenAI', metadata: { langgraph_node: 'agent' }, data: { chunk: { content: 'x' } } })
    expect(r).toEqual({ kind: 'token', role: 'supervisor', agentId: 'supervisor', delta: 'x' })
  })

  it('ignores empty token deltas', () => {
    expect(attribute({ event: 'on_chat_model_stream', name: 'ChatOpenAI', metadata: { langgraph_node: 'coder' }, data: { chunk: { content: '' } } })).toBeNull()
  })

  it('returns null for events we do not surface', () => {
    expect(attribute({ event: 'on_tool_start', name: 'task', metadata: {} })).toBeNull()
  })

  it('builds deterministic agentIds per role', () => {
    expect(agentIdForRole('supervisor')).toBe('supervisor')
    expect(agentIdForRole('reviewer')).toBe('reviewer')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run packages/sidecar/src/session/attribution.test.ts`
Expected: FAIL — `attribute` not defined.

- [ ] **Step 3: Implement the helper**

```ts
// packages/sidecar/src/session/attribution.ts
import type { AgentRole } from '@hip/protocol'
import { roleForName } from './agents.js'

export interface StreamEv {
  event: string
  name?: string
  metadata?: Record<string, unknown>
  data?: { chunk?: { content?: unknown } }
}

export type Attribution =
  | { kind: 'token'; role: AgentRole; agentId: string; delta: string }
  | null

/** Stable per-role agent id (one logical agent per role this phase). */
export function agentIdForRole(role: AgentRole): string {
  return role
}

/** 🔎 SPIKE Q2: the metadata key that names the active node. */
const NODE_KEY = 'langgraph_node'

export function attribute(ev: StreamEv): Attribution {
  if (ev.event !== 'on_chat_model_stream') return null
  const content = ev.data?.chunk?.content
  const delta = typeof content === 'string' ? content : ''
  if (!delta) return null
  const node = ev.metadata?.[NODE_KEY]
  const role = roleForName(typeof node === 'string' ? node : undefined)
  return { kind: 'token', role, agentId: agentIdForRole(role), delta }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run packages/sidecar/src/session/attribution.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/attribution.ts packages/sidecar/src/session/attribution.test.ts
git commit -m "feat(sidecar): pure stream-event attribution helper with tests"
```

---

## Task 4: Rewrite Session streaming to emit per-agent events

**Files:**
- Modify: `packages/sidecar/src/session/session.ts`

This replaces the broken `streamEvents(v3)` loop. We track which agents we've already announced (to emit `agent:started` once per agent), stream tokens attributed per agent, accumulate the supervisor's text for `message:complete`, and emit `agent:finished` for every announced agent at the end.

- [ ] **Step 1: Rebuild the agent with sub-agents (constructor)**

In `packages/sidecar/src/session/session.ts`, import the new modules and pass subagents:

```ts
import { SUBAGENTS, SUPERVISOR_PROMPT, agentIdForRole } from './agents.js'   // adjust if names differ
import { attribute } from './attribution.js'
```

In the constructor, build with subagents (🔎 SPIKE Q3 field names):

```ts
this.agent = createDeepAgent({
  model: model ?? buildModel(config),
  systemPrompt: config.systemPrompt ?? SUPERVISOR_PROMPT,
  subagents: SUBAGENTS as unknown as Parameters<typeof createDeepAgent>[0]['subagents'],
})
```

- [ ] **Step 2: Replace the streaming body of `sendMessage`**

Keep the `NO_API_KEY` guard (Phase 1) at the top. Replace the `try { const run = await this.agent.streamEvents(...) ... }` block through `message:complete` with:

```ts
this.messages.push(new HumanMessage(content))
this.abortController = new AbortController()

const started = new Set<string>()   // agentIds we've emitted agent:started for
let supervisorText = ''

const ensureStarted = (agentId: string, role: AgentRole) => {
  if (started.has(agentId)) return
  started.add(agentId)
  _send({ type: 'agent:started', sessionId: this.id, agentId, role })
}

try {
  // 🔎 SPIKE Q1: confirmed streaming call.
  const stream = this.agent.streamEvents(
    { messages: this.messages },
    { version: 'v2', signal: this.abortController.signal },
  )

  for await (const ev of stream) {
    const a = attribute(ev as unknown as import('./attribution.js').StreamEv)
    if (!a) continue
    ensureStarted(a.agentId, a.role)
    _send({ type: 'token:stream', sessionId: this.id, agentId: a.agentId, delta: a.delta })
    if (a.role === 'supervisor') supervisorText += a.delta
  }

  // Close out every agent we announced.
  for (const agentId of started) {
    _send({ type: 'agent:finished', sessionId: this.id, agentId })
  }
} catch (err) {
  const isAbort = err instanceof Error && err.name === 'AbortError'
  // Still close out announced agents so the UI doesn't hang on "running".
  for (const agentId of started) {
    _send({ type: 'agent:finished', sessionId: this.id, agentId })
  }
  _send({
    type: 'error',
    sessionId: this.id,
    code: isAbort ? 'CANCELLED' : 'AGENT_ERROR',
    message: isAbort ? 'User cancelled the request' : err instanceof Error ? err.message : String(err),
  })
  return
}

this.messages.push(new AIMessage(supervisorText))
_send({
  type: 'message:complete',
  sessionId: this.id,
  message: {
    id: `asst-supervisor-${Date.now()}`,
    role: 'assistant',
    content: supervisorText,
    agentId: agentIdForRole('supervisor'),
    timestamp: Date.now(),
  },
})
```

Remove the now-unused `AGENT_ID` / `AGENT_ROLE` constants and the old `aiText`/`run.messages` code.

- [ ] **Step 3: Type-check**

Run: `yarn workspace @hip/sidecar type-check`
Expected: PASS. (The `as unknown as ...` casts are deliberate seams for the deepagents subagents type and the event type; tighten them once the spike confirms exact types.)

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/session/session.ts
git commit -m "feat(sidecar): emit per-agent events from supervisor + sub-agents"
```

---

## Task 5: Multi-agent integration test (real DeepSeek, skipIf)

**Files:**
- Create: `packages/sidecar/src/session/multiagent.integration.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
// packages/sidecar/src/session/multiagent.integration.test.ts
import { describe, it, expect } from 'vitest'
import { Session } from './session.js'

const hasKey = !!process.env.DEEPSEEK_API_KEY

describe.skipIf(!hasKey)('Session multi-agent (real DeepSeek)', () => {
  it('emits events for more than one agent role', async () => {
    const session = new Session('mt-1', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] })
    const events: { type: string; role?: string; agentId?: string }[] = []
    await session.sendMessage(
      'Plan, implement, and review a function that reverses a string in TypeScript.',
      (m) => events.push(m as { type: string; role?: string }),
    )

    const startedRoles = new Set(events.filter((e) => e.type === 'agent:started').map((e) => e.role))
    expect(startedRoles.size).toBeGreaterThan(1)              // supervisor + at least one sub-agent
    expect(events.some((e) => e.type === 'token:stream')).toBe(true)
    // every started agent must also finish
    const startedIds = events.filter((e) => e.type === 'agent:started').map((e) => e.agentId)
    const finishedIds = new Set(events.filter((e) => e.type === 'agent:finished').map((e) => e.agentId))
    for (const id of startedIds) expect(finishedIds.has(id)).toBe(true)
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  }, 60_000)
})
```

- [ ] **Step 2: Run with the real key**

Run: `DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY yarn vitest run packages/sidecar/src/session/multiagent.integration.test.ts`
Expected: PASS. If only the supervisor role appears, the supervisor isn't delegating — strengthen `SUPERVISOR_PROMPT` (Task 2) to explicitly require using the planner and coder, and/or re-check the spike's attribution field. Iterate here with the real API.

- [ ] **Step 3: Confirm it is skipped without a key**

Run: `env -u DEEPSEEK_API_KEY yarn vitest run packages/sidecar/src/session/multiagent.integration.test.ts`
Expected: the suite is SKIPPED (0 failures).

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/session/multiagent.integration.test.ts
git commit -m "test(sidecar): real-LLM multi-agent integration test (skipIf no key)"
```

---

## Task 6: Cancellation correctness with multiple running agents

**Files:**
- Modify: `packages/sidecar/src/session/session.ts` (verify only; the Task 4 catch block already closes out agents)

- [ ] **Step 1: Add a cancel integration test**

Append to `packages/sidecar/src/session/multiagent.integration.test.ts`:

```ts
describe.skipIf(!hasKey)('Session multi-agent cancel', () => {
  it('closes out running agents and emits an error on cancel', async () => {
    const session = new Session('mt-cancel', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] })
    const events: { type: string; agentId?: string; code?: string }[] = []
    const p = session.sendMessage('Write a very long, detailed multi-step plan and implementation.', (m) => events.push(m as { type: string }))
    const t = setInterval(() => {
      if (events.some((e) => e.type === 'token:stream')) { session.cancel(); clearInterval(t) }
    }, 50)
    await p
    clearInterval(t)

    expect(events.some((e) => e.type === 'error' && e.code === 'CANCELLED')).toBe(true)
    const started = events.filter((e) => e.type === 'agent:started').map((e) => e.agentId)
    const finished = new Set(events.filter((e) => e.type === 'agent:finished').map((e) => e.agentId))
    for (const id of started) expect(finished.has(id)).toBe(true)   // no agent left "running"
  }, 60_000)
})
```

- [ ] **Step 2: Run it**

Run: `DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY yarn vitest run packages/sidecar/src/session/multiagent.integration.test.ts`
Expected: PASS. If a started agent has no finish on cancel, fix the catch block in `session.ts` (Task 4 Step 2) to iterate `started` — it already does; this test guards against regressions.

- [ ] **Step 3: Commit**

```bash
git add packages/sidecar/src/session/multiagent.integration.test.ts
git commit -m "test(sidecar): cancel closes out all running agents"
```

---

## Task 7: End-to-end GUI verification (Agent Dashboard)

**Files:** none (verification only)

- [ ] **Step 1: Run the full app with a configured key**

Ensure a DeepSeek key is set (Phase 1 Settings UI or env), then `yarn tauri dev`.

- [ ] **Step 2: Trigger multi-agent work and watch the dashboard**

Send: "Plan, code, and review a function that debounces calls in TypeScript." Open the right panel → Agents tab.
Expected: a Supervisor card plus ≥1 sub-agent card (Planner/Coder/Reviewer) appear; sub-agent cards stream tokens and transition running → done; the chat shows the Supervisor's synthesized reply.

- [ ] **Step 3: Final phase gate**

Run: `yarn workspace @hip/sidecar type-check && yarn vitest run packages/sidecar/src/session/attribution.test.ts packages/sidecar/src/session/session-unit.test.ts`
Expected: PASS (unit tests green without a key; integration tests covered in Tasks 5-6 with a key).

---

## Self-Review (completed during authoring)

- **Spec coverage (§W1):** spike → Task 1; sub-agents → Task 2; attribution → Task 3; per-agent event emission + streaming rewrite → Task 4; supervisor→chat / sub-agents→dashboard handled by the existing `applyServerMessage` (token:stream with `role==='supervisor'` feeds chat); real-LLM coverage → Tasks 5-6; UI proof → Task 7. ✅
- **Type consistency:** `roleForName`/`agentIdForRole`/`SUBAGENTS`/`SUPERVISOR_PROMPT` (agents.ts) ↔ `attribute`/`StreamEv` (attribution.ts) ↔ session.ts imports all match. Sub-agent `name` values (`planner`/`coder`/`reviewer`) match `NAME_TO_ROLE`. ✅
- **Spike-contingent points flagged:** every `🔎 SPIKE` marks an exact field/shape to confirm in Task 1; the pure helper + tests stay valid regardless of where the field comes from. ✅
- **Cancel safety:** both the success and catch paths in Task 4 close out every announced agent, asserted by Task 6. ✅
- **Out of scope (per spec):** real sub-agent tools (file/exec) — sub-agents are reasoning-only here. ✅
