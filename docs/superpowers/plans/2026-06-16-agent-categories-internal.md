# Three Agent Categories + Internal Managed Agents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third agent category — **internal managed agents**: prompt-only personas that run on hip's own ReAct loop with a per-agent tool allow-list and model, dispatched through the existing `dispatch_agent` + `AgentInvoker` seam — and explicitly group the 智能体管理 page into ACP / CLI / Internal, including generic ACP creation.

**Architecture:** The sidecar dispatch wiring in `session.ts` is untouched: it already collects every enabled agent into the `dispatch_agent` roster and routes delegation through `invoker.invoke(agentId, …)`. The only sidecar branch added is inside the invoker (`kind:'internal'` → a new `runManagedAgent`, a generalized `runSubagent` taking a custom system prompt + filtered tools + chosen model). Two small extractions (`model-factory.ts`, exporting `lastAiText`) keep imports acyclic. The frontend gains category grouping, a 3-item Add menu, and an internal-agent editor branch.

**Tech Stack:** TypeScript, Node sidecar, LangGraph (`@langchain/core`, `@langchain/openai`), zod tools, Vitest (node env), React + Zustand + react-i18next, Radix DropdownMenu.

---

## Critical constraints (read before any task)

- **NEVER run bare `yarn test` / `yarn vitest run` with no path, and never `vitest run src`** — both fire **paid** real-DeepSeek suites (`packages/sidecar/src/**/*.integration.test.ts` reseed the key from `~/.hip/config/auth.json`). Every run command in this plan targets an **exact file path** and every new test injects a **fake** model runner — so the new suites are paid-free. For a full-suite run, move `~/.hip/config/auth.json` aside first, then restore.
- **bash is 3.2**; brace `${var}` before CJK punctuation.
- **Subagents share the git checkout** — do NOT `git checkout`/switch branches. Stay on `feat/agent-categories-internal`.
- Vitest only includes `*.test.ts` (NOT `.test.tsx`) — component logic is covered via pure-helper tests + `tsc`; components themselves are verified with `tsc` and browser preview.
- Typecheck command used throughout: `npx tsc --noEmit` (the authoritative full check is `yarn build`, which runs `tsc && vite build`).

## File structure

**Sidecar / protocol:**
- `packages/protocol/src/index.ts` — *modify*: `AgentConfig.kind` += `'internal'`; add `prompt?`, `allowedTools?`.
- `packages/sidecar/src/session/model-factory.ts` — *create*: `ReasoningChatOpenAI`, `buildChatModel`, `activeKey`, `createSummarizer` (lifted from `session.ts`).
- `packages/sidecar/src/session/system-prompt.ts` — *modify*: add `buildManagedAgentPrompt`.
- `packages/sidecar/src/session/internal-runner.ts` — *create*: `filterTools`, `runManagedAgent`.
- `packages/sidecar/src/session/subagent.ts` — *modify*: `export` `lastAiText`.
- `packages/sidecar/src/session/agents/invoker.ts` — *modify*: branch on `kind:'internal'`; add `runInternal` dep.
- `packages/sidecar/src/session/session.ts` — *modify*: import from `model-factory`; drop the lifted code.
- `packages/sidecar/src/session/__testutils__/dispatch-harness.ts` — *modify*: add `makeTextModel` + `registerInternalAgent`.
- `packages/sidecar/src/session/dispatch-internal.integration.test.ts` — *create*.

**Frontend:**
- `src/lib/agentCategory.ts` (+ `.test.ts`) — *create*.
- `src/lib/agentTools.ts` (+ `.test.ts`) — *create*.
- `src/lib/agentDraft.ts` (+ existing `.test.ts`) — *modify*.
- `src/i18n/{en,zh-CN,zh-TW}.ts` — *modify*.
- `src/components/account/AgentEditor.tsx` — *modify*: internal branch + editable ACP command/args + quirks + `initialKind`.
- `src/components/account/AgentManagement.tsx` — *modify*: category sections + 3-item Add menu.
- `src/components/account/AgentCard.tsx` — *modify*: category badge + internal summary.

---

## Phase A — protocol + frontend pure helpers

### Task 1: Protocol fields for internal agents

**Files:**
- Modify: `packages/protocol/src/index.ts:43-57` (the `AgentConfig` interface)

- [ ] **Step 1: Add the fields**

In `AgentConfig`, change the `kind` union and add two optional fields:

```ts
export interface AgentConfig {
  id: string                          // nanoid
  name: string                        // display name
  description?: string                // when-to-use text shown to hip's dispatch tool + the agent card
  kind: 'custom' | 'opencode' | 'acp' | 'internal' // selects the provider/runtime
  command: string                     // executable (PATH name or absolute path); '' for internal
  args: string[]                      // static launch args; [] for internal
  transport: AgentTransport
  acceptsModelConfig: boolean
  boundModel?: BoundModel             // required iff acceptsModelConfig and the user picked a model; internal: the agent's model (unset ⇒ global active)
  authMode?: AgentAuthMode            // acp only: who supplies the model+key (default 'opencode-self')
  quirks?: string                     // acp only: per-agent quirk-profile key (e.g. 'opencode')
  env?: Record<string, string>        // advanced manual env overrides
  prompt?: string                     // internal only: the persona system prompt (required for kind 'internal')
  allowedTools?: string[]             // internal only: tool-name allow-list; undefined ⇒ full default set
  enabled: boolean
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no consumers break — the new fields are optional and the union only widens). If `src/lib/roleColor.ts` or any exhaustive `Record<AgentRole, …>` complains, that's unrelated to `kind`; do NOT touch role maps (this change is to `AgentConfig.kind`, not `AgentRole`).

- [ ] **Step 3: Commit**

```bash
cd /Users/lijiamin/data/my-github/hip
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): AgentConfig internal kind + prompt/allowedTools"
```

---

### Task 2: `agentCategory` helper

**Files:**
- Create: `src/lib/agentCategory.ts`
- Test: `src/lib/agentCategory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agentCategory.test.ts
import { describe, it, expect } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import { agentCategory } from './agentCategory'

function a(kind: AgentConfig['kind']): AgentConfig {
  return { id: 'x', name: 'X', kind, command: '', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true }
}

