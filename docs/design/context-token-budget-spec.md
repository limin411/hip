# Context & Token Budget Management — Spec & Plan

**Status:** implemented  
**Date:** 2026-07-23  
**Scope:** sidecar session loop (compaction, prompt estimation, tool-output caps)

## Problem

Hip already has a layered compaction stack (micro-prune → sliding window → LLM summary → overflow retry), but:

1. Auto-compact triggers at a **fixed 48k tokens**, not a **% of the model context window**.
2. `tokenBudgetPercent` is computed against that 48k budget, not the real window.
3. `estimateTokens` counts **message text only** (misses system prompt + tool schemas).
4. `MIN_STEPS_BETWEEN_LLM_COMPACT` is defined but never enforced.
5. Summarizer has no degenerate-output guard.
6. Tool-output default cap (100KB) is more generous than peer agents (~40KB).

## Goals

| ID | Goal | Success criteria |
|----|------|------------------|
| G1 | Percentage-based auto-compact | Trigger at 85% of resolved `context_window` (70% for subagents) |
| G2 | Honest remaining budget | `tokenBudgetPercent` = remaining % of model window |
| G3 | Fuller prompt estimate | `estimatePromptTokens` includes messages + system + tools overhead |
| G4 | Prefer real usage | When last step reports `input_tokens`, use max(real, estimate) |
| G5 | Throttle LLM compact | At least `MIN_STEPS_BETWEEN_LLM_COMPACT` graph steps between LLM summaries (prune always ok) |
| G6 | Summary quality gate | Empty/too-short summary → one retry → extractive fallback |
| G7 | Tighter tool previews | Default tool-output byte cap = 40KB |
| G8 | Stable compact carrier | Summary message uses structured prefix; first user + recent tail preserved |

## Non-goals

- Real BPE tokenizer integration
- Two-pass / background prefire compaction
- Prompt-caching layout redesign
- Server-side provider compaction APIs

## Follow-up (implemented 2026-07-23 cont.)

| ID | Item | Status |
|----|------|--------|
| G9 | `TARGET_THRESHOLD_PERCENT` (50%) drives keep-tail via `selectKeepUnitsByTokenBudget` | done |
| G10 | Memory Phase1 flush before LLM compact (`flushMemoryBeforeCompact`, 15s timeout) | done |
| G11 | Two-pass prefire compact (NOTE₁ at threshold−10%, pass-2 merge at compact) | done |
| G12 | hip.toml `[context]` + env overrides (`resolveContextPolicy`) | done |
| G13 | Loop observability: `loop.compact` / `loop.prefire` + fill snapshot | done |
| G14 | Overflow secondary recovery (prune + tighter keep + second retry) | done |

### hip.toml `[context]`

```toml
[context]
autoCompactPercent = 85
subagentCompactPercent = 70
targetKeepPercent = 50
prefireLeadPercent = 10
twoPass = true
memoryFlushBeforeCompact = true
toolOutputMaxBytes = 40960
```

Env overrides: `HIP_TWO_PASS_COMPACT`, `HIP_CONTEXT_AUTO_COMPACT_PERCENT`,
`HIP_CONTEXT_SUBAGENT_COMPACT_PERCENT`, `HIP_CONTEXT_TARGET_KEEP_PERCENT`,
`HIP_CONTEXT_PREFIRE_LEAD_PERCENT`, `HIP_CONTEXT_MEMORY_FLUSH`,
`HIP_TOOL_OUTPUT_MAX_BYTES`.

Kill switch: `HIP_TWO_PASS_COMPACT=0|false|off`.

## Design

### Constants (aligned with grok-build / industry)

| Name | Value | Notes |
|------|-------|-------|
| `DEFAULT_CONTEXT_WINDOW` | 128_000 | Fallback when catalog has no limit |
| `AUTO_COMPACT_THRESHOLD_PERCENT` | 85 | Supervisor / default |
| `SUBAGENT_COMPACT_THRESHOLD_PERCENT` | 70 | Subagents bloat faster |
| `TARGET_THRESHOLD_PERCENT` | 50 | Reserved for keep-sizing (document; optional use) |
| `CHARS_PER_TOKEN` | 4 | bytes/chars heuristic (Codex / OpenCode / grok-build) |
| `MIN_SUMMARY_SEED_CHARS` | 80 | Below → degenerate |
| `DEFAULT_TOOL_OUTPUT_BYTES` | 40_000 | Was 100KB |
| `TOOL_SCHEMA_OVERHEAD_CHARS` | 400 | Per-tool fixed estimate (~100 tok) |

Legacy `COMPACT_BUDGET_TOKENS` becomes:

```ts
compactTriggerTokens(DEFAULT_CONTEXT_WINDOW, AUTO_COMPACT_THRESHOLD_PERCENT)
// = floor(128000 * 85 / 100) = 108_800
```

`SUBAGENT_COMPACT_BUDGET_TOKENS` becomes trigger at 70% of default window (= 89_600).  
Call sites that can resolve a real window pass absolute trigger derived from that window.

### Resolution of context window

1. Read `limit.context` from `~/.hip/cache/models.json` / catalog for active provider+model.
2. Else `DEFAULT_CONTEXT_WINDOW`.

### Prompt token estimate

```
estimatePromptTokens({ messages, systemPrompt?, tools? })
  = estimateMessages(messages)
  + estimateText(systemPrompt)
  + sum( name + description + TOOL_SCHEMA_OVERHEAD ) / 4
```

Gate:

```
used = max(lastPromptTokens ?? 0, estimatePromptTokens(...))
over = used * 100 >= contextWindow * thresholdPercent
```

### Graph wiring

`GraphCtx` gains:

- `contextWindowTokens?: number`
- `lastPromptTokens?: number`
- `compactBudgetTokens?: number` (absolute override; tests / forced budgets)
- `compactThresholdPercent?: number` (default 85 / 70)

`LoopState` gains:

- `stepsSinceLastLlmCompact: number` (default = `MIN_STEPS_BETWEEN_LLM_COMPACT` so first over-budget compact is allowed)

`compactNode` order:

1. Micro-prune (always)
2. Sliding window (message-count path; unchanged)
3. If over budget **and** `stepsSinceLastLlmCompact >= MIN` → LLM compact; reset counter to 0
4. Else increment counter

### Summary quality

After `summarizer.summarize`:

1. If `trim(text).length < MIN_SUMMARY_SEED_CHARS` → retry once (same messages, focus “more detail”).
2. If still short → extractive fallback: join middle message texts, hard-cap ~2k chars, prefix with note.

### Tool output

`DEFAULT_MAX_BYTES = 40 * 1024` (40KB). Tests that assert 100KB bound update accordingly.

### Backward compatibility

- `estimateTokens(messages)` kept (messages-only).
- `COMPACT_BUDGET_TOKENS` / `SUBAGENT_COMPACT_BUDGET_TOKENS` re-exported as derived defaults.
- `buildGraph(maxSteps, compactBudget)` second arg still absolute fallback when ctx omits override.
- UI chip already uses model `limit.context`; no UI change required if sidecar reports better `contextTokens`.

## Plan (execution order)

### Phase A — Core budget module + catalog

1. Extend sidecar `CatalogModel` with `limit?: { context?: number; output?: number }`.
2. Add `packages/sidecar/src/session/context-budget.ts` (+ tests).
3. Add `resolveModelContextWindow(providerID, modelID)`.

### Phase B — Compaction quality + estimates

4. Wire `estimatePromptTokens` / threshold helpers into `compaction.ts` (re-exports).
5. Degenerate summary detection + retry + extractive fallback in `compactMessages` path.
6. Unit tests for estimate / threshold / summary gate.

### Phase C — Graph + session callers

7. GraphCtx + LoopState fields; compactNode uses % gate + step throttle.
8. `session-turn-runner`: resolve window, remaining %, pass ctx fields; track `lastPromptTokens` from usage.
9. `session.compactNow`: use new estimate; keep API.
10. `internal-runner` / `subagent`: subagent threshold percent / budget.
11. Session `buildAgent` may stay default; runtime ctx overrides budget.

### Phase D — Tool output cap

12. Lower `DEFAULT_MAX_BYTES` to 40KB; fix tool-output-store tests.

### Phase E — Verify

13. Run targeted vitest for compaction / budget / tool-output / graph overflow.
14. Fix regressions.

## Test plan

| Area | Tests |
|------|-------|
| `context-budget` | chars/4, exceeds_threshold boundary at exactly 85%, remaining %, window resolve fallback |
| `compaction` | prompt estimate includes system; degenerate → fallback; trigger helpers |
| `graph` / overflow | still compacts under tiny absolute budget; respects min steps when unit-tested |
| `tool-output-store` | 40KB default |
| `session-turn` / injectors | remaining % semantics unchanged for inject thresholds (30/10) |

## Risks

| Risk | Mitigation |
|------|------------|
| Higher trigger (48k → ~85% of window) delays compact | Intentional; overflow recovery remains |
| Catalog missing limit | Fallback 128k |
| Tool schema estimate low | Fixed overhead + name/desc; real usage max() corrects after first step |
| Min-steps delays emergency compact | Overflow path still force-compacts with `overflowRecovery` |
