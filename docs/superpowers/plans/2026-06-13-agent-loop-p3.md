# Agent-Loop Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the single LangGraph ReAct loop three capabilities — a live turn-scoped planning checklist (`write_todos`), a general model-driven `task` sub-agent, and token/cost visibility — reusing the dormant trace/delegation/persistence substrate.

**Architecture:** One combined phase, built in dependency order **A → C → B**. A (`write_todos`) rides on the existing tool-call pipeline (no new event/state). C (token/cost) captures provider `usage_metadata`, accumulates per-agent, persists on `agent_runs`, and computes $ cost renderer-side. B (`task` sub-agent) activates the existing delegation UI via a `spawnSubagent` closure (depth-1, sequential, shared cwd+abort, new `'worker'` role); its child runs flow through C's capture so sub-agent usage is counted for free.

**Tech Stack:** Tauri v2 + Node.js sidecar (ESM), LangGraph/LangChain, DeepSeek (OpenAI-compatible), `@hip/protocol` (consumed as source), React + Zustand + i18next frontend, better-sqlite3 persistence, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-agent-loop-p3-design.md`

---

## ⚠️ Test safety (READ FIRST — this machine has a LIVE PAID DeepSeek key)

- NEVER run a bare `vitest run`, `vitest run src…`, or any glob — they substring-match paid live-LLM suites.
- NEVER run `packages/sidecar/src/session/session.test.ts` or `reasoner-reasoning.integration.test.ts` (paid).
- ALWAYS pass explicit non-LLM file paths. Graph/sub-agent tests inject a FAKE `ModelRunner` (never `RealModelRunner`/a real `ChatOpenAI`), so `buildGraph.invoke` runs fully local. Store/sqlite and pure-logic tests are safe.
- Sidecar typecheck: `cd packages/sidecar && npx tsc --noEmit`. Frontend typecheck: `npm run type-check`. Frontend tests (`npm run test -- <path>`) are not paid.

---

## File structure

**Create**

- `src/lib/todos.ts`
- `src/lib/todos.test.ts`
- `packages/sidecar/src/session/usage.ts`
- `packages/sidecar/src/session/usage.test.ts`
- `src/lib/usageCost.ts`
- `src/lib/usageCost.test.ts`
- `src/domain/usageTotal.test.ts`
- `packages/sidecar/src/session/subagent.ts`
- `packages/sidecar/src/session/subagent.test.ts`
- `src/lib/timelineFilter.ts`
- `src/lib/timelineFilter.test.ts`

**Modify**

- `packages/sidecar/src/session/tools.ts` (buildTools return at L182, add new tool before the return; L31,182-183 buildTools signature + conditional task append; imports tool/StructuredToolInterface/z already present)
- `packages/sidecar/src/session/system-prompt.ts` (BASE const L6-12; L1-35 add childSystemPrompt export)
- `src/components/chat/TurnTimeline.tsx` (imports L1-7; component body L66-105; L7,93-101 import + skip task tool steps via the helper)
- `src/i18n/en.ts` (chat namespace, after styleEmpty L51; chat block, after styleEmpty ~line 51; L87 artifact.roles)
- `src/i18n/zh-CN.ts` (chat namespace, after styleEmpty L51; chat block, after styleEmpty ~line 51; L87 artifact.roles)
- `src/i18n/zh-TW.ts` (chat namespace, after styleEmpty L51; chat block, after styleEmpty ~line 51; L87 artifact.roles)
- `packages/protocol/src/index.ts` (Message ~L39-49, AgentRun ~L51-62, ToolCall ~L66-76, add TurnUsage near them; L1 AgentRole union; refresh stale comments on ToolCall.name/agentId, AgentRun.parentAgentId at lines 59,69)
- `packages/sidecar/src/session/graph.ts` (GraphEmit ~L11-16, agent node ~L53-64)
- `packages/sidecar/src/session/session.ts` (buildModel ~L150-157; runTurn ~L394-514: replace inline emit with makeEmit + accumulator; finalizeAndPersist ~L518-540: attach usage; L14,17,431-444,449-473 import runSubagent/CHILD_MAX_STEPS; add ensureFinished; build spawnSubagent; pass into buildTools; supervisor emit via makeEmit)
- `packages/sidecar/src/persistence/schema.ts` (migrate ~L44-118: add version<6 block)
- `packages/sidecar/src/persistence/store.ts` (insertTurn ~L52-82, loadAgentRuns ~L104-113, loadMessagesWithRuns ~L117-130)
- `src/domain/hooks.ts` (add selectUsageTotal + useActiveUsageTotal)
- `src/domain/index.ts` (re-export useActiveUsageTotal, line 3)
- `src/components/chat/MessageBubble.tsx` (footer next to MessageActions, ~line 65)
- `src/components/chat/ChatHeader.tsx` (session-total chip, ~line 56)
- `src/lib/roleColor.ts` (4-17: ROLE_COLOR, ROLE_NAME_KEY)
- `src/styles/tokens.css` (24-28: --role-* block)
- `packages/sidecar/src/session/loop-control.ts` (1-14: CHILD_MAX_STEPS const; recursionLimit signature)
- `packages/sidecar/src/session/agents.ts` (DELETE via git rm — P3-J3, roleForName unused)
- `packages/sidecar/src/session/agents.test.ts` (DELETE via git rm — P3-J3)

**Test**

- `packages/sidecar/src/session/tools.test.ts`
- `packages/sidecar/src/session/system-prompt.test.ts`
- `src/lib/todos.test.ts`
- `packages/sidecar/src/session/graph.test.ts`
- `packages/sidecar/src/session/usage.test.ts`
- `packages/sidecar/src/persistence/store.test.ts`
- `src/lib/usageCost.test.ts`
- `src/domain/usageTotal.test.ts`
- `src/lib/roleColor.test.ts` (NEW — exhaustiveness guard)
- `packages/sidecar/src/session/loop-control.test.ts` (1-14: extend)
- `packages/sidecar/src/session/subagent.test.ts` (NEW)
- `src/lib/timelineFilter.test.ts` (NEW)

---

## Feature A — write_todos

### Task 1: Add write_todos tool to buildTools + reconcile system-prompt to introduce it

**Files:**
- Modify: packages/sidecar/src/session/tools.ts (buildTools return at L182, add new tool before the return)
- Modify: packages/sidecar/src/session/system-prompt.ts (BASE const L6-12)
- Modify: packages/sidecar/src/session/tools.test.ts (add write_todos cases)
- Modify: packages/sidecar/src/session/system-prompt.test.ts (add write_todos assertion)
- Test: packages/sidecar/src/session/tools.test.ts
- Test: packages/sidecar/src/session/system-prompt.test.ts

`write_todos` is a **pure** tool (no filesystem I/O): it validates a todo list against a schema and returns a one-line confirmation. The model uses it to publish/replace a turn-scoped plan; the renderer (Task 2) reads `ToolCall.input` of the latest call. Per locked decision D1 there is NO new protocol event, NO SessionVM field — state lives entirely in the tool-call input persisted via `tool_calls`.

### Step 1 — Write a failing unit test for the tool

Append these cases to `packages/sidecar/src/session/tools.test.ts` (the existing `byName(root, name)` helper already resolves a tool by name from `buildTools(root)`):

```ts
  it('write_todos returns a one-line confirmation with the count', async () => {
    const out = String(
      await byName(root, 'write_todos').invoke({
        todos: [
          { content: 'read the spec', status: 'completed' },
          { content: 'implement the tool', status: 'in_progress' },
          { content: 'write tests', status: 'pending' },
        ],
      }),
    )
    expect(out).toMatch(/3/)
    expect(out).toMatch(/todo/i)
    expect(out.split('\n')).toHaveLength(1)
  })

  it('write_todos accepts an empty list (clears the plan)', async () => {
    const out = String(await byName(root, 'write_todos').invoke({ todos: [] }))
    expect(out).toMatch(/0/)
  })

  it('write_todos rejects an invalid status', async () => {
    await expect(
      byName(root, 'write_todos').invoke({ todos: [{ content: 'x', status: 'blocked' }] }),
    ).rejects.toThrow()
  })
```

Note: LangChain's `tool()` validates the args against the zod `schema` before the handler runs, so an invalid `status` rejects the `.invoke()` promise (hence `.rejects.toThrow()`, matching the existing style where escape-path cases `.resolves.toMatch` because those are handler-level returns, not schema rejections).

### Step 2 — Run the test, expect FAIL

```
cd packages/sidecar && npx vitest run src/session/tools.test.ts
```

Expected: the three new cases FAIL — `byName(root, 'write_todos')` returns `undefined` (no such tool yet), so `.invoke` throws `Cannot read properties of undefined`.

### Step 3 — Implement the tool in buildTools

In `packages/sidecar/src/session/tools.ts`, add the tool definition just before the `return [...]` (currently line 182). The file already imports `tool` and `z` at the top. Insert:

```ts
  const writeTodos = tool(
    async ({ todos }) => {
      const done = todos.filter((t) => t.status === 'completed').length
      return `Updated todo list (${todos.length} item${todos.length === 1 ? '' : 's'}, ${done} done).`
    },
    {
      name: 'write_todos',
      description:
        'Publish or replace your plan for THIS turn as a checklist. Call it once at the start of a ' +
        'multi-step task and again whenever the plan changes — each call REPLACES the whole list. ' +
        '`todos` is an ordered array of { content, status } where status is "pending", "in_progress", ' +
        'or "completed". Keep at most one item "in_progress". Skip this for simple, single-step requests.',
      schema: z.object({
        todos: z.array(
          z.object({
            content: z.string(),
            status: z.enum(['pending', 'in_progress', 'completed']),
          }),
        ),
      }),
    },
  )
```

Then add it to the returned array. Change line 182 from:

```ts
  return [writeFile, readFile, editFile, ls, glob, grep]
```

to:

```ts
  return [writeFile, readFile, editFile, ls, glob, grep, writeTodos]
```

### Step 4 — Reconcile the BASE system prompt to introduce write_todos

In `packages/sidecar/src/session/system-prompt.ts`, the `BASE` const currently is EXACTLY (lines 6-12):

```ts
const BASE =
  'You are a capable coding assistant working directly in a project. ' +
  'You have real file tools — read_file, write_file, edit_file, ls, glob, grep — operating on the ' +
  'project directory. Use them to do the work yourself: read what you need, write actual files, then ' +
  'verify by reading the result back. Do not ask the user to do steps you can do with your tools. ' +
  'When the task is done, finish with a short plain-text summary of what you changed. ' +
  'For a simple request, just do it directly — do not over-plan.'
```

Replace it with (adds `write_todos` to the tool list and turns the closing sentence into a planning rule that keeps the "don't over-plan" guard for simple requests):

```ts
const BASE =
  'You are a capable coding assistant working directly in a project. ' +
  'You have real file tools — read_file, write_file, edit_file, ls, glob, grep — and a planning tool, ' +
  'write_todos — operating on the ' +
  'project directory. Use them to do the work yourself: read what you need, write actual files, then ' +
  'verify by reading the result back. Do not ask the user to do steps you can do with your tools. ' +
  'When the task is done, finish with a short plain-text summary of what you changed. ' +
  'For a multi-step task, call write_todos first to lay out an ordered checklist, then update it as ' +
  'you go — mark exactly one item in_progress at a time and flip items to completed as you finish them. ' +
  'For a simple, single-step request, just do it directly — do not over-plan or call write_todos.'
```

### Step 5 — Add a system-prompt assertion

In `packages/sidecar/src/session/system-prompt.test.ts`, the first test currently asserts `write_file`, the cwd, and the anti-phantom rule. Add a `write_todos` assertion inside that same `it(...)` (after the existing `expect(s).toContain('write_file')` on line 8):

```ts
    expect(s).toContain('write_todos')
```

### Step 6 — Run both tests, expect PASS

```
cd packages/sidecar && npx vitest run src/session/tools.test.ts src/session/system-prompt.test.ts
```

Expected: all cases PASS. (Both are pure/FS-local, no LLM — safe.)

### Step 7 — Typecheck and commit

```
cd packages/sidecar && npx tsc --noEmit
```

Then commit:

```
git add packages/sidecar/src/session/tools.ts packages/sidecar/src/session/system-prompt.ts packages/sidecar/src/session/tools.test.ts packages/sidecar/src/session/system-prompt.test.ts
git commit -m "$(cat <<'EOF'
feat(sidecar): add turn-scoped write_todos planning tool

Pure tool validating { todos: [{ content, status }] } and returning a
one-line confirmation; renderer reads the latest call's input (D1, no new
protocol event). BASE prompt now introduces write_todos for multi-step
tasks while keeping the don't-over-plan guard for simple requests.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Render the latest write_todos call as a turn-scoped checklist in TurnTimeline

**Files:**
- Create: src/lib/todos.ts
- Create: src/lib/todos.test.ts
- Modify: src/components/chat/TurnTimeline.tsx (imports L1-7; component body L66-105)
- Modify: src/i18n/en.ts (chat namespace, after styleEmpty L51)
- Modify: src/i18n/zh-CN.ts (chat namespace, after styleEmpty L51)
- Modify: src/i18n/zh-TW.ts (chat namespace, after styleEmpty L51)
- Test: src/lib/todos.test.ts

**Where the special-case lives — and why `TurnTimeline`, not `ToolCallRow`.** Choosing the *latest* `write_todos` call "in the turn" is a turn-level reduction across all of a turn's tool steps. `ToolCallRow` only ever receives a single `ToolCall` and has no view of the turn, so it cannot know which `write_todos` is the live one. `TurnTimeline` already owns the turn-wide pass (it builds `byCallId` over all `toolCalls` and tracks `seen` agents while walking ordered steps), so the live-plan decision belongs there. `ToolCallRow` stays the generic fallback for every non-write_todos tool, unchanged.

