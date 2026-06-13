# Agent-Loop Phase 3 — Design

> **Status:** approved design, pre-plan. Phase 3 of the agent-loop redesign (P1 = single ReAct
> loop; P2 = doom-loop / HITL / retry / compaction). This spec is one combined phase covering
> three features, built in dependency order **A → C → B**.

**Goal:** Give the single LangGraph ReAct loop three capabilities — a live planning checklist
(`write_todos`), model-driven sub-agents (`task`), and token/cost visibility — reusing the
trace/delegation/persistence substrate that already exists but lies dormant.

**Grounding:** A read-only 5-agent codebase sweep (2026-06-13) established the integration seams
cited throughout. Key facts the design leans on:

- `GraphEmit.toolStarted(name, callId, input)` already carries tool **args** end-to-end, and the
  wire/persistence model stores them as `ToolCall.input` (JSON string). → a turn-scoped
  `write_todos` needs **no new protocol event or state**; the list rides as the tool call.
- `toolsNode` dispatches a tool-call batch in a **sequential `for…of await` loop**
  (`graph.ts:71`). → multiple `task` calls cannot race; and the parent model is suspended while a
  child runs, so parent/child writes never overlap.
- `RealModelRunner.run` returns the **gathered chunk as the `AIMessage`**, so `msg.usage_metadata`
  is reachable in the agent node with **no `ModelRunner` interface change**.
- The protocol + frontend already model parent→child delegation (`AgentRun.parentAgentId`/
  `taskInput`, `agent:started`, `groupByAgent`, `AgentDashboard`/`AgentCard`, `TurnTimeline`
  delegation-row, `roleColor`, role i18n, `agent_runs` persistence) — **built and tested**, never
  fired because the runtime hardcodes `'supervisor'`.
- `AgentRole` is a **closed union** with exhaustive maps (`ROLE_COLOR`, `ROLE_NAME_KEY`,
  `tokens.css --role-*`, i18n `roles.*`) — adding a role is lockstep work (the
  `tailwind-merge`/token-sync foot-gun).

---

## Locked decisions

- **P3-D1 (todos scope).** `write_todos` is **turn-scoped**: its state is the latest `write_todos`
  tool call on the current turn's `Message`. No `todos:update` event, no `SessionVM` field, no
  schema change — it persists and reloads via the existing `tool_calls` table. In hip a "turn" is
  one long agentic loop = one task, so this is the Claude-Code TodoWrite analogy. A paused→resumed
  turn (P2 Option Z) is a *fresh* turn, so the agent re-plans across the pause; acceptable for v1.

- **P3-D2 (subagent breadth).** `task` is a **general** model-driven tool: the model spawns a
  focused sub-agent for any purpose, and the sub-agent gets the **full file toolset** (read **and**
  write/edit) sandboxed to the parent cwd. Not a read-only "explore"-only researcher.

- **P3-D3 (subagent constraints).** Sub-agents: share the parent **sandboxed cwd**; run
  **sequentially** (toolsNode is a sequential loop — never parallelize `task` calls); **share the
  parent `AbortSignal`** (cancel propagates into the child stream); are **depth-1** (the child's
  toolset excludes `task` — no recursion, preserving the protocol's 2-level-tree assumption); a
  child that would HITL-**pause returns its partial result** instead of escalating to the user
  (v1); the child's doom-loop **nudge still applies**.

- **P3-D4 (subagent role).** Add **one** new `AgentRole` value `'worker'` (honest "general
  sub-agent" label), with lockstep updates to every exhaustive map. *(Considered + rejected:
  reusing `'coder'` for zero churn — wrong label for a general/research sub-agent.)* Sub-agent ids
  are minted per turn as `worker-<seq>` for trajectory-Map uniqueness.

- **P3-D5 (usage delivery).** Token usage is captured from `msg.usage_metadata` in the agent node,
  accumulated **per agent** in `session.ts`, and delivered **only on `message:complete`** (as
  `Message.usage` = turn total and `AgentRun.usage` = per-agent). **No** streaming `usage:update`
  event in v1 — DeepSeek emits usage only on the final chunk, so live mid-turn ticking is deferred.

- **P3-D6 (cost computation).** Token **counts** are authoritative and persisted (sidecar); **$
  cost** is computed in the **renderer** from `CatalogModel.cost` (models.dev, already loaded), so
  no pricing is plumbed into the sidecar. Token-only display when the active model has no catalog
  price.

- **P3-D7 (display granularity).** Both **per-turn** (footer on each assistant `MessageBubble`,
  persists with the `Message`) and **per-session running total** (chip in `ChatHeader`, derived by
  summing `messages[].usage`).

- **P3-J1.** Usage columns live on **`agent_runs`** (one supervisor run per turn today; sub-agent
  child runs each carry their own → turn total = sum), not on `messages`. Additive migration only.

- **P3-J2.** v1 usage **excludes** P2's summarizer/title cheap-model calls (they bypass the
  runner/trace path) and **ignores** prompt-cache token tiers (flat input/output rates). Documented
  limitations, not bugs.

