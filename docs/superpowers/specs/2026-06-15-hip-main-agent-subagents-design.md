# hip as the main agent, configured agents as sub-agents

**Date:** 2026-06-15
**Status:** Design approved, pending spec review → implementation plan
**Branch context:** stacked on `feat/agent-orchestration-foundation`

## Summary

Today a chat session is bound to exactly one agent via `config.agentId`:
`'builtin'`/undefined runs the hip LangGraph ReAct supervisor; any other id runs an
external provider (`LoopAgentProvider`, or `AcpAgentProvider` for OpenCode/ACP) for
the *entire* conversation. The composer's `AgentPicker` lets the user switch which
agent owns the chat.

This change makes **hip the only top-level agent**. The agents configured in
智能体管理 become **dispatchable sub-agents** that hip delegates to on its own
judgment. The composer is locked to hip, and its agent picker is replaced by a
**model picker** for hip.

## Decisions (locked during brainstorming)

1. **Delegation trigger — hip decides autonomously.** Each enabled configured agent
   becomes a dispatch tool hip can call when useful (agents-as-tools). The user only
   ever talks to hip.
2. **Sub-agent rendering — nested live, full fidelity.** A delegated turn streams
   inside hip's dispatch card: live reasoning, tool-call cards, and the HITL
   permission modal all bubble up (collapsible).
3. **Direct external sessions — retired fully.** New sessions are always hip; external
   agents exist only as sub-agents. Existing external-bound sessions become read-only
   history.
4. **Composer model picker — per-chat, locked at start.** Pick the model before the
   first message; fixed for the session afterward (mirrors how the agent is locked
   today). Flows into the existing `SessionConfig.model`.
5. **Dispatch wiring — Approach C (hybrid shared seam).** Build on the session's
   external-provider machinery for rich nested streaming + HITL, but factor a shared
   "resolve agentId → run one turn" seam (`AgentInvoker`, shaped like the
   orchestrator's `AgentRunner`) so the DAG orchestrator and the dispatch tool
   converge on one resolver later.

## Current state (what we build on)

- **Session turn loop** — `packages/sidecar/src/session/session.ts`:
  `Session.runTurn()` runs the LangGraph ReAct loop for the built-in agent;
  `isExternalAgent()` / `ensureExternalProvider()` route to an external provider
  when `config.agentId` is set. `spawnSubagent()` / `runSubagent()` already spawn
  depth-1 **LangGraph workers** (clones of hip, no `task` tool) — these are *not*
  the configured external agents, and they **swallow HITL**.
- **External providers** — `packages/sidecar/src/session/agents/`:
  `createAgentProvider()` → `LoopAgentProvider | AcpAgentProvider`;
  `AgentProvider.runTurn(userText, emit, signal, hooks)`; `ExternalAgentHooks`
  drives `requestPermission` (HITL) and `configOptions`. `readAgentsConfig()` /
  `resolveAgentModel()` in `registry.ts`.
- **Orchestrator** — `packages/sidecar/src/orchestrator/`: pure DAG engine with an
  `AgentRunner` port (`run(req, signal) → NodeOutput`), `buildRegistry(configs)`,
  `validate`, `reduce`, `executor`. Not yet wired into sessions. Its `AgentRunner`
  is the shape our shared seam mirrors.
- **Protocol** — `packages/protocol/src/index.ts`: `SessionConfig` (`agentId`,
  `llmProvider`, `model`, `baseURL`, …), `AgentConfig`, `AgentRole`
  (`supervisor`/`worker`), `parentAgentId`, ACP `configOptions` types.
- **Composer** — `src/components/chat/AgentPicker.tsx` (draft-time agent select +
  read-only committed badge), `InputBar.tsx`, `ComposerConfigSelectors`.
  `src/store/draftStore.ts` (`draft.agentId`), `src/store/providersStore.ts`
  (`activeModel`, catalog, `groupModelOptions`), `configFromDraft()` in the session
  service.
- **Settings** — `src/components/account/AgentManagement.tsx`, `AgentCard.tsx`,
  `AgentEditor.tsx`; `src/store/agentsStore.ts`.

## Design

### 1. Conceptual model

- hip (built-in LangGraph supervisor) is the only top-level agent; every new session
  is `config.agentId = 'builtin'`.
- Enabled configured agents are dispatchable sub-agents; hip delegates autonomously.
- A sub-agent turn is a full external-agent turn rendered nested under hip's dispatch
  card, streaming reasoning + tool cards, with HITL bubbling to the real modal.
- The composer is locked to hip; the agent picker becomes a model picker
  (per-chat, locked at start).

### 2. Dispatch tool + shared seam (sidecar)

- **One generic tool** `dispatch_agent({ agent, task })` added to hip's LangGraph
  toolset. `agent` is an enum built dynamically from *enabled* `AgentConfig`s at turn
  start; the tool description lists each agent's name + its "when to use" text.
  (One generic tool over N per-agent tools — mirrors Claude Code's single
  `Task` + `subagent_type`; less context, scales cleanly.)
- **Shared seam** `AgentInvoker`, shaped like the orchestrator's `AgentRunner`:
  `invoke(agentId, task, emit, signal, hooks) → finalText`. Implemented over the
  existing `createAgentProvider` + `resolveAgentModel` path (same one
  `ensureExternalProvider` uses). The orchestrator's `AgentRunner` can later wrap the
  same invoker — the Approach-C join point.
- Execution reuses proven machinery: ACP pool for OpenCode, provider lifecycle, abort
  propagation (hip-turn abort → sub-agent abort via `signal`).
- **Depth-1 only**: sub-agents do not receive the dispatch tool (matches today's
  worker cap). The tool returns the sub-agent's final text as its result; hip
  continues its turn.

### 3. Nested HITL (the one genuinely new piece of plumbing)

- The session already owns the interrupt channel, and external-provider hooks already
  drive `agent:interrupt` for direct sessions. The gap is only that depth-1 LangGraph
  workers swallow HITL.
- Change: the dispatched sub-agent's `requestPermission` routes through the session's
  existing interrupt mechanism, tagged with the sub-agent frame, so the modal reads
  "OpenCode (sub-agent) wants to run X." Resume continues the sub-agent's pending turn
  while hip is still mid-tool-call.
- Isolated to the dispatch path; the LangGraph-worker HITL behavior is untouched.

### 4. Protocol changes

- `SessionConfig.agentId` is always `'builtin'` for new sessions (legacy value
  tolerated when replaying old sessions). `model` is carried from the draft.
- **Event framing**: extend the existing `parentAgentId` / `AgentRole` so a dispatched
  sub-agent's stream is identifiable (`agentId`, display name, kind, role
  `'subagent'`). The UI nests on this frame.