**No DOM/render test infra exists.** The repo's vitest config is `environment: 'node'`, `include: ['src/**/*.test.ts', …]` (`.test.ts` only, not `.test.tsx`), and there is no `@testing-library/react`/jsdom in deps. So the testable unit is the pure derivation — extracted into `src/lib/todos.ts` and tested as a `.test.ts` (the same pattern as `src/lib/turnAgents.ts` + `turnAgents.test.ts`). `TurnTimeline` then just maps over the parsed result. This keeps the PR free of a heavy testing-library/jsdom infra change.

### Step 1 — Write a failing test for the pure parser

Create `src/lib/todos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { ToolCall } from '@hip/protocol'
import { latestTodos, parseTodos, type Todo } from './todos'

function tc(over: Partial<ToolCall>): ToolCall {
  return { callId: 'c', agentId: 'supervisor', name: 'write_todos', input: '{}', status: 'finished', seq: 0, ...over }
}

describe('parseTodos', () => {
  it('parses a valid write_todos input into typed todos', () => {
    const todos = parseTodos(
      JSON.stringify({ todos: [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
      ] }),
    )
    expect(todos).toEqual<Todo[]>([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ])
  })

  it('returns [] for malformed JSON', () => {
    expect(parseTodos('not json')).toEqual([])
  })

  it('drops entries with a bad shape or unknown status', () => {
    const todos = parseTodos(
      JSON.stringify({ todos: [{ content: 'ok', status: 'pending' }, { content: 'x', status: 'blocked' }, { nope: 1 }] }),
    )
    expect(todos).toEqual<Todo[]>([{ content: 'ok', status: 'pending' }])
  })
})

describe('latestTodos', () => {
  it('returns the highest-seq write_todos call as the live plan', () => {
    const calls: ToolCall[] = [
      tc({ callId: 'c1', seq: 1, input: JSON.stringify({ todos: [{ content: 'old', status: 'pending' }] }) }),
      tc({ callId: 'r1', seq: 2, name: 'read_file', input: '{"path":"/x"}' }),
      tc({ callId: 'c2', seq: 3, input: JSON.stringify({ todos: [{ content: 'new', status: 'in_progress' }] }) }),
    ]
    const live = latestTodos(calls)
    expect(live).not.toBeNull()
    expect(live!.callId).toBe('c2')
    expect(live!.todos).toEqual<Todo[]>([{ content: 'new', status: 'in_progress' }])
  })

  it('returns null when there is no write_todos call', () => {
    expect(latestTodos([tc({ name: 'read_file', input: '{}' })])).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(latestTodos(undefined)).toBeNull()
  })
})
```

### Step 2 — Run it, expect FAIL

```
npm run test -- src/lib/todos.test.ts
```

Expected: FAIL — `src/lib/todos.ts` does not exist (module-not-found). (`npm run test` = `vitest run`; passing an explicit file path scopes it. Frontend tests are not paid.)

### Step 3 — Implement the pure parser

Create `src/lib/todos.ts`:

```ts
import type { ToolCall } from '@hip/protocol'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export interface Todo {
  content: string
  status: TodoStatus
}

const STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed'])

/** Parse a write_todos ToolCall.input (JSON) into typed todos; drops malformed entries, never throws. */
export function parseTodos(input: string): Todo[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    return []
  }
  const raw = (parsed as { todos?: unknown }).todos
  if (!Array.isArray(raw)) return []
  const out: Todo[] = []
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const { content, status } = item as { content?: unknown; status?: unknown }
      if (typeof content === 'string' && typeof status === 'string' && STATUSES.has(status)) {
        out.push({ content, status: status as TodoStatus })
      }
    }
  }
  return out
}

export interface LivePlan {
  callId: string
  todos: Todo[]
}

/** The latest (highest-seq) write_todos call in a turn's tool calls — the live plan. Null if none. */
export function latestTodos(toolCalls?: ToolCall[]): LivePlan | null {
  if (!toolCalls || toolCalls.length === 0) return null
  let latest: ToolCall | null = null
  for (const tc of toolCalls) {
    if (tc.name === 'write_todos' && (latest === null || tc.seq > latest.seq)) latest = tc
  }
  if (!latest) return null
  return { callId: latest.callId, todos: parseTodos(latest.input) }
}
```

### Step 4 — Run it, expect PASS

```
npm run test -- src/lib/todos.test.ts
```

Expected: all cases PASS.

### Step 5 — Add i18n keys (identical shape in all three locales)

In each file, insert a `todos` block into the `chat` namespace immediately after `styleEmpty` (the last chat key, line 51, just before the `},` that closes `chat`).

`src/i18n/en.ts` — after `styleEmpty: 'No saved styles yet. Create one below.',`:

```ts
      todos: {
        plan: 'Plan',
        pending: 'To do',
        in_progress: 'In progress',
        completed: 'Done',
      },
```

`src/i18n/zh-CN.ts` — after `styleEmpty: '还没有保存的风格，请在下方新建。',`:

```ts
      todos: {
        plan: '计划',
        pending: '待办',
        in_progress: '进行中',
        completed: '已完成',
      },
```

`src/i18n/zh-TW.ts` — after `styleEmpty: '還沒有儲存的風格，請在下方新增。',`:

```ts
      todos: {
        plan: '計畫',
        pending: '待辦',
        in_progress: '進行中',
        completed: '已完成',
      },
```

The `status` glyph labels (`pending`/`in_progress`/`completed`) are used as `aria-label`s on the state icons; `plan` is the checklist header. Shapes are identical across locales (en is the typed source via `as const`, so the others must match key-for-key or `type-check` fails).

### Step 6 — Render the checklist in TurnTimeline

In `src/components/chat/TurnTimeline.tsx`:

6a. Update imports. The current icon import (line 3) is:

```tsx
import { ChevronRight, Brain } from 'lucide-react'
```

Change it to add the three state glyphs:

```tsx
import { ChevronRight, Brain, Circle, CircleDot, CheckCircle2 } from 'lucide-react'
```

Add the parser import after the existing `ROLE_COLOR` import (after line 7):

```tsx
import { latestTodos, type Todo } from '@/lib/todos'
```

6b. Add a `TodoChecklist` component above `TurnTimeline` (e.g. just before the `interface TurnTimelineProps` block on line 59):

```tsx
const TODO_ICON = {
  pending: Circle,
  in_progress: CircleDot,
  completed: CheckCircle2,
} as const

const TODO_ICON_CLASS = {
  pending: 'text-ink-tertiary',
  in_progress: 'text-accent-strong',
  completed: 'text-success',
} as const

function TodoChecklist({ todos }: { todos: Todo[] }) {
  const { t } = useTranslation()
  return (
    <div
      className="rounded-md border border-border bg-surface-muted/40 px-2 py-1.5"
      data-testid="todo-checklist"
    >
      <div className="mb-1 text-caption uppercase tracking-wide text-ink-tertiary">{t('chat.todos.plan')}</div>
      <ul className="flex flex-col gap-1">
        {todos.map((todo, i) => {
          const Icon = TODO_ICON[todo.status]
          return (
            <li key={i} className="flex items-start gap-1.5" data-status={todo.status}>
              <Icon
                size={13}
                className={cn('mt-0.5 shrink-0', TODO_ICON_CLASS[todo.status])}
                aria-label={t(`chat.todos.${todo.status}`)}
              />
              <span
                className={cn(
                  'min-w-0 flex-1 text-meta',
                  todo.status === 'completed' ? 'text-ink-tertiary line-through' : 'text-ink-secondary',
                )}
              >
                {todo.content}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

6c. In the `TurnTimeline` body, derive the live plan once and (a) render it once at the top, (b) skip the `write_todos` tool steps in the per-step loop so the raw tool row never shows for the plan. The current body after the early-return (lines 69-73) is:

```tsx
  const ordered = [...steps].sort((a, b) => a.stepSeq - b.stepSeq)
  const byCallId = new Map((toolCalls ?? []).map((tc) => [tc.callId, tc]))
  const taskByAgent = new Map((agentRuns ?? []).filter((r) => r.taskInput).map((r) => [r.agentId, r.taskInput!]))
  const seen = new Set<string>()
  return (
    <div className="mb-2 flex flex-col gap-1.5" data-testid="turn-timeline">
```

Replace it with (adds the `plan` derivation and renders `TodoChecklist` as the first child):

```tsx
  const ordered = [...steps].sort((a, b) => a.stepSeq - b.stepSeq)
  const byCallId = new Map((toolCalls ?? []).map((tc) => [tc.callId, tc]))
  const taskByAgent = new Map((agentRuns ?? []).filter((r) => r.taskInput).map((r) => [r.agentId, r.taskInput!]))
  const seen = new Set<string>()
  const plan = latestTodos(toolCalls)
  return (
    <div className="mb-2 flex flex-col gap-1.5" data-testid="turn-timeline">
      {plan && plan.todos.length > 0 && <TodoChecklist todos={plan.todos} />}
```

Then, inside the `else` branch that resolves a tool step (currently lines 93-100), skip `write_todos` so its generic row is suppressed (the checklist already represents every write_todos call). Change:

```tsx
        } else {
          const tool = byCallId.get(step.callId)
          if (tool) nodes.push(
            <div key={`t-${step.stepSeq}`} className="flex gap-2">
              <AgentBadge role={step.role} />
              <div className="min-w-0 flex-1"><ToolCallRow tool={tool} /></div>
            </div>,
          )
        }
```

to:

```tsx
        } else {
          const tool = byCallId.get(step.callId)
          if (tool && tool.name !== 'write_todos') nodes.push(
            <div key={`t-${step.stepSeq}`} className="flex gap-2">
              <AgentBadge role={step.role} />
              <div className="min-w-0 flex-1"><ToolCallRow tool={tool} /></div>
            </div>,
          )
        }
```

This renders ONLY the latest write_todos as the live plan (older write_todos calls and the current one are all suppressed from the raw step list), while every other tool keeps its generic `ToolCallRow`. `ToolCallRow.tsx` is unchanged.

### Step 7 — Typecheck and re-run the parser test

```
npm run type-check
npm run test -- src/lib/todos.test.ts
```

Expected: type-check passes (i18n shapes match across locales; `TurnTimeline` types resolve) and the parser test still PASSES. The render is verified by manual GUI acceptance per the project's live-LLM testing policy; the pure parser test is the automated guard.

### Step 8 — Commit

```
git add src/lib/todos.ts src/lib/todos.test.ts src/components/chat/TurnTimeline.tsx src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "$(cat <<'EOF'
feat(chat): render latest write_todos call as a turn-scoped checklist

TurnTimeline derives the live plan via latestTodos() (highest-seq
write_todos call), renders it as a state-glyph checklist, and suppresses
the generic ToolCallRow for write_todos steps. Pure parser extracted to
src/lib/todos.ts with unit tests. Adds chat.todos.* i18n (en/zh-CN/zh-TW).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Feature C — token/cost (sidecar)

### Task 3: T-protocol: add TurnUsage + AgentRun.usage + Message.usage; refresh stale ToolCall comments

**Files:**
- Modify: packages/protocol/src/index.ts (Message ~L39-49, AgentRun ~L51-62, ToolCall ~L66-76, add TurnUsage near them)

Types-only change. No new `ServerMessage`/`ClientMessage` variants — usage rides on the existing `message:complete`. The protocol package is consumed as SOURCE (`packages/protocol/src/index.ts`), so a sidecar/frontend typecheck is the only verification.

- [ ] **Add the `TurnUsage` interface** directly above `AgentRun` in `packages/protocol/src/index.ts` (after the `Message` interface, before `AgentRun`):
```ts
/** Provider-reported token counts for a turn or a single agent's slice of it.
 *  Counts only — $ cost is computed in the renderer from the models.dev catalog price. */
export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}
```

- [ ] **Add `usage?: TurnUsage` to `Message`.** The current interface ends:
```ts
  toolCalls?: ToolCall[]     // flat tool calls for this turn, referenced by timeline tool steps via callId
  agentRuns?: AgentRun[]     // per-agent run metadata for THIS turn (taskInput/output/timing/parent)
}
```
append before the closing brace:
```ts
  usage?: TurnUsage          // turn total = sum of agentRuns' usage; present once usage was reported
```

- [ ] **Add `usage?: TurnUsage` to `AgentRun`.** The current interface ends:
```ts
  toolCalls?: ToolCall[]     // ordered by seq; hydrated from the tool_calls table
  messageId?: string         // turn this run belongs to (maps agent_runs.message_id; NULL → no assistant message)
}
```
append before the closing brace:
```ts
  usage?: TurnUsage          // this agent's token counts for the turn (hydrated from agent_runs.*_tokens)
```