describe('agentCategory', () => {
  it('maps acp and the legacy opencode alias to acp', () => {
    expect(agentCategory(a('acp'))).toBe('acp')
    expect(agentCategory(a('opencode'))).toBe('acp')
  })
  it('maps custom to cli', () => {
    expect(agentCategory(a('custom'))).toBe('cli')
  })
  it('maps internal to internal', () => {
    expect(agentCategory(a('internal'))).toBe('internal')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agentCategory.test.ts`
Expected: FAIL — "Failed to resolve import './agentCategory'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/agentCategory.ts
import type { AgentConfig } from '@hip/protocol'

export type AgentCategory = 'acp' | 'cli' | 'internal'

/** The UI's single source of truth for an agent's category (for grouping + badges). */
export function agentCategory(agent: Pick<AgentConfig, 'kind'>): AgentCategory {
  switch (agent.kind) {
    case 'acp':
    case 'opencode':
      return 'acp'
    case 'internal':
      return 'internal'
    case 'custom':
    default:
      return 'cli'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agentCategory.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/lijiamin/data/my-github/hip
git add src/lib/agentCategory.ts src/lib/agentCategory.test.ts
git commit -m "feat(ui): agentCategory helper (acp/cli/internal)"
```

---

### Task 3: `agentTools` capability-group ⇆ tool-name mapping

**Files:**
- Create: `src/lib/agentTools.ts`
- Test: `src/lib/agentTools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/agentTools.test.ts
import { describe, it, expect } from 'vitest'
import { TOOL_GROUPS, groupsToToolNames, toolNamesToGroups, DEFAULT_TOOL_GROUPS } from './agentTools'

describe('agentTools', () => {
  it('expands group booleans to the flat tool-name list', () => {
    expect(groupsToToolNames({ read: true, edit: false, plan: true, git: false }))
      .toEqual([...TOOL_GROUPS.read, ...TOOL_GROUPS.plan])
  })
  it('round-trips: a name present in a group turns that group on', () => {
    const names = [...TOOL_GROUPS.read, 'write_file']
    expect(toolNamesToGroups(names)).toEqual({ read: true, edit: true, plan: false, git: false })
  })
  it('treats undefined allowedTools as every group on (legacy-safe)', () => {
    expect(toolNamesToGroups(undefined)).toEqual({ read: true, edit: true, plan: true, git: true })
  })
  it('default groups are read+edit+plan, git off', () => {
    expect(DEFAULT_TOOL_GROUPS).toEqual({ read: true, edit: true, plan: true, git: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agentTools.test.ts`
Expected: FAIL — cannot resolve `./agentTools`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/agentTools.ts
/** Built-in tools an internal agent may be granted, grouped into capability buckets. */
export const TOOL_GROUPS = {
  read: ['read_file', 'ls', 'glob', 'grep'],
  edit: ['write_file', 'edit_file'],
  plan: ['write_todos'],
  git: ['git_commit', 'git_create_branch', 'git_switch_branch'],
} as const

export type ToolGroup = keyof typeof TOOL_GROUPS
export interface ToolGroups { read: boolean; edit: boolean; plan: boolean; git: boolean }

/** A new internal agent: read + edit + plan, git off. */
export const DEFAULT_TOOL_GROUPS: ToolGroups = { read: true, edit: true, plan: true, git: false }

const ORDER: ToolGroup[] = ['read', 'edit', 'plan', 'git']

/** Flatten the enabled groups to the precise tool-name allow-list (stable order). */
export function groupsToToolNames(g: ToolGroups): string[] {
  return ORDER.filter((k) => g[k]).flatMap((k) => [...TOOL_GROUPS[k]])
}

/** Derive group toggles from a stored allow-list. undefined ⇒ all on (legacy-safe);
 *  otherwise a group is on iff ANY of its tool names is present. */
export function toolNamesToGroups(names: string[] | undefined): ToolGroups {
  if (!names) return { read: true, edit: true, plan: true, git: true }
  const has = (k: ToolGroup) => TOOL_GROUPS[k].some((n) => names.includes(n))
  return { read: has('read'), edit: has('edit'), plan: has('plan'), git: has('git') }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agentTools.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/lijiamin/data/my-github/hip
git add src/lib/agentTools.ts src/lib/agentTools.test.ts
git commit -m "feat(ui): capability-group <-> tool-name mapping for internal agents"
```

---

## Phase B — sidecar runtime

### Task 4: Extract `model-factory.ts` (no behavior change)

Lift `ReasoningChatOpenAI` + its helpers + a `buildChatModel` factory + `activeKey` + the real summarizer out of `session.ts` so the internal runner can build models without importing `session.ts` (which would cycle).

**Files:**
- Create: `packages/sidecar/src/session/model-factory.ts`
- Modify: `packages/sidecar/src/session/session.ts` (remove lifted code, import it)
- Export `lastAiText` from: `packages/sidecar/src/session/subagent.ts:20` (used in Task 6)

- [ ] **Step 1: Create `model-factory.ts`**

Move the code verbatim from `session.ts` (the `REASONING_BLOCK_INDEX` const, `stripReasoningBlocks`, `ReasoningChatOpenAI`, `activeKey`, `SUMMARY_SYSTEM_PROMPT`, `RealSummarizer`) into this new file and add `buildChatModel` + `createSummarizer`:

```ts
// packages/sidecar/src/session/model-factory.ts
import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { getActiveModel, cheapModelFor } from '../config/providers.js'
import { resolveApiKey } from '../config/auth-file.js'
import type { Summarizer } from './compaction.js'

const REASONING_BLOCK_INDEX = 7

/** (moved verbatim from session.ts) Strip re-projected reasoning/thinking blocks before the outbound body. */
function stripReasoningBlocks(messages: readonly { content: unknown }[]): void {
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue
    const kept = m.content.filter((b) => {
      const t = (b as { type?: unknown } | null)?.type
      return t !== 'reasoning' && t !== 'thinking'
    })
    if (kept.length === m.content.length) continue
    if (kept.length === 1 && (kept[0] as { type?: unknown }).type === 'text') {
      ;(m as { content: unknown }).content = (kept[0] as { text?: string }).text ?? ''
    } else {
      ;(m as { content: unknown }).content = kept.length === 0 ? '' : kept
    }
  }
}

/** (moved verbatim from session.ts) DeepSeek reasoning re-projection model. */
export class ReasoningChatOpenAI extends ChatOpenAI {
  async *_streamResponseChunks(
    messages: Parameters<ChatOpenAI['_streamResponseChunks']>[0],
    options: Parameters<ChatOpenAI['_streamResponseChunks']>[1],
    runManager?: Parameters<ChatOpenAI['_streamResponseChunks']>[2],
  ): ReturnType<ChatOpenAI['_streamResponseChunks']> {
    stripReasoningBlocks(messages)
    for await (const chunk of super._streamResponseChunks(messages, options, runManager)) {
      const msg = chunk.message as unknown as { content: unknown; additional_kwargs?: { reasoning_content?: unknown } }
      const rc = msg.additional_kwargs?.reasoning_content
      if (typeof rc === 'string' && rc.length > 0 && typeof msg.content === 'string') {
        const blocks: Array<Record<string, unknown>> = [{ type: 'reasoning', reasoning: rc, index: REASONING_BLOCK_INDEX }]
        if (msg.content.length > 0) blocks.push({ type: 'text', text: msg.content, index: 0 })
        msg.content = blocks as unknown as string
      }
      yield chunk
    }
  }

  withConfig(config: Parameters<ChatOpenAI['withConfig']>[0]): ReasoningChatOpenAI {
    const f = (this as unknown as { fields: ConstructorParameters<typeof ChatOpenAI>[0] }).fields
    const m = new ReasoningChatOpenAI(f)
    ;(m as unknown as { defaultOptions: unknown }).defaultOptions = {
      ...(this as unknown as { defaultOptions: Record<string, unknown> }).defaultOptions,
      ...config,
    }
    return m
  }
}

/** Resolve a provider's API key, with the sentinel used by the existing code. */
export function activeKey(providerID: string): string {
  return resolveApiKey(providerID) || 'sk-missing'
}

/** Build the production reasoning chat model for a concrete model choice. */
export function buildChatModel(choice: { providerID: string; modelID: string; baseURL: string }): ChatOpenAI {
  return new ReasoningChatOpenAI({
    model: choice.modelID,
    apiKey: activeKey(choice.providerID),
    configuration: { baseURL: choice.baseURL },
    streamUsage: true,
  })
}

const SUMMARY_SYSTEM_PROMPT =
  '你是对话压缩器。把给定的较早对话片段压成一段简洁中文摘要，保留：任务目标、关键决策、约束、' +
  '已写入或修改的文件、近期工具结果与未决事项；丢弃：中间推理、被否方案、冗长输出。只输出摘要正文。'

/** (moved verbatim from session.ts) Production summarizer: one cheap completion over the middle span. */
class RealSummarizer implements Summarizer {
  async summarize(messages: BaseMessage[]): Promise<string> {
    const { providerID, modelID, baseURL } = getActiveModel()
    const model = new ChatOpenAI({ model: cheapModelFor(providerID, modelID), apiKey: activeKey(providerID), configuration: { baseURL }, maxTokens: 512, temperature: 0.2 })
    const transcript = messages.map((m) => `${m.getType()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n')
    const res = await model.invoke([new SystemMessage(SUMMARY_SYSTEM_PROMPT), new HumanMessage(transcript)])
    return typeof res.content === 'string' ? res.content : ''
  }
}

export function createSummarizer(): Summarizer {
  return new RealSummarizer()
}
```

- [ ] **Step 2: Rewire `session.ts`**

In `packages/sidecar/src/session/session.ts`:

1. **Delete** these now-lifted blocks: `const REASONING_BLOCK_INDEX = 7` (line ~94) and its doc comment; `function stripReasoningBlocks` (lines ~100-116); `class ReasoningChatOpenAI` (lines ~118-158); `function activeKey` (lines ~160-162); `const SUMMARY_SYSTEM_PROMPT` (lines ~193-195); `class RealSummarizer` (lines ~197-206). **Keep** `const NOOP_SUMMARIZER` (line 191).
2. **Add** the import (near the other `./` imports, after the `model-runner` import):

```ts
import { buildChatModel, activeKey, createSummarizer } from './model-factory.js'
```

3. **Replace** `buildModel` (lines ~181-189) with:

```ts
function buildModel(config: SessionConfig): ChatOpenAI {
  return buildChatModel(resolveModelChoice(config, getActiveModel()))
}
```

4. **Replace** the body of `summarizer()` (line ~310-312) `new RealSummarizer()` with `createSummarizer()`:

```ts
  private summarizer(): Summarizer {
    if (this.injectedSummarizer) return this.injectedSummarizer
    return this.usesEnvModel ? createSummarizer() : NOOP_SUMMARIZER
  }
```

(`ChatOpenAI`, `getActiveModel`, `resolveModelChoice`, `SystemMessage`, `HumanMessage`, `cheapModelFor` remain imported/used by the title generator and `modelRunner` — do not remove those imports. `activeKey` is now imported from `model-factory` and is still used by the title generator at line ~79.)

- [ ] **Step 3: Export `lastAiText`**

In `packages/sidecar/src/session/subagent.ts`, change `function lastAiText` (line 20) to `export function lastAiText`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. Fix any dangling reference (e.g. a leftover `RealSummarizer`/`ReasoningChatOpenAI` mention in `session.ts`).

- [ ] **Step 5: Paid-free behavior check**

Run: `npx vitest run packages/sidecar/src/session/model-runner.test.ts packages/sidecar/src/session/agents/invoker.test.ts packages/sidecar/src/session/tools.test.ts`
Expected: PASS (these inject fakes; no API). This confirms the extraction didn't break the runner/invoker/tool wiring. (The paid `reasoner-reasoning.integration.test.ts` still exercises `ReasoningChatOpenAI` end-to-end but is only run in a deliberate paid session.)

- [ ] **Step 6: Commit**

```bash
cd /Users/lijiamin/data/my-github/hip
git add packages/sidecar/src/session/model-factory.ts packages/sidecar/src/session/session.ts packages/sidecar/src/session/subagent.ts
git commit -m "refactor(sidecar): extract model-factory (ReasoningChatOpenAI, buildChatModel, summarizer)"
```

---

### Task 5: `buildManagedAgentPrompt`

**Files:**
- Modify: `packages/sidecar/src/session/system-prompt.ts`
- Test: `packages/sidecar/src/session/system-prompt.test.ts` (create if absent; else append)

- [ ] **Step 1: Write the failing test**

```ts
// packages/sidecar/src/session/system-prompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildManagedAgentPrompt } from './system-prompt.js'

describe('buildManagedAgentPrompt', () => {
  it('embeds the persona, the cwd, and the granted tool names', () => {
    const p = buildManagedAgentPrompt({
      cwd: '/proj',
      persona: 'You are a meticulous code reviewer.',
      toolNames: ['read_file', 'grep'],
    })
    expect(p).toContain('You are a meticulous code reviewer.')
    expect(p).toContain('/proj')
    expect(p).toContain('read_file')
    expect(p).toContain('grep')
  })
  it('omits git guidance when no git tool is granted', () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: ['read_file'] })
    expect(p).not.toContain('git_commit')
  })
  it('includes git guidance when a git tool is granted', () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: ['read_file', 'git_commit'] })
    expect(p).toContain('git_commit')
  })
  it('forbids claiming a non-hip identity', () => {
    const p = buildManagedAgentPrompt({ cwd: '/proj', persona: 'x', toolNames: [] })
    expect(p).toContain('hip')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/sidecar/src/session/system-prompt.test.ts`
Expected: FAIL — `buildManagedAgentPrompt` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/sidecar/src/session/system-prompt.ts` (it already defines `IDENTITY`, `ANTI_PHANTOM`, `GIT_GUIDANCE`, `cwdBlock`):

```ts
export interface ManagedAgentPromptInput {
  cwd: string
  persona: string
  toolNames: string[]
}

/** System prompt for an internal managed sub-agent: identity guard + an operating preamble that
 *  enumerates the agent's ACTUAL granted tools + cwd convention + anti-phantom + the persona, framed
 *  as a focused, non-delegating sub-agent. Git guidance only when a git tool is granted. */
export function buildManagedAgentPrompt({ cwd, persona, toolNames }: ManagedAgentPromptInput): string {
  const toolList = toolNames.length ? toolNames.join(', ') : '(no tools — answer from reasoning only)'
  const base =
    'Right now you are acting as a focused sub-agent completing a single delegated sub-task. ' +
    `Your available tools are: ${toolList}. ` +
    'Use them to do the work yourself — read what you need, make changes only with the tools you have, ' +
    'and verify your results. You cannot delegate further. When done, return a concise text result ' +
    'describing what you found or changed.'
  const hasGit = toolNames.some((n) => n.startsWith('git_'))
  const parts = [IDENTITY, base, cwdBlock(cwd)]
  if (hasGit) parts.push(GIT_GUIDANCE)
  parts.push(ANTI_PHANTOM, `## Your role and instructions\n${persona.trim()}`)
  return parts.join('\n\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/sidecar/src/session/system-prompt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/lijiamin/data/my-github/hip
git add packages/sidecar/src/session/system-prompt.ts packages/sidecar/src/session/system-prompt.test.ts
git commit -m "feat(sidecar): buildManagedAgentPrompt for internal agents"
```

---

### Task 6: `internal-runner.ts` — `filterTools` + `runManagedAgent`

**Files:**
- Create: `packages/sidecar/src/session/internal-runner.ts`
- Test: `packages/sidecar/src/session/internal-runner.test.ts`

- [ ] **Step 1: Write the failing test**

The test injects a fake `ModelRunner` so no model is built and no API is hit. It uses a temp dir as cwd.

```ts
// packages/sidecar/src/session/internal-runner.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { GraphEmit } from './graph.js'
import { filterTools, runManagedAgent } from './internal-runner.js'
import { buildTools } from './tools.js'

const dirs: string[] = []
function tmp() { const d = mkdtempSync(join(tmpdir(), 'hip-internal-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }) } catch { /* ignore */ } } })

function collectingEmit() {
  const tokens: string[] = []
  const emit: GraphEmit = { token: (d) => tokens.push(d), reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {} }
  return { emit, tokens }
}

/** A runner that ignores tools and emits a fixed final answer with no tool calls. */
class TextRunner implements ModelRunner {
  constructor(private readonly text: string) {}
  async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    opts.onText(this.text)
    return new AIMessage(this.text)
  }
}

describe('filterTools', () => {
  it('keeps all tools when allowedTools is undefined', () => {
    const tools = buildTools('/proj')
    expect(filterTools(tools, undefined)).toHaveLength(tools.length)
  })
  it('keeps only the named tools', () => {
    const tools = buildTools('/proj')
    const kept = filterTools(tools, ['read_file', 'grep']).map((t) => t.name).sort()
    expect(kept).toEqual(['grep', 'read_file'])
  })
})

describe('runManagedAgent', () => {
  it('runs the loop with the injected runner and returns the final text', async () => {
    const cwd = tmp()
    const { emit, tokens } = collectingEmit()
    const text = await runManagedAgent({
      resolved: null, cwd, prompt: 'You are a tester.', allowedTools: ['read_file'],
      task: 'say hi', emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner: new TextRunner('done'),
      summarizer: { async summarize() { return '' } },
    })
    expect(text).toBe('done')
    expect(tokens.join('')).toBe('done')
  })

  it('a read-only allow-list produces a toolset with no write_file', async () => {
    const cwd = tmp()
    writeFileSync(join(cwd, 'a.txt'), 'hello', 'utf8')
    let seenToolNames: string[] = []
    const runner: ModelRunner = {
      async run(_m, opts) { seenToolNames = opts.tools.map((t) => t.name); opts.onText('ok'); return new AIMessage('ok') },
    }
    await runManagedAgent({
      resolved: null, cwd, prompt: 'read only', allowedTools: ['read_file', 'ls', 'glob', 'grep'],
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    expect(seenToolNames).not.toContain('write_file')
    expect(seenToolNames).not.toContain('edit_file')
    expect(seenToolNames).toContain('read_file')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/sidecar/src/session/internal-runner.test.ts`
Expected: FAIL — cannot resolve `./internal-runner`.

- [ ] **Step 3: Implement**

```ts
// packages/sidecar/src/session/internal-runner.ts
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { GraphEmit, GraphCtx } from './graph.js'
import { buildGraph } from './graph.js'
import { buildTools } from './tools.js'
import { recursionLimit } from './loop-control.js'
import { buildManagedAgentPrompt } from './system-prompt.js'
import { lastAiText } from './subagent.js'
import { RealModelRunner, type ModelRunner } from './model-runner.js'
import { buildChatModel, createSummarizer } from './model-factory.js'
import { getActiveModel } from '../config/providers.js'
import type { Summarizer } from './compaction.js'
import type { ResolvedModel } from './agents/registry.js'

/** Keep only the tools whose name is in `allowed`. undefined ⇒ keep all (legacy-safe). */
export function filterTools(tools: StructuredToolInterface[], allowed?: string[]): StructuredToolInterface[] {
  if (!allowed) return tools
  const set = new Set(allowed)
  return tools.filter((t) => set.has(t.name))
}

export interface RunManagedAgentArgs {
  resolved: ResolvedModel | null      // the agent's bound model; null ⇒ global active model
  cwd: string
  prompt: string                      // persona
  allowedTools?: string[]
  task: string
  emit: GraphEmit
  signal: AbortSignal
  childMaxSteps: number
  runner?: ModelRunner                // injectable for tests; default builds the real model
  summarizer?: Summarizer             // injectable for tests; default = real summarizer
}

/**
 * Run an internal managed agent: hip's built-in ReAct loop with a custom persona prompt, a model of
 * the agent's choosing (or the global active model), and a tool allow-list. Depth-1 (no task/dispatch).
 * Streams every event through `emit` and returns the final assistant text.
 */
export async function runManagedAgent(args: RunManagedAgentArgs): Promise<string> {
  const { resolved, cwd, prompt, allowedTools, task, emit, signal, childMaxSteps } = args
  const runner = args.runner ?? new RealModelRunner(buildChatModel(resolved ?? getActiveModel()))
  const summarizer = args.summarizer ?? createSummarizer()
  // base + git tools (no task/dispatch closures → depth-1), then narrow to the allow-list.
  const tools = filterTools(buildTools(cwd, undefined, cwd), allowedTools)
  const toolNames = tools.map((t) => t.name)
  const ctx: GraphCtx = { runner, tools, emit, summarizer }
  const app = buildGraph(childMaxSteps)
  const final = await app.invoke(
    {
      messages: [new SystemMessage(buildManagedAgentPrompt({ cwd, persona: prompt, toolNames })), new HumanMessage(task)],
      steps: 0,
      recentSigs: [],
      nudgedSig: undefined,
      status: 'running',
    },
    { configurable: { ctx }, signal, recursionLimit: recursionLimit(childMaxSteps) },
  )
  const text = lastAiText(final.messages)
  if (final.status === 'awaiting_user') {
    const q = (final as { pendingQuestion?: string }).pendingQuestion
    return q ? `${text}\n\n[sub-agent paused — open question: ${q}]` : text
  }
  return text
}
```

> Note: if `npx tsc --noEmit` flags the `final.status` / `final.messages` shape, mirror exactly how `subagent.ts:57-61` accesses `final` (same `app.invoke` return type) — copy its access pattern verbatim.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/sidecar/src/session/internal-runner.test.ts`
Expected: PASS (4 tests). Then `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/lijiamin/data/my-github/hip
git add packages/sidecar/src/session/internal-runner.ts packages/sidecar/src/session/internal-runner.test.ts
git commit -m "feat(sidecar): runManagedAgent + filterTools for internal agents"
```

---

### Task 7: Invoker branch for `kind:'internal'`

**Files:**
- Modify: `packages/sidecar/src/session/agents/invoker.ts`
- Test: `packages/sidecar/src/session/agents/invoker.test.ts` (append)

- [ ] **Step 1: Write the failing tests (append to invoker.test.ts)**

Add, after the existing tests (inside the `describe('createAgentInvoker', …)` block):

```ts
  it('routes an internal agent to runInternal with the resolved model + allowlist, returns its text', async () => {
    const seen: { agentId?: string; task?: string; resolved?: unknown; allowedTools?: string[]; prompt?: string } = {}
    const internalAgent: AgentConfig = {
      id: 'rev', name: 'Reviewer', kind: 'internal', command: '', args: [], transport: 'thin',
      acceptsModelConfig: false, enabled: true, prompt: 'review carefully', allowedTools: ['read_file'],
      boundModel: { providerID: 'p', modelID: 'm' },
    }
    const invoker = createAgentInvoker('/work', {
      readAgents: () => [internalAgent],
      resolveModel: () => ({ providerID: 'p', modelID: 'm', baseURL: 'u' }),
      createProvider: () => { throw new Error('internal must NOT build a provider') },
      runInternal: async (a) => { seen.agentId = a.agentId; seen.task = a.task; seen.resolved = a.resolved; seen.allowedTools = a.allowedTools; seen.prompt = a.prompt; a.emit.token('R'); return 'reviewed' },
    })
    const { emit, tokens } = collectingEmit()
    const text = await invoker.invoke('rev', 'do review', emit, new AbortController().signal)
    expect(text).toBe('reviewed')
    expect(tokens.join('')).toBe('R')
    expect(seen).toMatchObject({ agentId: 'rev', task: 'do review', resolved: { providerID: 'p', modelID: 'm', baseURL: 'u' }, allowedTools: ['read_file'], prompt: 'review carefully' })
  })

  it('passes resolved=null for an internal agent with no bound model', async () => {
    let seenResolved: unknown = 'unset'
    const internalAgent: AgentConfig = {
      id: 'sum', name: 'Summarizer', kind: 'internal', command: '', args: [], transport: 'thin',
      acceptsModelConfig: false, enabled: true, prompt: 'summarize',
    }
    const invoker = createAgentInvoker('/work', {
      readAgents: () => [internalAgent],
      resolveModel: () => null,
      runInternal: async (a) => { seenResolved = a.resolved; return 'ok' },
    })
    await invoker.invoke('sum', 't', collectingEmit().emit, new AbortController().signal)
    expect(seenResolved).toBeNull()
  })
```

Note the test references the shape passed to `runInternal` (`agentId`, `task`, `resolved`, `allowedTools`, `prompt`, `emit`). Match those property names exactly in the implementation.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/sidecar/src/session/agents/invoker.test.ts`
Expected: FAIL — `runInternal` is not a recognized dep / internal agents currently fall through to `createProvider` (throws "internal must NOT build a provider").

- [ ] **Step 3: Implement the branch**

Edit `packages/sidecar/src/session/agents/invoker.ts`:

```ts
import type { AgentConfig } from '@hip/protocol'
import type { GraphEmit } from '../graph.js'
import { createAgentProvider } from './index.js'
import { readAgentsConfig, resolveAgentModel, type ResolvedModel } from './registry.js'
import type { AgentProvider, ExternalAgentHooks } from './types.js'
import { runManagedAgent } from '../internal-runner.js'
import { CHILD_MAX_STEPS } from '../loop-control.js'

// ... (AgentInvoker interface unchanged) ...

/** Args handed to the internal-loop runner (a seam so tests can stub the loop). */
export interface RunInternalArgs {
  agentId: string
  resolved: ResolvedModel | null
  cwd: string
  prompt: string
  allowedTools?: string[]
  task: string
  emit: GraphEmit
  signal: AbortSignal
}

export interface InvokerDeps {
  readAgents?: () => AgentConfig[]
  createProvider?: (agent: AgentConfig, cwd: string, model: ResolvedModel | null) => AgentProvider
  resolveModel?: (agent: AgentConfig) => ResolvedModel | null
  runInternal?: (args: RunInternalArgs) => Promise<string>
}

export function createAgentInvoker(cwd: string, deps: InvokerDeps = {}): AgentInvoker {
  const readAgents = deps.readAgents ?? readAgentsConfig
  const createProvider = deps.createProvider ?? createAgentProvider
  const resolveModel = deps.resolveModel ?? resolveAgentModel
  const runInternal = deps.runInternal ?? ((a: RunInternalArgs) =>
    runManagedAgent({ resolved: a.resolved, cwd: a.cwd, prompt: a.prompt, allowedTools: a.allowedTools, task: a.task, emit: a.emit, signal: a.signal, childMaxSteps: CHILD_MAX_STEPS }))
  return {
    async invoke(agentId, task, emit, signal, hooks) {
      const agent = readAgents().find((a) => a.id === agentId && a.enabled)
      if (!agent) throw new Error(`unknown or disabled agent: ${agentId}`)

      if (agent.kind === 'internal') {
        // hip's own loop — no external provider, no token-teeing (runManagedAgent returns the final text).
        return runInternal({ agentId, resolved: resolveModel(agent), cwd, prompt: agent.prompt ?? '', allowedTools: agent.allowedTools, task, emit, signal })
      }

      // external (custom / acp) — unchanged
      const model = agent.acceptsModelConfig ? resolveModel(agent) : null
      const provider = createProvider(agent, cwd, model)
      let text = ''
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

(`resolveAgentModel` returns null when the agent has no `boundModel`, so internal agents without a bound model get `resolved: null` → the runner falls back to the global active model.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/sidecar/src/session/agents/invoker.test.ts`
Expected: PASS (all prior tests + 2 new). Then `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/lijiamin/data/my-github/hip
git add packages/sidecar/src/session/agents/invoker.ts packages/sidecar/src/session/agents/invoker.test.ts
git commit -m "feat(sidecar): invoker routes internal agents to hip's own loop"
```

---

### Task 8: End-to-end dispatch of an internal agent (integration, paid-free)

Drive the real `Session.sendMessage` so the supervisor emits a `dispatch_agent` tool call targeting an internal agent; assert the nested sub-agent run streams and its text returns into the supervisor's answer — all with **fake** models (supervisor model from the harness; the internal child via an injected `invokerFactory`).

**Files:**
- Modify: `packages/sidecar/src/session/__testutils__/dispatch-harness.ts`
- Create: `packages/sidecar/src/session/dispatch-internal.integration.test.ts`

- [ ] **Step 1: Read the existing harness**

Open `packages/sidecar/src/session/__testutils__/dispatch-harness.ts` and note the exports (`ToolThenTextModel`, `makeToolCallingModel`, `registerAgent`, `cleanupAgents`, `makeSession`, `collect`). The new test reuses `registerAgent`, `makeSession`, `collect`, `ToolThenTextModel`.

- [ ] **Step 2: Add a text-only fake model + its runner factory to the harness**

Append to `dispatch-harness.ts` (mirror how `ToolThenTextModel` overrides `bindTools`):

```ts
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { RealModelRunner, type ModelRunner } from '../model-runner.js'

/** A fake chat model that always answers with `text` and no tool calls; tool-binding is a no-op. */
export class TextOnlyModel extends FakeListChatModel {
  constructor(private readonly text: string) { super({ responses: [text] }) }
  bindTools(): any { return this }
}

/** A ModelRunner over a TextOnlyModel — used as the internal child's runner so no API is hit. */
export function makeTextRunner(text: string): ModelRunner {
  return new RealModelRunner(new TextOnlyModel(text) as any)
}
```

(If `registerAgent` cannot already write an `internal`-kind agent, confirm it writes whatever `AgentConfig` object it is given — it serializes to `HIP_AGENTS_PATH` as-is, so no change is needed; pass a full internal `AgentConfig`.)

- [ ] **Step 3: Write the integration test**

```ts
// packages/sidecar/src/session/dispatch-internal.integration.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import type { AgentConfig, ServerMessage } from '@hip/protocol'
import { createAgentInvoker } from './agents/invoker.js'
import { runManagedAgent } from './internal-runner.js'
import {
  makeToolCallingModel, registerAgent, cleanupAgents, makeSession, collect, makeTextRunner,
} from './__testutils__/dispatch-harness.js'

afterEach(() => cleanupAgents())

const internalAgent: AgentConfig = {
  id: 'reviewer', name: 'Reviewer', kind: 'internal', command: '', args: [], transport: 'thin',
  acceptsModelConfig: false, enabled: true, prompt: 'You review code.', allowedTools: ['read_file', 'grep'],
}

describe('dispatch → internal managed agent (end-to-end)', () => {
  it('runs the internal agent on the built-in loop and folds its result into the supervisor answer', async () => {
    registerAgent(internalAgent)

    // Supervisor: turn 1 calls dispatch_agent(reviewer), turn 2 answers using the result.
    const supervisorModel = makeToolCallingModel(
      { name: 'dispatch_agent', args: { agent: 'reviewer', task: 'review /a.ts' } },
      'The reviewer said: looks good.',
    )

    // Inject an invokerFactory whose internal runner uses a FAKE child model (paid-free), but the REAL loop.
    const invokerFactory = (cwd: string) => createAgentInvoker(cwd, {
      runInternal: (a) => runManagedAgent({
        resolved: a.resolved, cwd: a.cwd, prompt: a.prompt, allowedTools: a.allowedTools,
        task: a.task, emit: a.emit, signal: a.signal, childMaxSteps: 5,
        runner: makeTextRunner('looks good'),
        summarizer: { async summarize() { return '' } },
      }),
    })

    const session = makeSession({ model: supervisorModel, invokerFactory })
    const msgs: ServerMessage[] = []
    const finalText = await collect(session, 'please review', (m) => msgs.push(m))

    // The supervisor's final answer used the delegated result.
    expect(finalText).toContain('looks good')

    // A nested sub-agent run was surfaced (role 'subagent', parent 'supervisor').
    const started = msgs.find((m) => m.type === 'agent:started' && (m as any).role === 'subagent') as any
    expect(started).toBeTruthy()
    expect(started.parentAgentId).toBe('supervisor')
    const finished = msgs.find((m) => m.type === 'agent:finished' && (m as any).agentId === started.agentId)
    expect(finished).toBeTruthy()
  })
})
```

> If `makeSession`'s options object does not yet accept `invokerFactory`, extend it: `makeSession` constructs `new Session(...)`; pass the `invokerFactory` argument through to the `Session` constructor's last parameter (it already exists — see `session.ts:246`). Match the existing `makeSession` signature/style. If `makeToolCallingModel`'s arg shape differs from `{name, args}` + final text, adapt the call to the harness's actual signature (read it in Step 1).

- [ ] **Step 4: Run the integration test**

Run: `npx vitest run packages/sidecar/src/session/dispatch-internal.integration.test.ts`
Expected: PASS. This exercises the real `Session` graph, the real `dispatch_agent` tool, the real invoker internal branch, and the real `runManagedAgent` loop — only the two models are fake, so it is **paid-free**.

- [ ] **Step 5: Typecheck + commit**

```bash
cd /Users/lijiamin/data/my-github/hip
npx tsc --noEmit
git add packages/sidecar/src/session/__testutils__/dispatch-harness.ts packages/sidecar/src/session/dispatch-internal.integration.test.ts
git commit -m "test(sidecar): end-to-end dispatch of an internal managed agent (paid-free)"
```

---

## Phase C — frontend (i18n, draft logic, UI)

### Task 9: i18n strings (all three locales)

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts` (the `settings.agents` block)

- [ ] **Step 1: Add keys to each locale**

Under `settings.agents` in **all three** files, add the keys below (translate per locale). Keep the existing keys; only add. The category labels, section headers, internal-editor strings, capability-group names, and add-menu items:

`zh-CN` (`src/i18n/zh-CN.ts`):
```ts
        // categories + sections
        catAcp: 'ACP 智能体',
        catCli: '命令行智能体',
        catInternal: '内部智能体',
        sectionAcp: 'ACP',
        sectionCli: '命令行',
        sectionInternal: '内部',
        catAcpEmpty: '暂无 ACP 智能体',
        catCliEmpty: '暂无命令行智能体',
        catInternalEmpty: '暂无内部智能体',
        // add menu
        addAcp: '新增 ACP 智能体',
        addCli: '新增命令行智能体',
        addInternal: '新增内部智能体',
        // internal editor
        prompt: '提示词',
        promptPlaceholder: '描述这个内部智能体的角色、风格与工作方式…',
        sectionTools: '可用工具',
        toolsHint: '勾选该智能体可以使用的能力',
        toolRead: '读取与搜索',
        toolReadDesc: 'read_file、ls、glob、grep',
        toolEdit: '编辑文件',
        toolEditDesc: 'write_file、edit_file',
        toolPlan: '计划',
        toolPlanDesc: 'write_todos',
        toolGit: 'Git 操作',
        toolGitDesc: 'git_commit、git_create_branch、git_switch_branch',
        modelGlobal: '使用全局模型',
        // acp generic
        quirks: '兼容性配置（quirks）',
        quirksPlaceholder: '如 opencode（可留空）',
        badgeInternal: '内部',
        badgeGlobalModel: '全局模型',
```

`zh-TW` (`src/i18n/zh-TW.ts`):
```ts
        catAcp: 'ACP 智能體',
        catCli: '命令列智能體',
        catInternal: '內部智能體',
        sectionAcp: 'ACP',
        sectionCli: '命令列',
        sectionInternal: '內部',
        catAcpEmpty: '尚無 ACP 智能體',
        catCliEmpty: '尚無命令列智能體',
        catInternalEmpty: '尚無內部智能體',
        addAcp: '新增 ACP 智能體',
        addCli: '新增命令列智能體',
        addInternal: '新增內部智能體',
        prompt: '提示詞',
        promptPlaceholder: '描述這個內部智能體的角色、風格與工作方式…',
        sectionTools: '可用工具',
        toolsHint: '勾選該智能體可以使用的能力',
        toolRead: '讀取與搜尋',
        toolReadDesc: 'read_file、ls、glob、grep',
        toolEdit: '編輯檔案',
        toolEditDesc: 'write_file、edit_file',
        toolPlan: '計畫',
        toolPlanDesc: 'write_todos',
        toolGit: 'Git 操作',
        toolGitDesc: 'git_commit、git_create_branch、git_switch_branch',
        modelGlobal: '使用全域模型',
        quirks: '相容性設定（quirks）',
        quirksPlaceholder: '如 opencode（可留空）',
        badgeInternal: '內部',
        badgeGlobalModel: '全域模型',
```

`en` (`src/i18n/en.ts`):
```ts
        catAcp: 'ACP agents',
        catCli: 'CLI agents',
        catInternal: 'Internal agents',
        sectionAcp: 'ACP',
        sectionCli: 'CLI',
        sectionInternal: 'Internal',
        catAcpEmpty: 'No ACP agents yet',
        catCliEmpty: 'No CLI agents yet',
        catInternalEmpty: 'No internal agents yet',
        addAcp: 'Add ACP agent',
        addCli: 'Add CLI agent',
        addInternal: 'Add internal agent',
        prompt: 'Prompt',
        promptPlaceholder: 'Describe this internal agent: its role, style, and how it works…',
        sectionTools: 'Available tools',
        toolsHint: 'Choose what this agent is allowed to do',
        toolRead: 'Read & search',
        toolReadDesc: 'read_file, ls, glob, grep',
        toolEdit: 'Edit files',
        toolEditDesc: 'write_file, edit_file',
        toolPlan: 'Plan',
        toolPlanDesc: 'write_todos',
        toolGit: 'Git',
        toolGitDesc: 'git_commit, git_create_branch, git_switch_branch',
        modelGlobal: 'Use global model',
        quirks: 'Quirks profile',
        quirksPlaceholder: 'e.g. opencode (optional)',
        badgeInternal: 'Internal',
        badgeGlobalModel: 'Global model',
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (The locale objects are `as const`; if the project enforces locale-shape parity via a `satisfies`/`Record` somewhere, ensure all three files got the identical key set.)

- [ ] **Step 3: Commit**

```bash
cd /Users/lijiamin/data/my-github/hip
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "i18n: agent categories + internal-agent editor strings"
```

---

### Task 10: `agentDraft.ts` — internal kind in form / validate / build

**Files:**
- Modify: `src/lib/agentDraft.ts`
- Test: `src/lib/agentDraft.test.ts` (append)

- [ ] **Step 1: Write the failing tests (append)**

```ts
// add to src/lib/agentDraft.test.ts
import { TOOL_GROUPS } from './agentTools'

const internalBase: AgentForm = {
  name: 'Reviewer', kind: 'internal', command: '', args: '', transport: 'thin',
  acceptsModelConfig: false, boundModelKey: '', authMode: 'opencode-self', enabled: true,
  prompt: 'You review code.', toolsRead: true, toolsEdit: false, toolsPlan: true, toolsGit: false,
}

describe('internal agents', () => {
  it('requires a name and a non-empty prompt (command not required)', () => {
    expect(isAgentDraftValid(internalBase)).toBe(true)
    expect(isAgentDraftValid({ ...internalBase, prompt: '   ' })).toBe(false)
    expect(isAgentDraftValid({ ...internalBase, command: '' })).toBe(true) // command irrelevant
  })
  it('builds an internal draft: prompt + allowedTools from groups, inert command/args', () => {
    const d = buildAgentDraft(internalBase)
    expect(d).toMatchObject({ kind: 'internal', prompt: 'You review code.', command: '', args: [], transport: 'thin', acceptsModelConfig: false })
    expect(d.allowedTools).toEqual([...TOOL_GROUPS.read, ...TOOL_GROUPS.plan])
    expect(d.boundModel).toBeUndefined()
  })
  it('binds a model when a key is chosen', () => {
    const d = buildAgentDraft({ ...internalBase, boundModelKey: 'anthropic/claude-opus-4' })
    expect(d.boundModel).toEqual({ providerID: 'anthropic', modelID: 'claude-opus-4' })
  })
})
```

Also update the existing `base` fixture and any other `AgentForm` literals in this test file to include the new required fields (`prompt: ''`, `toolsRead/Edit/Plan/Git`) so they still typecheck — add `prompt: '', toolsRead: true, toolsEdit: true, toolsPlan: true, toolsGit: false` to the top-of-file `base` literal.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/agentDraft.test.ts`
Expected: FAIL — `AgentForm` has no `prompt`/`toolsRead`/…; `buildAgentDraft` doesn't branch on internal.

- [ ] **Step 3: Implement**

Rewrite `src/lib/agentDraft.ts`:

```ts
import type { AgentConfig, AgentAuthMode } from '@hip/protocol'
import { groupsToToolNames } from './agentTools'

export interface AgentForm {
  name: string
  description?: string
  kind: AgentConfig['kind']
  command: string
  args: string
  transport: AgentConfig['transport']
  acceptsModelConfig: boolean
  boundModelKey: string
  authMode: AgentAuthMode
  quirks?: string
  // internal-only fields:
  prompt: string
  toolsRead: boolean
  toolsEdit: boolean
  toolsPlan: boolean
  toolsGit: boolean
  enabled: boolean
}

export function isAgentDraftValid(form: AgentForm): boolean {
  if (form.kind === 'internal') {
    return form.name.trim() !== '' && form.prompt.trim() !== ''
  }
  // For an acp agent with hip-managed auth, a model must be chosen.
  const needsModel = form.kind === 'acp' ? form.authMode === 'hip-managed' : form.acceptsModelConfig
  return (
    form.name.trim() !== '' &&
    form.command.trim() !== '' &&
    (!needsModel || form.boundModelKey !== '')
  )
}

function parseBoundModel(key: string): AgentConfig['boundModel'] {
  if (key === '') return undefined
  const slash = key.indexOf('/')
  return { providerID: key.slice(0, slash), modelID: key.slice(slash + 1) }
}

export function buildAgentDraft(form: AgentForm): Omit<AgentConfig, 'id'> {
  if (form.kind === 'internal') {
    return {
      name: form.name.trim(),
      description: (form.description ?? '').trim() || undefined,
      kind: 'internal',
      command: '',
      args: [],
      transport: 'thin',
      acceptsModelConfig: false,
      prompt: form.prompt.trim(),
      allowedTools: groupsToToolNames({ read: form.toolsRead, edit: form.toolsEdit, plan: form.toolsPlan, git: form.toolsGit }),
      boundModel: parseBoundModel(form.boundModelKey),
      enabled: form.enabled,
    }
  }

  const isAcp = form.kind === 'acp'
  const acceptsModelConfig = isAcp ? form.authMode === 'hip-managed' : form.acceptsModelConfig
  const useModel = acceptsModelConfig && form.boundModelKey !== ''
  return {
    name: form.name.trim(),
    description: (form.description ?? '').trim() || undefined,
    kind: form.kind,
    command: form.command.trim(),
    args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
    transport: form.transport,
    acceptsModelConfig,
    boundModel: useModel ? parseBoundModel(form.boundModelKey) : undefined,
    ...(isAcp ? { authMode: form.authMode } : {}),
    ...(form.quirks ? { quirks: form.quirks } : {}),
    enabled: form.enabled,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/agentDraft.test.ts`
Expected: PASS (existing + 3 new). Then `npx tsc --noEmit` — this will surface that `AgentEditor.tsx` constructs an `AgentForm` missing the new fields; fix that in Task 11 (expected to fail tsc until then, so do NOT run a repo-wide tsc gate at this step — just the test).

- [ ] **Step 5: Commit**

```bash
cd /Users/lijiamin/data/my-github/hip
git add src/lib/agentDraft.ts src/lib/agentDraft.test.ts
git commit -m "feat(ui): agentDraft supports the internal kind (prompt + tool groups)"
```

---

### Task 11: `AgentEditor.tsx` — internal branch + editable ACP + `initialKind`

**Files:**
- Modify: `src/components/account/AgentEditor.tsx`

- [ ] **Step 1: Add `initialKind`, internal form state, and the internal branch**

Make these changes to `src/components/account/AgentEditor.tsx`:

1. **Props**: add `initialKind`:

```tsx
export function AgentEditor({
  initial,
  initialKind,
  onSave,
  onCancel,
}: {
  initial: AgentConfig | null
  initialKind?: AgentConfig['kind']
  onSave: (draft: Omit<AgentConfig, 'id'>) => Promise<void>
  onCancel: () => void
}) {
```

2. **Imports**: add `agentCategory` and the tool-group helper + tFunc for titles:

```tsx
import { agentCategory } from '@/lib/agentCategory'
import { toolNamesToGroups } from '@/lib/agentTools'
```

3. **Initial form**: seed `kind` from `initial ?? initialKind ?? 'custom'` and seed the internal fields from `initial`:

```tsx
  const groups0 = toolNamesToGroups(initial?.allowedTools)
  const [form, setForm] = useState<AgentForm>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    kind: initial?.kind ?? initialKind ?? 'custom',
    command: initial?.command ?? '',
    args: (initial?.args ?? []).join(' '),
    transport: initial?.transport ?? (initialKind === 'acp' ? 'rich' : 'thin'),
    acceptsModelConfig: initial?.acceptsModelConfig ?? false,
    boundModelKey: initial?.boundModel ? `${initial.boundModel.providerID}/${initial.boundModel.modelID}` : '',
    authMode: initial?.authMode ?? 'opencode-self',
    quirks: initial?.quirks,
    prompt: initial?.prompt ?? '',
    toolsRead: groups0.read,
    toolsEdit: groups0.edit,
    toolsPlan: groups0.plan,
    toolsGit: groups0.git,
    enabled: initial?.enabled ?? true,
  })
```

4. **Category + title**: replace `const isAcp = form.kind === 'acp'` with:

```tsx
  const category = agentCategory({ kind: form.kind })
  const isAcp = category === 'acp'
  const isInternal = category === 'internal'
  const title = initial
    ? t('settings.agents.editTitle')
    : t(form.kind === 'acp' ? 'settings.agents.addAcp' : form.kind === 'internal' ? 'settings.agents.addInternal' : 'settings.agents.addCli')
```

Use `title` in `<Modal … title={title}>`.

5. **Body**: wrap the command/auth/transport/model sections so they only render for **non-internal**, and add the internal branch. Replace the `<div className="space-y-5 p-5">…</div>` body content with:

```tsx
        <div className="space-y-5 p-5">
          <Field label={t('settings.agents.name')}>
            <input className={inputCls} value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="My Agent" />
          </Field>

          <Field label={t('settings.agents.description')}>
            <textarea
              className={cn(inputCls, 'min-h-[64px] resize-y')}
              value={form.description ?? ''}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder={t('settings.agents.descriptionPlaceholder')}
              rows={3}
            />
          </Field>

          {isInternal ? (
            <>
              <Field label={t('settings.agents.prompt')}>
                <textarea
                  className={cn(inputCls, 'min-h-[140px] resize-y font-mono')}
                  value={form.prompt}
                  onChange={(e) => patch({ prompt: e.target.value })}
                  placeholder={t('settings.agents.promptPlaceholder')}
                  rows={7}
                />
              </Field>

              <Section label={t('settings.agents.sectionModel')}>
                <select className={inputCls} value={form.boundModelKey} onChange={(e) => patch({ boundModelKey: e.target.value })}>
                  <option value="">{t('settings.agents.modelGlobal')}</option>
                  {groups.map((g) => (
                    <optgroup key={g.providerID} label={g.providerName}>
                      {g.models.map((m) => (
                        <option key={m.key} value={m.key}>{m.modelID}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Section>

              <Section label={t('settings.agents.sectionTools')}>
                <div className="text-caption text-ink-tertiary">{t('settings.agents.toolsHint')}</div>
                <ToolToggle label={t('settings.agents.toolRead')} desc={t('settings.agents.toolReadDesc')} checked={form.toolsRead} onChange={(v) => patch({ toolsRead: v })} />
                <ToolToggle label={t('settings.agents.toolEdit')} desc={t('settings.agents.toolEditDesc')} checked={form.toolsEdit} onChange={(v) => patch({ toolsEdit: v })} />
                <ToolToggle label={t('settings.agents.toolPlan')} desc={t('settings.agents.toolPlanDesc')} checked={form.toolsPlan} onChange={(v) => patch({ toolsPlan: v })} />
                <ToolToggle label={t('settings.agents.toolGit')} desc={t('settings.agents.toolGitDesc')} checked={form.toolsGit} onChange={(v) => patch({ toolsGit: v })} />
              </Section>
            </>
          ) : (
            <>
              <Section label={t('settings.agents.sectionCommand')}>
                <Field label={t('settings.agents.command')}>
                  <input
                    className={cn(inputCls, 'font-mono')}
                    value={form.command}
                    onChange={(e) => patch({ command: e.target.value })}
                    placeholder="/usr/local/bin/my-agent"
                  />
                </Field>
                <Field label={t('settings.agents.args')}>
                  <input
                    className={cn(inputCls, 'font-mono')}
                    value={form.args}
                    onChange={(e) => patch({ args: e.target.value })}
                    placeholder="--loop --json"
                  />
                </Field>
              </Section>

              {isAcp && (
                <>
                  <Field label={t('settings.agents.quirks')}>
                    <input
                      className={cn(inputCls, 'font-mono')}
                      value={form.quirks ?? ''}
                      onChange={(e) => patch({ quirks: e.target.value || undefined })}
                      placeholder={t('settings.agents.quirksPlaceholder')}
                    />
                  </Field>
                  <Section label={t('settings.agents.sectionAuth')}>
                    {/* …existing auth radiogroup + hip-managed model <select> — UNCHANGED… */}
                  </Section>
                </>
              )}

              <Section label={t('settings.agents.sectionTransport')}>
                {/* …existing transport radiogroup — UNCHANGED… */}
              </Section>

              {!isAcp && (
                <Section label={t('settings.agents.sectionModel')}>
                  {/* …existing acceptsModelConfig switch + model <select> — UNCHANGED… */}
                </Section>
              )}
            </>
          )}

          {error && <div className="text-meta text-danger">{error}</div>}
        </div>
```

> Keep the existing auth/transport/model JSX exactly as-is; only the **command/args inputs lose `readOnly={isAcp}`** (now always editable) and the whole non-internal group is gated by `!isInternal`. The `quirks` field is new.

6. **Add the `ToolToggle` sub-component** (next to `Field`/`Section`/`ChoiceCard`):

```tsx
function ToolToggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="flex-1">
        <div className="text-body text-ink">{label}</div>
        <div className="mt-0.5 font-mono text-caption text-ink-tertiary">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} ariaLabel={label} />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (this resolves the `AgentForm` shape errors from Task 10). If `AgentManagement.tsx`'s `<AgentEditor>` call now mismatches, that's fixed in Task 12 — but `initialKind` is optional, so Task 11 should typecheck on its own.

- [ ] **Step 3: Commit**

```bash
cd /Users/lijiamin/data/my-github/hip
git add src/components/account/AgentEditor.tsx
git commit -m "feat(ui): internal-agent editor branch + editable ACP command/args + quirks"
```

---

### Task 12: `AgentManagement.tsx` — category sections + 3-item Add menu

**Files:**
- Modify: `src/components/account/AgentManagement.tsx`

- [ ] **Step 1: Rewrite the component**

```tsx
// src/components/account/AgentManagement.tsx
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Plus } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { agentCategory, type AgentCategory } from '@/lib/agentCategory'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/DropdownMenu'
import { BuiltinCard, AgentCard } from './AgentCard'
import { AgentEditor } from './AgentEditor'
import { DeleteAgentDialog } from './DeleteAgentDialog'

type Editing =
  | { mode: 'add'; kind: AgentConfig['kind'] }
  | { mode: 'edit'; agent: AgentConfig }
  | null

const SECTIONS: { cat: AgentCategory; titleKey: string; emptyKey: string }[] = [
  { cat: 'internal', titleKey: 'settings.agents.sectionInternal', emptyKey: 'settings.agents.catInternalEmpty' },
  { cat: 'cli', titleKey: 'settings.agents.sectionCli', emptyKey: 'settings.agents.catCliEmpty' },
  { cat: 'acp', titleKey: 'settings.agents.sectionAcp', emptyKey: 'settings.agents.catAcpEmpty' },
]

export function AgentManagement() {
  const { t } = useTranslation()
  const { agents, loaded, load, addAgent, updateAgent, removeAgent } = useAgentsStore()
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<AgentConfig | null>(null)

  useEffect(() => { if (!loaded) void load() }, [loaded, load])

  const byCat = useMemo(() => {
    const m: Record<AgentCategory, AgentConfig[]> = { acp: [], cli: [], internal: [] }
    for (const a of agents) m[agentCategory(a)].push(a)
    return m
  }, [agents])

  return (
    <div className="p-6">
      <h2 className="text-title font-semibold text-ink">{t('settings.agents.title')}</h2>
      <p className="mt-1 text-body text-ink-secondary">{t('settings.agents.intro')}</p>

      <div className="mt-5 space-y-2">
        <BuiltinCard />
      </div>

      {SECTIONS.map(({ cat, titleKey, emptyKey }) => (
        <div key={cat} className="mt-6">
          <div className="mb-2 text-caption font-medium uppercase tracking-wide text-ink-tertiary">{t(titleKey)}</div>
          <div className="space-y-2">
            {byCat[cat].length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-5 text-center text-meta text-ink-tertiary">
                {t(emptyKey)}
              </div>
            ) : (
              byCat[cat].map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  onToggle={(enabled) => void updateAgent(a.id, { enabled })}
                  onEdit={() => setEditing({ mode: 'edit', agent: a })}
                  onDelete={() => setDeleting(a)}
                />
              ))
            )}
          </div>
        </div>
      ))}

      <div className="mt-6">
        {/* modal={false}: the menu's item opens a Modal; stacking two pointer-events locks freezes the app. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-3 text-body font-medium text-accent-strong transition-colors hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <Plus size={15} /> {t('settings.agents.add')}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setEditing({ mode: 'add', kind: 'internal' })}>
              <Bot size={14} /> {t('settings.agents.addInternal')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditing({ mode: 'add', kind: 'custom' })}>
              {t('settings.agents.addCli')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditing({ mode: 'add', kind: 'acp' })}>
              {t('settings.agents.addAcp')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {editing && (
        <AgentEditor
          initial={editing.mode === 'edit' ? editing.agent : null}
          initialKind={editing.mode === 'add' ? editing.kind : undefined}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            if (editing.mode === 'edit') await updateAgent(editing.agent.id, draft)
            else await addAgent(draft)
            setEditing(null)
          }}
        />
      )}

      {deleting && (
        <DeleteAgentDialog
          agent={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => { void removeAgent(deleting.id); setDeleting(null) }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/lijiamin/data/my-github/hip
git add src/components/account/AgentManagement.tsx
git commit -m "feat(ui): group agents into ACP/CLI/internal sections + 3-item Add menu"
```

---

### Task 13: `AgentCard.tsx` — category badge + internal summary

**Files:**
- Modify: `src/components/account/AgentCard.tsx`

- [ ] **Step 1: Add a category badge + internal-specific body**

In `src/components/account/AgentCard.tsx`:

1. Import the helper:

```tsx
import { agentCategory } from '@/lib/agentCategory'
```

2. In `AgentCard`, compute the category and render an internal-aware body. Replace the badges row + cmdline block:

```tsx
  const { t } = useTranslation()
  const cat = agentCategory(agent)
  const catLabel = cat === 'acp' ? t('settings.agents.catAcp') : cat === 'internal' ? t('settings.agents.badgeInternal') : t('settings.agents.catCli')
  const cmdline = [agent.command, ...agent.args].join(' ')
  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-border bg-surface px-4 py-3.5">
      <Avatar name={agent.name} shape="square" size={38} className={cn(!agent.enabled && 'opacity-60')} />
      <div className={cn('min-w-0 flex-1', !agent.enabled && 'opacity-60')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium text-ink">{agent.name}</span>
          <Badge className={cat === 'internal' ? 'bg-accent-subtle text-accent-strong' : undefined}>{catLabel}</Badge>
          {cat !== 'internal' && (
            <Badge className={agent.transport === 'rich' ? 'bg-accent-subtle text-accent-strong' : undefined}>
              {t(agent.transport === 'rich' ? 'settings.agents.transportRich' : 'settings.agents.transportThin')}
            </Badge>
          )}
          <Badge>
            <Cpu size={11} />
            {agent.boundModel ? agent.boundModel.modelID : (cat === 'internal' ? t('settings.agents.badgeGlobalModel') : null)}
          </Badge>
        </div>
        {cat === 'internal' ? (
          agent.description && <div className="mt-1 truncate text-caption text-ink-tertiary">{agent.description}</div>
        ) : (
          <>
            <div className="mt-1 flex items-center gap-1 overflow-hidden font-mono text-caption text-ink-tertiary">
              <Terminal size={12} className="shrink-0 text-ink-tertiary/70" />
              <span className="min-w-0 truncate">{cmdline}</span>
            </div>
            {agent.description && <div className="mt-1 truncate text-caption text-ink-tertiary">{agent.description}</div>}
          </>
        )}
      </div>
      {/* …Switch + kebab DropdownMenu — UNCHANGED… */}
```

> The model `<Badge>` now always renders, showing the bound model id, or "全局模型" for an internal agent with no bound model, or nothing for an external agent with no bound model. If `agent.boundModel` is absent and `cat !== 'internal'`, render no model badge — guard it: only render the model `<Badge>` when `agent.boundModel || cat === 'internal'`.

Apply that guard:

```tsx
          {(agent.boundModel || cat === 'internal') && (
            <Badge>
              <Cpu size={11} />
              {agent.boundModel ? agent.boundModel.modelID : t('settings.agents.badgeGlobalModel')}
            </Badge>
          )}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Browser-preview verification (per project rule)**

Per the project's prefer-GUI rule, verify the settings page renders: built-in hip card, three sections (内部/命令行/ACP), the seeded OpenCode under ACP, the 3-item Add menu, and an internal-agent editor (prompt + model + four tool toggles). Use the preview tools (mock `__TAURI_INTERNALS__.invoke` if needed) to confirm no console errors and the sections render.

- [ ] **Step 4: Commit**

```bash
cd /Users/lijiamin/data/my-github/hip
git add src/components/account/AgentCard.tsx
git commit -m "feat(ui): category badge + internal-agent summary on the agent card"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` → clean.
- [ ] Paid-free targeted suite of everything new:
  ```bash
  npx vitest run \
    src/lib/agentCategory.test.ts src/lib/agentTools.test.ts src/lib/agentDraft.test.ts \
    packages/sidecar/src/session/system-prompt.test.ts \
    packages/sidecar/src/session/internal-runner.test.ts \
    packages/sidecar/src/session/agents/invoker.test.ts \
    packages/sidecar/src/session/dispatch-internal.integration.test.ts \
    packages/sidecar/src/session/model-runner.test.ts packages/sidecar/src/session/tools.test.ts
  ```
  Expected: all PASS.
- [ ] Full suite (optional, **move `~/.hip/config/auth.json` aside first**, then restore): `yarn test`.
- [ ] Final holistic review (subagent-driven final reviewer): confirm the three categories render, internal dispatch works end-to-end, allow-list is enforced, generic ACP creation works, and no regression to the existing dispatch/HITL/SubAgentCard paths.
- [ ] Manual `yarn tauri dev` GUI acceptance (user-owned): create an internal agent (e.g. a read-only "Reviewer" with a custom prompt), enable it, dispatch via hip in a real chat, confirm the nested SubAgentCard streams and the result folds into hip's answer; create a generic ACP agent; confirm sections + Add menu.

---

## Self-review notes (coverage map)

- Spec §A (categories/data model) → Tasks 1, 2.
- Spec §B (internal runtime, model-factory, internal-runner, invoker branch, prompt) → Tasks 4, 5, 6, 7; end-to-end Task 8.
- Spec §C (allow-list, four groups, filterTools) → Tasks 3, 6, 10, 11.
- Spec §D (model binding + fallback) → Tasks 6 (fallback), 7 (resolve), 10/11 (picker).
- Spec §E (settings page, editor, cards) → Tasks 9, 11, 12, 13.
- Spec §F (generic ACP creation) → Task 11 (editable command/args + quirks) + Task 12 (Add ACP).
- Spec §G (testing) → Tasks 2, 3, 5, 6, 7, 8, 10 + final verification.
- Spec §H (non-goals) → honored: no union refactor (Task 1 flat optional), no per-tool granularity (groups), depth-1 (buildTools without spawn/dispatch in Task 6), no internal HITL (built-in tools execute directly), no session.ts dispatch-wiring change (only model-factory import).
