# Render Agent Delegation Trace + Pipeline Consolidation — Design

**Status:** Approved (2026-06-09)
**Builds on:** `2026-06-09-inline-trace-thinking-design.md` (shipped the per-turn `Message.timeline`/`toolCalls`, the inline `TurnTimeline`, the repurposed per-turn `AgentDashboard`, and the thinking toggle). That design's **D10** deferred subagent prose and its frontend notes *intended* to remove the session-global `AgentVM` array — but the implementation kept it. This design lifts the D10 deferral (surfaces delegation + subagent output) **and** finishes the intended removal (one per-turn source of truth).

## Motivation — the multi-agent value is captured but invisible, and maintained twice

The expensive part of multi-agent visibility is done: `agent:started` carries `role`/`parentAgentId`/`taskInput`; the `task` delegation tool is filtered so delegations surface as agents not phantom tool rows; reasoning + tools are keyed by `turnId` and interleaved by `stepSeq`; everything persists (schema v5 `messages.timeline`, `tool_calls`, `agent_runs`) and rehydrates. Yet:

1. **The delegation instruction is invisible.** `taskInput` + `parentAgentId` are captured, persisted in `agent_runs`, and hydrated into `AgentVM` — but **no component reads them**. A user sees *that* a Coder ran, never *what it was told to do*. (`AgentCard.tsx:34-49` renders only role title + reasoning + tools.)
2. **Subagent output is dropped from the conversation.** `token:stream` is appended to the message body only when `role === 'supervisor'` (`sessionStore.ts:203-204`); the Planner's actual plan and the Reviewer's actual review are accumulated into `AgentVM.tokens` and then never rendered.
3. **Per-agent status is wrong.** `AgentDashboard.groupByAgent` derives status from "any tool still running" only (`AgentDashboard.tsx:21-22`), so a subagent still streaming text with no in-flight tool shows `done`, and a zero-tool agent always shows `done`. It ignores `agent:started`/`agent:finished`.
4. **Two divergent trace pipelines maintain the same data twice.** `Message.timeline`+`toolCalls` (per-turn, what `AgentDashboard` actually renders) vs `SessionVM.agents` (`AgentVM`, session-global, carries the delegation data). `useAgents()` (`hooks.ts:24`) has **no consumer** — `AgentVM` is dead state, and the parallel `tool:started`/`tool:finished` branches that maintain `s.agents[].toolCalls` are a live drift/duplication smell.

**Key enabling fact: the turn↔run association is already persisted.** `agent_runs.message_id` exists (`schema.ts:18`, `REFERENCES messages(id) ON DELETE CASCADE`), and `insertTurn(message, sessionId, runs)` writes a turn's message + its runs together with `message.id === turnId` (`session.ts:443-447`). The association is only dropped at the protocol boundary: `loadAgentRuns` never selects `message_id` (`store.ts:105`) and `AgentRun` has no such field. So **no DB migration is needed** to consolidate — the link is already in the table.

## Locked decisions

