# Inline Agent Activity + Thinking + File-Honesty — Design

**Status:** Approved (2026-06-09)
**Supersedes the presentation of:** `2026-06-08-agent-execution-trace-design.md` (that feature shipped the tool-trace data + the right-panel AgentDashboard; this design moves the *display* inline and adds thinking + file honesty).

## Motivation — three GUI-acceptance bugs, three root causes

1. **Phantom file.** User asked for an HTML self-intro; the agent said it created `/workspace/self-intro.html`, but no file exists. **Root cause:** the model *hallucinated* the write — `tool_calls` had **0 rows** for that session; `write_file` was never called, and `/workspace/...` isn't even the real working dir. The filesystem plumbing is fine (`FilesystemBackend` rooted at `~/.hip/scratch/<sessionId>/`); the prompt forces a planner→coder→reviewer *ritual* but never forces a real write tool call.
2. **Inelegant agent display.** Agent activity is exiled to a default-closed right panel, disconnected from the conversation, dense and square. Claude Desktop weaves thinking + tools inline into the transcript.
3. **No thinking shown.** Broken at four layers: default model `deepseek-chat` emits no reasoning; the stream reads only `msg.text` (ignores `msg.reasoning`); the protocol has no reasoning field; the UI renders only `message.content` (`ThinkingBubble` is a static placeholder).

Bugs #2 and #3 converge on one design — **inline, collapsible thinking + tool activity in the transcript**. Bug #1 is a correctness fix that becomes self-policing once tool calls are visible inline.

## Locked decisions

- **D1 — Inline placement.** Thinking + tool activity render inline in the chat transcript (Claude Desktop style), not in a separate panel as the primary surface.
- **D2 — Flat timeline.** Within a turn, activity is a *flat chronological* list of steps; each step carries a small role-colored agent badge (Supervisor/Planner/Coder/Reviewer). Thinking disclosures and tool rows interleave in execution order.
- **D3 — Thinking toggle, default ON.** A per-conversation toggle. ON → `deepseek-reasoner` (emits `reasoning_content`); OFF → `deepseek-chat`. `deepseek-reasoner` supports function/tool calling, so one model serves both reasoning and the `task`/`write_file` tools.
- **D4 — Bug #1 fix = prompt hardening + real-cwd injection + post-hoc verification.**
- **D5 — Panel repurposed.** Keep `AgentDashboard`/`AgentCard`/`ToolTrace`/`ToolCallRow`, but feed them **per-turn** data derived from the selected message's timeline (not the session-global `agents` array). Inline timeline is primary; the panel is a power-user/debug detail view.
- **D6 — Turn-global ordering.** A single monotonic `stepSeq` per turn, assigned by the sidecar to every step (each reasoning burst + each tool call), is the authoritative order both live and on reload.
- **D7 — Timeline owned by the message.** The assistant `Message` owns its ordered `timeline[]`; activity belongs to a turn, not a session-global blob.
- **D8 — Persist as a JSON blob.** `messages.timeline TEXT` (JSON of the ordered steps). Reasoning content lives inside the blob; tool steps reference `tool_calls` rows by `callId`. No `agent_runs.reasoning` column.
- **D9 — Separate `reasoning:delta` event.** Reasoning streams on its own event, never folded into `token:stream`, so it can never leak into the answer body.
- **D10 — v1 scope.** Timeline = thinking + tool steps only (subagent prose hidden). Final answer stays `Message.content`.

## Architecture overview

A turn produces an ordered list of **timeline steps** carried by the turn's assistant message. The sidecar stamps each step with a turn-global `stepSeq` as it happens, so the live stream and the persisted blob describe the same order. The frontend renders that list inline above the answer; the repurposed panel renders the same list grouped by agent.

```
TimelineStep =
  | { kind:'reasoning'; stepSeq:number; agentId:string; role:AgentRole; content:string }
  | { kind:'tool';      stepSeq:number; agentId:string; role:AgentRole; callId:string }
```

`reasoning` steps store thinking text (one contiguous burst by one agent). `tool` steps reference the existing `ToolCall` record by `callId` — the `ToolCall` shape (callId, agentId, name, input, output, status, error, seq, truncated) is reused verbatim; no duplication.