- **P3-J3.** Delete the orphaned `agents.ts` + `agents.test.ts` (`roleForName` — imported nowhere
  but its own test, a deepagents-pipeline leftover). The `task` tool does **not** build on it.

- **P3-J4.** `CHILD_MAX_STEPS = 15` (a sub-agent's own loop cap, independent of the parent's
  `MAX_STEPS = 25`). Each `task` call is one parent step, so the parent cap bounds the number of
  spawns; the child cap bounds each child. Both tunable.

---

## Product alignment (informed by, not citing)

Mirrors patterns these tools have converged on: a **single evolving task list the agent maintains
in-context and the UI renders** (Claude Code's `TodoWrite`); a **model-decided delegation tool that
spawns a fresh sub-agent which runs its own loop and returns a result string** (Claude Code's
`Task` / sub-agents), kept **depth-1** to bound blast radius; and **token/cost surfaced from
provider-reported usage** rather than client-side estimation. hip's twist: the trajectory/delegation
substrate already exists, so B is mostly *activation* + the nested-run plumbing, not new UI.

---

## §1 — Feature A: `write_todos` (turn-scoped checklist)

### 1.1 Tool (`packages/sidecar/src/session/tools.ts`)

Add to the `buildTools` array a 7th tool. It is a **pure** tool (args only — no injected context):

```ts
const TodoItem = z.object({
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
})
const writeTodos = tool(
  async ({ todos }) => `tracked ${todos.length} todo(s)`,
  {
    name: 'write_todos',
    description:
      'Maintain a short plan for a multi-step task. Pass the FULL current list each time (it ' +
      'replaces the previous one); mark items in_progress/completed as you go. Skip for trivial ' +
      'one-shot work.',
    schema: z.object({ todos: z.array(TodoItem) }),
  },
)
```

The list's authoritative state is simply the **latest `write_todos` call's `input`** on the turn's
`Message.toolCalls` — no separate channel.

### 1.2 System prompt (`packages/sidecar/src/session/system-prompt.ts`)

The shipped BASE ends with *"do not over-plan"*, which is in tension with a planning tool.
Reconcile: keep the anti-over-plan stance for trivial work but introduce the tool, e.g. append a
clause — *"For a non-trivial multi-step task, call `write_todos` first to lay out a brief plan and
update it (mark steps in_progress/completed) as you work. Do not use it for simple one-shot
requests."* Also append the `task` tool's one-line description here (see §2.5). The exact wording is
a plan-task detail; this spec fixes the intent.

### 1.3 Render (`src/components/chat/TurnTimeline.tsx` + `src/components/artifact/ToolCallRow.tsx`)

When a `ToolCall.name === 'write_todos'`, render a **checklist block** (parse `tool.input` →
`{ todos }`) instead of a generic `ToolCallRow`: one row per item with a state glyph
(☐ pending · ◐ in_progress · ☑ completed) and the content. Only the **latest** `write_todos` call
in the turn is shown as the live plan (earlier ones collapse/hide), so repeated calls read as the
plan *updating* in place. Add i18n keys under `chat.todos.*` (en + zh-CN + zh-TW, identical shape).

### 1.4 Persistence / reload

None added. `write_todos` is a normal tool call → already written to `tool_calls` by `insertTurn`
and rehydrated into `Message.toolCalls` by `loadMessagesWithRuns`. The checklist reconstructs from
the persisted call on `session:load`.

---

## §2 — Feature B: general `task` sub-agent

### 2.1 The `task` tool (injected with a spawn closure)

`buildTools` gains an **optional** second argument so the `task` tool can reach a spawn capability
without changing the pure file tools:

```ts
export function buildTools(
  root: string,
  spawnSubagent?: (description: string) => Promise<string>,
): StructuredToolInterface[] { … }
```

When `spawnSubagent` is provided, append:

```ts
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
```

The **child** toolset is `buildTools(root)` **without** `spawnSubagent` → no `task` tool → depth-1
(P3-D3).

### 2.2 `spawnSubagent` (built in `packages/sidecar/src/session/session.ts`, inside `runTurn`)

`session.ts` owns the trajectory Map, `ensureStarted`/`ensureFinished`, the WS `send`, the shared
turn-global `stepSeq`, the model, `root`, and the turn `AbortSignal` — everything a child run needs.
It builds `spawnSubagent` and passes it into `buildTools(root, spawnSubagent)`:

```
spawnSubagent(description):
  childId = `worker-${++subagentSeq}`
  ensureStarted(childId, role='worker', parentAgentId='supervisor', taskInput=description)  // emits agent:started
  childEmit = makeEmit(childId, role='worker')   // same send/trajectory/stepSeq, tagged childId
  childCtx  = { runner, tools: buildTools(root), emit: childEmit, summarizer }   // no task tool
  final = await buildGraph(CHILD_MAX_STEPS).invoke(
    { messages: [new SystemMessage(childSystemPrompt(description)), new HumanMessage(description)] },
    { recursionLimit: recursionLimit(CHILD_MAX_STEPS), configurable: { ctx: childCtx }, signal: turnSignal },
  )
```

> **Enabling change in `loop-control.ts`:** `recursionLimit()` is currently arg-less
> (`MAX_STEPS * 3 + 10`). Parameterize it to `recursionLimit(maxSteps = MAX_STEPS)` returning
> `maxSteps * 3 + 10`, so the child can pass `CHILD_MAX_STEPS`. The existing supervisor call site
> (`recursionLimit()`) is unaffected by the default.

```
  text = lastAiText(final.messages)              // child's final assistant content
  ensureFinished(childId, output=text)           // emits agent:finished
  return text                                    // → String()ed into the parent's ToolMessage
```

**Refactor enabling this:** the per-agent emit translation that `runTurn` currently hardcodes for
`'supervisor'` (token→`token:stream`, reasoning→`reasoning:delta` with the shared `stepSeq`,
toolStarted→`tool:started`, toolFinished→`tool:finished`) is extracted into a
`makeEmit(agentId, role): GraphEmit` factory, called once for the supervisor and once per child.
This is the central change in `session.ts`.

### 2.3 Constraints (P3-D3) — how each is enforced

- **Sandbox:** child uses the same `root`; `tools.ts` `real()` jails every path → child writes are
  sandboxed identically to the parent. No new sandbox code.
- **Sequential / no races:** `toolsNode` already awaits tool calls one-by-one; `spawnSubagent` is
  awaited inside that loop. The parent model is suspended until the `ToolMessage` returns, so
  parent and child never write concurrently. Multiple `task` calls in one batch run one-at-a-time.
- **Abort:** the turn `AbortSignal` is passed to the child `.invoke`; cancelling the turn aborts the
  child's in-flight stream (same path the supervisor uses).
- **Depth-1:** child toolset omits `task`.
- **No child HITL:** the child graph still has `pause`; if a child reaches it, `final.status ===
  'awaiting_user'` — `spawnSubagent` returns the child's partial text (+ `final.pendingQuestion`
  appended as context) rather than emitting `agent:interrupt`. Only the supervisor can pause the
  turn.

