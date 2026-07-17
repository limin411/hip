# Idle Timeout Hardening — Plan

| Field | Value |
|-------|-------|
| **Spec** | [`2026-07-17-idle-timeout-hardening-spec.md`](./2026-07-17-idle-timeout-hardening-spec.md) |
| **Date** | 2026-07-17 |

## Execution order (staged commits)

### PR/Commit 1 — Spec docs
- Add this plan + spec under `docs/design/`.

### PR/Commit 2 — Tool-call stream activity kick
**Files:**
- `packages/sidecar/src/session/model-runner.ts` — `onActivity` on `ModelRunOptions`; detect tool-call progress; set `emitted`
- `packages/sidecar/src/session/graph.ts` — wire `onActivity: () => emit.activity?.()`
- `packages/sidecar/src/session/model-runner.test.ts` — unit tests

**Done when:** A1 covered by tests.

### PR/Commit 3 — Configurable idle timeout
**Files:**
- `packages/protocol/src/hip-config.ts` — `AgentLoopConfig.idleTimeoutMs?`
- `packages/protocol/src/hipConfig.contract.test.ts` — round-trip
- `packages/sidecar/src/config/hip-config.ts` — normalize `idle_timeout_ms`
- `packages/sidecar/src/session/idle-timeout.ts` (new) — `resolveIdleTimeoutMs`
- `packages/sidecar/src/session/session.ts` — re-export if needed
- `packages/sidecar/src/session/session-manager.ts` — pass resolved ms into `new Session(...)`
- tests for resolve + config parse

**Done when:** A3, A4.

### PR/Commit 4 — Truncation UX + defaults
**Files:**
- `packages/sidecar/src/session/tool-output-store.ts` — marker text, maxBytes 100KB
- `packages/sidecar/src/session/tool-output-store.test.ts`
- `packages/sidecar/src/session/tools/file.ts` — tool descriptions

**Done when:** A5.

### PR/Commit 5 — Edit strategy guidance
**Files:**
- `packages/sidecar/src/session/system-prompt.ts`
- `packages/sidecar/src/session/system-prompt.test.ts`
- optional child prompt one-liner

**Done when:** A6.

### PR/Commit 6 — Verify
- Run targeted vitest suites (model-runner, idle, tool-output, system-prompt, hip-config)
- Run lightweight e2e if feasible (`app-launch` or harness that doesn't need paid LLM); document if skipped
- Final status update in docs if needed

## Implementation notes

### Tool-call detection helper

```ts
export function hasToolCallStreamActivity(chunk: AIMessageChunk): boolean {
  const tcc = (chunk as { tool_call_chunks?: unknown[] }).tool_call_chunks
  if (Array.isArray(tcc) && tcc.length > 0) return true
  const tc = chunk.tool_calls
  if (Array.isArray(tc) && tc.length > 0) return true
  return false
}
```

### resolveIdleTimeoutMs

```ts
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000
export const DEFAULT_CODE_IDLE_TIMEOUT_MS = 180_000
export const MIN_IDLE_TIMEOUT_MS = 5_000
export const MAX_IDLE_TIMEOUT_MS = 1_800_000

// priority: env > config > surface default → clamp
```

### SessionManager wiring

```ts
const idleMs = resolveIdleTimeoutMs({
  env: process.env.HIP_IDLE_TIMEOUT_MS,
  configMs: loadHipConfig()?.agentLoop?.idleTimeoutMs,
  surface: cfg.surface,
})
new Session(id, cfg, model, store, undefined, idleMs, ...)
```

Cache hip config read lightly (existing load path if any).
