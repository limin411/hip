# Agent-Driven Orchestration + Agents Panel — Implementation Plan

> **For agentic workers:** Execute task-by-task. Spec: `docs/superpowers/specs/2026-07-10-agent-driven-orchestration-agents-panel-design.md` (D1–D3 locked).

**Goal:** Remove user fast/dag choice and DAG tab; harden agent harness (cancel projection, empty-output fail, tool aliases, permission inheritance, loop guards); unify observation in Agents panel with structure only when sub-agents exist.

**Architecture:** Always run StateGraph supervisor; delegation via `task`/`dispatch_agent` only (no product workflow entry). Workflow path remains for tests/dead code until Phase 3 cleanup but is not entered from `runTurn`.

**Tech Stack:** TypeScript, Vitest, React, sidecar LangGraph

---

## Phase 0 — Harness 止血

### Task 0.1 Cancel → finalize partial
- Modify: `packages/sidecar/src/session/workflow-runner.ts`
- Test: `packages/sidecar/src/session/workflow-runner.test.ts`

### Task 0.2 Empty agent text → node failed
- Modify: `packages/sidecar/src/orchestrator/node-runner.ts`
- Test: `packages/sidecar/src/orchestrator/node-runner.test.ts` (create if missing)

### Task 0.3 Tool aliases `bash|shell|sh` → `run_script`
- Modify: `packages/sidecar/src/session/tool-registry.ts`
- Test: `packages/sidecar/src/session/tool-registry.test.ts`

### Task 0.4 Workflow subagent inherits `permissionMode`
- Modify: `packages/sidecar/src/session/workflow-runner.ts` (`'full'` → `deps.config.permissionMode`)

### Task 0.5 Guard `.git/objects` thrash
- Modify: `packages/sidecar/src/session/doom-loop.ts` + graph tools path or registry settle
- Test: unit for path detector + settle rejection

### Task 0.6 (light) Ensure finalize persists stopped assistant — covered by 0.1

## Phase 1 — Unified main path

### Task 1.1 `resolveWorkflowDefForTurn` never forces cluster-default
- Modify: `packages/sidecar/src/session/session-turn-runner.ts`
- Test: `session-turn-runner.test.ts`

### Task 1.2 Remove orchMode UI
- Modify: `src/components/chat/ModelPicker.tsx` + tests + i18n optional leave keys

### Task 1.3 setOrchMode no-op / ignore on runTurn
- Backend already ignored if resolve returns null

## Phase 2 — Agents panel

### Task 2.1 Remove `dag` ArtifactTab
- `uiStore.ts`, `PanelToggle.tsx`, `ArtifactPanel.tsx`, tests, i18n, serverMessageEffects

### Task 2.2 Collaboration structure when sub-agents exist
- `AgentDashboard.tsx` + small structure component from parentAgentId

## Phase 3 — later
- Token/prompt budget, dead code cleanup, docs

---

Execute order: 0.1 → 0.2 → 0.3 → 0.4 → 0.5 → 1.x → 2.x → 3.x

## Status (2026-07-10)

- [x] Phase 0 harness 止血 (commit `a0ee3c7`)
- [x] Phase 1 统一主路径 / 去 orchMode UI
- [x] Phase 2 Agents 面板 + CollaborationStructure
- [x] Phase 3 follow-up: docs supersede, system-prompt harness guidance, pendingWorkflowDef tests (not orchMode)
