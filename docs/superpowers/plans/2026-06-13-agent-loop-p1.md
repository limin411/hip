# Agent Loop — Phase 1 (Core ReAct Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deepagents "supervisor must call `task` 3× (planner→coder→reviewer)" forced pipeline with a single self-adaptive LangGraph ReAct agent loop that actually writes files — the model chooses tools each step, the loop runs until the model finishes or a step cap is hit.

**Architecture:** A custom `@langchain/langgraph` `StateGraph` of two nodes — `agent` (one model turn, streams text/reasoning, may emit tool calls) and `tools` (executes the tool calls, appends results) — wired `START → agent ⇄ tools`, with a deterministic step cap that forces a final text answer. The risky streaming/reasoning-extraction is isolated behind a `ModelRunner` interface so the graph's control flow is unit-testable with a fake runner. The existing trace/persistence/protocol layer (`tool-trace.ts`, `store.ts`, `@hip/protocol` events) is reused unchanged.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), `@langchain/langgraph` 1.3.6, `@langchain/openai` (`ReasoningChatOpenAI`), `@langchain/core` messages, `vitest`, node:sqlite. This is Phase 1 of the design in `docs/superpowers/specs/2026-06-13-agent-loop-design.md`. **Out of scope (later phases):** HITL interrupt/resume, doom-loop detection, retry/backoff, auto-compaction (P2); `write_todos` UI, `task` subagents (P3).

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/sidecar/package.json` | add `@langchain/langgraph` as a direct dep | 1 |
| `packages/sidecar/src/session/tools.ts` (new) | sandboxed file tools as LangChain `tool()` over an injected root dir | 3 |
| `packages/sidecar/src/session/system-prompt.ts` (new) | assemble the single-agent system prompt (pure) | 4 |
| `packages/sidecar/src/session/loop-control.ts` (new) | step-cap constant + max-steps directive + pure helpers | 5 |
| `packages/sidecar/src/session/model-runner.ts` (new) | `ModelRunner` interface + `RealModelRunner` (real streaming + reasoning extraction) | 6 |
| `packages/sidecar/src/session/graph.ts` (new) | the `StateGraph` loop: agent node, tools node, edges, step cap | 7 |
| `packages/sidecar/src/session/session.ts` (modify) | `buildAgent` builds the graph; `runTurn` drives it, reusing the trace/finalize layer | 8 |
| `packages/sidecar/src/session/agents.ts` (modify) | drop the forced-pipeline prompt; keep `roleForName` | 4, 8 |

Reused unchanged: `tool-trace.ts`, `verify.ts`, `workspace-fs.ts` (`resolveWithin`), `persistence/store.ts`, `idle-watchdog.ts`, `config/providers.ts`, `config/auth-file.ts`, `@hip/protocol`.

---

## Task 1: Add LangGraph as a direct dependency

**Files:**
- Modify: `packages/sidecar/package.json`

LangGraph 1.3.6 is already resolvable (transitively via `deepagents`); make it a direct dependency so we import it without relying on hoisting.

- [ ] **Step 1: Add the dependency**

Edit `packages/sidecar/package.json` — add to `dependencies` (keep alphabetical with the other `@langchain/*` entries):

```json
"@langchain/langgraph": "^1.3.6",
```

- [ ] **Step 2: Install and verify resolution**

Run: `yarn install` then `node -e "console.log(require('@langchain/langgraph/package.json').version)"`
Expected: prints `1.3.6` (or a `1.3.x`).

- [ ] **Step 3: Commit**

```bash
git add packages/sidecar/package.json yarn.lock
git commit -m "build(sidecar): add @langchain/langgraph as a direct dependency"
```

---

## Task 2: Spike — validate the loop + streaming + tool-calling against live DeepSeek (manual, paid)

**Files:**
- Create (throwaway, NOT committed): `packages/sidecar/scratch/spike-loop.mts`

> This is a **manual validation**, not an automated test (per the project's "prefer GUI / avoid paid real-LLM tests in `yarn test`" policy). It de-risks R1 (LangGraph + `ReasoningChatOpenAI` streaming) and R2 (DeepSeek `deepseek-v4-pro` tool-calling). Its purpose is to **record the exact streamed chunk shape** so Task 6's extraction code is correct. Delete the file after.

- [ ] **Step 1: Write the spike script**

Create `packages/sidecar/scratch/spike-loop.mts`:

```ts
// Run with a real key present in ~/.hip/config/auth.json. NOT part of `yarn test`.
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { concat } from '@langchain/core/utils/stream'
import { HumanMessage, type AIMessageChunk } from '@langchain/core/messages'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const auth = JSON.parse(readFileSync(join(homedir(), '.hip/config/auth.json'), 'utf8'))
const apiKey = auth.deepseek?.apiKey ?? auth.deepseek ?? Object.values(auth)[0]

const writeFile = tool(async ({ path, content }) => `wrote ${path} (${content.length} bytes)`, {
  name: 'write_file',
  description: 'Write a file. path is absolute, relative to the project root.',
  schema: z.object({ path: z.string(), content: z.string() }),
})

const model = new ChatOpenAI({
  model: 'deepseek-v4-pro',
  apiKey,
  configuration: { baseURL: 'https://api.deepseek.com/v1' },
}).bindTools([writeFile])

const stream = await model.stream([
  new HumanMessage('Write a file /hello.html with a tiny HTML page. Use the write_file tool.'),
])
let gathered: AIMessageChunk | undefined
for await (const chunk of stream) {
  gathered = gathered ? concat(gathered, chunk) : chunk
  // RECORD: shape of chunk.content (string vs array), chunk.additional_kwargs.reasoning_content
  console.log('CHUNK.content=', JSON.stringify(chunk.content), 'rk=', JSON.stringify((chunk.additional_kwargs as any)?.reasoning_content ?? null))
}
console.log('FINAL tool_calls=', JSON.stringify(gathered?.tool_calls))
```

- [ ] **Step 2: Run it and record findings**

Run: `cd packages/sidecar && npx tsx scratch/spike-loop.mts`
Expected/record: (a) at least one `CHUNK.content` carries text deltas; (b) `FINAL tool_calls` is a non-empty array `[{ name: 'write_file', args: { path, content }, id }]`; (c) whether reasoning arrives as `additional_kwargs.reasoning_content` and/or content blocks. **Write the observed text-delta and reasoning-delta location into a comment at the top of `model-runner.ts` in Task 6.** If `tool_calls` is empty (model narrated instead), record that `tool_choice` forcing is needed and note it for Task 6.

- [ ] **Step 3: Delete the spike (do not commit it)**

```bash
rm packages/sidecar/scratch/spike-loop.mts
```

---

## Task 3: Sandboxed file tools (`tools.ts`)

**Files:**
- Create: `packages/sidecar/src/session/tools.ts`
- Test: `packages/sidecar/src/session/tools.test.ts`

LangChain `tool()` definitions bound to an injected root dir, reusing `resolveWithin` from `workspace-fs.ts` for the path jail. Paths the model passes are "absolute relative to root" (e.g. `/index.html` → `<root>/index.html`), matching the existing prompt convention.

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/tools.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTools } from './tools.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-tools-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function byName(root: string, name: string) {
  return buildTools(root).find((t) => t.name === name)!
}

describe('file tools', () => {
  it('write_file creates a file under root and read_file reads it back', async () => {
    const w = await byName(root, 'write_file').invoke({ path: '/index.html', content: '<h1>hi</h1>' })
    expect(readFileSync(join(root, 'index.html'), 'utf8')).toBe('<h1>hi</h1>')
    expect(String(w)).toMatch(/index\.html/)
    const r = await byName(root, 'read_file').invoke({ path: '/index.html' })
    expect(String(r)).toContain('<h1>hi</h1>')
  })

  it('edit_file replaces an exact string', async () => {
    writeFileSync(join(root, 'a.txt'), 'foo bar foo')
    await byName(root, 'edit_file').invoke({ path: '/a.txt', oldString: 'bar', newString: 'BAZ' })
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('foo BAZ foo')
  })

  it('ls lists immediate children', async () => {
    writeFileSync(join(root, 'x.txt'), '')
    mkdirSync(join(root, 'sub'))
    const out = String(await byName(root, 'ls').invoke({ path: '/' }))
    expect(out).toContain('x.txt')
    expect(out).toContain('sub')
  })

  it('rejects a path that escapes the root', async () => {
    await expect(byName(root, 'write_file').invoke({ path: '/../escape.txt', content: 'x' }))
      .resolves.toMatch(/escape|outside|root/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/sidecar && npx vitest run src/session/tools.test.ts`
Expected: FAIL — `Cannot find module './tools.js'`.

- [ ] **Step 3: Implement `tools.ts`**

Create `packages/sidecar/src/session/tools.ts`:

```ts
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { resolveWithin } from './workspace-fs.js'

/** Map a model-supplied "/abs-relative-to-root" path to a real fs path inside `root` (throws on escape). */
function real(root: string, p: string): string {
  const rel = p.replace(/^\/+/, '')
  return resolveWithin(root, path.join(root, rel))
}

