# Phase 2: Plan → Execute → Verify Loop — Implementation Plan

**Branch:** `feature/tool-runner-modernization`
**Prerequisite:** Phase 1 committed (ToolRunner, ApprovalCache, ToolPolicy, sticky HITL)
**Date:** 2026-06-20

---

## Overview

Add an optional **plan → execute → verify** loop to the LangGraph agent loop, with user approval/amendment of plans. Simple requests take a fast path that skips planning entirely.

---

## Wave 1: Protocol Types + Graph Infrastructure

**Goal:** Define all new message types and LoopState fields. Add `plan` node, `planPause` node, `verify` routing logic, and `planRouter` to the StateGraph. Existing fast-path tests must continue to pass.

### 1.1 Protocol types (`packages/protocol/src/index.ts`)

Add to `ClientMessage` union:

```typescript
| { type: 'plan:respond'; sessionId: string; action: 'approve' | 'reject' | 'amend'; amendContent?: string }
```

Add to `ServerMessage` union:

```typescript
| { type: 'plan:published'; sessionId: string; turnId: string; plan: PlanItem[] }
```

Add shared type:

```typescript
export interface PlanItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}
```

Extend existing `agent:interrupt` context (optional, no type change — use `context` field):

The existing `agent:interrupt` has `question: string` and `context?: string`. When the plan pause fires, `question` will be a plan-approval prompt and `context` will carry `JSON.stringify({ kind: 'plan_approval', plan: PlanItem[] })`. This avoids a new interrupt variant.

### 1.2 Graph state fields (`packages/sidecar/src/session/graph.ts`)

Add to `LoopState`:

```typescript
planningMode: Annotation<'fast' | 'plan'>({ reducer: (_prev, next) => next, default: () => 'fast' }),
planStatus: Annotation<'none' | 'generating' | 'ready' | 'approved' | 'rejected'>({ reducer: (_prev, next) => next, default: () => 'none' }),
plan: Annotation<PlanItem[] | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
planAmendContent: Annotation<string | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
verifyMemo: Annotation<string | undefined>({ reducer: (_prev, next) => next, default: () => undefined }),
```

Where `PlanItem` is imported from `@hip/protocol`.

### 1.3 New graph nodes (`packages/sidecar/src/session/graph.ts`)

**`planNode`** (async, between compact and planPause):
- If `state.planStatus === 'generating'` (amendment re-run), prepend a `HumanMessage(planAmendContent)` to the message list to give the LLM the user's amendment feedback.
- Inject a planning `SystemMessage` with instructions: "Analyze the user's request. Break it into concrete, ordered steps. Call `write_todos` with the plan. Then output a one-sentence summary of the plan."
- Call `runner.run()` with tools bound (so `write_todos` is available).
- Set `planStatus: 'ready'`, `planningMode: 'plan'`.
- Return updated messages and incremented steps.

**`planPause`** (sync, after planNode):
- Set `status: 'awaiting_user'`, `pendingQuestion: 'Review the plan above. Approve, reject, or suggest changes.'`.
- The `plan` field in state carries the parsed plan items for the session.ts interrupt handler.
- Edge: → END.

**`verifyNode` logic** — inline in `routeAfterTools` (not a standalone node):
- If `state.planningMode === 'plan' && state.planStatus === 'approved'`:
  - Extract the last `write_todos` tool call from conversation to get the current plan state.
  - Check if any tool in the just-executed batch failed (ToolMessage with error content).
  - If failures detected, set `verifyMemo: 'Some planned steps encountered errors. Review and decide whether to continue.'` and route to `'pause'`.
  - If all tools succeeded but plan items remain incomplete, set `verifyMemo: undefined` and route to `'compact'` (continue).
  - If all plan items are marked `'completed'` and no more tool calls are pending, route to `END` (graceful completion after verify).
- If not in plan mode, existing routing applies (nudge/pause/compact).

### 1.4 New routing edges (`packages/sidecar/src/session/graph.ts`)

**`routeAfterCompact`** (replaces fixed `compact → agent` edge):
```typescript
function routeAfterCompact(state: State): 'plan' | 'agent' {
  if (state.planningMode === 'plan' && state.planStatus !== 'approved') return 'plan'
  return 'agent'
}
```

