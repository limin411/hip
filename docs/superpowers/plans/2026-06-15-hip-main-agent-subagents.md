# hip Main Agent + Configured Agents as Sub-Agents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hip (the built-in LangGraph supervisor) the only top-level agent; configured external agents (智能体管理) become sub-agents hip dispatches to autonomously via a `dispatch_agent` tool, rendered nested with live streaming + HITL. The composer locks to hip and its agent picker becomes a per-chat model picker.

**Architecture:** A new `AgentInvoker` seam (shaped like the orchestrator's `AgentRunner`) wraps `createAgentProvider().runTurn()`. A `dispatch_agent` LangChain tool is added to hip's toolset, built from the enabled `AgentConfig`s; its callback runs the chosen provider through the invoker with a nested emit sink (`role:'subagent'`, `parentAgentId:'supervisor'`) and real HITL hooks routed through the session's existing `pendingPermissions` interrupt channel (tagged with an `agentFrame`). The composer's `AgentPicker` is replaced by a `ModelPicker` writing `draft.modelKey`, which `configFromDraft` folds into `SessionConfig.{llmProvider, model, baseURL}`; `buildModel` honors that per-session model. The transcript groups sub-agent runs under the dispatch tool-call into a collapsible `SubAgentCard`.

**Tech Stack:** TypeScript, Node sidecar (LangGraph / `@langchain/core`, zod), React + Zustand frontend, Tauri IPC, Vitest, `@hip/protocol` shared types.

---

## Spec

Design doc: [`docs/superpowers/specs/2026-06-15-hip-main-agent-subagents-design.md`](../specs/2026-06-15-hip-main-agent-subagents-design.md).

## Conventions

- **Run a single test file (paid-free):** `npx vitest run <relative/path/to/file.test.ts>`. Do NOT use a bare `vitest run src` substring — it can match `packages/sidecar/src` and fire paid real-LLM suites. Always pass an explicit file path. New tests in this plan use fakes only.
- **Type-check:** `yarn tsc --noEmit` (or the repo's `yarn type-check` if present).
- **Commit** after each task's tests are green. Commit messages end with the Co-Authored-By trailer used in this repo.
- All new sidecar tests use `FakeAgentProvider` / `FakeListChatModel` / `FakeTransport` patterns (no network). All UI store tests use `setState` merge-mode (never `replace`) and `vi.mock('@tauri-apps/api/core')`.

## File Structure

**Protocol (`packages/protocol/src/index.ts`)**
- `AgentRole` — add `'subagent'`.
- `AgentConfig` — add `description?: string`.
- `permission:request` ServerMessage — add `agentFrame?: { agentId: string; parentAgentId: string; name: string }`.

**Sidecar (`packages/sidecar/src`)**
- `session/agents/invoker.ts` — **NEW.** `AgentInvoker` interface + `createAgentInvoker(cwd, deps?)`. Wraps `createAgentProvider().runTurn()`, tees token deltas into an accumulator, returns final text. AgentRunner-shaped for a future orchestrator adapter.
- `session/tools.ts` — `buildTools` gains an optional `dispatch` arg that adds the `dispatch_agent` tool.
- `session/session.ts` — build the `dispatch_agent` callback (mirrors `spawnSubagent`), nested emit + sub-agent HITL hooks; `buildModel` honors per-session model; retire the `agentId` external-session entry for new turns is left intact for old sessions but no longer produced by the composer.
- `config/providers.ts` — unchanged (fallback only).

**Frontend (`src`)**
- `store/draftStore.ts` — `Draft.modelKey?` + `setModelKey`.
- `domain/sessionService.ts` — `configFromDraft` maps `modelKey` → `{llmProvider, model, baseURL}`; drop the dead `agentId` branch.
- `lib/modelKey.ts` — **NEW.** Pure helpers: `parseModelKey`, `resolveModelConfig(catalog, config, modelKey)`, `activeModelKey(config)`.
- `components/chat/ModelPicker.tsx` — **NEW.** Replaces `AgentPicker` (draft dropdown via `groupModelOptions` + committed read-only badge).
- `components/chat/InputBar.tsx` — swap `<AgentPicker/>` → `<ModelPicker/>`, drop `<ComposerConfigSelectors/>`.
- `components/chat/AgentPicker.tsx` / `ComposerConfigSelectors.tsx` — deleted after the swap.
- `lib/agentDraft.ts` + `components/account/AgentEditor.tsx` + `components/account/AgentCard.tsx` — `description` field + relabel "enabled" → "available as sub-agent".
- `components/artifact/SubAgentCard.tsx` — **NEW.** Collapsible nested sub-agent transcript.
- `lib/roleColor.ts` — add `'subagent'` to `ROLE_COLOR` + `ROLE_NAME_KEY` (exhaustive `Record<AgentRole>`; done in Task 1 so `tsc` stays green).
- `components/chat/MessageBubble.tsx` / `lib/turnAgents.ts` — group sub-agent runs into `SubAgentCard` (no role-map edits; badges read `roleColor.ts`).
- `domain/sessionStore.ts` (`PendingPermission` + `permission:request` reducer) + `components/chat/PermissionModal.tsx` — thread `agentFrame` and label the HITL modal with the requesting sub-agent (Task 4b).
- i18n (`src/i18n/en.ts`, `zh-CN.ts`, `zh-TW.ts`) — new keys.

**Phase ordering & checkpoints.** Phase A (protocol) unblocks everything. Phases B→D (invoker → dispatch tool → nested HITL) are the sidecar core. Phases E→F (per-chat model → ModelPicker) are independent of B→D and can be done in parallel by a second worker. Phase G (description) is independent. Phase H (nested transcript) depends on Phase C. Phase I (retire direct sessions) depends on F. Natural review checkpoints after C, D, F, and H.

---

## Phase A — Protocol foundation

### Task 1: Add `subagent` role, `AgentConfig.description`, and permission `agentFrame`

**Files:**
- Modify: `packages/protocol/src/index.ts:1` (`AgentRole`), `:43-56` (`AgentConfig`), `:307` (`permission:request`)
- Test: `packages/protocol/src/subagent-protocol.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/src/subagent-protocol.test.ts
import { describe, it, expect } from 'vitest'
import type { AgentRole, AgentConfig, ServerMessage } from './index.js'

describe('sub-agent protocol additions', () => {
  it('AgentRole includes subagent', () => {
    const role: AgentRole = 'subagent'
    expect(role).toBe('subagent')
  })

  it('AgentConfig carries an optional description', () => {
    const a: AgentConfig = {
      id: 'x', name: 'X', kind: 'custom', command: 'c', args: [],
      transport: 'thin', acceptsModelConfig: false, enabled: true,
      description: 'when to use X',
    }
    expect(a.description).toBe('when to use X')
  })

  it('permission:request can carry an agentFrame for nested HITL', () => {
    const msg: Extract<ServerMessage, { type: 'permission:request' }> = {
      type: 'permission:request', sessionId: 's', turnId: 't', requestId: 'r',
      tool: { title: 'edit', kind: 'edit' },                               // real PermissionRequestPayload {title, kind, diff?, content?}
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }], // real PermissionOption {optionId, name, kind}
      agentFrame: { agentId: 'subagent-1', parentAgentId: 'supervisor', name: 'OpenCode' },
    }
    expect(msg.agentFrame?.name).toBe('OpenCode')
  })

})
```

> Why this task also touches `src/lib/roleColor.ts` (Step 3b below): `ROLE_COLOR` / `ROLE_NAME_KEY` there are the repo's only exhaustive `Record<AgentRole, …>` maps, so adding `'subagent'` to `AgentRole` breaks `tsc` until they gain a `subagent` entry — it must land in the **same** change. That coverage is asserted by the existing `src/lib/roleColor.test.ts` (extended in Step 3b), not in this protocol-package test, to avoid a cross-package import from `packages/protocol` into `src/`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/protocol/src/subagent-protocol.test.ts`
Expected: FAIL — `Type '"subagent"' is not assignable to type 'AgentRole'`, and `agentFrame`/`description` do not exist.

- [ ] **Step 3: Make the protocol changes**

In `packages/protocol/src/index.ts`:

```ts
// line 1 — add 'subagent'
export type AgentRole = 'supervisor' | 'planner' | 'coder' | 'reviewer' | 'worker' | 'subagent'
```

```ts
// AgentConfig (lines 43-56) — add description after name
export interface AgentConfig {
  id: string
  name: string
  description?: string                 // when-to-use text shown to hip's dispatch tool + the agent card
  kind: 'custom' | 'opencode' | 'acp'
  command: string
  args: string[]
  transport: AgentTransport
  acceptsModelConfig: boolean
  boundModel?: BoundModel
  authMode?: AgentAuthMode
  quirks?: string
  env?: Record<string, string>
  enabled: boolean
}
```

```ts
// permission:request ServerMessage member (~line 307) — add optional agentFrame
  | {
      type: 'permission:request'
      sessionId: string
      turnId: string
      requestId: string
      tool: PermissionRequestPayload
      options: PermissionOption[]
      agentFrame?: { agentId: string; parentAgentId: string; name: string }
    }
```

> Note: streaming events (`token:stream`, `reasoning:delta`, `tool:started`, `tool:finished`) deliberately do **not** gain `parentAgentId`. Sub-agent identity rides on `role: 'subagent'` plus the existing `agent:started.parentAgentId`, which the store reducer already threads onto each `AgentRun`. Real shapes confirmed: `PermissionRequestPayload = { title: string; kind: string; diff?; content? }` (index.ts:96), `PermissionOption = { optionId: string; name: string; kind: string }` (index.ts:104).

- [ ] **Step 3b: Update the exhaustive role maps + role i18n (same change set)**

In `src/lib/roleColor.ts` add a `subagent` entry to **both** maps (reuse the worker color var — no new CSS needed):

```ts
export const ROLE_COLOR: Record<AgentRole, string> = {
  supervisor: 'var(--role-supervisor)',
  planner: 'var(--role-planner)',
  coder: 'var(--role-coder)',
  reviewer: 'var(--role-reviewer)',
  worker: 'var(--role-worker)',
  subagent: 'var(--role-worker)',          // reuse worker's color; a dedicated --role-subagent is a nice-to-have follow-up
}

export const ROLE_NAME_KEY = {
  supervisor: 'artifact.roles.supervisor',
  planner: 'artifact.roles.planner',
  coder: 'artifact.roles.coder',
  reviewer: 'artifact.roles.reviewer',
  worker: 'artifact.roles.worker',
  subagent: 'artifact.roles.subagent',
} as const satisfies Record<AgentRole, string>
```

Add the i18n role name to `src/i18n/en.ts` (the `artifact.roles` object at ~line 164) and `zh-CN.ts` / `zh-TW.ts`:

```ts
roles: { supervisor: 'Supervisor', planner: 'Planner', coder: 'Coder', reviewer: 'Reviewer', worker: 'Worker', subagent: 'Sub-agent' },
```

(zh-CN: `子智能体`, zh-TW: `子智能體`.) `AgentBadge`/`TurnTimeline`/`artifact/AgentCard` all read these maps by index, so no further component edits are needed. If `src/lib/roleColor.test.ts` enumerates a fixed role list, add `'subagent'` to it.

- [ ] **Step 4: Run the tests + type-check to verify they pass**

Run: `npx vitest run packages/protocol/src/subagent-protocol.test.ts src/lib/roleColor.test.ts && yarn tsc --noEmit`
Expected: PASS, and `tsc` clean (the `Record<AgentRole>` maps now cover `subagent`).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/index.ts packages/protocol/src/subagent-protocol.test.ts src/lib/roleColor.ts src/lib/roleColor.test.ts src/i18n/*.ts
git commit -m "feat(protocol): subagent role + AgentConfig.description + permission agentFrame; role maps"
```

---

## Phase B — AgentInvoker seam

### Task 2: `createAgentInvoker` — wrap one external-agent turn, return final text

**Files:**
- Create: `packages/sidecar/src/session/agents/invoker.ts`
- Test: `packages/sidecar/src/session/agents/invoker.test.ts`

The invoker is the shared seam: signature is AgentRunner-shaped (`agentId` + input → text) but also takes a live `emit` sink. It lives in `session/agents/` (not `orchestrator/`) because it directly wraps `createAgentProvider`, `GraphEmit`, and `ExternalAgentHooks`; a later thin adapter in `orchestrator/` can expose it as an `AgentRunner` (out of scope here).

- [ ] **Step 1: Write the failing test**

```ts
// packages/sidecar/src/session/agents/invoker.test.ts
import { describe, it, expect } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import type { GraphEmit } from '../graph.js'
import type { AgentProvider, ExternalAgentHooks } from './types.js'
import { createAgentInvoker } from './invoker.js'

function collectingEmit() {
  const tokens: string[] = []
  const emit: GraphEmit = {
    token: (d) => tokens.push(d),
    reasoning: () => {},
    toolStarted: () => {},
    toolFinished: () => {},
    usage: () => {},
  }
  return { emit, tokens }
}

class FakeProvider implements AgentProvider {
  disposed = false
  constructor(private readonly script: (emit: GraphEmit) => Promise<void>) {}
  async runTurn(_t: string, emit: GraphEmit, _s: AbortSignal, _h?: ExternalAgentHooks) {
    await this.script(emit)
  }
  dispose() { this.disposed = true }
}

const baseAgent: AgentConfig = {
  id: 'echo', name: 'Echo', kind: 'custom', command: 'x', args: [],
  transport: 'thin', acceptsModelConfig: false, enabled: true,
}

describe('createAgentInvoker', () => {
  it('streams tokens through emit and returns the accumulated text', async () => {
    const provider = new FakeProvider(async (emit) => { emit.token('he'); emit.token('llo') })
    const invoker = createAgentInvoker('/tmp', {
      readAgents: () => [baseAgent],
      createProvider: () => provider,
      resolveModel: () => null,
    })
    const { emit, tokens } = collectingEmit()
    const text = await invoker.invoke('echo', 'hi', emit, new AbortController().signal)
    expect(tokens.join('')).toBe('hello')
    expect(text).toBe('hello')
    expect(provider.disposed).toBe(true)
  })

  it('errors for an unknown or disabled agent', async () => {
    const invoker = createAgentInvoker('/tmp', { readAgents: () => [], createProvider: () => { throw new Error('nope') }, resolveModel: () => null })
    await expect(invoker.invoke('missing', 'hi', collectingEmit().emit, new AbortController().signal))
      .rejects.toThrow(/unknown or disabled agent: missing/)
  })

  it('disposes the provider even when runTurn throws', async () => {
    const provider = new FakeProvider(async () => { throw new Error('boom') })
    const invoker = createAgentInvoker('/tmp', { readAgents: () => [baseAgent], createProvider: () => provider, resolveModel: () => null })
    await expect(invoker.invoke('echo', 'hi', collectingEmit().emit, new AbortController().signal)).rejects.toThrow('boom')
    expect(provider.disposed).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/sidecar/src/session/agents/invoker.test.ts`
Expected: FAIL — `Cannot find module './invoker.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/sidecar/src/session/agents/invoker.ts
import type { AgentConfig } from '@hip/protocol'
import type { GraphEmit } from '../graph.js'
import { createAgentProvider } from './index.js'
import { readAgentsConfig, resolveAgentModel, type ResolvedModel } from './registry.js'
import type { AgentProvider, ExternalAgentHooks } from './types.js'

/** Run one configured external agent's turn and return its final text.
 *  Shaped like the orchestrator's AgentRunner (agentId + task → text) but also
 *  streams live events through `emit`. A later orchestrator adapter can wrap this. */
export interface AgentInvoker {
  invoke(agentId: string, task: string, emit: GraphEmit, signal: AbortSignal, hooks?: ExternalAgentHooks): Promise<string>
}

interface InvokerDeps {
  readAgents?: () => AgentConfig[]
  createProvider?: (agent: AgentConfig, cwd: string, model: ResolvedModel | null) => AgentProvider
  resolveModel?: (agent: AgentConfig) => ResolvedModel | null
}

export function createAgentInvoker(cwd: string, deps: InvokerDeps = {}): AgentInvoker {
  const readAgents = deps.readAgents ?? readAgentsConfig
  const createProvider = deps.createProvider ?? createAgentProvider
  const resolveModel = deps.resolveModel ?? resolveAgentModel
  return {
    async invoke(agentId, task, emit, signal, hooks) {
      const agent = readAgents().find((a) => a.id === agentId && a.enabled)
      if (!agent) throw new Error(`unknown or disabled agent: ${agentId}`)
      const model = agent.acceptsModelConfig ? resolveModel(agent) : null
      const provider = createProvider(agent, cwd, model)
      let text = ''
      // Tee token deltas so we can return the final text while still forwarding
      // every event to the caller's sink (the dispatch tool-card).
      const teed: GraphEmit = {
        token: (d) => { text += d; emit.token(d) },
        reasoning: emit.reasoning,
        toolStarted: emit.toolStarted,
        toolFinished: emit.toolFinished,
        usage: emit.usage,
      }
      try {
        await provider.runTurn(task, teed, signal, hooks)
        return text
      } finally {
        provider.dispose()
      }
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/sidecar/src/session/agents/invoker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/agents/invoker.ts packages/sidecar/src/session/agents/invoker.test.ts
git commit -m "feat(sidecar): AgentInvoker seam wrapping one external-agent turn"
```

---

## Phase C — `dispatch_agent` tool + nested streaming

### Task 3a: Add the `dispatch_agent` tool to `buildTools`

**Files:**
- Modify: `packages/sidecar/src/session/tools.ts:32` (`buildTools` signature + new tool)
- Test: `packages/sidecar/src/session/tools.dispatch.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

```ts
// packages/sidecar/src/session/tools.dispatch.test.ts
import { describe, it, expect } from 'vitest'
import { buildTools } from './tools.js'

describe('buildTools dispatch_agent', () => {
  it('omits dispatch_agent when no agents are available', () => {
    const tools = buildTools('/tmp', async () => '', '/tmp')
    expect(tools.find((t) => t.name === 'dispatch_agent')).toBeUndefined()
  })

  it('adds dispatch_agent listing the available agents and routes the call', async () => {
    const calls: Array<{ agent: string; task: string }> = []
    const tools = buildTools('/tmp', async () => '', '/tmp', {
      agents: [{ id: 'opencode', name: 'OpenCode', description: 'edits code' }],
      run: async (agent, task) => { calls.push({ agent, task }); return `done:${agent}` },
    })
    const dispatch = tools.find((t) => t.name === 'dispatch_agent')!
    expect(dispatch).toBeDefined()
    expect(dispatch.description).toContain('OpenCode')
    expect(dispatch.description).toContain('edits code')
    const out = await dispatch.invoke({ agent: 'opencode', task: 'fix bug' })
    expect(out).toBe('done:opencode')
    expect(calls).toEqual([{ agent: 'opencode', task: 'fix bug' }])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/sidecar/src/session/tools.dispatch.test.ts`
Expected: FAIL — `buildTools` takes 3 args; 4th arg / `dispatch_agent` not present.

- [ ] **Step 3: Implement the tool**

In `packages/sidecar/src/session/tools.ts`, extend the signature and append the tool (mirrors the existing `task` tool at line ~255):

```ts
export interface DispatchSpec {
  agents: Array<{ id: string; name: string; description?: string }>
  run: (agentId: string, task: string) => Promise<string>
}

export function buildTools(
  root: string,
  spawnSubagent?: (description: string) => Promise<string>,
  cwd?: string,
  dispatch?: DispatchSpec,
): StructuredToolInterface[] {
  // ... existing base tools (writeFile, readFile, …) unchanged ...
  // ... existing git tools + task tool unchanged ...

  const out = spawnSubagent ? [...base, task] : base
  if (!dispatch || dispatch.agents.length === 0) return out

  const roster = dispatch.agents
    .map((a) => `- ${a.id} (${a.name})${a.description ? `: ${a.description}` : ''}`)
    .join('\n')
  const ids = dispatch.agents.map((a) => a.id) as [string, ...string[]]
  const dispatchAgent = tool(
    async ({ agent, task: t }) => dispatch.run(agent, t),
    {
      name: 'dispatch_agent',
      description:
        'Delegate a focused, self-contained task to a specialized sub-agent and return its result. ' +
        'Pick the agent best matched to the task. Available agents:\n' +
        roster,
      schema: z.object({
        agent: z.enum(ids).describe('id of the sub-agent to delegate to'),
        task: z.string().describe('the complete, self-contained instruction for the sub-agent'),
      }),
    },
  )
  return [...out, dispatchAgent]
}
```

> The `task` tool (LangGraph self-clone worker) stays. `dispatch_agent` is only present at the top level (it requires the `dispatch` arg, which `runSubagent` never passes), preserving the depth-1 cap.
>
> Caller compatibility: the new `dispatch` param is the optional 4th arg, so the existing `subagent.ts` call `buildTools(root)` and any other 3-arg callers are unaffected. The only caller that passes it is `session.ts`'s `runTurn` (wired in Task 3b).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/sidecar/src/session/tools.dispatch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/tools.ts packages/sidecar/src/session/tools.dispatch.test.ts
git commit -m "feat(sidecar): dispatch_agent tool listing available sub-agents"
```

### Task 3b: Wire the dispatch callback into the session turn (nested streaming)

**Files:**
- Modify: `packages/sidecar/src/session/session.ts` (`runTurn` — near the `spawnSubagent` closure at ~711 and the `buildTools` call at ~728)
- Test: `packages/sidecar/src/session/dispatch.integration.test.ts` (Create)

- [ ] **Step 1: Write the failing test + the test harness**

Provide the full harness, then the test. The harness gives a fake tool-calling supervisor model and a `Session` whose `AgentInvoker` is stubbed (so no real sub-agent process runs). It uses the real turn entrypoint `Session.sendMessage(content, send, userMessageId?)` (session.ts:566) — there is no `handleSend`.

```ts
// packages/sidecar/src/session/__testutils__/dispatch-harness.ts
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { AIMessageChunk } from '@langchain/core/messages'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentConfig, ServerMessage } from '@hip/protocol'
import { Session } from '../session.js'
import type { AgentInvoker } from '../agents/invoker.js'

/** Supervisor model: 1st call emits a dispatch_agent tool call, 2nd call emits final text. */
class ToolThenTextModel extends FakeListChatModel {
  private call = 0
  constructor(private readonly args: { agent: string; task: string }, private readonly finalText: string) {
    super({ responses: ['unused'] })
  }
  bindTools(): this { return this }
  async *_streamResponseChunks(): AsyncGenerator<ChatGenerationChunk> {
    this.call += 1
    if (this.call === 1) {
      yield new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({
          content: '',
          tool_calls: [{ name: 'dispatch_agent', args: this.args, id: 'call-1', type: 'tool_call' }],
        }),
      })
    } else {
      yield new ChatGenerationChunk({ text: this.finalText, message: new AIMessageChunk({ content: this.finalText }) })
    }
  }
}
export function makeToolCallingModel(args: { agent: string; task: string }, finalText: string): ToolThenTextModel {
  return new ToolThenTextModel(args, finalText)
}

/** Write a one-agent hip-agents.json and point HIP_AGENTS_PATH at it (see registry.test.ts). */
export function registerAgent(agent: Partial<AgentConfig> = {}): string {
  const full: AgentConfig = {
    id: 'echo', name: 'Echo', kind: 'custom', command: 'x', args: [],
    transport: 'thin', acceptsModelConfig: false, enabled: true, ...agent,
  }
  const p = join(mkdtempSync(join(tmpdir(), 'hip-dispatch-')), 'hip-agents.json')
  writeFileSync(p, JSON.stringify({ agents: [full] }))
  process.env.HIP_AGENTS_PATH = p
  return full.id
}

export type StubInvoke = AgentInvoker['invoke']

/** Session whose AgentInvoker is stubbed (no real sub-agent process). */
export function makeSession(id: string, model: ToolThenTextModel, stub: StubInvoke): Session {
  const invokerFactory = (): AgentInvoker => ({ invoke: stub })
  // 3rd arg injects the supervisor model (as session-unit.test.ts does); 4th arg (added in Step 3)
  // injects the invoker factory. `as never` matches how existing tests pass fake models.
  return new Session(id, { llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() }, model as never, invokerFactory)
}

/** Drive one turn; resolve on message:complete|error. `onMessage` may respond mid-turn. */
export function collect(session: Session, text: string, onMessage?: (m: ServerMessage) => void): Promise<ServerMessage[]> {
  const out: ServerMessage[] = []
  return new Promise<ServerMessage[]>((resolve) => {
    void session.sendMessage(text, (m: ServerMessage) => {
      out.push(m)
      onMessage?.(m)
      if (m.type === 'message:complete' || m.type === 'error') resolve(out)
    })
  })
}
```

```ts
// packages/sidecar/src/session/dispatch.integration.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import type { ServerMessage } from '@hip/protocol'
import { makeToolCallingModel, registerAgent, makeSession, collect } from './__testutils__/dispatch-harness.js'

afterEach(() => { delete process.env.HIP_AGENTS_PATH })

describe('dispatch_agent end-to-end (nested sub-agent)', () => {
  it('runs the sub-agent as role=subagent under the supervisor and returns its text', async () => {
    registerAgent({ id: 'echo', name: 'Echo' })
    const model = makeToolCallingModel({ agent: 'echo', task: 'do it' }, 'all done')
    const session = makeSession('s-dispatch', model, async (_id, _task, emit) => { emit.token('patched'); return 'patched' })

    const events = await collect(session, 'please delegate')
    const sub = events.find((e): e is Extract<ServerMessage, { type: 'agent:started' }> => e.type === 'agent:started' && e.role === 'subagent')
    expect(sub?.parentAgentId).toBe('supervisor')
    expect(events.some((e) => e.type === 'token:stream' && e.agentId === sub?.agentId)).toBe(true)
    expect(events.some((e) => e.type === 'tool:finished')).toBe(true)
  })
})
```

> Feasibility note: `RealModelRunner.run` (model-runner.ts:49) `concat`s streamed chunks and reads `gathered.tool_calls`, so the chunk above surfaces a tool call there. If `tool_calls` don't materialize, confirm the chunk's `message` is an `AIMessageChunk` carrying `tool_calls` (not `tool_call_chunks`), mirroring `session-unit.test.ts`'s `HangingChatModel` override. Align the `model as never` cast with the real `Session` constructor's model-param type.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/sidecar/src/session/dispatch.integration.test.ts`
Expected: FAIL — no dispatch wiring; no `subagent` `agent:started` is emitted; the injection seam does not exist.

- [ ] **Step 3: Implement the dispatch callback + injection seam**

In `session.ts`, add a constructor-injectable invoker factory (default the real one) so tests can stub it:

```ts
// near the top, import
import { createAgentInvoker, type AgentInvoker } from './agents/invoker.js'
import { readAgentsConfig, resolveAgentModel } from './agents/registry.js'
import type { ExternalAgentHooks } from './agents/types.js'

// Session class field (alongside other ctor-injected deps):
private readonly invokerFactory: (cwd: string) => AgentInvoker
// Add invokerFactory as the LAST optional constructor parameter, AFTER the existing
// optional injected-model param (so existing callers `new Session(id, config)` and
// `new Session(id, config, model)` are unaffected):
//   constructor(id, config, model?, invokerFactory?: (cwd: string) => AgentInvoker)
//   this.invokerFactory = invokerFactory ?? ((cwd) => createAgentInvoker(cwd))
```

Inside `runTurn`, right after the existing `spawnSubagent` closure (~line 722) and before `const tools = buildTools(...)` (~728):

```ts
    const enabledAgents = readAgentsConfig().filter((a) => a.enabled && a.id !== 'builtin')
    const invoker = this.invokerFactory(cwd)
    const dispatchAgent = async (agentId: string, task: string): Promise<string> => {
      const cfg = enabledAgents.find((a) => a.id === agentId)
      if (!cfg) return `Error: unknown or disabled agent ${agentId}`
      const childId = `subagent-${++subagentSeq}`
      ensureStarted(childId, 'subagent', 'supervisor', task)
      const hooks: ExternalAgentHooks = {
        requestPermission: (req) =>
          new Promise((resolve) => {
            this.pendingPermissions.set(req.requestId, resolve)
            send({
              type: 'permission:request', sessionId: this.id, turnId,
              requestId: req.requestId, tool: req.tool, options: req.options,
              agentFrame: { agentId: childId, parentAgentId: 'supervisor', name: cfg.name },
            })
          }),
        configOptions: () => {},
      }
      try {
        const text = await invoker.invoke(agentId, task, makeEmit(childId, 'subagent'), this.abortController!.signal, hooks)
        ensureFinished(childId, text)
        return text || '(sub-agent produced no output)'
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        ensureFinished(childId, `Error: ${msg}`)
        return `Error: ${msg}`
      }
    }
    const tools = buildTools(
      cwd,
      spawnSubagent,
      this._config.cwd,
      enabledAgents.length
        ? {
            agents: enabledAgents.map((a) => ({ id: a.id, name: a.name, description: a.description })),
            run: dispatchAgent,
          }
        : undefined,
    )
```

Notes:
- `subagentSeq`, `ensureStarted`, `ensureFinished`, `makeEmit`, `send`, `turnId`, `pendingPermissions` all already exist in `runTurn`'s scope (lines 689–722, 214).
- `makeEmit(childId, 'subagent')` routes tokens to `trajectory[childId].output` and emits `token:stream`/`tool:*` tagged with `agentId=childId, role='subagent'`; `ensureStarted(childId, 'subagent', 'supervisor', task)` emits `agent:started` with `parentAgentId='supervisor'`. The store reducer (`agent:started` handler) already appends a nested `AgentRun`.
- The dispatch path runs inside the built-in graph path (`isExternalAgent()` is false for hip sessions), so `dispatch_agent` is reachable.
- No double-counting: this mirrors the existing `spawnSubagent` pattern exactly (`session.ts:711-722`) — `makeEmit(childId, …)` accumulates `trajectory[childId].output` from streamed token deltas during the turn (for the UI/persistence `AgentRun`), while the `invoker.invoke(...)` return value is used only as the **tool result** the supervisor sees and the argument to `ensureFinished(childId, text)`. The invoker tees tokens into its own local accumulator; it does not write to `trajectory`. Same two-sink shape the worker path already uses.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/sidecar/src/session/dispatch.integration.test.ts`
Expected: PASS. Also run the existing session suites to confirm no regression:
Run: `npx vitest run packages/sidecar/src/session/session-unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/dispatch.integration.test.ts packages/sidecar/src/session/__testutils__/dispatch-harness.ts
git commit -m "feat(sidecar): wire dispatch_agent — nested sub-agent turn via AgentInvoker"
```

---

## Phase D — Nested HITL

### Task 4: Sub-agent permission requests bubble to the modal (tagged), resume continues the dispatch

**Files:**
- Modify: (sidecar HITL is already wired in Task 3b via `agentFrame`; this task verifies + hardens it)
- Test: `packages/sidecar/src/session/dispatch-hitl.integration.test.ts` (Create)

The mechanism reuses the existing `pendingPermissions` map (`session.ts:214`) and `respondPermission` (`:275`) — already source-agnostic. Task 3b's hooks register the resolver and emit `permission:request` **with** `agentFrame`. This task locks the behavior with tests and confirms the abort/cleanup path.

- [ ] **Step 1: Write the failing test**

```ts
// packages/sidecar/src/session/dispatch-hitl.integration.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import type { ServerMessage } from '@hip/protocol'
import { makeToolCallingModel, registerAgent, makeSession, collect, type StubInvoke } from './__testutils__/dispatch-harness.js'

afterEach(() => { delete process.env.HIP_AGENTS_PATH })

describe('nested HITL through dispatch_agent', () => {
  it('emits permission:request with an agentFrame and resumes when approved', async () => {
    registerAgent({ id: 'echo', name: 'Echo' })
    const model = makeToolCallingModel({ agent: 'echo', task: 'edit' }, 'done')
    const stub: StubInvoke = async (_id, _task, emit, _signal, hooks) => {
      const choice = await hooks!.requestPermission({
        requestId: 'perm-1',
        tool: { title: 'edit', kind: 'edit' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      })
      if ('optionId' in choice) emit.token('approved')
      return 'optionId' in choice ? 'approved' : 'cancelled'
    }
    const session = makeSession('s-hitl', model, stub)
    const events = await collect(session, 'go', (m) => {
      if (m.type === 'permission:request') session.respondPermission(m.requestId, { optionId: 'allow' })
    })
    const perm = events.find((e): e is Extract<ServerMessage, { type: 'permission:request' }> => e.type === 'permission:request')
    expect(perm?.agentFrame).toEqual({ agentId: 'subagent-1', parentAgentId: 'supervisor', name: 'Echo' })
  })

  it('returns a failed delegation when the user rejects', async () => {
    registerAgent({ id: 'echo', name: 'Echo' })
    const model = makeToolCallingModel({ agent: 'echo', task: 'edit' }, 'done')
    const stub: StubInvoke = async (_id, _task, _emit, _signal, hooks) => {
      const choice = await hooks!.requestPermission({
        requestId: 'perm-2', tool: { title: 'edit', kind: 'edit' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      })
      if ('cancelled' in choice) throw new Error('permission denied')
      return 'ok'
    }
    const session = makeSession('s-reject', model, stub)
    const events = await collect(session, 'go', (m) => {
      if (m.type === 'permission:request') session.respondPermission(m.requestId, { cancelled: true })
    })
    // dispatch_agent's catch returns "Error: permission denied" as the tool result; the turn still completes.
    expect(events.some((e) => e.type === 'tool:finished')).toBe(true)
  })

  it('drains a blocked sub-agent permission on cancel() (no leak)', async () => {
    registerAgent({ id: 'echo', name: 'Echo' })
    const model = makeToolCallingModel({ agent: 'echo', task: 'edit' }, 'done')
    let choice: unknown
    const stub: StubInvoke = async (_id, _task, _emit, _signal, hooks) => {
      choice = await hooks!.requestPermission({
        requestId: 'perm-3', tool: { title: 'edit', kind: 'edit' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      })
      return 'done'
    }
    const session = makeSession('s-cancel', model, stub)
    await collect(session, 'go', (m) => { if (m.type === 'permission:request') session.cancel() })
    expect(choice).toEqual({ cancelled: true }) // finally-block (session.ts:787-792) settled the pending permission
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/sidecar/src/session/dispatch-hitl.integration.test.ts`
Expected: FAIL until Task 3b is implemented — `agentFrame` is absent and the dispatch wiring does not exist. (This task ships on Task 3b's code; sequence it immediately after 3b.)

- [ ] **Step 3: No new production code — confirm the cleanup contract**

These tests pass on Task 3b's wiring: `respondPermission` (session.ts:275) is source-agnostic, and the `finally` block (session.ts:787-792) settles outstanding `pendingPermissions` with `{ cancelled: true }` on abort. Verify the `dispatchAgent` `catch` returns the error string (failed delegation) rather than rethrowing, so the supervisor's turn completes cleanly. The `cancel()` method (session.ts:848) aborts the controller, triggering that cleanup.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/sidecar/src/session/dispatch-hitl.integration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/dispatch-hitl.integration.test.ts
git commit -m "test(sidecar): nested HITL via dispatch_agent — frame, resume, abort cleanup"
```

### Task 4b: Label the permission modal with the sub-agent (UI)

**Files:**
- Modify: `src/domain/sessionStore.ts:12-17` (`PendingPermission`) + `:235-239` (`permission:request` reducer)
- Modify: `src/components/chat/PermissionModal.tsx` (render the sub-agent label)
- Modify: `src/i18n/en.ts`, `zh-CN.ts`, `zh-TW.ts` (`chat.permission.fromSubagent`)
- Test: `src/domain/sessionStore.test.ts` (or the existing reducer test file — extend)

- [ ] **Step 1: Write the failing test**

```ts
// extend the sessionStore reducer test — permission:request carries agentFrame onto pendingPermission
import { applyServerMessage } from './sessionStore'  // match the real reducer export name

it('stores agentFrame on pendingPermission for a nested sub-agent request', () => {
  const base = { sessions: [{ id: 's1', config: { llmProvider: 'd', model: 'm', tools: [] }, title: '', preview: '', updatedAtMs: 0, loaded: true, messages: [], status: 'idle', error: null }] } as any
  const next = applyServerMessage(base, {
    type: 'permission:request', sessionId: 's1', turnId: 't', requestId: 'r',
    tool: { title: 'edit', kind: 'edit' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    agentFrame: { agentId: 'subagent-1', parentAgentId: 'supervisor', name: 'OpenCode' },
  } as any, 0)
  expect(next.sessions[0].pendingPermission?.agentFrame?.name).toBe('OpenCode')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/domain/sessionStore.test.ts`
Expected: FAIL — `agentFrame` is not threaded onto `pendingPermission`.

- [ ] **Step 3: Thread `agentFrame` through the type, reducer, and modal**

`src/domain/sessionStore.ts` — extend `PendingPermission` and the reducer:

```ts
export interface PendingPermission {
  turnId: string
  requestId: string
  tool: PermissionRequestPayload
  options: PermissionOption[]
  agentFrame?: { agentId: string; parentAgentId: string; name: string }
}

// reducer case (line 238) — pass agentFrame through
pendingPermission: { turnId: msg.turnId, requestId: msg.requestId, tool: msg.tool, options: msg.options, ...(msg.agentFrame ? { agentFrame: msg.agentFrame } : {}) },
```

`src/components/chat/PermissionModal.tsx` — after the intro `<p>`, show the sub-agent label when present:

```tsx
const { requestId, tool, options, agentFrame } = pending
// …inside the modal body, right after the intro paragraph:
{agentFrame && (
  <p className="text-meta text-ink-tertiary" data-testid="permission-subagent">
    {t('chat.permission.fromSubagent', { name: agentFrame.name })}
  </p>
)}
```

i18n (`chat.permission`): add `fromSubagent: 'Requested by sub-agent {{name}}'` (zh-CN `来自子智能体 {{name}} 的请求`, zh-TW `來自子智能體 {{name}} 的請求`).

- [ ] **Step 4: Run the test + type-check**

Run: `npx vitest run src/domain/sessionStore.test.ts && yarn tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionStore.ts src/components/chat/PermissionModal.tsx src/domain/sessionStore.test.ts src/i18n/*.ts
git commit -m "feat(ui): label the HITL modal with the requesting sub-agent"
```

---

## Phase E — Per-chat model (sidecar + draft)

### Task 5: `buildModel` honors a per-session model, falling back to the global active model

**Files:**
- Modify: `packages/sidecar/src/session/session.ts:163-171` (`buildModel`)
- Test: `packages/sidecar/src/session/build-model.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

```ts
// packages/sidecar/src/session/build-model.test.ts
import { describe, it, expect } from 'vitest'
import { resolveModelChoice } from './session.js' // pure helper extracted from buildModel

describe('resolveModelChoice', () => {
  const fallback = { providerID: 'deepseek', modelID: 'deepseek-reasoner', baseURL: 'https://api.deepseek.com/v1' }
  it('uses the session config model when present', () => {
    const c = resolveModelChoice({ llmProvider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', tools: [] }, fallback)
    expect(c).toEqual({ providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.openai.com/v1' })
  })
  it('falls back to the global active model when config.model is empty', () => {
    const c = resolveModelChoice({ llmProvider: 'deepseek', model: '', tools: [] }, fallback)
    expect(c).toEqual(fallback)
  })
  it('falls back to active baseURL when config.baseURL is missing', () => {
    const c = resolveModelChoice({ llmProvider: 'openai', model: 'gpt-4o', tools: [] }, fallback)
    expect(c).toEqual({ providerID: 'openai', modelID: 'gpt-4o', baseURL: 'https://api.deepseek.com/v1' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/sidecar/src/session/build-model.test.ts`
Expected: FAIL — `resolveModelChoice` is not exported.

- [ ] **Step 3: Extract the pure helper and use it in `buildModel`**

```ts
// session.ts — add an exported pure helper and call it from buildModel
export function resolveModelChoice(
  config: Pick<SessionConfig, 'llmProvider' | 'model' | 'baseURL'>,
  fallback: { providerID: string; modelID: string; baseURL: string },
): { providerID: string; modelID: string; baseURL: string } {
  if (config.model) {
    return {
      providerID: config.llmProvider || fallback.providerID,
      modelID: config.model,
      baseURL: config.baseURL || fallback.baseURL,
    }
  }
  return fallback
}

function buildModel(config: SessionConfig): ChatOpenAI {
  const { providerID, modelID, baseURL } = resolveModelChoice(config, getActiveModel())
  return new ReasoningChatOpenAI({
    model: modelID,
    apiKey: activeKey(providerID),
    configuration: { baseURL },
    streamUsage: true,
  })
}
```

> `getActiveModel()` is imported from `../config/providers.js` and returns `ActiveModel = { providerID: string; modelID: string; baseURL: string }` (protocol index.ts:16) — exactly the `fallback` shape `resolveModelChoice` expects. `activeKey`/`ReasoningChatOpenAI` are the existing imports in `session.ts`; keep them.

- [ ] **Step 4: Run tests to verify they pass (and no regression)**

Run: `npx vitest run packages/sidecar/src/session/build-model.test.ts packages/sidecar/src/session/session-unit.test.ts`
Expected: PASS (the `NO_API_KEY` guard still passes: `config.model='deepseek-chat'` resolves provider `deepseek`, key absent → `NO_API_KEY`).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/build-model.test.ts
git commit -m "feat(sidecar): per-session model in buildModel with global fallback"
```

### Task 6: `draft.modelKey` + `modelKey` helpers + `configFromDraft` mapping

**Files:**
- Modify: `src/store/draftStore.ts:5-11` (`Draft`), `:55-59` (setter)
- Create: `src/lib/modelKey.ts`
- Modify: `src/domain/sessionService.ts:349-354` (`configFromDraft`)
- Test: `src/lib/modelKey.test.ts`, `src/domain/sessionService.configFromDraft.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/modelKey.test.ts
import { describe, it, expect } from 'vitest'
import { parseModelKey, resolveModelConfig, activeModelKey } from './modelKey.js'

const catalog = { openai: { id: 'openai', name: 'OpenAI', env: [], api: 'https://api.openai.com/v1', models: { 'gpt-4o': {} } } } as any
const config = { providers: { openai: { enabled: true } }, activeModel: { providerID: 'openai', modelID: 'gpt-4o' } } as any

describe('modelKey helpers', () => {
  it('parses provider/model', () => {
    expect(parseModelKey('openai/gpt-4o')).toEqual({ providerID: 'openai', modelID: 'gpt-4o' })
  })
  it('parses model ids that contain slashes', () => {
    expect(parseModelKey('openrouter/anthropic/claude')).toEqual({ providerID: 'openrouter', modelID: 'anthropic/claude' })
  })
  it('resolves a model key to SessionConfig fields with baseURL', () => {
    expect(resolveModelConfig(catalog, config, 'openai/gpt-4o')).toEqual({ llmProvider: 'openai', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1' })
  })
  it('derives the active model key from config', () => {
    expect(activeModelKey(config)).toBe('openai/gpt-4o')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/modelKey.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helpers**

```ts
// src/lib/modelKey.ts
import type { Catalog } from '@/ipc/catalog'
import type { ProvidersConfig } from '@hip/protocol'

/** Split a 'providerID/modelID' key — modelID may itself contain '/'. */
export function parseModelKey(key: string): { providerID: string; modelID: string } {
  const slash = key.indexOf('/')
  return { providerID: key.slice(0, slash), modelID: key.slice(slash + 1) }
}

function resolveBaseURL(catalog: Catalog, config: ProvidersConfig, providerID: string): string {
  return config.providers[providerID]?.baseURL ?? catalog[providerID]?.api ?? ''
}

/** Resolve a model key to the SessionConfig LLM fields. */
export function resolveModelConfig(
  catalog: Catalog,
  config: ProvidersConfig,
  key: string,
): { llmProvider: string; model: string; baseURL: string } {
  const { providerID, modelID } = parseModelKey(key)
  return { llmProvider: providerID, model: modelID, baseURL: resolveBaseURL(catalog, config, providerID) }
}

/** The key for the global active model, or '' if none set. */
export function activeModelKey(config: ProvidersConfig): string {
  const a = config.activeModel
  return a ? `${a.providerID}/${a.modelID}` : ''
}
```

Add to `draftStore.ts`:

```ts
// Draft (lines 5-11) — add modelKey
export interface Draft {
  tempId: string
  mode: 'project' | 'chat'
  cwd?: string
  text: string
  modelKey?: string            // 'providerID/modelID' chosen for this chat (locked at first send)
  agentId?: string             // legacy; no longer set by the composer (kept for old drafts)
}

// new setter, alongside setAgentId (~line 55)
setModelKey: (modelKey: string) =>
  set((s) => {
    const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
    return { draft: { ...base, modelKey } }
  }),
```

Add `setModelKey: (modelKey: string) => void` to the `DraftStore` interface.

Update `configFromDraft` (`sessionService.ts:349-354`):

```ts
import { resolveModelConfig } from '@/lib/modelKey'
import { useProvidersStore } from '@/store/providersStore'

/** Build the committed SessionConfig from the current draft (project cwd + chosen model). */
export function configFromDraft(draft: Draft | null): SessionConfig {
  const base: SessionConfig =
    draft?.mode === 'project' && draft.cwd ? { ...DEFAULT_CONFIG, cwd: draft.cwd } : DEFAULT_CONFIG
  if (!draft?.modelKey) return base
  const { catalog, config } = useProvidersStore.getState()
  const { llmProvider, model, baseURL } = resolveModelConfig(catalog, config, draft.modelKey)
  return { ...base, llmProvider, model, ...(baseURL ? { baseURL } : {}) }
}
```

> The dead `draft.agentId` external-agent branch is removed (Phase I retires direct sessions). Old persisted drafts with `agentId` are simply ignored.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/modelKey.test.ts src/domain/sessionService.configFromDraft.test.ts`
Expected: PASS. Update the existing `configFromDraft` test to cover `modelKey` → config fields and to drop the agentId expectation.

- [ ] **Step 5: Commit**

```bash
git add src/lib/modelKey.ts src/lib/modelKey.test.ts src/store/draftStore.ts src/domain/sessionService.ts src/domain/sessionService.configFromDraft.test.ts
git commit -m "feat(ui): per-chat model — draft.modelKey + configFromDraft mapping"
```

---

## Phase F — Composer: ModelPicker replaces AgentPicker

### Task 7: `ModelPicker` component + InputBar swap + i18n

**Files:**
- Create: `src/components/chat/ModelPicker.tsx`
- Modify: `src/components/chat/InputBar.tsx:31`
- Delete: `src/components/chat/AgentPicker.tsx`, `src/components/chat/ComposerConfigSelectors.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`
- Test: `src/components/chat/ModelPicker.test.tsx` (or a domain test if the project avoids RTL — check for existing `.test.tsx`)

- [ ] **Step 1: Write the failing test**

Check whether the repo has React component tests (`*.test.tsx`). If yes, write an RTL test; if the repo only has store/domain tests, test the picker's pure selection logic by extracting it. Minimal store-level test:

```ts
// src/components/chat/ModelPicker.logic.test.ts
import { describe, it, expect } from 'vitest'
import { modelPickerItems, currentModelLabel } from './ModelPicker.js'

const catalog = { openai: { id: 'openai', name: 'OpenAI', env: [], api: 'x', models: { 'gpt-4o': {} } } } as any
const config = { providers: { openai: { enabled: true } }, activeModel: { providerID: 'openai', modelID: 'gpt-4o' } } as any

describe('ModelPicker logic', () => {
  it('lists enabled providers/models as groups', () => {
    expect(modelPickerItems(catalog, config)[0]).toMatchObject({ providerID: 'openai', models: [{ key: 'openai/gpt-4o', modelID: 'gpt-4o' }] })
  })
  it('labels the current draft model by its modelID', () => {
    expect(currentModelLabel('openai/gpt-4o')).toBe('gpt-4o')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/chat/ModelPicker.logic.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `ModelPicker`**

Mirror `AgentPicker.tsx`'s two branches (committed read-only badge + draft dropdown) but over models. Reuse `groupModelOptions` for the list and `parseModelKey` for the label.

```tsx
// src/components/chat/ModelPicker.tsx
import { useTranslation } from 'react-i18next'
import { Cpu, Lock, Check } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/DropdownMenu'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useProvidersStore } from '@/store/providersStore'
import { useActiveSession, useActiveSessionId } from '@/domain'
import { groupModelOptions } from '@/lib/agentModelOptions'   // existing helper — src/lib/agentModelOptions.ts:14
import { parseModelKey, activeModelKey } from '@/lib/modelKey'
import { cn } from '@/lib/utils'

/** Pure: groups for the dropdown. */
export const modelPickerItems = groupModelOptions
/** Pure: label for a model key. */
export function currentModelLabel(key: string): string {
  return key ? parseModelKey(key).modelID : ''
}

export function ModelPicker() {
  const { t } = useTranslation()
  const draft = useDraftStore((s) => s.draft)
  const setModelKey = useDraftStore((s) => s.setModelKey)
  const { catalog, config } = useProvidersStore((s) => ({ catalog: s.catalog, config: s.config }))
  const activeId = useActiveSessionId()   // domain hooks, matching AgentPicker
  const session = useActiveSession()

  // Committed session: locked read-only model badge.
  if (activeId && session) {
    const label = session.config.model || t('chat.noModelSelected')
    return (
      <ComposerChip disabled active title={t('chat.modelLocked')} data-testid="model-chip-locked">
        <Cpu size={13} className="shrink-0" aria-hidden />
        <span className="max-w-[140px] truncate">{label}</span>
        <Lock size={11} className="shrink-0 opacity-60" aria-hidden />
      </ComposerChip>
    )
  }

  // Draft: interactive model picker.
  const groups = groupModelOptions(catalog, config)
  const currentKey = draft?.modelKey ?? activeModelKey(config)
  const label = currentModelLabel(currentKey) || t('chat.noModelSelected')
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ComposerChip title={t('chat.modelHint')} data-testid="model-chip">
          <Cpu size={13} className="shrink-0" aria-hidden />
          <span className="max-w-[140px] truncate">{label}</span>
        </ComposerChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {groups.map((g) => (
          <div key={g.providerID}>
            <DropdownMenuLabel>{g.providerName}</DropdownMenuLabel>
            {g.models.map((m) => (
              <DropdownMenuItem key={m.key} onSelect={() => setModelKey(m.key)}>
                <Check size={14} className={cn('shrink-0', currentKey === m.key ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">{m.modelID}</span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

> Confirmed against `AgentPicker.tsx`: `DropdownMenuLabel` is exported by `@/components/ui/DropdownMenu` (line 55); `ComposerChip` is imported relatively as `'./ComposerChip'`; `cn` is from `@/lib/utils`; the active-session hooks `useActiveSession`/`useActiveSessionId` come from `@/domain`.

Swap in `InputBar.tsx:31`:

```tsx
// before: leftSlot={<><AgentPicker /><ComposerConfigSelectors /></>}
leftSlot={<ModelPicker />}
```

Remove the now-unused imports of `AgentPicker` and `ComposerConfigSelectors`, then delete those two files.

Add i18n keys (en.ts under `chat`, plus zh-CN.ts / zh-TW.ts):

```ts
modelHint: 'Choose the model (before the conversation starts)',
modelLocked: 'Model is locked for this conversation',
noModelSelected: 'Select a model',
```

(zh-CN: `选择模型（对话开始前）` / `本次对话的模型已锁定` / `选择模型`. zh-TW analogous.)

- [ ] **Step 4: Run the tests + type-check**

Run: `npx vitest run src/components/chat/ModelPicker.logic.test.ts && yarn tsc --noEmit`
Expected: PASS, no type errors (no dangling `AgentPicker`/`ComposerConfigSelectors` imports).

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ModelPicker.tsx src/components/chat/InputBar.tsx src/i18n/*.ts
git rm src/components/chat/AgentPicker.tsx src/components/chat/ComposerConfigSelectors.tsx
git commit -m "feat(ui): ModelPicker replaces AgentPicker; drop composer config selectors"
```

---

## Phase G — AgentConfig description in 智能体管理

### Task 8a: `description` field through AgentForm / buildAgentDraft / AgentEditor / AgentCard

**Files:**
- Modify: `src/lib/agentDraft.ts:3-14` (`AgentForm`), `:26-46` (`buildAgentDraft`)
- Modify: `src/components/account/AgentEditor.tsx:27-40` (form init) + a new textarea Field
- Modify: `src/components/account/AgentCard.tsx` (render description)
- Modify: `src/i18n/en.ts`, `zh-CN.ts`, `zh-TW.ts`
- Test: `src/lib/agentDraft.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agentDraft.test.ts (add cases)
import { buildAgentDraft } from './agentDraft.js'

it('carries a trimmed description, omitting it when blank', () => {
  const base = { name: 'A', kind: 'custom' as const, command: 'c', args: '', transport: 'thin' as const, acceptsModelConfig: false, boundModelKey: '', authMode: 'opencode-self' as const, enabled: true }
  expect(buildAgentDraft({ ...base, description: '  edits code  ' }).description).toBe('edits code')
  expect(buildAgentDraft({ ...base, description: '   ' }).description).toBeUndefined()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/agentDraft.test.ts`
Expected: FAIL — `description` is not a property of `AgentForm` / not in the build output.

- [ ] **Step 3: Implement**

`agentDraft.ts` — add to `AgentForm` and `buildAgentDraft`:

```ts
export interface AgentForm {
  name: string
  description: string            // when-to-use; surfaced to hip's dispatch tool
  kind: AgentConfig['kind']
  // …rest unchanged…
}

// in buildAgentDraft's returned object, after name:
description: form.description.trim() || undefined,
```

`AgentEditor.tsx` — form init (line 27-40) add `description: initial?.description ?? '',`. Add a textarea Field after the name Field (~line 72):

```tsx
<Field label={t('settings.agents.description')}>
  <textarea
    className={cn(inputCls, 'min-h-[64px] resize-y')}
    value={form.description}
    onChange={(e) => patch({ description: e.target.value })}
    placeholder={t('settings.agents.descriptionPlaceholder')}
    rows={3}
  />
</Field>
```

`AgentCard.tsx` — after the command-line row (~line 64-68), render the description when present:

```tsx
{agent.description && (
  <div className="mt-1 truncate text-caption text-ink-tertiary">{agent.description}</div>
)}
```

i18n (`settings.agents`):

```ts
description: 'When to use',
descriptionPlaceholder: 'Describe when hip should delegate to this agent…',
```

(zh-CN: `使用场景` / `描述 hip 何时应委派给该智能体…`. zh-TW analogous.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/agentDraft.test.ts && yarn tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentDraft.ts src/lib/agentDraft.test.ts src/components/account/AgentEditor.tsx src/components/account/AgentCard.tsx src/i18n/*.ts
git commit -m "feat(ui): agent description (when-to-use) field for dispatch"
```

### Task 8b: Relabel "enabled" → "available as sub-agent"

**Files:**
- Modify: `src/i18n/en.ts`, `zh-CN.ts`, `zh-TW.ts` (`settings.agents.enableThis`)
- (No component change — both `AgentEditor` footer and `AgentCard` Switch use this key.)

- [ ] **Step 1: Change the string** (no test; pure copy)

```ts
enableThis: 'Available as sub-agent',
```

(zh-CN: `作为子智能体启用`. zh-TW: `作為子智能體啟用`.)

- [ ] **Step 2: Type-check**

Run: `yarn tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/*.ts
git commit -m "feat(ui): relabel agent enable toggle to 'available as sub-agent'"
```

---

## Phase H — Nested transcript rendering

### Task 9a: Guard that a subagent run groups under its parent

> The role maps + i18n role name were already added in **Task 1 / Step 3b** (`src/lib/roleColor.ts`, `artifact.roles.subagent`), and `AgentBadge` / `TurnTimeline` / `artifact/AgentCard` consume those maps by index, so no badge-component edit is needed. This task only adds a data-shape guard for the grouping the nested card relies on.

**Files:**
- Test: `src/lib/turnAgents.test.ts` (extend)

- [ ] **Step 1: Extend the grouping test**

```ts
// add to src/lib/turnAgents.test.ts — a subagent run carries its parentAgentId through groupByAgent
import { groupByAgent } from './turnAgents'

it('groups a subagent run carrying parentAgentId', () => {
  const message = {
    timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'subagent-1', role: 'subagent', content: 'thinking' }],
    agentRuns: [{ agentId: 'subagent-1', role: 'subagent', parentAgentId: 'supervisor', output: 'done', startedAt: 0, finishedAt: 1, seq: 0, taskInput: 'do it' }],
    toolCalls: [],
  } as unknown as Parameters<typeof groupByAgent>[0]
  const sub = groupByAgent(message, false).find((a) => a.agentId === 'subagent-1')
  expect(sub?.parentAgentId).toBe('supervisor')
  expect(sub?.role).toBe('subagent')
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/turnAgents.test.ts`
Expected: PASS — `groupByAgent` is already role-agnostic (it threads `parentAgentId`/`role` straight through). This guards the contract the `SubAgentCard` grouping depends on.

- [ ] **Step 3: Commit**

```bash
git add src/lib/turnAgents.test.ts
git commit -m "test(ui): guard subagent run grouping carries parentAgentId"
```

### Task 9b: `SubAgentCard` + group sub-agent runs under the dispatch tool-call

**Files:**
- Create: `src/components/artifact/SubAgentCard.tsx`
- Modify: `src/components/chat/MessageBubble.tsx` (route nested agents into the card)
- Test: `src/components/artifact/SubAgentCard.logic.test.ts`

- [ ] **Step 1: Write the failing test**

Extract the grouping selection into a pure helper and test it:

```ts
// src/components/artifact/SubAgentCard.logic.test.ts
import { describe, it, expect } from 'vitest'
import { splitAgents } from './SubAgentCard.js'

it('separates supervisor (flat) from nested sub-agents', () => {
  const agents = [
    { agentId: 'supervisor', role: 'supervisor', parentAgentId: undefined },
    { agentId: 'subagent-1', role: 'subagent', parentAgentId: 'supervisor' },
  ] as any
  const { flat, nested } = splitAgents(agents)
  expect(flat.map((a: any) => a.agentId)).toEqual(['supervisor'])
  expect(nested.map((a: any) => a.agentId)).toEqual(['subagent-1'])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/artifact/SubAgentCard.logic.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `SubAgentCard`**

```tsx
// src/components/artifact/SubAgentCard.tsx
import { useState } from 'react'
import { ChevronRight, Loader2, Check } from 'lucide-react'
import type { TurnAgent } from '@/lib/turnAgents'
import { ToolCallRow } from '@/components/artifact/ToolCallRow'
import { cn } from '@/lib/utils'

/** Split grouped agents into flat (supervisor) vs nested (dispatched sub-agents). */
export function splitAgents(agents: TurnAgent[]): { flat: TurnAgent[]; nested: TurnAgent[] } {
  const flat: TurnAgent[] = []
  const nested: TurnAgent[] = []
  for (const a of agents) {
    if (a.role === 'subagent' && a.parentAgentId) nested.push(a)
    else flat.push(a)
  }
  return { flat, nested }
}

export function SubAgentCard({ agent }: { agent: TurnAgent }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-md border border-border bg-surface-muted/30">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-2 py-1.5 text-left" data-testid="subagent-card">
        <ChevronRight size={12} className={cn('shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')} />
        <span className="shrink-0 text-meta font-medium text-ink">{agent.agentId}</span>
        {agent.taskInput && <span className="truncate text-caption text-ink-tertiary">{agent.taskInput}</span>}
        <span className="ml-auto shrink-0">
          {agent.status === 'running' ? <Loader2 size={12} className="animate-spin text-accent-strong" /> : <Check size={12} className="text-success" />}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border px-2 py-1.5">
          {agent.reasoning && <pre className="whitespace-pre-wrap text-caption text-ink-secondary">{agent.reasoning}</pre>}
          {agent.tools.map((tc) => <ToolCallRow key={tc.callId} tool={tc} />)}
          {agent.output && <div className="text-prose text-ink">{agent.output}</div>}
        </div>
      )}
    </div>
  )
}
```

In `MessageBubble.tsx`, when rendering an assistant message, compute `groupByAgent(message, streaming)`, then `splitAgents(...)`; render the existing `TurnTimeline` for the flat (supervisor) steps as today, and render a `SubAgentCard` per nested agent (placed in stepSeq order relative to the dispatch tool call). Keep the change additive — when `nested` is empty, behavior is identical to today.

- [ ] **Step 4: Run the test + type-check + browser preview**

Run: `npx vitest run src/components/artifact/SubAgentCard.logic.test.ts && yarn tsc --noEmit`
Expected: PASS. Then verify in the browser preview that a dispatched turn renders a nested collapsible card (use the preview workflow; mock a turn or run a real delegation in `yarn tauri dev`).

- [ ] **Step 5: Commit**

```bash
git add src/components/artifact/SubAgentCard.tsx src/components/artifact/SubAgentCard.logic.test.ts src/components/chat/MessageBubble.tsx
git commit -m "feat(ui): nested SubAgentCard for dispatched sub-agent turns"
```

---

## Phase I — Retire direct external sessions

### Task 10: Stop producing external-agent sessions; keep old ones read-only

**Files:**
- Verify: `src/domain/sessionService.ts` `configFromDraft` no longer sets `agentId` (done in Task 6).
- Modify: `src/i18n/*.ts` — remove now-unused `chat.agentHint/agentBuiltin/agentLocked/agentNeedsModel/agentRestarted` keys only if nothing references them (grep first).
- Test: `src/domain/sessionService.configFromDraft.test.ts` (assert no `agentId` is ever emitted)

- [ ] **Step 1: Write the failing/affirming test**

```ts
// in sessionService.configFromDraft.test.ts
it('never sets agentId (direct external sessions retired)', () => {
  const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', modelKey: 'deepseek/deepseek-reasoner' })
  expect('agentId' in cfg).toBe(false)
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/domain/sessionService.configFromDraft.test.ts`
Expected: PASS (Task 6 already removed the branch). If it FAILS, remove any residual `agentId` assignment.

- [ ] **Step 3: Clean up dead i18n + confirm old sessions still load**

Grep for the old `chat.agent*` keys; remove the ones with zero references. Confirm an existing external-bound session (one with `config.agentId` set) still renders from history: it routes through the unchanged `isExternalAgent()` path on the sidecar, so viewing it works; no new composer affordance creates such sessions. Document in the commit that old external sessions are read-only history.

- [ ] **Step 4: Type-check + full suite (paid-free)**

Move `~/.hip/config/auth.json` aside, then:
Run: `yarn test`
Expected: green, no real-LLM calls. Restore `auth.json` after.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionService.configFromDraft.test.ts src/i18n/*.ts
git commit -m "feat(ui): retire direct external-agent sessions; old ones read-only"
```

---

## Final verification

- [ ] **Type-check whole repo:** `yarn tsc --noEmit` → clean.
- [ ] **Full test suite, paid-free:** move `~/.hip/config/auth.json` aside, `yarn test` → green; restore.
- [ ] **Manual GUI acceptance (`yarn tauri dev`):**
  1. Composer shows a **model picker** (not an agent picker); selecting a model and sending starts a hip session on that model; the committed badge is read-only and shows the model.
  2. Configure an enabled agent (e.g. OpenCode) with a "when to use" description; ask hip something that matches it; confirm hip calls `dispatch_agent`, the sub-agent renders as a **nested collapsible card** with live reasoning/tool cards, and its result flows back into hip's answer.
  3. Trigger a sub-agent permission request; confirm the HITL modal appears **labeled with the sub-agent**, approving continues the delegation, rejecting returns a failed-delegation result hip handles.
  4. Open an old external-bound session from history; confirm it still renders.
- [ ] **Update memory** ([`agent-orchestration-foundation-plan.md`](../../../memory/) family): record that hip-as-main-agent + sub-agent dispatch shipped on this branch, with the `AgentInvoker` seam as the orchestrator join point.

## Out of scope (YAGNI)

- No orchestrator DAG wiring or `AgentRunnerAdapter` (the seam is left compatible; the adapter is a later slice).
- No per-event `parentAgentId` on streaming messages (identity rides on `role:'subagent'` + `agent:started.parentAgentId`).
- No re-homing of ACP live model/mode selectors into the sub-agent card (deferred per the spec).
- No depth-2 delegation (sub-agents do not receive `dispatch_agent`).
- No mid-conversation model switching (model is locked at first send).