- `AgentConfig` gains `description?: string` ("when to use this agent"). `enabled` now
  means "available as a sub-agent."

### 5. UI changes

- **Composer**: `AgentPicker` → `ModelPicker`. Draft gains `modelKey`
  (`providerID/modelID`), defaulting from `providersStore.activeModel`; reuses
  `groupModelOptions`. `configFromDraft` writes `SessionConfig.{llmProvider, model,
  baseURL}`. Committed sessions show a read-only model badge (reusing the read-only
  pattern `AgentPicker` already has).
- `ComposerConfigSelectors` (ACP live model/mode) no longer applies at top level
  (hip isn't ACP). Those selectors move into the nested sub-agent card, or defer.
- **Transcript**: hip's `dispatch_agent` tool call renders as a collapsible card
  containing the sub-agent's live transcript (reasoning + tool cards). HITL modal as
  today, labeled with the sub-agent.
- **智能体管理**: `AgentEditor` gains a "when to use / description" field; "enabled"
  relabeled to "available as sub-agent"; `boundModel` stays per-agent (sub-agents run
  on their own model, independent of hip's composer model).

### 6. Migration, scope (YAGNI), testing

- **Retire direct sessions**: new sessions always hip; old external-bound sessions
  render read-only from history (no new turns); agent-switch UI removed from composer.
- **Out of scope**: no DAG workflow UI (orchestrator stays separate but
  seam-compatible); no per-agent generated tools; depth-1 only.
- **Testing**:
  - TDD pure helpers: dispatch-tool schema builder from enabled agents;
    `configFromDraft` model mapping; sub-agent event-frame tagging.
  - Sidecar integration with a Fake provider: dispatch → nested stream → HITL →
    resume; abort propagation; depth-1 cap.
  - UI: `ModelPicker` draft/committed states; nested transcript rendering.
  - Manual GUI acceptance for a real OpenCode sub-agent + nested HITL (per the
    prefer-GUI-over-real-LLM-tests rule). Keep test runs paid-free (move
    `~/.hip/config/auth.json` aside before `yarn test`).

## Open thread

- `ComposerConfigSelectors` fate: move the live model/mode selectors into the nested
  sub-agent card, or drop them from this iteration. Leaning toward deferring until the
  nested card exists.

## Components & boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `AgentInvoker` (sidecar) | resolve agentId → run one external-agent turn | `createAgentProvider`, `resolveAgentModel` |
| `dispatch_agent` tool | expose enabled agents to hip's LangGraph loop, call `AgentInvoker` | `AgentInvoker`, enabled `AgentConfig`s |
| nested emit sink | tag sub-agent stream events with the dispatch frame | protocol event-frame types |
| nested HITL bridge | route sub-agent `requestPermission` → session interrupt | session interrupt channel |
| `ModelPicker` (UI) | per-chat model selection (draft) + read-only committed badge | `providersStore`, `draftStore` |
| nested sub-agent card (UI) | render the sub-agent transcript under hip's dispatch tool call | event-frame types |
| `AgentEditor` description field | capture "when to use" per agent | `agentsStore` |