**Updated graph construction:**
```typescript
return new StateGraph(LoopState)
  .addNode('compact', compact)
  .addNode('agent', agent)
  .addNode('tools', toolsNode)
  .addNode('nudge', nudge)
  .addNode('pause', pause)
  .addNode('plan', planNode)           // NEW
  .addNode('planPause', planPause)     // NEW
  .addEdge(START, 'compact')
  .addConditionalEdges('compact', routeAfterCompact, { plan: 'plan', agent: 'agent' })  // CHANGED
  .addEdge('plan', 'planPause')        // NEW
  .addEdge('planPause', END)           // NEW
  .addConditionalEdges('agent', routeAfterAgent, { tools: 'tools', [END]: END })
  .addConditionalEdges('tools', routeAfterTools, { nudge: 'nudge', pause: 'pause', compact: 'compact', [END]: END })  // EXTENDED
  .addEdge('nudge', 'agent')
  .addEdge('pause', END)
  .compile()
```

### 1.5 `shouldPlan()` heuristic (`packages/sidecar/src/session/plan.ts` — NEW FILE)

```typescript
export function shouldPlan(userMessage: string, config?: { forcePlan?: boolean; disablePlan?: boolean }): boolean
```

Logic:
1. If `config?.disablePlan === true`, return `false` (fast path always).
2. If `config?.forcePlan === true`, return `true`.
3. Otherwise, heuristic check on `userMessage`:
   - `true` if message length > 200 chars (substantial request).
   - `true` if message contains multi-step indicators (keywords: "首先", "然后", "接着", "最后", "first", "then", "next", "finally", "步骤", "step", "1.", "2.", "3.", "todo", "plan").
   - `true` if message contains file creation/modification intent AND mentions multiple distinct files or directories.
   - `false` otherwise (short queries, single-file edits, questions).

### 1.6 Sidecar imports

In `packages/sidecar/src/session/graph.ts`, add:
```typescript
import type { PlanItem } from '@hip/protocol'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
```

### 1.7 Wave 1 verification