### 2.4 Role + ids (P3-D4)

Add `'worker'` to `AgentRole`. Lockstep updates (all must change together — see §4):
`src/lib/roleColor.ts` (`ROLE_COLOR`, `ROLE_NAME_KEY`), `src/styles/tokens.css` (`--role-worker`),
i18n `roles.worker` (en/zh-CN/zh-TW), and any exhaustive `switch`/`Record<AgentRole, …>`. `agents.ts`
is **deleted** (P3-J3), not extended.

### 2.5 Render

Automatic: a non-supervisor `AgentRun` with `taskInput` already triggers the `TurnTimeline`
delegation-row and the `AgentDashboard`/`AgentCard` pane. **One tweak:** the parent's own `task`
tool call (`name === 'task'`) is **suppressed** from the tool-row render (it's represented by the
delegation card, not a generic tool row) to avoid double-display. The `ToolMessage` still carries
the child's result to the model and to persistence.

### 2.6 Persistence

Free: `agent_runs` already round-trips `parentAgentId`/`taskInput`/`output`/`toolCalls`
(`store.test.ts` exercises planner/coder/reviewer runs). Child runs persist and rehydrate with no
schema change (usage columns from §3 apply to them too).

---

## §3 — Feature C: token/cost

### 3.1 Capture (`model-runner.ts` + `session.ts` model build)