- [ ] **Refresh the now-stale `ToolCall` comments** (Feature B will make `'task'` a real tool name and `'worker'` a real agentId; reword so they don't lie). Current:
```ts
export interface ToolCall {
  callId: string
  agentId: string          // who called it: supervisor | planner | coder | reviewer
  name: string             // 'read_file' | 'write_file' | 'edit_file' | … (never 'task')
```
change the two comment lines to:
```ts
  agentId: string          // who called it: supervisor | a sub-agent (e.g. worker-1)
  name: string             // 'read_file' | 'write_file' | 'edit_file' | 'task' | …
```

- [ ] **Verify both typecheckers pass** (no runtime, no LLM). From repo root:
```bash
cd packages/sidecar && npx tsc --noEmit
```
expected: no errors. Then from repo root:
```bash
npm run type-check
```
expected: no errors. (Both consume `packages/protocol/src/index.ts` as source; adding optional fields and rewording comments is non-breaking.)

- [ ] **Commit:**
```bash
git add packages/protocol/src/index.ts
git commit -m "$(cat <<'EOF'
feat(protocol): add TurnUsage; Message.usage + AgentRun.usage; refresh ToolCall comments

Token counts ride on the existing message:complete (no new wire event). Optional
fields are additive; ToolCall comments updated for the upcoming task/worker work.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: T-capture-emit: streamUsage on the model, GraphEmit.usage, agent node reads usage_metadata

**Files:**
- Modify: packages/sidecar/src/session/graph.ts (GraphEmit ~L11-16, agent node ~L53-64)
- Modify: packages/sidecar/src/session/session.ts (buildModel ~L150-157)
- Modify: packages/sidecar/src/session/graph.test.ts (noopEmit ~L22, add a test)
- Test: packages/sidecar/src/session/graph.test.ts

Capture the provider's `usage_metadata` (reachable on the gathered `AIMessage` per the spec — no `ModelRunner` interface change) and surface it through a new `GraphEmit.usage` sink. Build the production model with `streamUsage: true` so `concat` accumulates the final usage chunk. Graph test injects a FAKE `ModelRunner` (paid-safe).

- [ ] **Write the failing test FIRST.** In `packages/sidecar/src/session/graph.test.ts`, the existing `fakeRunner` helper (L11-20) returns scripted `AIMessage`s — extend a copy so the returned message carries `usage_metadata`. Add this test inside the `describe('agent loop graph', …)` block (after the first test). It asserts the agent node calls `emit.usage` mapping `usage_metadata`:
```ts
  it('emits usage from the gathered message usage_metadata', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const msg = new AIMessage('done')
      msg.usage_metadata = { input_tokens: 12, output_tokens: 5, total_tokens: 17 }
      const runner = fakeRunner([msg])
      const seen: Array<{ inputTokens: number; outputTokens: number; totalTokens: number }> = []
      await app.invoke(
        { messages: [new HumanMessage('hi')], steps: 0 },
        { configurable: { ctx: { runner, tools: buildTools(root), emit: { ...noopEmit, usage: (u) => seen.push(u) }, summarizer: noopSummarizer } } },
      )
      expect(seen).toEqual([{ inputTokens: 12, outputTokens: 5, totalTokens: 17 }])
    })
  })

  it('does not emit usage when the message has no usage_metadata', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const seen: unknown[] = []
      await app.invoke(
        { messages: [new HumanMessage('hi')], steps: 0 },
        { configurable: { ctx: { runner: fakeRunner([new AIMessage('done')]), tools: buildTools(root), emit: { ...noopEmit, usage: (u) => seen.push(u) }, summarizer: noopSummarizer } } },
      )
      expect(seen).toEqual([])
    })
  })
```

- [ ] **Update `noopEmit` in the SAME test file** (L22) so it still satisfies the `GraphEmit` type once `usage` is added (otherwise every existing graph test fails to typecheck). Change:
```ts
const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {} }
```
to:
```ts
const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {} }
```

- [ ] **Run the test — expect FAIL** (`emit.usage` is not yet a property; the agent node never calls it). Explicit file path only, NO globs:
```bash
cd packages/sidecar && npx vitest run src/session/graph.test.ts
```
expected: the two new tests FAIL (and TS error on `usage` if run via tsc).

- [ ] **Add `usage` to `GraphEmit`** in `packages/sidecar/src/session/graph.ts`. Import `TurnUsage` and extend the interface. Current import line:
```ts
import type { StructuredToolInterface } from '@langchain/core/tools'
```
add after it:
```ts
import type { TurnUsage } from '@hip/protocol'
```
Current interface (L11-16):
```ts
export interface GraphEmit {
  token(delta: string): void
  reasoning(delta: string): void
  toolStarted(name: string, callId: string, input: unknown): void
  toolFinished(callId: string, status: 'finished' | 'error', output?: string, error?: string): void
}
```
add one method:
```ts
export interface GraphEmit {
  token(delta: string): void
  reasoning(delta: string): void
  toolStarted(name: string, callId: string, input: unknown): void
  toolFinished(callId: string, status: 'finished' | 'error', output?: string, error?: string): void
  usage(u: TurnUsage): void
}
```

- [ ] **Read `usage_metadata` in the agent node and call `emit.usage`.** Current `agent` function (graph.ts L53-64):
```ts
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
```
replace with (guard `undefined` — provider may not report):
```ts
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
    const u = msg.usage_metadata
    if (u) emit.usage({ inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens })
    return { messages: [msg], steps: state.steps + 1 }
  }
```

- [ ] **Build the production model with `streamUsage: true`** so the final streamed chunk carries usage and `concat` accumulates it onto the gathered message. In `packages/sidecar/src/session/session.ts`, current `buildModel` (L150-157):
```ts
function buildModel(_config: SessionConfig): ChatOpenAI {
  const { providerID, modelID, baseURL } = getActiveModel()
  return new ReasoningChatOpenAI({
    model: modelID,
    apiKey: activeKey(providerID),
    configuration: { baseURL },
  })
}
```
add `streamUsage: true`:
```ts
function buildModel(_config: SessionConfig): ChatOpenAI {
  const { providerID, modelID, baseURL } = getActiveModel()
  return new ReasoningChatOpenAI({
    model: modelID,
    apiKey: activeKey(providerID),
    configuration: { baseURL },
    streamUsage: true,
  })
}
```
(`streamUsage?: boolean` is a valid ChatOpenAI field — confirmed in `@langchain/openai/dist/types.d.ts`.)

- [ ] **NOTE for session.ts:** the `emit` object literal in `runTurn` (session.ts ~L452-472) does NOT yet have a `usage` property, so after adding `usage` to `GraphEmit` the sidecar will fail to typecheck. The full `makeEmit` refactor + accumulator lands in T-session-aggregate, but to keep THIS task green add a minimal no-op `usage` to that `emit` literal now (it's replaced in the next task). Insert after the `toolFinished` arrow (before the closing `}` of the `emit` literal, after L471):
```ts
      usage: () => {},
```

- [ ] **Run the test — expect PASS:**
```bash
cd packages/sidecar && npx vitest run src/session/graph.test.ts
```
expected: all tests PASS including the two new usage tests.

- [ ] **Typecheck the sidecar — expect no errors:**
```bash
cd packages/sidecar && npx tsc --noEmit
```

- [ ] **Commit:**
```bash
git add packages/sidecar/src/session/graph.ts packages/sidecar/src/session/session.ts packages/sidecar/src/session/graph.test.ts
git commit -m "$(cat <<'EOF'
feat(sidecar): capture token usage_metadata; GraphEmit.usage; streamUsage on model

Agent node reads the gathered message's usage_metadata (guarded) and emits it via
the new GraphEmit.usage sink; production model built with streamUsage:true so the
final chunk carries usage. Tested with a fake ModelRunner (paid-safe).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: T-session-aggregate: makeEmit factory + per-agent usage accumulator; attach to runs + Message.usage

**Files:**
- Create: packages/sidecar/src/session/usage.ts
- Create: packages/sidecar/src/session/usage.test.ts
- Modify: packages/sidecar/src/session/session.ts (runTurn ~L394-514: replace inline emit with makeEmit + accumulator; finalizeAndPersist ~L518-540: attach usage)
- Test: packages/sidecar/src/session/usage.test.ts

Extract the per-agent emit translation `runTurn` hardcodes for `'supervisor'` into a `makeEmit(agentId, role): GraphEmit` factory (reused by sub-agents in Feature B), and route the new `usage` sink into a per-agent accumulator (`Map<agentId, TurnUsage>`). In `finalizeAndPersist`, attach each agent's usage to its `AgentRun.usage` and set `Message.usage` = sum. Non-trivial summation goes into a PURE, unit-tested helper `usage.ts` (Session-level tests are paid-restricted).

- [ ] **Write the pure helper test FIRST.** Create `packages/sidecar/src/session/usage.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { addUsage, sumUsage } from './usage.js'
import type { TurnUsage } from '@hip/protocol'

describe('usage helpers', () => {
  it('addUsage seeds from undefined accumulator', () => {
    expect(addUsage(undefined, { inputTokens: 3, outputTokens: 2, totalTokens: 5 }))
      .toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 })
  })

  it('addUsage accumulates field-wise across steps', () => {
    const a = addUsage(undefined, { inputTokens: 3, outputTokens: 2, totalTokens: 5 })
    expect(addUsage(a, { inputTokens: 10, outputTokens: 4, totalTokens: 14 }))
      .toEqual({ inputTokens: 13, outputTokens: 6, totalTokens: 19 })
  })

  it('addUsage does not mutate the previous accumulator', () => {
    const a: TurnUsage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    addUsage(a, { inputTokens: 1, outputTokens: 1, totalTokens: 2 })
    expect(a).toEqual({ inputTokens: 1, outputTokens: 1, totalTokens: 2 })
  })

  it('sumUsage returns undefined for an empty list (no usage reported)', () => {
    expect(sumUsage([])).toBeUndefined()
    expect(sumUsage([undefined, undefined])).toBeUndefined()
  })

  it('sumUsage adds across agents and skips undefined', () => {
    expect(sumUsage([
      { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      undefined,
      { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    ])).toEqual({ inputTokens: 13, outputTokens: 6, totalTokens: 19 })
  })
})
```

- [ ] **Run it — expect FAIL** (module does not exist yet). Explicit path, no globs:
```bash
cd packages/sidecar && npx vitest run src/session/usage.test.ts
```
expected: fails to resolve `./usage.js`.

- [ ] **Create the pure helper** `packages/sidecar/src/session/usage.ts`:
```ts
import type { TurnUsage } from '@hip/protocol'

/** Fold one step's usage into an accumulator (immutable; undefined acc → seed). */
export function addUsage(acc: TurnUsage | undefined, next: TurnUsage): TurnUsage {
  return acc
    ? {
        inputTokens: acc.inputTokens + next.inputTokens,
        outputTokens: acc.outputTokens + next.outputTokens,
        totalTokens: acc.totalTokens + next.totalTokens,
      }
    : { ...next }
}

/** Sum per-agent usages into the turn total. Returns undefined when nothing was reported. */
export function sumUsage(parts: ReadonlyArray<TurnUsage | undefined>): TurnUsage | undefined {
  let out: TurnUsage | undefined
  for (const p of parts) if (p) out = addUsage(out, p)
  return out
}
```

- [ ] **Run the helper test — expect PASS:**
```bash
cd packages/sidecar && npx vitest run src/session/usage.test.ts
```

- [ ] **Refactor `runTurn` in `session.ts` to a `makeEmit` factory + accumulator.** Add the import near the top (after the `loop-control` import, L17):
```ts
import { addUsage, sumUsage } from './usage.js'
```
and make sure `TurnUsage` is importable — extend the existing protocol import (session.ts L1):
```ts
import type { ServerMessage, SessionConfig, AgentRole, Message, AgentRun, FsEntry, TurnUsage } from '@hip/protocol'
```

  Inside `runTurn`, just after `const started = new Set<string>()` (L406), add the accumulator:
```ts
    const usageByAgent = new Map<string, TurnUsage>()
```

  Then REPLACE the hardcoded supervisor `emit` literal (session.ts L452-472, the `const emit: GraphEmit = { … }` block) with a factory and a supervisor instance built from it. The current block is:
```ts
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
      usage: () => {},
    }
```
(the trailing `usage: () => {}` was the temporary no-op from T-capture-emit.) Replace the entire block with a generalized factory that captures `agentId`/`role`, plus a supervisor instance. Note the token sink only accumulates `supervisorText` for the supervisor (children's text is captured into the trajectory output, not the returned supervisor string):
```ts
    const makeEmit = (agentId: string, role: AgentRole): GraphEmit => ({
      token: (delta) => {
        if (!delta) return
        if (agentId === 'supervisor') supervisorText += delta
        const r = trajectory.get(agentId); if (r) r.output += delta
        send({ type: 'token:stream', sessionId: this.id, turnId, agentId, delta })
      },
      reasoning: (delta) => reasoningDelta(agentId, role, delta),
      toolStarted: (name, callId, input) => {
        closeReasoning(agentId)
        const seq = nextSeq()
        const inClip = clip(stringify(input))
        recorder.start(agentId, callId, name, inClip.text, seq, inClip.truncated)
        send({ type: 'tool:started', sessionId: this.id, turnId, agentId, role, callId, name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) })
      },
      toolFinished: (callId, status, output, error) => {
        const outClip = output !== undefined ? clip(stringify(output)) : undefined
        recorder.finish(agentId, callId, status, outClip?.text, error, outClip?.truncated ?? false)
        send({ type: 'tool:finished', sessionId: this.id, turnId, agentId, callId, status, ...(outClip ? { output: outClip.text } : {}), ...(error ? { error } : {}), ...(outClip?.truncated ? { truncated: true } : {}) })
      },
      usage: (u) => { usageByAgent.set(agentId, addUsage(usageByAgent.get(agentId), u)) },
    })
    const emit = makeEmit('supervisor', 'supervisor')
```
(Feature B reuses `makeEmit(childId, 'worker')` for each sub-agent; defined here so its closure already captures `usageByAgent`/`trajectory`/`send`/`stepSeq` machinery.)

- [ ] **Thread the accumulator into `finalizeAndPersist`.** It is called from three sites in `runTurn` (the pause branch L488, the abort branch L496, and the clean-completion return L513) plus `regenerate`. Add a `usageByAgent` parameter. Change the signature + body of `finalizeAndPersist` (session.ts L518-540). Current:
```ts
  private finalizeAndPersist(send: SendFn, turnId: string, supervisorText: string, trajectory: Map<string, TraceRun>, stopped: boolean): string {
    const { correction } = verifyWrites(trajectory, supervisorText, this._config.language ?? 'en')
    const finalText = correction ? `${supervisorText}\n\n${correction}` : supervisorText
    if (finalText) this.messages.push(new AIMessage(finalText))
    const ts = Date.now()
    const runs: AgentRun[] = trajectoryToRuns(trajectory).map((r) => ({ ...r, messageId: turnId }))
    const timeline = trajectoryToTimeline(trajectory)
    const toolCalls = runs.flatMap((r) => r.toolCalls ?? []).sort((a, b) => a.seq - b.seq)
    if (this.store) {
      this.store.insertTurn(
        finalText ? { id: turnId, sessionId: this.id, agentId: 'supervisor', content: finalText, timestamp: ts, stopped, timeline } : null,
        this.id,
        runs,
      )
      this.store.touchSession(this.id, ts)
    }
    send({
      type: 'message:complete',
      sessionId: this.id,
      message: { id: turnId, role: 'assistant', content: finalText, agentId: 'supervisor', timestamp: ts, timeline, toolCalls, agentRuns: runs, ...(stopped ? { stopped: true } : {}) },
    })
    return finalText
  }
```
Replace with (attach per-agent `usage`, compute `Message.usage` = sum, conditionally include both):
```ts
  private finalizeAndPersist(send: SendFn, turnId: string, supervisorText: string, trajectory: Map<string, TraceRun>, stopped: boolean, usageByAgent?: Map<string, TurnUsage>): string {
    const { correction } = verifyWrites(trajectory, supervisorText, this._config.language ?? 'en')
    const finalText = correction ? `${supervisorText}\n\n${correction}` : supervisorText
    if (finalText) this.messages.push(new AIMessage(finalText))
    const ts = Date.now()
    const runs: AgentRun[] = trajectoryToRuns(trajectory).map((r) => {
      const u = usageByAgent?.get(r.agentId)
      return { ...r, messageId: turnId, ...(u ? { usage: u } : {}) }
    })
    const turnUsage = sumUsage(runs.map((r) => r.usage))
    const timeline = trajectoryToTimeline(trajectory)
    const toolCalls = runs.flatMap((r) => r.toolCalls ?? []).sort((a, b) => a.seq - b.seq)
    if (this.store) {
      this.store.insertTurn(
        finalText ? { id: turnId, sessionId: this.id, agentId: 'supervisor', content: finalText, timestamp: ts, stopped, timeline } : null,
        this.id,
        runs,
      )
      this.store.touchSession(this.id, ts)
    }
    send({
      type: 'message:complete',
      sessionId: this.id,
      message: { id: turnId, role: 'assistant', content: finalText, agentId: 'supervisor', timestamp: ts, timeline, toolCalls, agentRuns: runs, ...(turnUsage ? { usage: turnUsage } : {}), ...(stopped ? { stopped: true } : {}) },
    })
    return finalText
  }
```

- [ ] **Pass `usageByAgent` at all three call sites.** In `runTurn`: the pause branch (L488) `this.finalizeAndPersist(send, turnId, supervisorText, trajectory, true)` → add `, usageByAgent`; the abort branch (L496) `this.finalizeAndPersist(rawSend, turnId, supervisorText, trajectory, true)` → add `, usageByAgent`; the clean return (L513) `return this.finalizeAndPersist(send, turnId, supervisorText, trajectory, false)` → add `, usageByAgent`. (`regenerate` calls `runTurn`, not `finalizeAndPersist` directly, so it needs no change — its accumulator is created fresh inside `runTurn`.)

- [ ] **Typecheck the sidecar — expect no errors** (this is the primary verification; Session-level behavior tests are paid-restricted, the summation logic is covered by `usage.test.ts`):
```bash
cd packages/sidecar && npx tsc --noEmit
```

- [ ] **Re-run the SAFE graph test** to confirm the `GraphEmit`/`makeEmit` shape still satisfies the graph (no regression):
```bash
cd packages/sidecar && npx vitest run src/session/graph.test.ts src/session/usage.test.ts
```
expected: all PASS. (Do NOT run `session.test.ts` — it is paid/live-LLM.)

- [ ] **Commit:**
```bash
git add packages/sidecar/src/session/usage.ts packages/sidecar/src/session/usage.test.ts packages/sidecar/src/session/session.ts
git commit -m "$(cat <<'EOF'
feat(sidecar): aggregate per-agent token usage; makeEmit factory; attach to runs + Message.usage

Extract the per-agent emit translation into makeEmit(agentId, role) (reused by
sub-agents later); route the usage sink into a Map<agentId, TurnUsage>; in
finalizeAndPersist attach AgentRun.usage and set Message.usage = sum via a pure,
unit-tested usage.ts (paid-safe).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: T-persist: migration v5→6 usage columns; insertTurn writes + loads hydrate AgentRun.usage / Message.usage

**Files:**
- Modify: packages/sidecar/src/persistence/schema.ts (migrate ~L44-118: add version<6 block)
- Modify: packages/sidecar/src/persistence/store.ts (insertTurn ~L52-82, loadAgentRuns ~L104-113, loadMessagesWithRuns ~L117-130)
- Modify: packages/sidecar/src/persistence/store.test.ts (add round-trip test)
- Test: packages/sidecar/src/persistence/store.test.ts

Persist token counts on `agent_runs` (additive `user_version 5 → 6` migration). `insertTurn` writes the three columns per run; `loadAgentRuns` hydrates `AgentRun.usage`; `loadMessagesWithRuns` reconstructs `Message.usage` = sum of its runs' usage. Store tests use an in-memory sqlite db (SAFE — no LLM).

- [ ] **Write the failing round-trip test FIRST.** In `packages/sidecar/src/persistence/store.test.ts`, add inside the `describe('SessionStore', …)` block (after the existing `round-trips tool calls…` test, ~L182). It inserts a turn whose runs carry `usage` and asserts both `AgentRun.usage` and the summed `Message.usage` hydrate; plus a NULL-usage run stays usage-less:
```ts
  it('round-trips per-agent usage and reconstructs Message.usage = sum', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3 },
      's1',
      [
        { agentId: 'supervisor', role: 'supervisor', output: 'done', startedAt: 1, finishedAt: 3, seq: 0, usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } },
        { agentId: 'worker-1', role: 'worker', output: 'sub', startedAt: 1, finishedAt: 2, seq: 1, parentAgentId: 'supervisor', taskInput: 'do', usage: { inputTokens: 30, outputTokens: 5, totalTokens: 35 } },
      ],
    )
    const runs = store.loadAgentRuns('s1')
    expect(runs.find((r) => r.agentId === 'supervisor')!.usage).toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120 })
    expect(runs.find((r) => r.agentId === 'worker-1')!.usage).toEqual({ inputTokens: 30, outputTokens: 5, totalTokens: 35 })
    const msg = store.loadMessagesWithRuns('s1').find((m) => m.id === 'a1')!
    expect(msg.usage).toEqual({ inputTokens: 130, outputTokens: 25, totalTokens: 155 })
  })

  it('omits usage for a run inserted without it (legacy/no-usage rows stay NULL)', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 2 },
      's1',
      [{ agentId: 'supervisor', role: 'supervisor', output: 'done', startedAt: 1, finishedAt: 2, seq: 0 }],
    )
    expect(store.loadAgentRuns('s1')[0].usage).toBeUndefined()
    expect(store.loadMessagesWithRuns('s1').find((m) => m.id === 'a1')!.usage).toBeUndefined()
  })