/** Build the file-tool set sandboxed to `root`. Each returns a short string result for the model. */
export function buildTools(root: string): StructuredToolInterface[] {
  const writeFile = tool(
    async ({ path: p, content }) => {
      const abs = real(root, p)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, content, 'utf8')
      return `wrote ${p} (${content.length} bytes)`
    },
    {
      name: 'write_file',
      description:
        'Create or overwrite a file. `path` is absolute relative to the project root (e.g. "/index.html"). Returns a confirmation.',
      schema: z.object({ path: z.string(), content: z.string() }),
    },
  )

  const readFile = tool(
    async ({ path: p }) => {
      const abs = real(root, p)
      try {
        return await fs.readFile(abs, 'utf8')
      } catch {
        return `Error: file not found: ${p}`
      }
    },
    {
      name: 'read_file',
      description: 'Read a text file. `path` is absolute relative to the project root.',
      schema: z.object({ path: z.string() }),
    },
  )

  const editFile = tool(
    async ({ path: p, oldString, newString, replaceAll }) => {
      const abs = real(root, p)
      const cur = await fs.readFile(abs, 'utf8')
      if (!cur.includes(oldString)) return `Error: oldString not found in ${p}`
      const next = replaceAll ? cur.split(oldString).join(newString) : cur.replace(oldString, newString)
      await fs.writeFile(abs, next, 'utf8')
      return `edited ${p}`
    },
    {
      name: 'edit_file',
      description: 'Replace an exact substring in a file. Set replaceAll to replace every occurrence.',
      schema: z.object({
        path: z.string(),
        oldString: z.string(),
        newString: z.string(),
        replaceAll: z.boolean().optional(),
      }),
    },
  )

  const ls = tool(
    async ({ path: p }) => {
      const abs = real(root, p ?? '/')
      const ents = await fs.readdir(abs, { withFileTypes: true })
      return ents.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join('\n') || '(empty)'
    },
    {
      name: 'ls',
      description: 'List the immediate children of a directory. `path` defaults to "/".',
      schema: z.object({ path: z.string().optional() }),
    },
  )

  const glob = tool(
    async ({ pattern }) => {
      const out: string[] = []
      async function walk(dir: string): Promise<void> {
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) await walk(full)
          else {
            const rel = '/' + path.relative(root, full)
            if (simpleMatch(pattern, rel)) out.push(rel)
          }
        }
      }
      await walk(root)
      return out.sort().slice(0, 200).join('\n') || `No files match ${pattern}`
    },
    {
      name: 'glob',
      description: 'Find files by a glob-ish pattern (supports * and **). Returns up to 200 paths.',
      schema: z.object({ pattern: z.string() }),
    },
  )

  const grep = tool(
    async ({ pattern, path: p }) => {
      const re = new RegExp(pattern)
      const hits: string[] = []
      async function walk(dir: string): Promise<void> {
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) await walk(full)
          else {
            const rel = '/' + path.relative(root, full)
            const text = await fs.readFile(full, 'utf8').catch(() => '')
            text.split('\n').forEach((line, i) => {
              if (re.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`)
            })
          }
        }
      }
      await walk(real(root, p ?? '/'))
      return hits.slice(0, 200).join('\n') || `No matches for ${pattern}`
    },
    {
      name: 'grep',
      description: 'Search file contents by regex. Optional `path` scopes the search. Returns up to 200 `file:line` hits.',
      schema: z.object({ pattern: z.string(), path: z.string().optional() }),
    },
  )

  return [writeFile, readFile, editFile, ls, glob, grep]
}

/** Minimal glob: `**` matches any chars incl. `/`; `*` matches any chars except `/`. Anchored full-match. */
function simpleMatch(pattern: string, p: string): boolean {
  const rx = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ')
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '.*')
  return new RegExp(`^${rx.startsWith('/') ? '' : '.*'}${rx}$`).test(p)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/sidecar && npx vitest run src/session/tools.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/tools.ts packages/sidecar/src/session/tools.test.ts
git commit -m "feat(sidecar): sandboxed file tools (write/read/edit/ls/glob/grep) for the agent loop"
```

---

## Task 4: Single-agent system prompt (`system-prompt.ts`) + retire the forced-pipeline prompt

**Files:**
- Create: `packages/sidecar/src/session/system-prompt.ts`
- Test: `packages/sidecar/src/session/system-prompt.test.ts`
- Modify: `packages/sidecar/src/session/agents.ts`

The single capable coding agent: plan briefly, use tools to read/write real files, verify by reading back, never claim an unmade write, finish with a short summary. Keep the existing cwd-path convention and anti-phantom wording from `agents.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/system-prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from './system-prompt.js'

describe('buildSystemPrompt', () => {
  it('includes the cwd, the path convention, and the anti-phantom rule', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).toContain('/tmp/proj')
    expect(s).toContain('write_file')
    expect(s).toMatch(/MUST NOT claim/i)
  })

  it('appends per-conversation user instructions when present', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', userInstructions: 'Always answer in French.' })
    expect(s).toContain('Always answer in French.')
  })

  it('omits the user-instructions section when blank', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', userInstructions: '   ' })
    expect(s).not.toMatch(/Additional instructions/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/sidecar && npx vitest run src/session/system-prompt.test.ts`
Expected: FAIL — `Cannot find module './system-prompt.js'`.

- [ ] **Step 3: Implement `system-prompt.ts`**

Create `packages/sidecar/src/session/system-prompt.ts`:

```ts
const ANTI_PHANTOM =
  'You MUST NOT claim, state, or imply any file was created, written, saved, or modified ' +
  'unless you actually called write_file/edit_file for that exact path this turn and it succeeded. ' +
  'If you did not call a write tool, say plainly that no file was created.'

const BASE =
  'You are a capable coding assistant working directly in a project. ' +
  'You have real file tools — read_file, write_file, edit_file, ls, glob, grep — operating on the ' +
  'project directory. Use them to do the work yourself: read what you need, write actual files, then ' +
  'verify by reading the result back. Do not ask the user to do steps you can do with your tools. ' +
  'When the task is done, finish with a short plain-text summary of what you changed. ' +
  'For a simple request, just do it directly — do not over-plan.'

function cwdBlock(cwd: string): string {
  return (
    `Your working directory is the project root \`${cwd}\`. Filesystem tools are sandboxed to it. ` +
    'Address every path as an absolute path starting with `/`, relative to this root — ' +
    `e.g. write to \`/index.html\` (maps to \`${cwd}/index.html\`). ` +
    'Never use `/workspace`, `/tmp`, `/home`, or any path outside this root.'
  )
}

export interface SystemPromptInput {
  cwd: string
  userInstructions?: string
}

/** Assemble the single-agent system prompt: base + cwd convention + anti-phantom (+ optional user instructions). */
export function buildSystemPrompt({ cwd, userInstructions }: SystemPromptInput): string {
  const base = `${BASE}\n\n${cwdBlock(cwd)}\n\n${ANTI_PHANTOM}`
  const extra = userInstructions?.trim()
  return extra
    ? `${base}\n\n## Additional instructions from the user (for this conversation)\n${extra}`
    : base
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/sidecar && npx vitest run src/session/system-prompt.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Slim `agents.ts` down to the role mapping**

The forced-pipeline prompts (`SUPERVISOR_BASE`, `CODER_BASE`, `buildSubagents`, `buildSupervisorPrompt`) are no longer used. Replace the whole body of `packages/sidecar/src/session/agents.ts` with just the role helper that `tool-trace.ts` / `session.ts` still need:

```ts
import type { AgentRole } from '@hip/protocol'

const NAME_TO_ROLE: Record<string, AgentRole> = { planner: 'planner', coder: 'coder', reviewer: 'reviewer' }

/** Map a sub-agent name to its role; defaults to 'supervisor' (the primary loop). */
export function roleForName(name: string | undefined): AgentRole {
  return name && name in NAME_TO_ROLE ? NAME_TO_ROLE[name] : 'supervisor'
}
```

- [ ] **Step 6: Run the full sidecar unit suite to catch dangling imports**

Run: `cd packages/sidecar && npx vitest run src/session/system-prompt.test.ts src/session/tools.test.ts`
Expected: PASS. (Broken imports of the removed exports are fixed in Task 8; if `agents.test.ts` exists and references them, delete those obsolete cases now.)

- [ ] **Step 7: Commit**

```bash
git add packages/sidecar/src/session/system-prompt.ts packages/sidecar/src/session/system-prompt.test.ts packages/sidecar/src/session/agents.ts
git commit -m "feat(sidecar): single-agent system prompt; retire forced planner/coder/reviewer pipeline prompts"
```

---

## Task 5: Loop-control constants & helpers (`loop-control.ts`)

**Files:**
- Create: `packages/sidecar/src/session/loop-control.ts`
- Test: `packages/sidecar/src/session/loop-control.test.ts`

Pure pieces the graph needs: the step cap (`MAX_STEPS = 25`, OpenCode's value), the max-steps directive injected when the cap is hit, and the `recursionLimit` we hand LangGraph (must exceed `2*MAX_STEPS`).

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/loop-control.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MAX_STEPS, MAX_STEPS_NOTE, recursionLimit } from './loop-control.js'

describe('loop-control', () => {
  it('caps steps at 25 and reserves graph recursion headroom above 2x', () => {
    expect(MAX_STEPS).toBe(25)
    expect(recursionLimit()).toBeGreaterThan(MAX_STEPS * 2)
  })

  it('the max-steps note tells the model tools are disabled and to answer in text', () => {
    expect(MAX_STEPS_NOTE).toMatch(/maximum/i)
    expect(MAX_STEPS_NOTE).toMatch(/text/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/sidecar && npx vitest run src/session/loop-control.test.ts`
Expected: FAIL — `Cannot find module './loop-control.js'`.

- [ ] **Step 3: Implement `loop-control.ts`**

Create `packages/sidecar/src/session/loop-control.ts`:

```ts
/** Max model turns per user turn before the loop is forced to finish (OpenCode's value). */
export const MAX_STEPS = 25

/** Injected as a system message on the final step: tools are off, answer in text only. */
export const MAX_STEPS_NOTE =
  'MAXIMUM STEPS REACHED. Tools are now disabled. Do not attempt any tool call. ' +
  'Respond with a short plain-text summary of what you have done so far and what remains.'

/** LangGraph recursion limit. Each model turn is ~2 node visits (agent + tools), so reserve headroom
 *  above 2*MAX_STEPS; our own step cap (not this limit) is the real stop condition. */
export function recursionLimit(): number {
  return MAX_STEPS * 2 + 5
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/sidecar && npx vitest run src/session/loop-control.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/loop-control.ts packages/sidecar/src/session/loop-control.test.ts
git commit -m "feat(sidecar): loop-control constants (step cap + max-steps directive)"
```

---

## Task 6: Model runner (`model-runner.ts`)

**Files:**
- Create: `packages/sidecar/src/session/model-runner.ts`
- Test: `packages/sidecar/src/session/model-runner.test.ts`

Isolate the one risky piece — streaming text + reasoning out of `ReasoningChatOpenAI` and gathering the final `AIMessage` (incl. tool calls) — behind a `ModelRunner` interface. The graph (Task 7) depends only on the interface, so its control flow is testable with a fake. The pure delta extractors are unit-tested here; the live `RealModelRunner` is validated by the Task 2 spike.

- [ ] **Step 1: Write the failing test (pure extractors)**

Create `packages/sidecar/src/session/model-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { AIMessageChunk } from '@langchain/core/messages'
import { textDelta, reasoningDelta } from './model-runner.js'

describe('delta extractors', () => {
  it('textDelta reads plain-string content', () => {
    expect(textDelta(new AIMessageChunk({ content: 'hello' }))).toBe('hello')
  })

  it('textDelta reads text blocks from array content', () => {
    const c = new AIMessageChunk({ content: [{ type: 'text', text: 'hi' } as any] })
    expect(textDelta(c)).toBe('hi')
  })

  it('reasoningDelta reads reasoning blocks from array content', () => {
    const c = new AIMessageChunk({ content: [{ type: 'reasoning', reasoning: 'because' } as any] })
    expect(reasoningDelta(c)).toBe('because')
  })

  it('reasoningDelta falls back to additional_kwargs.reasoning_content for string content', () => {
    const c = new AIMessageChunk({ content: '', additional_kwargs: { reasoning_content: 'why' } as any })
    expect(reasoningDelta(c)).toBe('why')
  })

  it('reasoningDelta is empty for plain text', () => {
    expect(reasoningDelta(new AIMessageChunk({ content: 'hi' }))).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/sidecar && npx vitest run src/session/model-runner.test.ts`
Expected: FAIL — `Cannot find module './model-runner.js'`.

- [ ] **Step 3: Implement `model-runner.ts`**

> Adjust `textDelta`/`reasoningDelta` if the Task 2 spike recorded a different shape. The version below matches the `ReasoningChatOpenAI` re-projection in `session.ts` (reasoning → a `{type:'reasoning'}` content block; text → `{type:'text'}`/string).

Create `packages/sidecar/src/session/model-runner.ts`:

```ts
import type { AIMessage, AIMessageChunk, BaseMessage } from '@langchain/core/messages'
import { SystemMessage } from '@langchain/core/messages'
import { concat } from '@langchain/core/utils/stream'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ChatOpenAI } from '@langchain/openai'
import { MAX_STEPS_NOTE } from './loop-control.js'

/** Per-step run options: the streaming sinks + whether tools are bound (off on the final, capped step). */
export interface ModelRunOptions {
  tools: StructuredToolInterface[]
  bindTools: boolean
  signal?: AbortSignal
  onText: (delta: string) => void
  onReasoning: (delta: string) => void
}

/** One model turn: stream deltas to the sinks, return the gathered assistant message (with tool_calls). */
export interface ModelRunner {
  run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage>
}

/** Per-chunk text delta: plain string, or the text blocks of array content. */
export function textDelta(chunk: AIMessageChunk): string {
  if (typeof chunk.content === 'string') return chunk.content
  return chunk.content
    .filter((b): b is { type: 'text'; text: string } => (b as { type?: string }).type === 'text')
    .map((b) => b.text)
    .join('')
}

/** Per-chunk reasoning delta: reasoning blocks of array content, else additional_kwargs.reasoning_content. */
export function reasoningDelta(chunk: AIMessageChunk): string {
  if (Array.isArray(chunk.content)) {
    const fromBlocks = chunk.content
      .filter((b): b is { type: 'reasoning'; reasoning: string } => (b as { type?: string }).type === 'reasoning')
      .map((b) => b.reasoning)
      .join('')
    if (fromBlocks) return fromBlocks
  }
  const rc = (chunk.additional_kwargs as { reasoning_content?: unknown } | undefined)?.reasoning_content
  return typeof rc === 'string' ? rc : ''
}

/** Production runner over a ChatOpenAI/ReasoningChatOpenAI instance. */
export class RealModelRunner implements ModelRunner {
  constructor(private readonly model: ChatOpenAI) {}

  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    const bound = opts.bindTools ? this.model.bindTools(opts.tools) : this.model
    const input: BaseMessage[] = opts.bindTools ? messages : [...messages, new SystemMessage(MAX_STEPS_NOTE)]
    const stream = await bound.stream(input, { signal: opts.signal })
    let gathered: AIMessageChunk | undefined
    for await (const chunk of stream) {
      gathered = gathered ? concat(gathered, chunk) : chunk
      const t = textDelta(chunk)
      if (t) opts.onText(t)
      const r = reasoningDelta(chunk)
      if (r) opts.onReasoning(r)
    }
    if (!gathered) throw new Error('model produced no output')
    return gathered as AIMessage
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/sidecar && npx vitest run src/session/model-runner.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/model-runner.ts packages/sidecar/src/session/model-runner.test.ts
git commit -m "feat(sidecar): ModelRunner — stream text/reasoning + gather tool calls behind a testable interface"
```

---

## Task 7: The agent-loop graph (`graph.ts`)

**Files:**
- Create: `packages/sidecar/src/session/graph.ts`
- Test: `packages/sidecar/src/session/graph.test.ts`

The `StateGraph`. State = `messages` (+ reducer) and `steps`. The `agent` node runs one model turn via the injected `ModelRunner` and a per-turn emit context; the `tools` node executes the last message's tool calls and appends `ToolMessage`s. Routing: tool calls + under cap → `tools`; else → `END`. At the cap, the agent node binds no tools so the model must answer in text. Tested with a **fake** `ModelRunner`.

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/graph.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { buildTools } from './tools.js'
import { buildGraph, type GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'

/** Fake runner: returns the scripted message for each successive turn. */
function fakeRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      const m = script[Math.min(i, script.length - 1)]
      i++
      // emit a token so streaming wiring is exercised
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {} }

describe('agent loop graph', () => {
  it('stops immediately when the model returns a plain text answer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hip-graph-'))
    try {
      const app = buildGraph()
      const runner = fakeRunner([new AIMessage('你好，我是助手')])
      const out = await app.invoke(
        { messages: [new HumanMessage('你是谁')], steps: 0 },
        { configurable: { ctx: { runner, tools: buildTools(root), emit: noopEmit } } },
      )
      const last = out.messages[out.messages.length - 1] as AIMessage
      expect(last.content).toBe('你好，我是助手')
      expect(out.steps).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('executes a write_file tool call then loops back and finishes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hip-graph-'))
    try {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({
          content: '',
          tool_calls: [{ name: 'write_file', args: { path: '/index.html', content: '<h1>me</h1>' }, id: 'c1' }],
        }),
        new AIMessage('已创建 /index.html'),
      ])
      const started: string[] = []
      const out = await app.invoke(
        { messages: [new HumanMessage('做个 HTML 自我介绍')], steps: 0 },
        {
          configurable: {
            ctx: {
              runner,
              tools: buildTools(root),
              emit: { ...noopEmit, toolStarted: (n: string) => started.push(n) },
            },
          },
        },
      )
      // the file was actually written
      expect(readFileSync(join(root, 'index.html'), 'utf8')).toBe('<h1>me</h1>')
      // tools node ran for write_file, loop did 2 model turns, ended on text
      expect(started).toContain('write_file')
      expect(out.steps).toBe(2)
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('已创建 /index.html')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('terminates at the step cap even if the model keeps requesting tools', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hip-graph-'))
    try {
      const app = buildGraph(2) // tiny cap for the test
      // always asks for a tool; the cap must stop it
      const loopMsg = new AIMessage({
        content: '',
        tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }],
      })
      const runner = fakeRunner([loopMsg])
      const out = await app.invoke(
        { messages: [new HumanMessage('spin')], steps: 0 },
        { configurable: { ctx: { runner, tools: buildTools(root), emit: noopEmit } }, recursionLimit: 50 },
      )
      expect(out.steps).toBeLessThanOrEqual(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/sidecar && npx vitest run src/session/graph.test.ts`
Expected: FAIL — `Cannot find module './graph.js'`.

- [ ] **Step 3: Implement `graph.ts`**

Create `packages/sidecar/src/session/graph.ts`:

```ts
import { StateGraph, Annotation, START, END, messagesStateReducer } from '@langchain/langgraph'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ModelRunner } from './model-runner.js'
import { MAX_STEPS } from './loop-control.js'

/** Streaming sinks the graph emits through (wired to the WS layer in session.ts). */
export interface GraphEmit {
  token(delta: string): void
  reasoning(delta: string): void
  toolStarted(name: string, callId: string, input: unknown): void
  toolFinished(callId: string, status: 'finished' | 'error', output?: string, error?: string): void
}

/** Per-turn context passed via config.configurable.ctx (keeps the compiled graph reusable). */
export interface GraphCtx {
  runner: ModelRunner
  tools: StructuredToolInterface[]
  emit: GraphEmit
}

const LoopState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  steps: Annotation<number>({ reducer: (_prev, next) => next, default: () => 0 }),
})

type State = typeof LoopState.State

function ctxOf(config: LangGraphRunnableConfig): GraphCtx {
  const ctx = (config.configurable as { ctx?: GraphCtx } | undefined)?.ctx
  if (!ctx) throw new Error('graph invoked without configurable.ctx')
  return ctx
}

/** Build the agent-loop graph. `maxSteps` is injectable for tests. */
export function buildGraph(maxSteps: number = MAX_STEPS) {
  async function agent(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    const { runner, tools, emit } = ctxOf(config)
    const capped = state.steps >= maxSteps - 1 // last allowed step: no tools, force text
    const msg = await runner.run(state.messages, {
      tools,
      bindTools: !capped,
      signal: config.signal,
      onText: (d) => emit.token(d),
      onReasoning: (d) => emit.reasoning(d),
    })
    return { messages: [msg], steps: state.steps + 1 }
  }

  async function toolsNode(state: State, config: LangGraphRunnableConfig): Promise<Partial<State>> {
    const { tools, emit } = ctxOf(config)
    const byName = new Map(tools.map((t) => [t.name, t]))
    const last = state.messages[state.messages.length - 1] as AIMessage
    const out: ToolMessage[] = []
    for (const call of last.tool_calls ?? []) {
      const id = call.id ?? call.name
      emit.toolStarted(call.name, id, call.args)
      const t = byName.get(call.name)
      if (!t) {
        emit.toolFinished(id, 'error', undefined, `unknown tool: ${call.name}`)
        out.push(new ToolMessage({ content: `Error: unknown tool ${call.name}`, tool_call_id: id, name: call.name }))
        continue
      }
      try {
        const result = String(await t.invoke(call.args))
        emit.toolFinished(id, 'finished', result)
        out.push(new ToolMessage({ content: result, tool_call_id: id, name: call.name }))
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        emit.toolFinished(id, 'error', undefined, error)
        out.push(new ToolMessage({ content: `Error: ${error}`, tool_call_id: id, name: call.name }))
      }
    }
    return { messages: out }
  }

  function route(state: State): 'tools' | typeof END {
    const last = state.messages[state.messages.length - 1] as AIMessage
    const wantsTools = (last.tool_calls?.length ?? 0) > 0
    if (wantsTools && state.steps < maxSteps) return 'tools'
    return END
  }

  return new StateGraph(LoopState)
    .addNode('agent', agent)
    .addNode('tools', toolsNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', route, { tools: 'tools', [END]: END })
    .addEdge('tools', 'agent')
    .compile()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/sidecar && npx vitest run src/session/graph.test.ts`
Expected: PASS (3 tests). The capped test ends because once `steps >= maxSteps-1` the agent binds no tools, the fake still returns a tool message, but `route` sees `steps >= maxSteps` and returns `END`.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/graph.ts packages/sidecar/src/session/graph.test.ts
git commit -m "feat(sidecar): agent-loop StateGraph (agent<->tools cycle + step cap)"
```

---

## Task 8: Wire the graph into `Session` (`session.ts`)

**Files:**
- Modify: `packages/sidecar/src/session/session.ts`
- Test: `packages/sidecar/src/session/session-loop.test.ts`

Replace deepagents in `buildAgent`/`runTurn`. Build the graph + tools + `RealModelRunner`; drive it with `app.invoke`, emitting the existing protocol events through a `GraphEmit` that feeds the existing `trajectory`/`recorder`/`ReasoningTracker`, then reuse `finalizeAndPersist` verbatim. The single primary loop reports under `agentId='supervisor'`.

- [ ] **Step 1: Write the failing integration test (fake model, real file write end-to-end)**

Create `packages/sidecar/src/session/session-loop.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { ServerMessage } from '@hip/protocol'

function fakeRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_m: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      const m = script[Math.min(i, script.length - 1)]; i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-sess-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('Session agent loop', () => {
  it('writes the requested file and reports success (no phantom)', async () => {
    const runner = fakeRunner([
      new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: '/intro.html', content: '<h1>hi</h1>' }, id: 'c1' }] }),
      new AIMessage('已创建 /intro.html，里面是一个简单的自我介绍页面。'),
    ])
    // Session accepts an injected ModelRunner (4th-ish ctor arg) for tests — see Step 3.
    const session = new Session('s1', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)
    const sent: ServerMessage[] = []
    await session.sendMessage('用一个 HTML 做个自我介绍', (m) => sent.push(m))

    expect(existsSync(join(root, 'intro.html'))).toBe(true)
    expect(readFileSync(join(root, 'intro.html'), 'utf8')).toBe('<h1>hi</h1>')

    const complete = sent.find((m) => m.type === 'message:complete') as Extract<ServerMessage, { type: 'message:complete' }>
    expect(complete.message.content).toContain('intro.html')
    // a tool:started for write_file was emitted
    expect(sent.some((m) => m.type === 'tool:started' && (m as any).name === 'write_file')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/sidecar && npx vitest run src/session/session-loop.test.ts`
Expected: FAIL — `Session` constructor has no `runner` param yet / still uses deepagents.

- [ ] **Step 3: Rewrite the deepagents-specific parts of `session.ts`**

Make these edits to `packages/sidecar/src/session/session.ts`:

(a) **Imports** — replace the deepagents/agents imports near the top:

```ts
// remove:  import { createDeepAgent, FilesystemBackend } from 'deepagents'
// remove:  import { buildSubagents, buildSupervisorPrompt, roleForName } from './agents.js'
import { roleForName } from './agents.js'
import { buildGraph, type GraphEmit, type GraphCtx } from './graph.js'
import { buildTools } from './tools.js'
import { buildSystemPrompt } from './system-prompt.js'
import { RealModelRunner, type ModelRunner } from './model-runner.js'
import { SystemMessage } from '@langchain/core/messages'
import { recursionLimit } from './loop-control.js'
```

(b) **Fields + constructor** — add an injectable runner and graph handle. Add to the class fields:

```ts
private app!: ReturnType<typeof buildGraph>
private readonly injectedRunner?: ModelRunner
```

Add a final optional `runner` parameter to the constructor and store it (place it after the existing params):

```ts
constructor(
  readonly id: string,
  config: SessionConfig,
  model?: BaseLanguageModel,
  private readonly store?: SessionStore,
  titleGenerator?: TitleGenerator,
  private readonly idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
  runner?: ModelRunner,
) {
  this._config = config
  this.injectedModel = model
  this.injectedRunner = runner
  this.usesEnvModel = !model
  this.titleGenerator = titleGenerator ?? (this.usesEnvModel ? buildDefaultTitleGenerator(config) : undefined)
  this.buildAgent()
}
```

(c) **`buildAgent`** — replace its body (drop `createDeepAgent`/`FilesystemBackend`; compile the graph once):

```ts
private buildAgent(): void {
  this.app = buildGraph()
}
```

(d) **A runner factory** — add a small helper (near `buildModel`):

```ts
/** The ModelRunner for this turn: injected (tests) or a RealModelRunner over the built ChatOpenAI. */
private modelRunner(): ModelRunner {
  if (this.injectedRunner) return this.injectedRunner
  const model = (this.injectedModel as ChatOpenAI | undefined) ?? buildModel(this._config)
  return new RealModelRunner(model)
}
```

(Add `import type { ChatOpenAI } from '@langchain/openai'` if not already imported.)

(e) **`runTurn`** — replace the deepagents streaming block. Keep the watchdog/abort/finalize scaffolding; swap the `this.agent.streamEvents(...)` + pump section for a graph invocation. Replace the body from `ensureStarted('supervisor', 'supervisor')` through the `await Promise.all([...]); await Promise.allSettled(pending); finishRemaining()` lines with:

```ts
ensureStarted('supervisor', 'supervisor')
const cwd = this._config.cwd ?? process.cwd()
const tools = buildTools(cwd)
const system = buildSystemPrompt({ cwd, userInstructions: this._config.systemPrompt })

const emit: GraphEmit = {
  token: (delta) => {
    if (!delta) return
    supervisorText += delta
    const r = trajectory.get('supervisor'); if (r) r.output += delta
    send({ type: 'token:stream', sessionId: this.id, turnId, agentId: 'supervisor', delta })
  },
  reasoning: (delta) => reasoningDelta('supervisor', 'supervisor', delta),
  toolStarted: (name, callId, input) => {
    closeReasoning('supervisor')
    const seq = nextSeq()
    const inClip = clip(stringify(input))
    recorder.start('supervisor', callId, name, inClip.text, seq, inClip.truncated)
    send({ type: 'tool:started', sessionId: this.id, turnId, agentId: 'supervisor', role: 'supervisor', callId, name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) })
  },
  toolFinished: (callId, status, output, error) => {
    const outClip = output !== undefined ? clip(stringify(output)) : undefined
    recorder.finish('supervisor', callId, status, outClip?.text, error, outClip?.truncated ?? false)
    send({ type: 'tool:finished', sessionId: this.id, turnId, agentId: 'supervisor', callId, status, ...(outClip ? { output: outClip.text } : {}), ...(error ? { error } : {}), ...(outClip?.truncated ? { truncated: true } : {}) })
  },
}

const ctx: GraphCtx = { runner: this.modelRunner(), tools, emit }
try {
  await this.app.invoke(
    { messages: [new SystemMessage(system), ...this.messages], steps: 0 },
    { configurable: { ctx }, signal: this.abortController.signal, recursionLimit: recursionLimit() },
  )
  closeReasoning('supervisor')
  finishRemaining()
} catch (err) { /* keep the existing catch block below unchanged */
```

> Notes for the editor:
> - `clip` / `stringify` are already imported from `./tool-trace.js` in `session.ts`; if not, add them.
> - `nextSeq`, `recorder`, `reasoningDelta`, `closeReasoning`, `trajectory`, `finishRemaining`, `supervisorText`, `send`, `turnId` are all already defined locally in `runTurn` — reuse them as-is.
> - The graph emits tool events synchronously, so the old `pending` array and `Promise.allSettled(pending)` are no longer needed for tools; you may delete `pending` and the `consumeToolCalls` import. The existing `catch (err) { ... }` / `finally { ... }` / `return this.finalizeAndPersist(...)` tail stays exactly as-is.

(f) **Delete now-dead code**: the `pumpSupervisor`/`pumpSubagents` closures, the `StreamedMessage` type, the `safeTaskInput` helper, and the `consumeToolCalls` import.

- [ ] **Step 4: Run the integration test to verify it passes**

Run: `cd packages/sidecar && npx vitest run src/session/session-loop.test.ts`
Expected: PASS — the file exists on disk under `root`, `message:complete` content mentions `intro.html`, a `tool:started` for `write_file` was emitted.

- [ ] **Step 5: Run the full non-LLM sidecar suite (no regressions)**

Run: `cd packages/sidecar && npx vitest run src/session/tools.test.ts src/session/system-prompt.test.ts src/session/loop-control.test.ts src/session/model-runner.test.ts src/session/graph.test.ts src/session/session-loop.test.ts`
Expected: PASS. (Use this explicit file list — a bare `vitest run src` substring-matches paid real-LLM suites; see the project memory note.)

- [ ] **Step 6: Typecheck the sidecar**

Run: `cd packages/sidecar && npx tsc --noEmit`
Expected: no errors. Fix any dangling references to removed deepagents exports.

- [ ] **Step 7: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-loop.test.ts
git commit -m "feat(sidecar): drive turns through the agent-loop graph; retire deepagents supervisor"
```

---

## Task 9: Manual GUI acceptance (the original failing scenario)

**Files:** none (manual, per the project's "prefer GUI for the live LLM path" policy).

- [ ] **Step 1: Launch the app**

Run: `scripts/dev.sh start` then `scripts/dev.sh logs app` (follow logs). Ensure a DeepSeek key is set in Settings (`~/.hip/config/auth.json`).

- [ ] **Step 2: Reproduce the original prompt**

In a new conversation, send: `用一个 HTML 做个自我介绍，简短一点`.
Expected: the agent calls `write_file` (visible as a tool step in the trace), an HTML file is actually created in the session workspace, and the final reply truthfully reports the created file. Confirm the file exists via the right-panel file tree / `ls ~/.hip/scratch/<id>/`.

- [ ] **Step 3: Sanity-check conversational + status turns**

Send `你是谁`, then mid-task `你在做什么`.
Expected: `你是谁` is answered directly with no tool calls; status questions are answered coherently without the old "让我重新…" dead loop.

- [ ] **Step 4: Stop the app**

Run: `scripts/dev.sh stop`

---

## Self-review notes (done by the plan author)

- **Spec coverage (P1 scope):** single loop replacing pipeline (Tasks 7–8) ✓; LangGraph self-built ReAct (Task 7) ✓; file tools sandboxed to cwd (Task 3) ✓; step cap + max-steps directive (Tasks 5, 7) ✓; system-prompt assembly + anti-phantom retained (Task 4) ✓; reuse streaming/trace/persistence/protocol (Task 8) ✓; deterministic non-LLM tests + GUI acceptance (Tasks 3–9) ✓. Deferred by design: HITL interrupt, doom-loop, retry, compaction (P2); `write_todos`, `task` subagents, todo UI (P3) — each gets its own plan.
- **Type consistency:** `GraphEmit`/`GraphCtx` defined in Task 7 are imported in Task 8; `ModelRunner`/`ModelRunOptions` defined in Task 6 are used in Tasks 7–8; `buildTools`/`buildSystemPrompt`/`roleForName`/`MAX_STEPS`/`recursionLimit` names match across tasks.
- **No placeholders:** every code step contains complete code; test commands give expected output.
- **Risk flagged inline:** Task 2 spike validates the R1/R2 streaming/tool-calling assumptions before Task 6's extractors are trusted; Task 6 says to adjust the extractors if the spike disagrees.