- Build the `ChatOpenAI`/`ReasoningChatOpenAI` with **`streamUsage: true`** so the final streamed
  chunk includes usage and `concat` accumulates it onto the gathered `AIMessageChunk`.
- No `ModelRunner` interface change: the agent node reads `msg.usage_metadata`
  (`{ input_tokens, output_tokens, total_tokens }`) off the returned message.

### 3.2 Emit + aggregate

- `GraphEmit` gains `usage(u: { inputTokens; outputTokens; totalTokens }): void`.
- The agent node (`graph.ts`) calls `emit.usage(...)` after `runner.run`, mapping
  `usage_metadata`. Guard against `undefined` (provider didn't report).
- `makeEmit(agentId,…)` routes `usage` into a **per-agent accumulator** in `runTurn` (a
  `Map<agentId, TurnUsage>` summed across that agent's steps). The supervisor sums its visits; each
  `worker` sums its own.

### 3.3 Protocol (`packages/protocol/src/index.ts`)

```ts
export interface TurnUsage { inputTokens: number; outputTokens: number; totalTokens: number }
// AgentRun gains:  usage?: TurnUsage
// Message  gains:  usage?: TurnUsage   // turn total = sum of agentRuns' usage
```

Delivered on **`message:complete`** (the `Message` carries `usage` + each `AgentRun.usage`). No new
streaming event (P3-D5).

### 3.4 Persist (`schema.ts` + `store.ts`)

- Migration `user_version 5 → 6`: `ALTER TABLE agent_runs ADD COLUMN prompt_tokens INTEGER`,
  `completion_tokens INTEGER`, `total_tokens INTEGER` (all nullable; old rows stay NULL).
- `insertTurn` writes the three columns per agent run; `loadMessagesWithRuns`/`loadAgentRuns`
  hydrate `AgentRun.usage` and reconstruct `Message.usage` = sum of its runs' usage (NULL → omit).

### 3.5 Display (renderer)

- **Per-turn footer:** in `MessageBubble`, beside `MessageActions`, show `↑{input} ↓{output}` tokens
  and (if the active model has catalog pricing) `$cost`, from `message.usage`.
- **Session total:** a chip in `ChatHeader` via a new derived hook `useActiveUsageTotal()` that sums
  `messages[].usage` for the active session (no `SessionVM` accumulator → no drift).
- **Cost (P3-D6):** `cost = inTok × catalog.cost.input + outTok × catalog.cost.output` (apply the
  models.dev unit scaling, typically per-1M-token), computed where the active model's catalog entry
  is known on the renderer. Token-only when no price. i18n keys `chat.usage.*` /`artifact.usage.*`
  (en/zh-CN/zh-TW).

---

## §4 — Protocol changes (single file, declared first)

`packages/protocol/src/index.ts`:

- `AgentRole`: `… | 'worker'`.
- `TurnUsage` interface (§3.3).
- `AgentRun.usage?: TurnUsage`; `Message.usage?: TurnUsage`.
- Refresh now-stale comments: `ToolCall.name` ("never 'task'" → `'task'` is now valid),
  `ToolCall.agentId` / `AgentRun.parentAgentId` (roles now include `'worker'`).

No new `ServerMessage`/`ClientMessage` variants — A rides on `tool:*`, B rides on the existing
`agent:*`/`tool:*`, C rides on `message:complete`.

---

## §5 — Persistence & schema

- One additive migration (§3.4) — `agent_runs` usage columns.
- No table changes for A (rides on `tool_calls`) or B (rides on `agent_runs`).
- `loadMessagesWithRuns` reconstructs `Message.usage` and `AgentRun.usage` so per-turn + session
  totals survive reload.

---

## §6 — Frontend changes (map)

| File | Change |
|---|---|
| `src/components/chat/TurnTimeline.tsx` | checklist render for `write_todos`; suppress raw `task` tool row |
| `src/components/artifact/ToolCallRow.tsx` | (if checklist lives here) special-case `write_todos` |
| `src/components/chat/MessageBubble.tsx` | per-turn usage/cost footer next to `MessageActions` |
| `src/components/chat/ChatHeader.tsx` | session-total usage/cost chip |
| `src/domain/hooks.ts` + `src/domain/index.ts` | `useActiveUsageTotal()` selector + re-export |
| `src/lib/roleColor.ts` | `'worker'` in `ROLE_COLOR` / `ROLE_NAME_KEY` |
| `src/styles/tokens.css` | `--role-worker` |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | `roles.worker`, `chat.todos.*`, `chat.usage.*` (identical shape across all three) |

`SessionVM` is **unchanged** (no todos field, no usage accumulator — both derive from `Message`).

---

## §7 — System prompt

`system-prompt.ts` BASE: reconcile "do not over-plan" with `write_todos` guidance (§1.2) and add the
`task` tool's one-liner (§2.1). Child sub-agents get a focused `childSystemPrompt(description)` —
the same base tools guidance, minus planning/delegation, framed as "complete this delegated
sub-task and return your result."

---

## §8 — Testing (all paid-free, fakes only)

> **Test safety:** this machine has a live PAID DeepSeek key. Never run a bare `vitest run`,
> `vitest run src…`, or globs (they substring-match paid suites). Always pass explicit non-LLM file
> paths. Never run `session.test.ts` or `reasoner-reasoning.integration.test.ts`. Sidecar types:
> `cd packages/sidecar && npx tsc --noEmit`. Frontend types: `npm run type-check`.

- **A:** `write_todos` tool returns confirmation; checklist render parses `input` and shows the
  three states; only the latest call renders.
- **B:** `spawnSubagent` with an **injected fake `ModelRunner`** (no live LLM): asserts a distinct
  `worker-<seq>` id, `agent:started`/`agent:finished` emitted with `parentAgentId='supervisor'`,
  child toolset excludes `task` (depth-1), parent `AbortSignal` propagates (abort → child stream
  throws), a child ending `awaiting_user` returns partial text (no `agent:interrupt`), and
  sequential execution of two `task` calls. `task` tool-row suppression in the frontend.
- **C:** usage aggregation across a multi-step supervisor turn and a turn with a sub-agent
  (per-agent sums; `Message.usage` = total); migration round-trip (insert with usage → load →
  `Message.usage`/`AgentRun.usage` reconstructed); renderer cost math; `useActiveUsageTotal` sum;
  graceful `undefined` usage (no crash, token-only).

---

## §9 — Build order (for the plan)

1. **A — `write_todos`** (tool + prompt + checklist render + i18n). Independent, smallest.
2. **C — token/cost** (streamUsage + agent-node emit + `GraphEmit.usage` + per-agent accumulate +
   protocol `TurnUsage` + migration + persist/hydrate + footer + header chip + cost). Independent
   of A.
3. **B — `task` sub-agent** (`'worker'` role lockstep + `makeEmit` refactor + `spawnSubagent` +
   `task` tool + child prompt + delete `agents.ts` + suppress `task` row). Last, because its child
   runs flow through C's capture → sub-agent usage is counted **for free**.

---

## §10 — Outstanding live-LLM verification (manual, paid — bundled with P1/P2's pending checks)

C assumes DeepSeek populates `usage_metadata` on the final streamed chunk under `streamUsage: true`.
**Spike-verify** (`scratch/spike-loop.mts`, single paid call) that the gathered `AIMessage.usage_metadata`
is non-empty before trusting the UI numbers. Fallback chain if empty:
`response_metadata.tokenUsage` → `additional_kwargs` → the `estimateTokens` char/3 heuristic (marked
"≈"). This joins P1's spike/GUI acceptance and P2's HITL-against-real-DeepSeek as the manual
verification bundle.