## Data flow

**Live (one turn):**
1. `runTurn` computes a stable `turnId` (the assistant message id) at the top and a fresh `stepSeq` counter starting at 0.
2. Supervisor + subagent pumps iterate **both** `msg.text` and `msg.reasoning` (independent replay-buffer cursors → safe to read concurrently).
3. A *reasoning burst* opens on the first reasoning delta from an agent; subsequent deltas append; it closes when any tool fires or that agent finishes. On open it draws the next `stepSeq` and emits `reasoning:delta` (carrying `turnId`, `agentId`, `role`, `stepSeq`, `delta`).
4. Each `tool:started` draws the next `stepSeq`; the sidecar closes any open reasoning bursts first so order is exact. `tool:started`/`tool:finished` carry `turnId` + `stepSeq`.
5. Supervisor answer text streams on the **existing** `token:stream` (now also carrying `turnId`) and builds `Message.content`. Subagent prose is not surfaced in v1.
6. `finalizeAndPersist` assembles the ordered `TimelineStep[]`, runs file verification (below), and emits `message:complete` with the message carrying `timeline` + `toolCalls`.

**Reload:** `messages.timeline` JSON is parsed back to `TimelineStep[]`; `tool_calls` rows are grouped by `message_id` and attached as `Message.toolCalls`. Order is exact because the blob preserves `stepSeq`. Legacy v4 turns have `timeline = NULL` → render plain content (+ a minimal tool trace if `tool_calls` exist), no thinking disclosure.

## Protocol changes (`packages/protocol/src/index.ts`)

- Add `TimelineStep` union (above).
- `Message`: add `timeline?: TimelineStep[]` and `toolCalls?: ToolCall[]`.
- `SessionConfig`: add `thinking?: boolean` (default treated as `true`) and `language?: 'en' | 'zh-CN' | 'zh-TW'` (for the server-side correction note).
- New `ServerMessage`: `{ type:'reasoning:delta'; sessionId; turnId; agentId; role:AgentRole; stepSeq:number; delta:string }`.
- Extend `token:stream` with `turnId`. Extend `tool:started` with `turnId`, `role`, and treat its existing `seq` as the turn-global `stepSeq`. Extend `tool:finished` with `turnId`.
- Extend `agent:started`/`agent:finished` with `turnId`.
- New `ClientMessage`: `{ type:'session:setThinking'; sessionId; thinking:boolean }`. New `ServerMessage`: `{ type:'session:thinking'; sessionId; thinking:boolean }`.

## Sidecar changes

- **`session/session.ts`**
  - `buildModel` derives the model via `resolveModel(config)` → `config.thinking === false ? 'deepseek-chat' : 'deepseek-reasoner'`. Title generation stays hardcoded on `deepseek-chat`.
  - `runTurn`: compute `turnId` at the top; replace `toolSeq`/`agentSeq` with one `stepSeq` counter feeding both tools and reasoning bursts; thread `turnId` onto every `send()`.
  - Supervisor pump + subagent pump: wrap text and reasoning iteration per message in `Promise.all`; emit `reasoning:delta`; maintain an open-reasoning-burst-per-agent map; close open bursts before allocating a tool's `stepSeq`.
  - `finalizeAndPersist`: assemble ordered `TimelineStep[]` from the trajectory + reasoning buffers; call `verifyWrites(...)`; pass `timeline` to `insertTurn` and include `timeline`+`toolCalls` on the emitted message.
  - `setThinking(thinking)`: update `_config` + `buildAgent()` (mirrors `setCwd`, preserving `this.messages`); guarded to no-op while `this.running`; persist config; echo `session:thinking`.