```

- [ ] **Run it — expect FAIL** (columns don't exist; `usage` not written/hydrated). Explicit path:
```bash
cd packages/sidecar && npx vitest run src/persistence/store.test.ts
```
expected: the two new tests FAIL (others still pass).

- [ ] **Add the migration block** in `packages/sidecar/src/persistence/schema.ts`, immediately after the `if (version < 5) { … }` block (closes at L117, before the closing `}` of `migrate`). Insert:
```ts
  if (version < 6) {
    db.exec('BEGIN')
    try {
      // Provider-reported token counts per agent run (nullable; old rows stay NULL).
      // Turn total = sum across the turn's runs; $ cost is computed in the renderer.
      db.exec(`ALTER TABLE agent_runs ADD COLUMN prompt_tokens INTEGER`)
      db.exec(`ALTER TABLE agent_runs ADD COLUMN completion_tokens INTEGER`)
      db.exec(`ALTER TABLE agent_runs ADD COLUMN total_tokens INTEGER`)
      db.exec('PRAGMA user_version = 6')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
```

- [ ] **Write the columns in `insertTurn`** (`store.ts` L52-82). Update the `runStmt` SQL (L64-66) to include the three columns and three placeholders. Current:
```ts
      const runStmt = this.db.prepare(
        `INSERT INTO agent_runs(session_id,message_id,seq,agent_id,role,output,started_at,finished_at,task_input,parent_agent_id) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
```
change to:
```ts
      const runStmt = this.db.prepare(
        `INSERT INTO agent_runs(session_id,message_id,seq,agent_id,role,output,started_at,finished_at,task_input,parent_agent_id,prompt_tokens,completion_tokens,total_tokens) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
```
and bind the values — current run loop (L70-72):
```ts
      for (const run of runs) {
        const info = runStmt.run(sessionId, assistant?.id ?? null, run.seq, run.agentId, run.role, run.output, run.startedAt, run.finishedAt, run.taskInput ?? null, run.parentAgentId ?? null)
        const runId = info.lastInsertRowid
```
change the `.run(...)` to append the three counts (NULL when no usage):
```ts
      for (const run of runs) {
        const info = runStmt.run(sessionId, assistant?.id ?? null, run.seq, run.agentId, run.role, run.output, run.startedAt, run.finishedAt, run.taskInput ?? null, run.parentAgentId ?? null, run.usage?.inputTokens ?? null, run.usage?.outputTokens ?? null, run.usage?.totalTokens ?? null)
        const runId = info.lastInsertRowid
```

- [ ] **Hydrate `AgentRun.usage` in `loadAgentRuns`** (`store.ts` L104-113). Update the SELECT to fetch the three columns and the row type, then build `usage` when present. Current:
```ts
  loadAgentRuns(sessionId: string): AgentRun[] {
    const rows = this.db.prepare(`SELECT id,message_id,agent_id,role,output,started_at,finished_at,seq,task_input,parent_agent_id FROM agent_runs WHERE session_id=? ORDER BY seq`).all(sessionId) as
      { id: number; message_id: string | null; agent_id: string; role: AgentRole; output: string; started_at: number; finished_at: number | null; seq: number; task_input: string | null; parent_agent_id: string | null }[]
    const toolStmt = this.db.prepare(`SELECT call_id,agent_id,name,input,output,status,error,seq,truncated FROM tool_calls WHERE agent_run_id=? ORDER BY seq`)
    return rows.map((r) => {
      const tools = (toolStmt.all(r.id) as { call_id: string; agent_id: string; name: string; input: string; output: string | null; status: ToolStatus; error: string | null; seq: number; truncated: number }[])
        .map((t): ToolCall => ({ callId: t.call_id, agentId: t.agent_id, name: t.name, input: t.input, status: t.status, seq: t.seq, ...(t.output != null ? { output: t.output } : {}), ...(t.error != null ? { error: t.error } : {}), ...(t.truncated ? { truncated: true } : {}) }))
      return { agentId: r.agent_id, role: r.role, output: r.output, startedAt: r.started_at, finishedAt: r.finished_at, seq: r.seq, ...(r.message_id != null ? { messageId: r.message_id } : {}), ...(r.task_input != null ? { taskInput: r.task_input } : {}), ...(r.parent_agent_id != null ? { parentAgentId: r.parent_agent_id } : {}), toolCalls: tools }
    })
  }
```
Replace with (note: import `TurnUsage` is added below):
```ts
  loadAgentRuns(sessionId: string): AgentRun[] {
    const rows = this.db.prepare(`SELECT id,message_id,agent_id,role,output,started_at,finished_at,seq,task_input,parent_agent_id,prompt_tokens,completion_tokens,total_tokens FROM agent_runs WHERE session_id=? ORDER BY seq`).all(sessionId) as
      { id: number; message_id: string | null; agent_id: string; role: AgentRole; output: string; started_at: number; finished_at: number | null; seq: number; task_input: string | null; parent_agent_id: string | null; prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null }[]
    const toolStmt = this.db.prepare(`SELECT call_id,agent_id,name,input,output,status,error,seq,truncated FROM tool_calls WHERE agent_run_id=? ORDER BY seq`)
    return rows.map((r) => {
      const tools = (toolStmt.all(r.id) as { call_id: string; agent_id: string; name: string; input: string; output: string | null; status: ToolStatus; error: string | null; seq: number; truncated: number }[])
        .map((t): ToolCall => ({ callId: t.call_id, agentId: t.agent_id, name: t.name, input: t.input, status: t.status, seq: t.seq, ...(t.output != null ? { output: t.output } : {}), ...(t.error != null ? { error: t.error } : {}), ...(t.truncated ? { truncated: true } : {}) }))
      const usage: TurnUsage | undefined = r.total_tokens != null
        ? { inputTokens: r.prompt_tokens ?? 0, outputTokens: r.completion_tokens ?? 0, totalTokens: r.total_tokens }
        : undefined
      return { agentId: r.agent_id, role: r.role, output: r.output, startedAt: r.started_at, finishedAt: r.finished_at, seq: r.seq, ...(r.message_id != null ? { messageId: r.message_id } : {}), ...(r.task_input != null ? { taskInput: r.task_input } : {}), ...(r.parent_agent_id != null ? { parentAgentId: r.parent_agent_id } : {}), ...(usage ? { usage } : {}), toolCalls: tools }
    })
  }
```

- [ ] **Reconstruct `Message.usage` in `loadMessagesWithRuns`** (`store.ts` L117-130). Current:
```ts
  loadMessagesWithRuns(sessionId: string): Message[] {
    const messages = this.loadMessages(sessionId)
    const byMessage = new Map<string, AgentRun[]>()
    for (const r of this.loadAgentRuns(sessionId)) {
      if (r.messageId == null) continue
      const arr = byMessage.get(r.messageId) ?? []
      arr.push(r)
      byMessage.set(r.messageId, arr)
    }
    return messages.map((m) => {
      const runs = byMessage.get(m.id)
      return runs && runs.length ? { ...m, agentRuns: runs } : m
    })
  }
```
Replace the final `.map` so a turn with any usage-bearing run also gets `Message.usage` = sum:
```ts
  loadMessagesWithRuns(sessionId: string): Message[] {
    const messages = this.loadMessages(sessionId)
    const byMessage = new Map<string, AgentRun[]>()
    for (const r of this.loadAgentRuns(sessionId)) {
      if (r.messageId == null) continue
      const arr = byMessage.get(r.messageId) ?? []
      arr.push(r)
      byMessage.set(r.messageId, arr)
    }
    return messages.map((m) => {
      const runs = byMessage.get(m.id)
      if (!runs || !runs.length) return m
      const usage = sumUsage(runs.map((r) => r.usage))
      return { ...m, agentRuns: runs, ...(usage ? { usage } : {}) }
    })
  }
```

- [ ] **Add the imports to `store.ts`.** The current import (L2) is:
```ts
import type { AgentRole, AgentRun, Message, SessionSummary, SearchHit, TimelineStep, ToolCall, ToolStatus } from '@hip/protocol'
```
add `TurnUsage`:
```ts
import type { AgentRole, AgentRun, Message, SessionSummary, SearchHit, TimelineStep, ToolCall, ToolStatus, TurnUsage } from '@hip/protocol'
```
and add the `sumUsage` import (new line after L2):
```ts
import { sumUsage } from '../session/usage.js'
```

- [ ] **Run the store test — expect PASS:**
```bash
cd packages/sidecar && npx vitest run src/persistence/store.test.ts
```
expected: all tests PASS, including the two new usage round-trip tests. (This db is `:memory:` — fully SAFE, no LLM.)

- [ ] **Typecheck the sidecar — expect no errors:**
```bash
cd packages/sidecar && npx tsc --noEmit
```

- [ ] **Commit:**
```bash
git add packages/sidecar/src/persistence/schema.ts packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
git commit -m "$(cat <<'EOF'
feat(persistence): persist per-agent token usage (agent_runs v5->6) + hydrate Message.usage

Additive migration adds nullable prompt/completion/total token columns; insertTurn
writes them, loadAgentRuns hydrates AgentRun.usage, loadMessagesWithRuns sums them
into Message.usage. Round-trip covered by in-memory sqlite tests (paid-safe).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Feature C — token/cost (renderer)

### Task 7: Pure cost helper + chat.usage.* i18n (all three locales)

**Files:**
- Create: src/lib/usageCost.ts
- Create: src/lib/usageCost.test.ts
- Modify: src/i18n/zh-CN.ts (chat block, after styleEmpty ~line 51)
- Modify: src/i18n/en.ts (chat block, after styleEmpty ~line 51)
- Modify: src/i18n/zh-TW.ts (chat block, after styleEmpty ~line 51)
- Test: src/lib/usageCost.test.ts

Ground rules / facts established by reading the repo:
- `CatalogModel.cost` is `{ input: number; output: number }` (`src/ipc/catalog.ts` line 11). **models.dev unit assumption (state it explicitly in a code comment): cost is USD per 1,000,000 tokens.** So `$ = (inTok × cost.input + outTok × cost.output) / 1_000_000` — this matches P3-D6 in the spec (§3.7).
- The protocol usage shape `TurnUsage { inputTokens: number; outputTokens: number; totalTokens: number }` is added by the **sidecar half** of Feature C (spec §3.3; `Message.usage?: TurnUsage`, `AgentRun.usage?: TurnUsage`). This renderer slice depends on that protocol type existing. To keep this task self-contained and typecheck-clean **even if sequenced before the sidecar lands**, define a local structural alias here rather than importing `TurnUsage` — the helper only needs `{ inputTokens; outputTokens }`.
- i18n type source is `zh-CN` (`src/i18n/i18next.d.ts` → `resources: typeof zhCN`). Every `t('chat.usage.*')` key MUST exist with an identical key set in **all three** locale files or `t()` calls become type errors. Insert the new `usage` sub-object inside the existing `chat: { … }` block, right after `styleEmpty` (zh-CN line 51, en line 51, zh-TW line 51).
- Test env is `node` (`vitest.config.ts` line 11); there is NO `@testing-library/react`/jsdom in the repo. The established pattern is **pure-logic `.test.ts`** (see `src/domain/sessionStore.test.ts`, `src/lib/turnAgents.test.ts`). This task ships only pure logic + a pure unit test.

### Step 1 — Write the failing test (RED)

Create `src/lib/usageCost.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeCost, formatUsd, type CostRate } from './usageCost'

const rate: CostRate = { input: 0.27, output: 1.1 } // models.dev USD / 1e6 tokens (deepseek-chat-ish)

describe('computeCost', () => {
  it('scales tokens by the models.dev per-million unit', () => {
    // 1_000_000 in + 1_000_000 out → exactly input + output dollars
    expect(computeCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, rate)).toBeCloseTo(1.37, 10)
  })

  it('mixes input and output rates', () => {
    // 500k in × 0.27/1e6 + 250k out × 1.1/1e6 = 0.135 + 0.275 = 0.41
    expect(computeCost({ inputTokens: 500_000, outputTokens: 250_000 }, rate)).toBeCloseTo(0.41, 10)
  })

  it('returns 0 for zero tokens', () => {
    expect(computeCost({ inputTokens: 0, outputTokens: 0 }, rate)).toBe(0)
  })

  it('returns null when no rate is given (token-only)', () => {
    expect(computeCost({ inputTokens: 1000, outputTokens: 1000 }, undefined)).toBeNull()
  })
})

describe('formatUsd', () => {
  it('shows sub-cent costs with enough precision', () => {
    expect(formatUsd(0.0012)).toBe('$0.0012')
  })

  it('rounds normal costs to 4 decimals', () => {
    expect(formatUsd(0.41)).toBe('$0.4100')
  })

  it('shows < $0.0001 for tiny non-zero costs', () => {
    expect(formatUsd(0.00001)).toBe('<$0.0001')
  })

  it('shows $0.00 for exactly zero', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })
})
```

### Step 2 — Run it, expect RED

Exact command (explicit file path — NEVER a bare `vitest run` or a `src` glob; those substring-match the paid sidecar suites per the repo memos):

```bash
npx vitest run src/lib/usageCost.test.ts
```

Expected: FAIL — `Cannot find module './usageCost'` (file does not exist yet).

### Step 3 — Implement the helper (GREEN)

Create `src/lib/usageCost.ts`:

```ts
// src/lib/usageCost.ts
// Pure token→cost math for the chat usage footer/chip.
// UNIT ASSUMPTION: models.dev `CatalogModel.cost` ({ input, output }) is USD per 1,000,000 tokens.
// So dollars = (inTok × cost.input + outTok × cost.output) / 1_000_000  (P3-D6).

/** A models.dev price pair (CatalogModel.cost): USD per 1,000,000 tokens. */
export interface CostRate {
  input: number
  output: number
}

/** Minimal token shape we need — structurally compatible with protocol TurnUsage. */
export interface UsageTokens {
  inputTokens: number
  outputTokens: number
}

const PER = 1_000_000

/**
 * Dollar cost of a usage record at the given rate, or `null` when no rate is
 * available (token-only display). Never throws.
 */
export function computeCost(usage: UsageTokens, rate: CostRate | undefined): number | null {
  if (!rate) return null
  return (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / PER
}

/** Compact USD formatter: 4 dp, with a `<$0.0001` floor for tiny non-zero costs and `$0.00` for zero. */
export function formatUsd(cost: number): string {
  if (cost === 0) return '$0.00'
  if (cost < 0.0001) return '<$0.0001'
  return `$${cost.toFixed(4)}`
}
```

### Step 4 — Add `chat.usage.*` to all three locales (GREEN for the components that follow)

In `src/i18n/zh-CN.ts`, inside the `chat: { … }` block, replace the closing of `styleEmpty` so the `usage` sub-object is appended (the canonical type source — define the key set here):

```ts
      styleEmpty: '还没有保存的风格，请在下方新建。',
      usage: {
        tokens: '{{total}} tokens',
        io: '{{input}} 输入 · {{output}} 输出',
        sessionTotal: '本对话累计',
        cost: '约 {{cost}}',
      },
    },
```

In `src/i18n/en.ts`, same spot inside `chat`:

```ts
      styleEmpty: 'No saved styles yet. Create one below.',
      usage: {
        tokens: '{{total}} tokens',
        io: '{{input}} in · {{output}} out',
        sessionTotal: 'Session total',
        cost: '~{{cost}}',
      },
    },
```

In `src/i18n/zh-TW.ts`, same spot inside `chat`:

```ts
      styleEmpty: '還沒有儲存的風格，請在下方新增。',
      usage: {
        tokens: '{{total}} tokens',
        io: '{{input}} 輸入 · {{output}} 輸出',
        sessionTotal: '本對話累計',
        cost: '約 {{cost}}',
      },
    },
```

(All three have the identical key set: `tokens`, `io`, `sessionTotal`, `cost`. Keep them in lockstep — `zh-CN` is the type source so a missing key in en/zh-TW that the components reference still type-errors against `zhCN`'s shape only if it's missing there; matching all three avoids runtime-missing translations.)

### Step 5 — Re-run test (GREEN) + frontend typecheck

```bash
npx vitest run src/lib/usageCost.test.ts
npm run type-check
```

Expected: test PASS (8 assertions). `npm run type-check` PASS (the new i18n keys are well-formed; no component references them yet, so this is just the i18n object literals + the new helper module compiling).

### Step 6 — Commit

```bash
git add src/lib/usageCost.ts src/lib/usageCost.test.ts src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(usage): pure cost helper + chat.usage i18n (3 locales)

models.dev cost is USD/1e6 tokens; computeCost scales accordingly and
returns null token-only when the active model has no catalog price.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: useActiveUsageTotal hook + MessageBubble footer + ChatHeader chip

**Files:**
- Create: src/domain/usageTotal.test.ts
- Modify: src/domain/hooks.ts (add selectUsageTotal + useActiveUsageTotal)
- Modify: src/domain/index.ts (re-export useActiveUsageTotal, line 3)
- Modify: src/components/chat/MessageBubble.tsx (footer next to MessageActions, ~line 65)
- Modify: src/components/chat/ChatHeader.tsx (session-total chip, ~line 56)
- Test: src/domain/usageTotal.test.ts

Depends on Task 7 (the `computeCost`/`formatUsd` helper and `chat.usage.*` keys) and on the **sidecar half of Feature C** having added `Message.usage?: TurnUsage` to `packages/protocol/src/index.ts` (`TurnUsage { inputTokens; outputTokens; totalTokens }`, spec §3.3). If this task is sequenced before the protocol field exists, the `message.usage` reads will type-error — note in the PR that this renderer task lands after the protocol/sidecar field, OR (if you must land first) the structural `message.usage` access is guarded with optional chaining and the typecheck step will flag the missing protocol field as the one expected failure.

**Explicit confirmation re: `sessionStore` (required by the slice brief):** `SessionVM` and the `applyServerMessage` reducer need **NO change**. The `message:complete` handler (`src/domain/sessionStore.ts` line 214-217) already finalizes via `finalizeAssistant(s.messages, finalized)` where `finalized = { ...msg.message, … }` — it spreads the **whole** `Message`, so any new `usage` field rides along automatically with no reducer edit and no `SessionVM` accumulator (spec §2.4: "`SessionVM` is unchanged"). The session total is **derived** (summed from `messages[].usage`) via the new hook, never stored — avoids drift.

Facts from reading the files:
- `useActiveSession`/`useActiveMessages` (`src/domain/hooks.ts`) follow the pattern `useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.… )`. The new hook mirrors this.
- The active model's catalog entry on the renderer: `useProvidersStore` (`src/store/providersStore.ts`) holds `catalog: Catalog` and `config.activeModel: { providerID, modelID } | undefined`. The active `CatalogModel` is `catalog[config.activeModel.providerID]?.models[config.activeModel.modelID]`, and its price is `.cost` (`{ input, output } | undefined`). MessageBubble/ChatHeader read this to get the rate.
- `MessageActions` is rendered at `MessageBubble.tsx` line 65: `{!streaming && <MessageActions … />}`. The footer goes adjacent.
- `ChatHeader.tsx` has a `<div className="flex-1" />` spacer at line 57 before the panel-toggle button — the chip goes just before it.
- Test env is `node`, no jsdom/testing-library. So the **unit test targets the pure `selectUsageTotal` selector** (a plain function over a store-shaped snapshot), exactly like `sessionStore.test.ts` tests `applyServerMessage`. The hook is a thin `useDomainStore(selectUsageTotal)` wrapper that needs no separate render test.

### Step 1 — Write the failing selector test (RED)

Create `src/domain/usageTotal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { selectUsageTotal } from './hooks'
import type { SessionVM } from './sessionStore'
import type { Message } from '@hip/protocol'

function msg(id: string, usage?: { inputTokens: number; outputTokens: number; totalTokens: number }): Message {
  return { id, role: 'assistant', content: 'x', timestamp: 1, ...(usage ? { usage } : {}) }
}

function session(id: string, messages: Message[]): SessionVM {
  return { id, config: { llmProvider: 'deepseek', model: '', tools: [] }, title: 't', preview: 'p', updatedAtMs: 1, loaded: true, messages, status: 'idle', error: null, interrupt: null }
}

describe('selectUsageTotal', () => {
  it('sums usage across the active session’s messages', () => {
    const state = {
      activeSessionId: 's1',
      sessions: [
        session('s1', [
          msg('a', { inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
          msg('b', { inputTokens: 200, outputTokens: 60, totalTokens: 260 }),
          msg('c'), // no usage → skipped
        ]),
        session('s2', [msg('z', { inputTokens: 999, outputTokens: 999, totalTokens: 1998 })]),
      ],
    }
    expect(selectUsageTotal(state)).toEqual({ inputTokens: 300, outputTokens: 110, totalTokens: 410 })
  })

  it('returns null when the active session has no usage at all', () => {
    const state = { activeSessionId: 's1', sessions: [session('s1', [msg('a'), msg('b')])] }
    expect(selectUsageTotal(state)).toBeNull()
  })

  it('returns null when there is no active session', () => {
    const state = { activeSessionId: null, sessions: [] }
    expect(selectUsageTotal(state)).toBeNull()
  })
})
```

### Step 2 — Run it, expect RED

Explicit file path only (never a `src` glob — substring-matches paid suites):

```bash
npx vitest run src/domain/usageTotal.test.ts
```

Expected: FAIL — `selectUsageTotal` is not exported from `./hooks`.

### Step 3 — Add the pure selector + hook to `src/domain/hooks.ts` (GREEN)

At the top, extend the imports (currently `import type { Message, SearchHit } from '@hip/protocol'`) to also bring in `TurnUsage`:

```ts
import type { Message, SearchHit, TurnUsage } from '@hip/protocol'
```

(`TurnUsage` is added by Feature C's sidecar/protocol task; see the dependency note above.)

Then append to the file (after `useActiveInterrupt`):

```ts
/** Pure: sum `usage` across the active session's messages. Returns null when the active
 *  session is absent or no message carries usage. Exported for unit testing; the hook below
 *  is the thin reactive wrapper. */
export function selectUsageTotal(state: { sessions: SessionVM[]; activeSessionId: string | null }): TurnUsage | null {
  const active = state.sessions.find((x) => x.id === state.activeSessionId)
  if (!active) return null
  let any = false
  const total: TurnUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  for (const m of active.messages) {
    if (!m.usage) continue
    any = true
    total.inputTokens += m.usage.inputTokens
    total.outputTokens += m.usage.outputTokens
    total.totalTokens += m.usage.totalTokens
  }
  return any ? total : null
}

/** Session-total token usage for the active session (derived, never stored). */
export function useActiveUsageTotal(): TurnUsage | null {
  return useDomainStore((s) => selectUsageTotal(s))
}
```

### Step 4 — Re-export the hook from `src/domain/index.ts`

Add `useActiveUsageTotal` to the explicit re-export list (line 3). Replace:

```ts
export { useSessions, useActiveSessionId, useActiveSession, useActiveMessages, useConnectionStatus, useHasApiKey, useActiveSessionError, useSearchHits, useActiveSessionStatus, useActiveInterrupt } from './hooks'
```

with:

```ts
export { useSessions, useActiveSessionId, useActiveSession, useActiveMessages, useConnectionStatus, useHasApiKey, useActiveSessionError, useSearchHits, useActiveSessionStatus, useActiveInterrupt, useActiveUsageTotal } from './hooks'
```

### Step 5 — Re-run the selector test (GREEN)

```bash
npx vitest run src/domain/usageTotal.test.ts
```

Expected: PASS (3 assertions).

### Step 6 — Add the per-turn footer to `MessageBubble.tsx`

This component renders one `Message`. Add a small footer that shows tokens always, and `~$cost` only when the active model has catalog pricing. Pull the active rate from `useProvidersStore`.

Extend the imports at the top of `src/components/chat/MessageBubble.tsx`:

```ts
import { useProvidersStore } from '@/store/providersStore'
import { computeCost, formatUsd } from '@/lib/usageCost'
```

Inside the component, after `const isUser = message.role === 'user'` (line 27), derive the active rate:

```ts
  const activeRate = useProvidersStore((s) => {
    const am = s.config.activeModel
    return am ? s.catalog[am.providerID]?.models[am.modelID]?.cost : undefined
  })
```

Then change the actions line (currently line 65):

```tsx
        {!streaming && <MessageActions message={message} isLastAssistant={!!isLastAssistant} />}
```

to render the footer alongside the actions:

```tsx
        {!streaming && (
          <div className="mt-1 flex items-center gap-2">
            <MessageActions message={message} isLastAssistant={!!isLastAssistant} />
            {message.role === 'assistant' && message.usage && (
              <span
                data-testid="message-usage"
                title={t('chat.usage.io', { input: message.usage.inputTokens, output: message.usage.outputTokens })}
                className="text-caption text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100"
              >
                {t('chat.usage.tokens', { total: message.usage.totalTokens })}
                {(() => {
                  const cost = computeCost(message.usage, activeRate)
                  return cost === null ? null : ` · ${t('chat.usage.cost', { cost: formatUsd(cost) })}`
                })()}
              </span>
            )}
          </div>
        )}
```

(Note: `MessageActions` already wraps itself in `mt-1`; keeping its own wrapper is fine. The `group-hover` reveal matches `MessageActions`'s existing hover-reveal behavior so the footer appears on hover, consistent with the action buttons.)

### Step 7 — Add the session-total chip to `ChatHeader.tsx`

Extend the imports. Replace line 4:

```ts
import { useActiveSession, useConnectionStatus, useHasApiKey, sessionService } from '@/domain'
```

with:

```ts
import { useActiveSession, useConnectionStatus, useHasApiKey, useActiveUsageTotal, sessionService } from '@/domain'
```

and add the helper + providers-store imports:

```ts
import { useProvidersStore } from '@/store/providersStore'
import { computeCost, formatUsd } from '@/lib/usageCost'
```

Inside the component, after `const hasApiKey = useHasApiKey()` (line 19):

```ts
  const usageTotal = useActiveUsageTotal()
  const activeRate = useProvidersStore((s) => {
    const am = s.config.activeModel
    return am ? s.catalog[am.providerID]?.models[am.modelID]?.cost : undefined
  })
```

Then, just before the `<div className="flex-1" />` spacer (line 57), insert the chip:

```tsx
      {usageTotal && (
        <span
          data-testid="session-usage"
          title={t('chat.usage.sessionTotal')}
          data-tauri-drag-region="false"
          className="ml-3 rounded-full bg-surface-subtle px-2 py-0.5 text-caption text-ink-tertiary"
        >
          {t('chat.usage.tokens', { total: usageTotal.totalTokens })}
          {(() => {
            const cost = computeCost(usageTotal, activeRate)
            return cost === null ? null : ` · ${t('chat.usage.cost', { cost: formatUsd(cost) })}`
          })()}
        </span>
      )}
```

### Step 8 — Typecheck + re-run the selector test

```bash
npm run type-check
npx vitest run src/domain/usageTotal.test.ts src/lib/usageCost.test.ts
```

Expected: `npm run type-check` PASS **provided the protocol `Message.usage` / `TurnUsage` field from Feature C's sidecar/protocol task is present** (see dependency note — if sequenced first, the only expected type errors are the `message.usage` / `usageTotal` reads and the `TurnUsage` import, which resolve the moment the protocol field lands). Tests PASS.

Manual GUI acceptance (consistent with the repo's `prefer-gui-over-real-llm-tests` memo — no component-render harness exists, and the live path is paid): after the sidecar half lands, send a turn and confirm the per-turn footer (hover a completed assistant message) and the header chip both show `<n> tokens · ~$<cost>` (cost present for DeepSeek which has catalog pricing), and that a model with no `cost` shows tokens only.

### Step 9 — Commit

```bash
git add src/domain/hooks.ts src/domain/index.ts src/domain/usageTotal.test.ts src/components/chat/MessageBubble.tsx src/components/chat/ChatHeader.tsx
git commit -m "feat(usage): per-turn footer + session-total chip (derived from Message.usage)

useActiveUsageTotal sums messages[].usage for the active session (no
SessionVM accumulator); MessageBubble + ChatHeader show tokens always and
$cost when the active model has catalog pricing. sessionStore unchanged —
message:complete already spreads the whole Message so usage rides along.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Feature B — task sub-agent

### Task 9: T-worker-role: add 'worker' AgentRole in lockstep across all exhaustive maps

**Files:**
- Modify: packages/protocol/src/index.ts:1 (AgentRole union; refresh stale comments on ToolCall.name/agentId, AgentRun.parentAgentId at lines 59,69)
- Modify: src/lib/roleColor.ts:4-17 (ROLE_COLOR, ROLE_NAME_KEY)
- Modify: src/styles/tokens.css:24-28 (--role-* block)
- Modify: src/i18n/en.ts:87 (artifact.roles)
- Modify: src/i18n/zh-CN.ts:87 (artifact.roles)
- Modify: src/i18n/zh-TW.ts:87 (artifact.roles)
- Test: src/lib/roleColor.test.ts (NEW — exhaustiveness guard)

Add one `AgentRole` value `'worker'` and update **every** exhaustive map in lockstep. This is the tailwind-merge/token-sync foot-gun (per MEMORY: token lists must stay in sync) — `ROLE_COLOR` and `ROLE_NAME_KEY` are `Record<AgentRole, …>`, so missing one is a `tsc` error; the CSS var and i18n keys are NOT type-checked, so they must be added by hand.

### Step 1 — Write the failing exhaustiveness test
`src/lib/roleColor.test.ts` does not exist. Create it:

```ts
import { describe, it, expect } from 'vitest'
import type { AgentRole } from '@hip/protocol'
import { ROLE_COLOR, ROLE_NAME_KEY } from './roleColor'

// One literal per AgentRole member. If a role is added/removed, this array (typed as the
// full union) forces a compile error here until updated — a deliberate exhaustiveness tripwire.
const ALL_ROLES: AgentRole[] = ['supervisor', 'planner', 'coder', 'reviewer', 'worker']

describe('roleColor maps cover every AgentRole', () => {
  it('ROLE_COLOR has a CSS var for every role', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_COLOR[role]).toMatch(/^var\(--role-/)
    }
  })
  it('ROLE_NAME_KEY has an i18n key for every role', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_NAME_KEY[role]).toMatch(/^artifact\.roles\./)
    }
  })
  it('maps the new worker role', () => {
    expect(ROLE_COLOR.worker).toBe('var(--role-worker)')
    expect(ROLE_NAME_KEY.worker).toBe('artifact.roles.worker')
  })
})
```

### Step 2 — Run it, expect FAIL
Frontend tests run under vitest `environment: 'node'` (vitest.config.ts). Use the explicit file path (NEVER a bare `vitest run` or glob — they substring-match paid sidecar suites):
```
npx vitest run src/lib/roleColor.test.ts
```
Expected: FAILS to compile/run because `AgentRole` does not yet include `'worker'` (the `ALL_ROLES` literal errors) and `ROLE_COLOR.worker`/`ROLE_NAME_KEY.worker` are absent.

### Step 3 — Add `'worker'` to the protocol union + refresh stale comments
Edit `packages/protocol/src/index.ts` line 1:
```ts
export type AgentRole = 'supervisor' | 'planner' | 'coder' | 'reviewer' | 'worker'
```
Refresh the now-stale comments in the same file (per spec §4):
- Line 69 `ToolCall.name`: change `// 'read_file' | 'write_file' | 'edit_file' | … (never 'task')` to `// 'read_file' | 'write_file' | 'edit_file' | 'task' | … ('task' delegations are valid here)`.
- Line 69 `ToolCall.agentId` comment `// who called it: supervisor | planner | coder | reviewer` → append ` | worker`.
- Line 59 `AgentRun.parentAgentId` comment is still accurate (children share parentAgentId='supervisor'); leave it.

### Step 4 — Update `ROLE_COLOR` and `ROLE_NAME_KEY`
Edit `src/lib/roleColor.ts`:
```ts
export const ROLE_COLOR: Record<AgentRole, string> = {
  supervisor: 'var(--role-supervisor)',
  planner: 'var(--role-planner)',
  coder: 'var(--role-coder)',
  reviewer: 'var(--role-reviewer)',
  worker: 'var(--role-worker)',
}

export const ROLE_NAME_KEY = {
  supervisor: 'artifact.roles.supervisor',
  planner: 'artifact.roles.planner',
  coder: 'artifact.roles.coder',
  reviewer: 'artifact.roles.reviewer',
  worker: 'artifact.roles.worker',
} as const satisfies Record<AgentRole, string>
```

### Step 5 — Add the CSS var
Edit `src/styles/tokens.css`, in the `/* 智能体角色色 */` block (after `--role-reviewer: #c77a1a;`, line 28) add a visually distinct worker color (slate-teal, distinct from the existing supervisor indigo/planner blue/coder green/reviewer amber):
```css
  --role-worker: #0d8a8a;
```

### Step 6 — Add `roles.worker` to all three i18n files (identical shape)
- `src/i18n/en.ts:87`: `roles: { supervisor: 'Supervisor', planner: 'Planner', coder: 'Coder', reviewer: 'Reviewer', worker: 'Worker' },`
- `src/i18n/zh-CN.ts:87`: `roles: { supervisor: '主管', planner: '规划员', coder: '编码员', reviewer: '审查员', worker: '工作员' },`
- `src/i18n/zh-TW.ts:87`: `roles: { supervisor: '主管', planner: '規劃員', coder: '編碼員', reviewer: '審查員', worker: '工作員' },`

### Step 7 — Run the test, expect PASS
```
npx vitest run src/lib/roleColor.test.ts
```
Expected: PASS.

### Step 8 — Typecheck BOTH workspaces (the role lives in protocol, consumed by both)
```
npm run type-check
```
and
```
cd packages/sidecar && npx tsc --noEmit
```
Both expected: clean. (The sidecar typecheck matters because `session.ts`/`tool-trace.ts` reference `AgentRole`; the change is additive — no existing `Record<AgentRole,…>` in the sidecar should break.)

### Step 9 — Commit
```
git add -A && git commit -m "feat(protocol): add 'worker' AgentRole in lockstep across role maps

Adds the general sub-agent role used by the P3 task tool. Lockstep updates to
ROLE_COLOR/ROLE_NAME_KEY (typed Record<AgentRole>), tokens.css --role-worker,
and i18n roles.worker (en/zh-CN/zh-TW). Refreshes stale ToolCall comments.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: T-tool-plumbing: parameterize recursionLimit, add CHILD_MAX_STEPS, gate the `task` tool on spawnSubagent

**Files:**
- Modify: packages/sidecar/src/session/loop-control.ts:1-14 (CHILD_MAX_STEPS const; recursionLimit signature)
- Modify: packages/sidecar/src/session/tools.ts:31,182-183 (buildTools signature + conditional task append; imports tool/StructuredToolInterface/z already present)
- Test: packages/sidecar/src/session/loop-control.test.ts:1-14 (extend)
- Test: packages/sidecar/src/session/tools.test.ts (extend with task-gating cases)

Two enabling changes, no behavior change for existing call sites: (1) `recursionLimit()` becomes `recursionLimit(maxSteps = MAX_STEPS)` so a child can pass `CHILD_MAX_STEPS`; (2) `buildTools(root, spawnSubagent?)` appends a depth-1 `task` tool **only** when `spawnSubagent` is provided. The child toolset (`buildTools(root)` with no spawn) therefore excludes `task` → depth-1 (spec P3-D3).

### Step 1 — Write failing tests for loop-control
Extend `packages/sidecar/src/session/loop-control.test.ts`. Add the `CHILD_MAX_STEPS` import and one new assertion block (keep the existing default-arg assertion intact):
```ts
import { describe, it, expect } from 'vitest'
import { MAX_STEPS, MAX_STEPS_NOTE, recursionLimit, CHILD_MAX_STEPS } from './loop-control.js'

describe('loop-control', () => {
  it('caps steps at 25 and reserves graph recursion headroom above 3x', () => {
    expect(MAX_STEPS).toBe(25)
    expect(recursionLimit()).toBe(MAX_STEPS * 3 + 10)
  })

  it('recursionLimit accepts a custom maxSteps for sub-agents', () => {
    expect(CHILD_MAX_STEPS).toBe(15)
    expect(recursionLimit(CHILD_MAX_STEPS)).toBe(CHILD_MAX_STEPS * 3 + 10)
    expect(recursionLimit(5)).toBe(25)
  })

  it('the max-steps note tells the model tools are disabled and to answer in text', () => {
    expect(MAX_STEPS_NOTE).toMatch(/maximum/i)
    expect(MAX_STEPS_NOTE).toMatch(/text/i)
  })
})
```

### Step 2 — Write failing tests for the task-tool gating
Extend `packages/sidecar/src/session/tools.test.ts` with a new describe block (the file already imports `buildTools` and sets up `root` in beforeEach/afterEach):
```ts
describe('task tool gating (depth-1)', () => {
  it('buildTools(root) has no task tool', () => {
    const names = buildTools(root).map((t) => t.name)
    expect(names).not.toContain('task')
    expect(names).toEqual(expect.arrayContaining(['read_file', 'write_file', 'edit_file', 'ls', 'glob', 'grep']))
  })

  it('buildTools(root, spawn) appends a task tool that invokes spawn', async () => {
    const calls: string[] = []
    const spawn = async (description: string) => { calls.push(description); return `done: ${description}` }
    const tools = buildTools(root, spawn)
    const task = tools.find((t) => t.name === 'task')
    expect(task).toBeDefined()
    const out = String(await task!.invoke({ description: 'investigate the bug' }))
    expect(calls).toEqual(['investigate the bug'])
    expect(out).toBe('done: investigate the bug')
  })
})
```

### Step 3 — Run both tests, expect FAIL
Explicit file paths only (NEVER a bare `vitest run`/glob — they substring-match paid suites):
```
npx vitest run packages/sidecar/src/session/loop-control.test.ts packages/sidecar/src/session/tools.test.ts
```
Expected: FAIL — `CHILD_MAX_STEPS` is not exported, `recursionLimit` takes no arg, and `buildTools` has no second parameter / no `task` tool.

### Step 4 — Implement loop-control changes
Edit `packages/sidecar/src/session/loop-control.ts`. Add the child cap constant after `MAX_STEPS` (line 2):
```ts
/** A sub-agent's own loop cap (P3-J4), independent of the parent MAX_STEPS. Each `task` call is
 *  one parent step, so the parent cap bounds spawns; this bounds each child. */
export const CHILD_MAX_STEPS = 15
```
and replace `recursionLimit` (lines 9-14):
```ts
/** LangGraph recursion limit for a loop capped at `maxSteps`. Each model turn now visits ~3 nodes
 *  (compact + agent + tools), plus occasional nudge/pause detours, so reserve headroom above
 *  3*maxSteps; our own step cap (not this limit) is the real stop condition. The arg-less default
 *  keeps the supervisor call site (recursionLimit()) unchanged; children pass CHILD_MAX_STEPS. */
export function recursionLimit(maxSteps: number = MAX_STEPS): number {
  return maxSteps * 3 + 10
}
```

### Step 5 — Implement the `task` tool gating in tools.ts
Edit `packages/sidecar/src/session/tools.ts`. The file already imports `tool`, `StructuredToolInterface`, and `z`. Change the `buildTools` signature (line 31):
```ts
export function buildTools(
  root: string,
  spawnSubagent?: (description: string) => Promise<string>,
): StructuredToolInterface[] {
```
Replace the final `return [writeFile, readFile, editFile, ls, glob, grep]` (line 182) with:
```ts
  const base = [writeFile, readFile, editFile, ls, glob, grep]
  if (!spawnSubagent) return base
  const task = tool(
    async ({ description }) => spawnSubagent(description),
    {
      name: 'task',
      description:
        'Delegate a focused, self-contained sub-task to a fresh sub-agent that runs its own loop ' +
        'with the file tools and returns a text result. Use to isolate research or a chunk of work. ' +
        'The sub-agent cannot itself delegate.',
      schema: z.object({ description: z.string() }),
    },
  )
  return [...base, task]
}
```

### Step 6 — Run the tests, expect PASS
```
npx vitest run packages/sidecar/src/session/loop-control.test.ts packages/sidecar/src/session/tools.test.ts
```
Expected: PASS. (The existing `graph.test.ts` still calls `buildTools(root)` with one arg — valid since `spawnSubagent` is optional; do not run it here.)

### Step 7 — Typecheck the sidecar
```
cd packages/sidecar && npx tsc --noEmit
```
Expected: clean. (`session.ts` still calls `buildTools(cwd)` with one arg — unaffected; the `spawnSubagent` wiring lands in T-spawn.)

### Step 8 — Commit
```
git add -A && git commit -m "feat(sidecar): parameterize recursionLimit + gate task tool on spawnSubagent

recursionLimit(maxSteps=MAX_STEPS) lets a child pass CHILD_MAX_STEPS=15.
buildTools(root, spawnSubagent?) appends a depth-1 task tool only when a spawn
closure is given, so the child toolset (no spawn) excludes task.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: T-spawn: runSubagent child-run helper + spawnSubagent wiring in session.ts; delete orphaned agents.ts

**Files:**
- Create: packages/sidecar/src/session/subagent.ts
- Create: packages/sidecar/src/session/subagent.test.ts
- Modify: packages/sidecar/src/session/session.ts:14,17,431-444,449-473 (import runSubagent/CHILD_MAX_STEPS; add ensureFinished; build spawnSubagent; pass into buildTools; supervisor emit via makeEmit)
- Modify: packages/sidecar/src/session/system-prompt.ts:1-35 (add childSystemPrompt export)
- Modify: packages/sidecar/src/session/agents.ts (DELETE via git rm — P3-J3, roleForName unused)
- Modify: packages/sidecar/src/session/agents.test.ts (DELETE via git rm — P3-J3)
- Test: packages/sidecar/src/session/subagent.test.ts (NEW)

Extract the child-run orchestration into a **testable, paid-safe** helper `runSubagent` (driven by an injected fake `ModelRunner` in tests — never a real `ChatOpenAI`), then wire `spawnSubagent` in `session.ts` around it (per-child `ensureStarted`/`ensureFinished` + Feature C's `makeEmit`). Delete the orphaned `agents.ts`/`agents.test.ts` (P3-J3).

> DEPENDENCY: this task assumes Feature C's session refactor has introduced `makeEmit(agentId, role): GraphEmit` in `session.ts` (extracting the supervisor's emit translation, lines 452-472). If sequencing C before B, wire `spawnSubagent` to call `makeEmit(childId, 'worker')`. The `runSubagent` helper itself takes a ready `GraphEmit` and is independent of that refactor, so its test is unaffected. Step 6d gives an inline fallback if C has not landed.

### Step 1 — Add `childSystemPrompt` to system-prompt.ts (failing import target)
Edit `packages/sidecar/src/session/system-prompt.ts`. The file already has `BASE`, `ANTI_PHANTOM`, `cwdBlock`. Append a focused child prompt at the end of the file (base tools guidance, minus planning/delegation, framed as 'complete this delegated sub-task'):
```ts
const CHILD_BASE =
  'You are a focused sub-agent completing a single delegated sub-task. ' +
  'You have real file tools — read_file, write_file, edit_file, ls, glob, grep — operating on the ' +
  'project directory. Do the work yourself: read what you need, write actual files, then verify by ' +
  'reading the result back. You cannot delegate further. When done, return a concise text result ' +
  'describing what you found or changed.'

/** System prompt for a delegated sub-agent: base tools + cwd convention + anti-phantom, framed
 *  around a single sub-task. No planning/delegation guidance (the child has no task tool). */
export function childSystemPrompt(description: string, cwd: string): string {
  return `${CHILD_BASE}\n\n${cwdBlock(cwd)}\n\n${ANTI_PHANTOM}\n\n## Your delegated sub-task\n${description}`
}
```

### Step 2 — Write the failing `runSubagent` test (paid-safe; fake ModelRunner)
Create `packages/sidecar/src/session/subagent.test.ts`. Copy the fake-runner pattern from `graph.test.ts:11-20` (canned `AIMessage` script; no live LLM). Cover: returned text, depth-1 (child tools lack `task`), abort propagation, and `awaiting_user` → partial text.
```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { runSubagent } from './subagent.js'
import { buildTools } from './tools.js'
import type { GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'

function fakeRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      opts.signal?.throwIfAborted?.()
      const m = script[Math.min(i, script.length - 1)]; i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {} }
const noopSummarizer: Summarizer = { async summarize() { return '' } }
const withTmp = async (fn: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'hip-subagent-'))
  try { await fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

describe('runSubagent', () => {
  it('returns the child final assistant text', async () => {
    await withTmp(async (root) => {
      const text = await runSubagent({
        runner: fakeRunner([new AIMessage('调查完成：未发现问题')]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'look into X', childMaxSteps: 15,
      })
      expect(text).toBe('调查完成：未发现问题')
    })
  })

  it('is depth-1: the child toolset has no task tool', async () => {
    await withTmp(async (root) => {
      // Child asks for `task`; toolsNode returns an unknown-tool ToolMessage, then the child answers.
      const text = await runSubagent({
        runner: fakeRunner([
          new AIMessage({ content: '', tool_calls: [{ name: 'task', args: { description: 'recurse' }, id: 'c1' }] }),
          new AIMessage('无法继续委派，已直接处理'),
        ]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'try to recurse', childMaxSteps: 15,
      })
      expect(buildTools(root).map((t) => t.name)).not.toContain('task')
      expect(text).toBe('无法继续委派，已直接处理')
    })
  })

  it('propagates a pre-aborted parent signal (child stream throws → rejects)', async () => {
    await withTmp(async (root) => {
      const ac = new AbortController(); ac.abort()
      await expect(runSubagent({
        runner: fakeRunner([new AIMessage('should not reach')]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: ac.signal, description: 'aborted', childMaxSteps: 15,
      })).rejects.toThrow()
    })
  })

  it('returns partial text when the child pauses (awaiting_user), no escalation', async () => {
    await withTmp(async (root) => {
      // Repeat the identical tool call enough to trip doom-loop → nudge → pause (see graph.test.ts).
      const loop = () => new AIMessage({ content: '部分进展', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
      const text = await runSubagent({
        runner: fakeRunner([loop(), loop(), loop(), loop(), loop()]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'loops', childMaxSteps: 15,
      })
      expect(text).toContain('部分进展')
    })
  })
})
```

### Step 3 — Run it, expect FAIL
```
npx vitest run packages/sidecar/src/session/subagent.test.ts
```
Expected: FAIL — `./subagent.js` (and `runSubagent`) does not exist; `childSystemPrompt` not yet importable.

### Step 4 — Implement `runSubagent`
Create `packages/sidecar/src/session/subagent.ts`:
```ts
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ModelRunner } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import { buildGraph, type GraphEmit, type GraphCtx } from './graph.js'
import { buildTools } from './tools.js'
import { recursionLimit } from './loop-control.js'
import { childSystemPrompt } from './system-prompt.js'

export interface RunSubagentArgs {
  runner: ModelRunner
  root: string
  summarizer: Summarizer
  emit: GraphEmit
  signal: AbortSignal
  description: string
  childMaxSteps: number
}

/** Last assistant message's text content (string content, or joined text blocks). */
function lastAiText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!(m instanceof AIMessage)) continue
    if (typeof m.content === 'string') return m.content
    return m.content
      .filter((b): b is { type: 'text'; text: string } => (b as { type?: string }).type === 'text')
      .map((b) => b.text)
      .join('')
  }
  return ''
}

/**
 * Run a depth-1 sub-agent to completion and return its final assistant text.
 *
 * - Child toolset = buildTools(root) with NO spawn closure → no `task` tool (depth-1, P3-D3).
 * - Shares the parent cwd (`root`) and the parent AbortSignal (cancel propagates into the child stream).
 * - Capped at `childMaxSteps` (independent of the parent MAX_STEPS).
 * - If the child would HITL-pause (status === 'awaiting_user'), it does NOT escalate: returns its
 *   partial assistant text with the pending question appended as context (P3-D3, no agent:interrupt).
 */
export async function runSubagent(args: RunSubagentArgs): Promise<string> {
  const { runner, root, summarizer, emit, signal, description, childMaxSteps } = args
  const tools = buildTools(root) // depth-1: no task tool
  const ctx: GraphCtx = { runner, tools, emit, summarizer }
  const app = buildGraph(childMaxSteps)
  const final = await app.invoke(
    {
      messages: [new SystemMessage(childSystemPrompt(description, root)), new HumanMessage(description)],
      steps: 0,
      recentSigs: [],
      nudgedSig: undefined,
      status: 'running',
    },
    { configurable: { ctx }, signal, recursionLimit: recursionLimit(childMaxSteps) },
  )
  const text = lastAiText(final.messages)
  if (final.status === 'awaiting_user') {
    const q = final.pendingQuestion
    return q ? `${text}\n\n[sub-agent paused — open question: ${q}]` : text
  }
  return text
}
```

### Step 5 — Run the test, expect PASS
```
npx vitest run packages/sidecar/src/session/subagent.test.ts
```
Expected: PASS (all four cases; fully local — no network).

### Step 6 — Wire `spawnSubagent` into `session.ts`
Edit `packages/sidecar/src/session/session.ts`.

**6a. Imports** (near line 14, beside `import { buildTools } from './tools.js'`):
```ts
import { runSubagent } from './subagent.js'
import { recursionLimit, CHILD_MAX_STEPS } from './loop-control.js'
```
(Replaces the existing `import { recursionLimit } from './loop-control.js'` at line 17 — merge both names into one import.)

**6b. ensureFinished helper.** Today only the all-at-once `finishRemaining()` exists. Add an `ensureFinished(agentId, output)` right after `ensureStarted` (line 436) so a child finishes individually before the supervisor turn ends:
```ts
    const ensureFinished = (agentId: string, output: string) => {
      if (!started.has(agentId)) return
      closeReasoning(agentId)
      const r = trajectory.get(agentId)
      if (r) { r.output = output; r.finishedAt = Date.now() }
      started.delete(agentId)
      send({ type: 'agent:finished', sessionId: this.id, turnId, agentId })
    }
```
(`finishRemaining` still iterates `started` for the supervisor + any child left open on abort/error; `ensureFinished` removes from `started`, so a cleanly-finished child is not double-finished.)

**6c. Build runner/summarizer locals + spawnSubagent + pass into buildTools.** Replace `const tools = buildTools(cwd)` (line 450) with:
```ts
    const runner = this.modelRunner()
    const summarizer = this.summarizer()
    let subagentSeq = 0
    const spawnSubagent = async (description: string): Promise<string> => {
      const childId = `worker-${++subagentSeq}`
      ensureStarted(childId, 'worker', 'supervisor', description)
      const text = await runSubagent({
        runner,
        root: cwd,
        summarizer,
        emit: makeEmit(childId, 'worker'),
        signal: this.abortController!.signal,
        description,
        childMaxSteps: CHILD_MAX_STEPS,
      })
      ensureFinished(childId, text)
      return text
    }
    const tools = buildTools(cwd, spawnSubagent)
```
Then change the final ctx (line 473) to reuse the locals: `const ctx: GraphCtx = { runner, tools, emit, summarizer }`.

**6d. makeEmit.** Feature C's session task extracts `makeEmit(agentId, role): GraphEmit` from the hardcoded supervisor emit (lines 452-472), and the supervisor emit becomes `const emit = makeEmit('supervisor', 'supervisor')`. If C has NOT landed, generalize the existing supervisor `emit` literal into a factory yourself: turn the object at lines 452-472 into `const makeEmit = (agentId: string, role: AgentRole): GraphEmit => ({ … })`, replacing every `'supervisor'` literal in `token`/`reasoning`/`toolStarted`/`toolFinished` (the `send({… agentId: 'supervisor', role: 'supervisor' …})` and `trajectory.get('supervisor')` / `recorder.start('supervisor',…)` / `recorder.finish('supervisor',…)` and `closeReasoning('supervisor')` and `reasoningDelta('supervisor', 'supervisor', …)` calls) with the `agentId`/`role` params; and accumulate `supervisorText += delta` only `if (agentId === 'supervisor')`. Then `const emit = makeEmit('supervisor', 'supervisor')`.

### Step 7 — Delete the orphaned agents files (P3-J3)
```
git rm packages/sidecar/src/session/agents.ts packages/sidecar/src/session/agents.test.ts
```
(`roleForName` is imported nowhere but its own test — confirm with `grep -rn roleForName packages/sidecar/src`.)

### Step 8 — Typecheck the sidecar
```
cd packages/sidecar && npx tsc --noEmit
```
Expected: clean.

### Step 9 — Run the safe sidecar unit suites touched here (NEVER session.test.ts — paid)
```
npx vitest run packages/sidecar/src/session/subagent.test.ts packages/sidecar/src/session/system-prompt.test.ts
```
Expected: PASS. Do NOT run `session.test.ts` or `reasoner-reasoning.integration.test.ts` (live LLM). The `session.ts` wiring is exercised end-to-end only by the paid `session.test.ts`; rely on the sidecar typecheck + `subagent.test.ts` (fake runner) for local verification.

### Step 10 — Commit
```
git add -A && git commit -m "feat(sidecar): general task sub-agent (runSubagent helper + spawnSubagent wiring)

runSubagent runs a depth-1 child loop (no task tool, CHILD_MAX_STEPS, shared
cwd + AbortSignal), returns final text, returns partial on awaiting_user.
session.ts mints worker-<seq> ids, ensureStarted/ensureFinished per child,
emits via makeEmit(childId,'worker'), passes spawnSubagent into buildTools.
Adds childSystemPrompt; deletes orphaned agents.ts/agents.test.ts (P3-J3).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: T-render-suppress: hide the raw `task` tool row in the inline timeline (delegation card represents it)

**Files:**
- Create: src/lib/timelineFilter.ts
- Create: src/lib/timelineFilter.test.ts
- Modify: src/components/chat/TurnTimeline.tsx:7,93-101 (import + skip task tool steps via the helper)
- Test: src/lib/timelineFilter.test.ts (NEW)

The supervisor's own `task` tool call is double-displayed today: once as a generic `ToolCallRow` in `TurnTimeline` AND once as the delegation card (`delegation-row` + `AgentDashboard`/`AgentCard`). Suppress the raw `task` tool **row** while keeping the `ToolMessage`/persistence intact (the call still lives in `Message.toolCalls`; only the inline render skips it). Frontend tests run under vitest `environment: 'node'` with NO jsdom/testing-library — so extract a **pure** filter helper and unit-test that, rather than rendering DOM.

### Step 1 — Write the failing helper test
Create `src/lib/timelineFilter.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { TimelineStep, ToolCall } from '@hip/protocol'
import { isSuppressedToolStep } from './timelineFilter'

const tc = (over: Partial<ToolCall>): ToolCall => ({ callId: 'c1', agentId: 'supervisor', name: 'read_file', input: '{}', status: 'finished', seq: 1, ...over })

describe('isSuppressedToolStep', () => {
  const byCallId = new Map<string, ToolCall>([
    ['c-task', tc({ callId: 'c-task', name: 'task' })],
    ['c-read', tc({ callId: 'c-read', name: 'read_file' })],
  ])

  it('suppresses a tool step whose resolved call is a task delegation', () => {
    const step: TimelineStep = { kind: 'tool', stepSeq: 2, agentId: 'supervisor', role: 'supervisor', callId: 'c-task' }
    expect(isSuppressedToolStep(step, byCallId)).toBe(true)
  })

  it('keeps a normal file tool step', () => {
    const step: TimelineStep = { kind: 'tool', stepSeq: 3, agentId: 'supervisor', role: 'supervisor', callId: 'c-read' }
    expect(isSuppressedToolStep(step, byCallId)).toBe(false)
  })

  it('keeps reasoning steps (never suppressed)', () => {
    const step: TimelineStep = { kind: 'reasoning', stepSeq: 1, agentId: 'supervisor', role: 'supervisor', content: 'thinking' }
    expect(isSuppressedToolStep(step, byCallId)).toBe(false)
  })

  it('keeps a tool step whose call is missing from the map', () => {
    const step: TimelineStep = { kind: 'tool', stepSeq: 4, agentId: 'supervisor', role: 'supervisor', callId: 'absent' }
    expect(isSuppressedToolStep(step, byCallId)).toBe(false)
  })
})
```

### Step 2 — Run it, expect FAIL
```
npx vitest run src/lib/timelineFilter.test.ts
```
Expected: FAIL — `./timelineFilter` / `isSuppressedToolStep` does not exist.

### Step 3 — Implement the pure helper
Create `src/lib/timelineFilter.ts`:
```ts
import type { TimelineStep, ToolCall } from '@hip/protocol'

/**
 * Whether a timeline step should be hidden from the inline TurnTimeline.
 * The parent's own `task` tool call is represented by the delegation card
 * (delegation-row + AgentDashboard), so its generic tool row is suppressed to
 * avoid double-display. The ToolCall itself stays in Message.toolCalls (the
 * ToolMessage still reaches the model and persistence) — only the row is hidden.
 */
export function isSuppressedToolStep(step: TimelineStep, byCallId: Map<string, ToolCall>): boolean {
  if (step.kind !== 'tool') return false
  return byCallId.get(step.callId)?.name === 'task'
}
```

### Step 4 — Run the test, expect PASS
```
npx vitest run src/lib/timelineFilter.test.ts
```
Expected: PASS.

### Step 5 — Use the helper in TurnTimeline
Edit `src/components/chat/TurnTimeline.tsx`. Add the import after line 7 (`import { ROLE_COLOR, ROLE_NAME_KEY } from '@/lib/roleColor'`):
```ts
import { isSuppressedToolStep } from '@/lib/timelineFilter'
```
The delegation-row block (lines 77-90) must still run when the agent first appears, so keep the suppression at the tool-render branch only. Replace the else-branch tool render (lines 93-101):
```ts
        } else {
          const tool = byCallId.get(step.callId)
          if (tool) nodes.push(
            <div key={`t-${step.stepSeq}`} className="flex gap-2">
              <AgentBadge role={step.role} />
              <div className="min-w-0 flex-1"><ToolCallRow tool={tool} /></div>
            </div>,
          )
        }
```
with:
```ts
        } else if (!isSuppressedToolStep(step, byCallId)) {
          const tool = byCallId.get(step.callId)
          if (tool) nodes.push(
            <div key={`t-${step.stepSeq}`} className="flex gap-2">
              <AgentBadge role={step.role} />
              <div className="min-w-0 flex-1"><ToolCallRow tool={tool} /></div>
            </div>,
          )
        }
```
The supervisor's `task` step is the only step suppressed; the CHILD's delegation-row is keyed off the child agent's own first step (`step.role !== 'supervisor'`), so suppressing the supervisor's task row does not hide the delegation card.

### Step 6 — Re-run the helper test + typecheck
```
npx vitest run src/lib/timelineFilter.test.ts
```
Expected: PASS. Then:
```
npm run type-check
```
Expected: clean.

### Step 7 — Commit
```
git add -A && git commit -m "feat(chat): suppress raw task tool row in inline timeline

The supervisor's own task delegation renders as the delegation card, so its
generic ToolCallRow is hidden to avoid double-display. Pure isSuppressedToolStep
helper (unit-tested under node env); the ToolCall stays in Message.toolCalls so
the ToolMessage and persistence are unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