- `yarn workspace @hip/sidecar type-check` — passes.
- Existing tests pass: `yarn workspace @hip/sidecar vitest run packages/sidecar/src/session/graph.test.ts packages/sidecar/src/session/doom-loop.test.ts packages/sidecar/src/session/loop-control.test.ts`
- No test covers the new plan path yet (that's Wave 4). Fast-path behavior is unchanged.

---

## Wave 2: Session Orchestration

**Goal:** Integrate plan approval pause/resume into `Session.runTurn()` and `SessionManager`. Connect `plan:respond` to the resume mechanism.

### 2.1 Session.ts changes (`packages/sidecar/src/session/session.ts`)

**Pre-graph invocation (`runTurn` method, ~line 408):**

Before building the graph context, call `shouldPlan()`:

```typescript
const userText = lastUserText(base?.messages ?? this.messages)
const usePlan = shouldPlan(userText, {
  forcePlan: this._config.forcePlan,
  disablePlan: this._config.disablePlan,
})
```

Set `planningMode` in the initial state:
```typescript
const initialState = {
  messages: [new SystemMessage(system), ...(base?.messages ?? this.messages)],
  steps: base?.steps ?? 0,
  recentSigs: [],
  nudgedSig: undefined,
  status: 'running' as const,
  planningMode: usePlan ? 'plan' : 'fast',
  planStatus: base?.planStatus ?? (usePlan ? 'none' : 'none'),
  plan: base?.plan,
  planAmendContent: base?.planAmendContent,
  verifyMemo: undefined,
}
```

**Post-graph `awaiting_user` handling (~line 426):**

Extend the existing `if (finalState.status === 'awaiting_user')` block:

```typescript
if (finalState.status === 'awaiting_user') {
  this.paused = {
    messages: finalState.messages.slice(1),
    steps: finalState.steps,
    // NEW: carry plan state across pause/resume
    planningMode: finalState.planningMode,
    planStatus: finalState.planStatus,
    plan: finalState.plan,
  }
  this.awaitingResume = true
  
  // NEW: if this is a plan pause, emit plan:published first
  if (finalState.planningMode === 'plan' && finalState.plan) {
    send({ type: 'plan:published', sessionId: this.id, turnId, plan: finalState.plan })
  }
  
  const stoppedText = this.finalizeAndPersist(send, turnId, supervisorText, trajectory, true, usageByAgent)
  void this.hooks.fire('TurnComplete', { sessionId: this.id, turnId }).catch(() => {})
  
  // NEW: include plan context in interrupt when applicable
  const interruptContext = finalState.planningMode === 'plan'
    ? JSON.stringify({ kind: 'plan_approval', plan: finalState.plan })
    : undefined
  send({
    type: 'agent:interrupt',
    sessionId: this.id,
    turnId,
    agentId: 'supervisor',
    question: finalState.pendingQuestion ?? PAUSE_QUESTION,
    ...(interruptContext ? { context: interruptContext } : {}),
  })
  return stoppedText
}
```

**Extend `PausedState` type (internal to session.ts):**

The existing `paused` field type needs to carry plan state:
```typescript
private paused: {
  messages: BaseMessage[]
  steps: number
  planningMode?: 'fast' | 'plan'
  planStatus?: 'none' | 'ready' | 'approved' | 'rejected'
  plan?: PlanItem[]
} | null = null
```

**New method: `handlePlanResponse(action, amendContent?)`:**

Called by `session-manager.ts` when a `plan:respond` message arrives:

```typescript
async handlePlanResponse(action: 'approve' | 'reject' | 'amend', amendContent?: string, send: SendFn): Promise<void> {
  if (!this.awaitingResume || !this.paused) return
  
  switch (action) {
    case 'approve': {
      const base = {
        messages: this.paused.messages,
        steps: this.paused.steps,
        planningMode: 'plan' as const,
        planStatus: 'approved' as const,
        plan: this.paused.plan,
        planAmendContent: undefined,
      }
      this.awaitingResume = false; this.paused = null
      await this.runTurn(send, base)
      break
    }
    case 'reject': {
      this.awaitingResume = false; this.paused = null
      send({ type: 'error', sessionId: this.id, code: 'PLAN_REJECTED', message: 'Plan was rejected by the user.' })
      break
    }
    case 'amend': {
      // Re-run the plan node with user feedback
      const base = {
        messages: [...this.paused.messages, new HumanMessage(amendContent ?? 'Please revise the plan.')],
        steps: this.paused.steps,
        planningMode: 'plan' as const,
        planStatus: 'generating' as const, // signals planNode to regenerate
        plan: this.paused.plan,
        planAmendContent: amendContent,
      }
      this.awaitingResume = false; this.paused = null
      const ts = Date.now()
      if (this.store) {
        this.store.insertMessage({ id: `u-${ts}`, sessionId: this.id, role: 'user', agentId: null, content: amendContent ?? 'Please revise the plan.', timestamp: ts })
        this.store.touchSession(this.id, ts)
      }
      await this.runTurn(send, base)
      break
    }
  }
}
```

The existing `resume()` method must also be updated to carry plan state through when `message:resume` is used (for non-plan pauses like doom-loop). The `resume()` method constructs its base from `this.paused`, which now includes plan fields — those should pass through transparently.

### 2.2 Session-manager.ts changes (`packages/sidecar/src/session/session-manager.ts`)

Add case to `handleAsync` switch:

```typescript
case 'plan:respond':
  await this.ensureSession(msg.sessionId).handlePlanResponse(
    msg.action,
    msg.amendContent,
    send,
  )
  break
```

### 2.3 Wave 2 verification

- `yarn workspace @hip/sidecar type-check` — passes.
- Existing session-manager and session tests pass:
  ```
  yarn workspace @hip/sidecar vitest run \
    packages/sidecar/src/session/session-manager-persist.test.ts \
    packages/sidecar/src/session/session-manager-resume.test.ts \
    packages/sidecar/src/session/session-manager-config.test.ts \
    packages/sidecar/src/session/session-unit.test.ts
  ```
- Manual test: send a complex message, verify `planningMode: 'plan'` is set; send a simple message, verify `planningMode: 'fast'`.

---

## Wave 3: Frontend Integration

**Goal:** Frontend receives `plan:published`, renders plan artifact, shows approval UI on `agent:interrupt` with plan context, and sends `plan:respond`.

### 3.1 sessionStore.ts (`src/domain/sessionStore.ts`)

In `applyServerMessage()`, add handler for `plan:published`:

```typescript
else if (msg.type === 'plan:published') {
  // Store plan in the active session's turn state.
  // The plan items are surfaced via the existing write_todos → ToolCall → latestTodos pipeline.
  // plan:published provides an authoritative plan snapshot that the UI can render
  // even before the turn completes.
  state.activeTurnPlan = msg.plan
}
```

Add `activeTurnPlan: PlanItem[] | null` to the domain state.

In `applyServerMessage()`, when `agent:interrupt` arrives with `context` containing `kind: 'plan_approval'`:
- Set a flag `planApprovalPending: true` on the session so the UI knows to show plan approval controls.

### 3.2 sessionService.ts (`src/domain/sessionService.ts`)

Add method:

```typescript
respondPlan(sessionId: string, action: 'approve' | 'reject' | 'amend', amendContent?: string): void {
  this.transport.send({ type: 'plan:respond', sessionId, action, amendContent })
}
```

### 3.3 Plan approval UI

Modify `src/components/chat/` — the component that handles `agent:interrupt` (currently shows a text input for doom-loop pauses). When `context.kind === 'plan_approval'`:

1. Render the plan items as a checklist (reuse `TurnTimeline`'s todo rendering or `ArtifactCard`).
2. Show three buttons: **Approve**, **Reject**, **Amend**.
3. On **Amend**, show a text input for feedback, then send `plan:respond` with `action: 'amend'` and `amendContent`.
4. On **Approve**, send `plan:respond` with `action: 'approve'`.
5. On **Reject**, send `plan:respond` with `action: 'reject'`.

The plan items data is available from:
- `plan:published` ServerMessage (authoritative) — Wave 3.1
- `write_todos` ToolCall on the streaming message (real-time, already parsed by `latestTodos()`) — existing

The UI should prefer `plan:published` when available, falling back to `latestTodos()`.

### 3.4 File to create/modify

- **Modify:** `src/domain/sessionStore.ts` — handle `plan:published`, parse plan context from `agent:interrupt`
- **Modify:** `src/domain/sessionService.ts` — add `respondPlan()`
- **Modify:** `src/components/chat/TurnTimeline.tsx` — render plan items from `plan:published` if available
- **Modify:** The component that renders `agent:interrupt` UI — add plan approval buttons (likely `src/components/chat/ChatInput.tsx` or a dedicated interrupt handler component)

### 3.5 Wave 3 verification

- `yarn type-check` — passes.
- Visual QA: complex message triggers plan flow, plan appears in chat, approve/reject/amend buttons work.
- Fast path: simple message "what is 2+2" goes through without plan.

---

## Wave 4: Tests

**Goal:** Add unit and integration tests for all new behavior. Keep existing test suite green.

### 4.1 `plan.ts` unit tests (`packages/sidecar/src/session/plan.test.ts` — NEW)

- `shouldPlan` returns `false` for short/simple messages
- `shouldPlan` returns `true` for long/complex messages
- `shouldPlan` respects `forcePlan: true`
- `shouldPlan` respects `disablePlan: true`

### 4.2 Graph plan-node tests (extend `packages/sidecar/src/session/graph.test.ts`)

- Plan node generates plan and calls `write_todos` when `planningMode: 'plan'` and `planStatus: 'none'`
- Plan node regenerates plan when `planStatus: 'generating'` (amendment)
- Plan pause sets `status: 'awaiting_user'` after plan node
- Fast path (`planningMode: 'fast'`) skips plan node entirely (existing tests already cover this)
- Verify routing: tools succeed + plan items incomplete → route to `'compact'`
- Verify routing: tool failure in plan mode → route to `'pause'`
- Verify routing: all plan items completed → route to `END`

### 4.3 Session plan orchestration tests (extend `packages/sidecar/src/session/session.test.ts` or new file)

- `shouldPlan` is called before graph invocation
- `planningMode` is set in initial state based on `shouldPlan` result
- `plan:published` is emitted when plan pause fires
- `agent:interrupt` carries `context` with `kind: 'plan_approval'`
- `handlePlanResponse('approve')` resumes graph with `planStatus: 'approved'`
- `handlePlanResponse('reject')` sends error and does not resume
- `handlePlanResponse('amend')` resumes graph with `planStatus: 'generating'` and `planAmendContent`

### 4.4 Session-manager routing tests (extend `packages/sidecar/src/session/session-manager-persist.test.ts`)

- `plan:respond` client message routes to `session.handlePlanResponse()`

### 4.5 Frontend tests

- `sessionStore.test.ts`: `plan:published` updates `activeTurnPlan`
- `sessionStore.test.ts`: `agent:interrupt` with plan context sets `planApprovalPending`
- Component test: plan approval UI renders plan items and buttons

### 4.6 Wave 4 verification

Run all tests:
```bash
yarn workspace @hip/sidecar vitest run packages/sidecar/src/session/
yarn vitest run src/
```

---

## Implementation Order

| Step | Wave | File(s) | What | Keeps suite green? |
|------|------|---------|------|--------------------|
| 1 | 1 | `packages/protocol/src/index.ts` | Add `PlanItem`, `plan:respond`, `plan:published` types | ✅ (types only) |
| 2 | 1 | `packages/sidecar/src/session/plan.ts` (new) | `shouldPlan()` heuristic | ✅ (new file) |
| 3 | 1 | `packages/sidecar/src/session/graph.ts` | Add LoopState fields, planNode, planPause, routeAfterCompact, verify logic | ✅ (new nodes idle unless planningMode='plan') |
| 4 | 2 | `packages/sidecar/src/session/session.ts` | Extend PausedState, call shouldPlan(), handle plan pause emission, add handlePlanResponse() | ✅ (fast path unchanged) |
| 5 | 2 | `packages/sidecar/src/session/session-manager.ts` | Route `plan:respond` | ✅ (new case, unused until frontend sends) |
| 6 | 3 | `src/domain/sessionStore.ts` | Handle `plan:published`, parse plan context from `agent:interrupt` | ✅ (new message types) |
| 7 | 3 | `src/domain/sessionService.ts` | Add `respondPlan()` method | ✅ (new method) |
| 8 | 3 | `src/components/chat/` | Plan approval UI (buttons + amend input) | ✅ (gated behind plan mode) |
| 9 | 4 | `packages/sidecar/src/session/plan.test.ts` (new) | `shouldPlan` unit tests | ✅ |
| 10 | 4 | `packages/sidecar/src/session/graph.test.ts` | Plan node, verify routing, fast path tests | ✅ |
| 11 | 4 | `packages/sidecar/src/session/session.test.ts` | Plan orchestration tests | ✅ |
| 12 | 4 | Frontend tests | sessionStore, component tests | ✅ |

---

## Key Design Decisions Encoded

| Decision | Implementation |
|----------|---------------|
| **A: Dedicated plan node** | `planNode` in graph.ts — separate LLM call with planning SystemMessage |
| **B: Plan approval before execution** | `planPause` node → `agent:interrupt` with plan context → `plan:respond` resume |
| **C: Verify node after tools** | Inline in `routeAfterTools` — checks tool failures and plan completion |
| **D: Approve/reject/amend** | `handlePlanResponse()` in session.ts with three action branches |
| **E: Plan as frontend artifact** | `plan:published` ServerMessage + existing `write_todos` tool parsing |
| **F: Persist plan as todos** | Plan node calls `write_todos` tool; frontend already renders `write_todos` calls |
| **G: Fast path** | `planningMode: 'fast'` skips plan/verify nodes; `shouldPlan()` returns false for simple requests |

## Graph State Machine (Planned Path)

```
                    ┌──────────────────────────────────┐
                    │        USER SENDS MESSAGE         │
                    └──────────────┬───────────────────┘
                                   │
                            shouldPlan()?
                          ┌───────┴───────┐
                     false│               │true
                          ▼               ▼
                    ┌──────────┐   ┌──────────┐
                    │FAST PATH │   │planNode  │
                    │(existing)│   │(LLM call)│
                    └──────────┘   └────┬─────┘
                                        │
                                   ┌────▼─────┐
                                   │planPause │──→ agent:interrupt + plan:published
                                   │await_user│
                                   └────┬─────┘
                                        │
                        ┌───────────────┼───────────────┐
                        │               │               │
                     approve         reject          amend
                        │               │               │
                        ▼               ▼               ▼
                  ┌──────────┐   ┌──────────┐   ┌──────────────┐
                  │planStatus│   │END turn  │   │planStatus=   │
                  │=approved │   │(error)   │   │'generating'  │──→ back to planNode
                  └────┬─────┘   └──────────┘   │+amendContent │
                       │                        └──────────────┘
                       ▼
              ┌─────────────────┐
              │ agent → tools   │←──────────────┐
              │    → verify     │               │
              │    → compact    │───────────────┘
              └────────┬────────┘     (continue if plan incomplete)
                       │
              ┌────────┴────────┐
              │                 │
        plan complete     tool failure
              │                 │
              ▼                 ▼
            END              pause
                         (user decides)
```