- **`session/tool-trace.ts`**: `TraceRun` gains a `reasoning` accumulator (ordered bursts with their `stepSeq`); a `trajectoryToTimeline(trajectory)` helper produces the interleaved `TimelineStep[]`. Reasoning content is clipped with the existing `TOOL_BLOB_CAP` pattern (sticky `truncated`).
- **`session/agents.ts`**: convert `SUPERVISOR_PROMPT` and the coder subagent into builders `buildSupervisorPrompt(cwd)` / `buildSubagents(cwd)`:
  - **Real-cwd injection:** "Your working directory is the project root `<cwd>`. Filesystem tools are sandboxed to it. Address every path as an absolute path starting with `/`, relative to this root — e.g. write to `/self-intro.html` (maps to `<cwd>/self-intro.html`). Never use `/workspace`, `/tmp`, `/home`, or any path outside this root."
  - **Anti-phantom hardening:** "You MUST NOT claim, state, or imply any file was created, written, saved, or modified unless you actually called `write_file`/`edit_file` for that exact path this turn and it succeeded. If you did not call a write tool, say plainly that no file was created." Supervisor variant: "In your final summary, only report files the coder actually wrote via tool calls."
- **`session/verify.ts` (NEW, pure):** `verifyWrites(trajectory, supervisorText, language): { correction?: string }`.
  - `writtenPaths` = every `write_file`/`edit_file` tool call with `status === 'finished'`.
  - `claimsCreation` = conservative bilingual regex requiring a creation verb **and** a filename/path token (e.g. `created|wrote|saved|generated …\.\w+`, `已创建|已生成|已保存`).
  - **Lie case** (`claimsCreation && writtenPaths.size === 0`): return a localized correction (e.g. "⚠️ No files were actually created this turn — no write tool was called."). Appended to `Message.content` before persist/emit, so it persists and renders via the existing markdown path. Truth case and silent-write case: no note. Ground truth is the trajectory; the note fires only when zero writes happened, so it can never contradict a real write.
- **`session/session-manager.ts`**: add a `session:setThinking` handler (mirrors `setCwd`): `session.setThinking`, `store.updateConfig`, echo `session:thinking`. Default-config fallback gains `thinking: true`.

## Persistence (schema v5)

- **`persistence/schema.ts`**: add an additive, idempotent `if (version < 5)` block: `ALTER TABLE messages ADD COLUMN timeline TEXT` then `PRAGMA user_version = 5`, wrapped in the same BEGIN/COMMIT/ROLLBACK pattern as v4. No other columns — reasoning lives inside the JSON blob; tool detail stays in `tool_calls`.
- **`persistence/store.ts`**: `insertTurn` writes `messages.timeline` (JSON of `TimelineStep[]`, or NULL when empty). Message load hydrates `Message.timeline` from the blob and `Message.toolCalls` from `tool_calls` grouped **by `message_id`** (finally using the existing `agent_runs.message_id` / `tool_calls` linkage). `session:loaded` ships messages with `timeline`+`toolCalls` populated per message.

## Frontend changes

- **`domain/sessionStore.ts`**
  - The in-flight turn is keyed by `turnId`; `reasoning:delta` upserts a reasoning step on the trailing assistant message by `stepSeq`; `tool:started` pushes a tool step + a running `ToolCall` into `Message.toolCalls`; `tool:finished` patches it; `token:stream` (supervisor) still builds `Message.content`; `message:complete` commits the assembled timeline and coerces any still-running tools (reuse `coerceRunningTools`).
  - `SessionConfig` default gains `thinking: true`; add a `session:thinking` case setting `s.config.thinking`.
  - The session-global `agents` array is **retired as the inline/panel source**; both surfaces read each turn's `Message.timeline`/`toolCalls`. (Per-turn agent status for the live panel comes from turn-scoped `agent:started`/`agent:finished`.) Zustand v5: timeline lives on the Message → reuse the stable messages selector; derive per-agent groups and resolve tool steps inside components, never in a selector that returns a fresh array.