- **D1 — Full scope.** Render `taskInput` + `parentAgentId` + subagent text output; fix per-agent status; add real "Thought for Ns" timing; **and** consolidate the two pipelines into one. (Not just a render add.)
- **D2 — Placement = inline summary + panel full text.** Inline `TurnTimeline` gains a compact "Delegated to {role}: {taskInput, truncated}" row at the subagent's first appearance. The right-panel `AgentCard` shows the full `taskInput` and the subagent's full text output, expandable. The main transcript answer body is unchanged (still the supervisor's `Message.content`).
- **D3 — `Message` is the single per-turn source of truth.** `SessionVM.agents`/`AgentVM`/`agentVMfromRun`/`upsertAgent`/`useAgents` and all reducer branches that maintain `s.agents` are deleted. Both the inline timeline and the panel derive from the turn's `Message` alone.
- **D4 — Carry runs on the message; reuse the existing `message_id` link; no DB migration.** `AgentRun` gains `messageId` (maps the existing column); `Message` gains `agentRuns?: AgentRun[]`. The server attaches the turn's runs to the message at both `message:complete` and `session:loaded`.
- **D5 — Live folding mirrors the proven `toolCalls` lifecycle.** During streaming the reducer folds `agent:started`/`token:stream`(subagent)/`agent:finished` into the trailing message's `agentRuns`; `message:complete` overwrites with the server-authoritative `message.agentRuns` (exactly as `toolCalls` are built live then finalized).
- **D6 — Status derived from `finishedAt`.** An agent is `running` until its run has a `finishedAt` (live); `done` otherwise. Tool-running is no longer the status signal. Fixes the zero-tool / still-streaming mislabels.
- **D7 — One shared derivation.** `groupByAgent` moves out of `AgentDashboard` into a shared pure helper (`lib/turnAgents.ts`) that merges `Message.timeline` (reasoning/tools, ordered by `stepSeq`) with `Message.agentRuns` (taskInput/parentAgentId/output/timing) into an enriched `TurnAgent`. Inline and panel both call it.
- **D8 — `session:loaded` ships per-message `agentRuns`; the top-level `agentRuns` array is removed.** Avoids re-introducing a second source on the client.

## Architecture overview

A turn produces (a) an ordered `TimelineStep[]` (reasoning + tool steps, already owned by the message) and (b) a set of `AgentRun`s (one per participating agent, including the supervisor). Both belong to the same turn and are now both carried by the turn's assistant `Message`. The reducer maintains only the message; the inline timeline and the right-panel both derive their view from that one message via `groupByAgent`.

```
Message {
  id, role, content, agentId?, timestamp, stopped?,
  timeline?:  TimelineStep[]   // reasoning + tool steps, ordered by stepSeq (unchanged)
  toolCalls?: ToolCall[]        // flat tool calls referenced by timeline (unchanged)
  agentRuns?: AgentRun[]        // NEW — per-agent run metadata for THIS turn
}

AgentRun {                      // existing shape + one field
  agentId, role, output, startedAt, finishedAt, seq,
  taskInput?, parentAgentId?, toolCalls?,
  messageId                     // NEW — maps the existing agent_runs.message_id column
}

TurnAgent {                     // derived by groupByAgent(message), enriched
  agentId, role, reasoning, tools, status,        // existing
  taskInput?, parentAgentId?, output, elapsedMs   // NEW
}
```

`status` and `elapsedMs` come from the run (`finishedAt`); `reasoning`/`tools` come from the timeline; `taskInput`/`parentAgentId`/`output` come from the run. The two structures join by `agentId` within the turn.

## Data flow

**Live (one turn):**
1. `agent:started` (supervisor) ensures the trailing assistant message (`ensureAssistantMessage`, unchanged) and upserts a supervisor `AgentRun` onto `message.agentRuns` (`output:''`, `startedAt:now`, `finishedAt:null`).
2. Each subagent `agent:started` upserts an `AgentRun` onto the same message carrying `taskInput` + `parentAgentId` (`='supervisor'`).
3. `reasoning:delta` / `tool:started` / `tool:finished` update `message.timeline` + `message.toolCalls` (unchanged).
4. `token:stream`: supervisor delta still appends to `message.content` (unchanged); a **subagent** delta now appends to that agent's `AgentRun.output` on the message (replaces the old `s.agents[].tokens` write).
5. `agent:finished` sets `finishedAt` on that run → status flips to `done`.
6. `message:complete` replaces the trailing message with the server's authoritative message, which now carries `agentRuns` (the server already computes `runs` in `finalizeAndPersist:439`). Still-running tools are coerced via the existing `coerceRunningToolCalls`.

**Reload:** `session:loaded` ships each `Message` with `timeline` + `toolCalls` + `agentRuns` already attached. `groupByAgent(message)` renders directly. No `s.agents`, no client-side join across arrays.

**Cancel / regenerate:** A cancelled turn keeps its partial message (with partial `agentRuns`, `stopped:true`) via `finalizeCancelledMessage` — `agentRuns` ride along on the message, no separate handling. `regenerateLastTurn` slices off the trailing assistant message; its `agentRuns` vanish with it (sidecar `deleteLastAssistantMessage` cascades `agent_runs` by FK). The current separate `agents: []` reset in `regenerateLastTurn` is **deleted** (no longer any session-global agent array to reset).

## Protocol changes (`packages/protocol/src/index.ts`)

- `AgentRun`: add `messageId: string` (maps the existing `agent_runs.message_id`).
- `Message`: add `agentRuns?: AgentRun[]`.
- `message:complete`: no shape change — its `message` now simply carries `agentRuns` (the field is on `Message`).
- `session:loaded`: **remove** the top-level `agentRuns: AgentRun[]`; each `Message` in `messages` now carries its own `agentRuns`. (Single source on the client.)
- No new events: `agent:started`/`token:stream`/`agent:finished` already carry `turnId` and suffice for live folding.

## Sidecar changes

- **`persistence/store.ts`**
  - `loadAgentRuns`: add `message_id` to the SELECT and set `messageId` on each returned `AgentRun`. (No schema change — column exists.)
  - Provide message-grouped runs for load: either a `loadAgentRunsByMessage(sessionId): Map<messageId, AgentRun[]>` helper, or group in the manager. Runs stay ordered by `seq` within a message.
- **`session/session.ts` `finalizeAndPersist`**: stamp each `AgentRun` in `runs` with `messageId = turnId`, and include `agentRuns: runs` on the `message:complete` message (alongside the existing `timeline`+`toolCalls`). Persistence (`insertTurn`) is unchanged — it already writes the runs with `message_id`.
- **`session/session-manager.ts` `session:loaded` assembly**: attach `agentRuns` to each `Message` by `message_id` (from the grouped load) instead of shipping a flat top-level array. Messages with no runs get `agentRuns` omitted/empty.
- **`session/tool-trace.ts` `trajectoryToRuns`**: ensure it surfaces `taskInput`/`parentAgentId`/`output` per run (it already builds `TraceRun`s with these) and that `messageId` is settable by the caller (or threaded through). No behavior change to tool/timeline assembly.

## Persistence

**No migration.** Schema stays at v5. The `agent_runs.message_id` column (added in v4) already links runs to turns; this design just stops discarding it at the protocol/load boundary. Legacy turns (pre-trace) simply have zero `agent_runs` rows → `agentRuns` empty → renders exactly as today (plain content + any timeline/tools).

## Frontend changes

- **`domain/sessionStore.ts`**
  - **Add** run-folding to the trailing message keyed by `turnId`: a `upsertRun(messages, turnId, run)` helper used by `agent:started` (uses the injected `now` for the live `startedAt`, `finishedAt: null`); `token:stream`(subagent) appends to the matching run's `output` (defensive no-op if the run is absent, mirroring `upsertReasoning`); `agent:finished` sets `finishedAt` to the injected `now`. `message:complete` then replaces the message wholesale → the server's real `startedAt`/`finishedAt`/`output` win (live values are provisional only).
  - **Delete:** `AgentVM` interface, `SessionVM.agents`, `agentVMfromRun`, `upsertAgent`, the `coerceRunningTools` (s.agents variant), the `agents:` resets in `summaryToVM`/`emptySession`, and the `s.agents` maintenance branches in the `agent:started`/`token:stream`/`agent:finished`/`tool:started`/`tool:finished`/`message:complete`/`error`(CANCELLED) handlers and in `regenerateLastTurn`. Net: every `.agents` read at `sessionStore.ts:51,182,199-200,217,234,252,264,273` goes away.
- **`domain/hooks.ts` + `domain/index.ts`**: delete `useAgents` and `EMPTY_AGENTS` (no consumer) and drop the `useAgents` re-export.
- **`lib/turnAgents.ts` (NEW, pure):** export `groupByAgent(message, live): TurnAgent[]` — moved out of `AgentDashboard` and enriched to merge `timeline` + `toolCalls` + `agentRuns`. Status: `running` while `live && finishedAt == null`, else `done`. `elapsedMs`: only meaningful once finished (`finishedAt - startedAt`); while running it is `0` and the card shows the running indicator, not a number (no wall-clock read inside this pure helper). `output`/`taskInput`/`parentAgentId` from the matching run. Unit-tested.
- **`components/artifact/AgentCard.tsx`**: extend `TurnAgent` (now imported from `lib/turnAgents.ts`) with the new fields. Header: when `parentAgentId` is set, render a "Delegated by Supervisor" line + the full `taskInput`. Expanded body: keep reasoning + `ToolTrace`, **add** a subagent `output` block (the plan/review). Status row uses `elapsedMs` → "Thought for Ns" via `chat.thoughtFor`.
- **`components/artifact/AgentDashboard.tsx`**: stop defining `groupByAgent` locally; import from `lib/turnAgents.ts`. Otherwise unchanged (still picks the latest assistant message; supervisor card + subAgents section).
- **`components/chat/TurnTimeline.tsx`** + **`components/chat/MessageBubble.tsx:49`**: pass `agentRuns={message.agentRuns}` into `TurnTimeline`. In the timeline, at a subagent's first step, render a compact "Delegated to {role}: {taskInput truncated}" row (role-colored badge), pointing the user to the panel for full text. `ThinkingDisclosure` now receives `seconds` (from the run timing where available) to fill the existing "Thought for Ns" label (kills the half-built dead UI).
- **i18n (`src/i18n/{en,zh-CN,zh-TW}.ts`):** add `artifact.delegatedBy` ("Delegated by Supervisor"), `chat.delegatedTo` ("Delegated to {{role}}"), `artifact.subAgentOutput` ("Output"). `chat.thoughtFor` exists; it now actually receives `seconds`. Types derive from `zh-CN`.

## Back-compat & invariants

- **`ensureAssistantMessage` invariant** (supervisor `agent:started` precedes any token/tool/finalize for the turn, and the provisional message is the trailing assistant message while streaming) is reused so run-folding always targets the right message tail.
- **`messageId === turnId`** holds in the sidecar (`finalizeAndPersist` uses `turnId` for both the message id and each run's `messageId`), so client live-folding (keyed by `turnId`) and server persistence agree.
- **Latest-turn-only view** is unchanged: `AgentDashboard` still derives from the latest assistant message; we only changed where the per-agent data comes from. No multi-turn merge ambiguity (the old session-global `s.agents` upsert-by-agentId, which collided across turns, is gone).
- **Legacy sessions** (no `agent_runs`) → empty `agentRuns` → identical to current rendering.

## Testing strategy

- **Pure units (vitest node):**
  - `lib/turnAgents.ts`: merge of timeline + agentRuns; status from `finishedAt` (zero-tool agent shows `running` until finished, `done` after); `elapsedMs` timing; output/taskInput/parent surfacing; supervisor-with-no-taskInput case.
  - `store.test.ts`: `loadAgentRuns` returns `messageId`; runs group correctly by `message_id`; round-trip across multiple turns; cascade on `deleteLastAssistantMessage`.
- **Reducer (`sessionStore.test.ts`):** the live fold sequence `agent:started`(supervisor)→`agent:started`(subagent w/ taskInput)→`token:stream`(subagent)→`agent:finished`→`message:complete` yields the expected `message.agentRuns`; `message:complete` overwrites the live fold with server runs; CANCELLED keeps partial `agentRuns` on the stopped message; `regenerateLastTurn` drops them with the message. Assert the removed `s.agents` paths are gone (no `SessionVM.agents`).
- **Sidecar (`session-unit`/`session-persist`/`session-manager-persist`):** `message:complete` and `session:loaded` both carry per-message `agentRuns` with `messageId`; the top-level `session:loaded.agentRuns` is gone.
- **No DOM/RTL** — presentational React verified by `yarn type-check`; behavior by GUI acceptance (project convention).
- **Live DeepSeek (skipIf no key):** the existing multi-agent delegation + cancel-persist suites stay green; assert a delegated turn now produces subagent runs with `taskInput` + non-empty `output`.
- **Manual GUI acceptance (user):** run a delegating prompt; confirm the inline "Delegated to Planner: …" row appears, the right-panel cards show the full instruction + the Planner's plan / Reviewer's review, status flips correctly (no premature "done"), "Thought for Ns" shows real seconds, and reload reproduces all of it.

## Risks & deferred validations

- **`message:complete` authority vs live fold.** The live fold is provisional; the server's `agentRuns` win at finalize. Risk if server runs ever diverge from the live stream (e.g. a run the server merged differently). Mitigation: the server is already the source of truth for `toolCalls` the same way; assert parity in the reducer test.
- **`elapsedMs` while live.** A still-running run has no `finishedAt`; "Thought for Ns" should not render a misleading number mid-stream — show the running indicator until `finishedAt`, then the elapsed value. Covered by the status/timing unit test.
- **Output size.** Subagent `output` can be large; it's already persisted in `agent_runs.output` and already rendered for the supervisor. Rendering subagent output in an expandable card bounds visual cost; no new clip needed beyond what exists.
- **Zustand stable refs (#185):** `groupByAgent` derives a fresh array — keep deriving **inside components** from the stable messages selector (the existing `AgentDashboard` pattern), never in a selector returning a new array.

## Out of scope (YAGNI)

- Multi-level / nested task-tree rendering (delegation is always 2-level supervisor→child today).
- Full subagent output **inline** in the transcript (only a compact delegation summary inline; full text in the panel).
- Parallel sub-agents (delegation remains sequential).
- A normalized per-step table or any schema change (the existing `message_id` link suffices).
- Touching other roadmap themes (resilience, search jump-to-message, session library, per-conversation config, attachments/cost).