- **`components/chat/MessageBubble.tsx` + `components/chat/TurnTimeline.tsx` (NEW):** render `<TurnTimeline steps={message.timeline} toolCalls={message.toolCalls}/>` above the markdown answer. Reasoning steps = collapsible "Thought for Xs" disclosures (a new `ThinkingDisclosure`); tool steps reuse `ToolCallRow` (resolved from `toolCalls` by `callId`) with a small `--role-*` badge. Flat, ordered by `stepSeq`.
- **`components/chat/ChatPane.tsx`:** retire the static `ThinkingBubble` for the live case (the first streamed reasoning step replaces it); extend the autoscroll trigger to include timeline growth (not just `messages.length`).
- **Panel repurpose (`components/artifact/*`):** `AgentDashboard`/`AgentCard`/`ToolTrace`/`ToolCallRow` stay, fed by the **selected turn's** timeline (default = latest/in-flight turn), grouped by `agentId` — i.e. each agent card shows that turn's thinking + tools for that agent (subagent prose is not surfaced in v1, per D10); live per-agent status comes from turn-scoped `agent:started`/`agent:finished`. The session-global `AgentVM` array is removed. Clicking an inline tool row opens the panel scoped to that turn (the scroll-to-step affordance is nice-to-have for v1). `ToolCallRow`/`ToolTrace` move to (or are exported from) a shared location since both inline and panel use them.
- **`components/chat/Composer.tsx`:** replace the static model label with a **thinking toggle** bound to the active session's `config.thinking` (default on, disabled while a turn runs). `domain/sessionService.ts` gains `setThinking(id, thinking)` (optimistic local apply then `session:setThinking`); `createSession` already forwards full config so `thinking` flows at creation.
- **i18n (`src/i18n/{en,zh-CN,zh-TW}.ts`):** add keys for the thinking disclosure label, the toggle, and the `chat.noFilesWritten` correction note — in all three locales (types derive from `zh-CN`).

## Back-compat & legacy rendering

- v5 migration is strictly additive (`ALTER ADD COLUMN`), so existing v4 `hip.db` sessions load. Old turns have `timeline = NULL` → plain assistant content; if they carry `tool_calls`, show a minimal collapsed tool trace; no thinking disclosure.
- `regenerateLastTurn` already clears the turn's runs and cascades `tool_calls` on delete; it must also drop that turn's in-memory timeline (targeted removal, not a blanket clear, now that activity is multi-turn).
- Empty/aborted turns: still anchor activity on a (possibly stopped) assistant message so the timeline has an owner; if no message is created, drop the orphan activity.

## Testing strategy

- **Pure units (vitest node):** `trajectoryToTimeline` ordering/interleave; `verifyWrites` lie/truth/silent-write/no-claim cases; reasoning clip cap; schema v5 migration (v4→v5 additive, idempotent); store timeline round-trip + `message_id` grouping + cascade.
- **Protocol/store reducers:** `reasoning:delta`/`tool:*` upserts on the in-flight message; `message:complete` finalize + coercion; `session:loaded` rehydrate (incl. legacy NULL-timeline path); `session:thinking` config update.
- **No DOM/RTL** — presentational React verified by `yarn type-check` + GUI acceptance.
- **Live DeepSeek (skipIf no key):** existing multi-agent delegation + cancel-persist suites must stay green under the model toggle.
- **Manual GUI acceptance (user):** the self-intro HTML flow end-to-end — confirm a real file appears (or an honest "no file" correction), inline thinking renders, the timeline order is correct, reload reproduces it, and the thinking toggle flips the model.

## Risks & deferred validations

- **`deepseek-reasoner` streaming shape:** confirm via a live smoke test that reasoning arrives as incremental deltas (vs one terminal blob). If blob-only, reasoning renders as a single pre-tools step per agent — the design degrades gracefully (the timeline simply has one reasoning step before that agent's tools).
- **Reasoner + `task` ritual:** the multi-agent delegation has only been exercised on `deepseek-chat`; verify behavior/latency under reasoner during GUI acceptance.
- **Cost/latency:** default-ON thinking means reasoner by default — a real billing/latency change; accepted per D3, mitigated by the per-conversation toggle.
- **Reasoning size:** capped on persist (D8 + clip) to bound DB growth.
- **Zustand #185:** per-message rendering must keep stable references — derive outside selectors (the existing `AgentDashboard` pattern).

## Out of scope (YAGNI for v1)

- Subagent prose as timeline steps (only thinking + tools surface).
- A normalized `timeline_steps` table (JSON blob suffices; promote later only if steps must be queried).
- An affirmative "Files written: …" summary in the truth case (silence is enough).
- Scroll-to-step deep-linking from inline row → exact panel position (panel opens to the turn; precise scroll is nice-to-have).
