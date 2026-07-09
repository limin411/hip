# Architecture Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce blast radius and implicit defaults in hip’s three-process architecture without rewriting the product — hygiene, CI, config normalization, message validation, localhost WS bind, and handler routing first; large god-file splits and orchestration unification later.

**Architecture:** Incremental, behaviour-preserving refactors. Shared defaults live in `@hip/protocol`. Sidecar and frontend route messages by domain. WebSocket is loopback-only. CI covers Rust unit tests. God-file splits and orch unification are sequenced after these foundations.

**Tech Stack:** TypeScript (protocol, sidecar, React), Rust/Tauri, Vitest, GitHub Actions

---

## Scope of this plan

| Phase | Theme | In this PR wave? |
|-------|--------|------------------|
| **1** | Hygiene + CI + normalizeConfig + message guard + WS loopback + handler routing | **Yes** |
| **2** | Protocol file split (re-export), SessionManager domain modules complete | Follow-up |
| **3** | `session.ts` / `lib.rs` size caps, orchMode main-path unification | Follow-up |
| **4** | Verification gates, worktree defaults, memory | Later product work |

### Explicitly deferred (do not do in Phase 1)

- Full `session.ts` split into TurnRunner / WorkspaceFacade / …
- Full `lib.rs` command module tree
- Unifying Layer1/2/3 orchestration into one runtime
- Making full e2e suite blocking (needs stability data first)
- OS keychain migration

---

## File map (Phase 1)

| Path | Responsibility |
|------|----------------|
| `.gitignore` | Ignore accidental home-relative paths + dmg artifacts |
| `.github/workflows/test.yml` | Add blocking `cargo test` |
| `packages/protocol/src/session-config.ts` | `normalizeSessionConfig` + effective defaults |
| `packages/protocol/src/session-config.test.ts` | Unit tests for defaults |
| `packages/protocol/src/message-guard.ts` | Runtime parse/validate ClientMessage shape |
| `packages/protocol/src/message-guard.test.ts` | Guard tests |
| `packages/protocol/src/index.ts` | Re-export new helpers |
| `packages/sidecar/src/server/ws-server.ts` | Bind `127.0.0.1`; use message guard |
| `packages/sidecar/src/session/session-manager.ts` | Use normalize; delegate workspace/mcp handlers |
| `packages/sidecar/src/session/handlers/workspace.ts` | fs/git client-message handlers |
| `packages/sidecar/src/session/handlers/mcp.ts` | mcp client-message handlers |
| `packages/sidecar/src/session/handlers/types.ts` | Shared `SendFn` + manager context type |
| `src/domain/serverMessageEffects.ts` | Side-effect router for non-domain-store messages |
| `src/domain/sessionService.ts` | Thin `receive` → effects; normalize on create |
| `src/domain/sessionStore.ts` | DEFAULT_CONFIG via normalize |

---

## Phase 1 tasks

### Task 1: Repo hygiene

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1:** Append ignore rules for accidental path artifacts and Tauri dmg leftovers.

```gitignore
# Accidental relative home paths (e.g. Users/.../.hip written into the repo tree)
Users/

# Stale create-dmg intermediate images break `yarn tauri build`
**/rw.*.dmg
```

- [ ] **Step 2:** Confirm `Users/` is not tracked: `git ls-files Users` → empty.

---

### Task 2: CI — cargo test

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1:** Add a `rust-unit` job (ubuntu) after checkout + rust-toolchain:

```yaml
  rust-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - name: cargo test
        working-directory: src-tauri
        run: cargo test
```

- [ ] **Step 2:** Keep `e2e-smoke` as `continue-on-error: true` for now; document in plan Phase 2 when to flip.

---

### Task 3: `normalizeSessionConfig`

**Files:**
- Create: `packages/protocol/src/session-config.ts`
- Create: `packages/protocol/src/session-config.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/sidecar/src/session/session-manager.ts` (`createSession`, `ensureSession`)
- Modify: `src/domain/sessionStore.ts` (`DEFAULT_CONFIG`)
- Modify: `src/domain/sessionService.ts` (`createSession`)

**Defaults (single source of truth):**

| Field | Default when undefined |
|-------|-------------------------|
| `permissionMode` | `'edit'` |
| `enableStickyApproval` | `true` |
| `useEventSource` | `true` |
| `orchMode` | `'fast'` |

Required fields (`llmProvider`, `model`, `tools`) are left as provided; do not invent provider ids beyond what callers pass.

- [ ] **Step 1:** Write failing tests for normalize defaults and “explicit values preserved”.
- [ ] **Step 2:** Implement `normalizeSessionConfig`.
- [ ] **Step 3:** Export from protocol index.
- [ ] **Step 4:** Call at sidecar create + rehydrate; frontend DEFAULT_CONFIG / createSession.
- [ ] **Step 5:** Run `yarn workspace @hip/protocol type-check` and protocol + related tests.

---

### Task 4: ClientMessage runtime guard + WS loopback

**Files:**
- Create: `packages/protocol/src/message-guard.ts`
- Create: `packages/protocol/src/message-guard.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/sidecar/src/server/ws-server.ts`

- [ ] **Step 1:** `parseClientMessage(raw: unknown): ClientMessage | null` — require non-null object, `type` string in known client type set, reject arrays/null/primitives.
- [ ] **Step 2:** On WS message: parse JSON → guard → handle or `error` with `INVALID_MESSAGE`.
- [ ] **Step 3:** `WebSocketServer({ port, host: '127.0.0.1' })`; `findAvailablePort` listen on `127.0.0.1`.
- [ ] **Step 4:** Tests for guard accept/reject.

---

### Task 5: Sidecar workspace + MCP handler modules

**Files:**
- Create: `packages/sidecar/src/session/handlers/types.ts`
- Create: `packages/sidecar/src/session/handlers/workspace.ts`
- Create: `packages/sidecar/src/session/handlers/mcp.ts`
- Modify: `packages/sidecar/src/session/session-manager.ts`

**Behaviour:** Move existing switch cases for `fs:*`, `git:*` (including worktree), and `mcp:*` into modules that receive a minimal context (`ensureSession`, `lsCwd`, `readCwd`, etc.). `handleAsync` calls `handleWorkspace` / `handleMcp` first; return if handled. No behaviour change.

- [ ] **Step 1:** Extract types + handlers.
- [ ] **Step 2:** Wire session-manager.
- [ ] **Step 3:** Run a subset of session-manager / workspace tests.

---

### Task 6: Frontend server-message side-effect router

**Files:**
- Create: `src/domain/serverMessageEffects.ts`
- Create: `src/domain/serverMessageEffects.test.ts` (minimal: ready triggers session:list; compact:result ok appends)
- Modify: `src/domain/sessionService.ts`

- [ ] **Step 1:** Move `receive` side effects (everything after `apply`) into `applyServerMessageEffects(msg, deps)`.
- [ ] **Step 2:** `SessionService.receive` only applies domain store + calls effects.
- [ ] **Step 3:** Run `src/domain/sessionService.test.ts` and new effects tests.

---

### Task 7: Verify + commit

- [ ] `yarn workspace @hip/protocol type-check`
- [ ] `yarn type-check`
- [ ] `yarn workspace @hip/sidecar type-check` (if time)
- [ ] `yarn test` for touched packages / domain tests
- [ ] `cargo test` in `src-tauri` (local, if toolchain present)
- [ ] Commit Phase 1 as one or more logical commits

---

## Phase 2+ backlog

### Phase 2 — completed 2026-07-10

1. [x] Split `packages/protocol/src/index.ts` into domain modules with barrel re-export (`session-core`, `messages`, `workspace-types`, `hooks`, `plugins`, …).
2. [x] Finish SessionManager routing for session / plugin / workflow / plan / replay (void|Promise pattern for sync create).
3. [x] Document single-client WS close → `cancelAllRunning` assumption (ws-server + SessionManager).

### Phase 3

1. `session.ts` ≤ ~800 lines façade; extract TurnRunner / AgentRuntime / ContextPipeline.
2. `lib.rs` → `commands/*.rs` + `logging.rs`.
3. Orchestration: `orchMode: dag` on main path with durable resume (see `docs/agent-orchestration-plan.md` Phase 1).

### Phase 4

1. Verification / reviewer gates on main path.
2. Worktree isolation default for background subagents.
3. Project memory + AGENTS.md injection.

---

## Success criteria (Phase 1)

- [x] No accidental `Users/` or `rw.*.dmg` can be committed without force
- [x] CI runs `cargo test` as a blocking job
- [x] All SessionConfig defaulting for the four fields above goes through `normalizeSessionConfig`
- [x] WS binds loopback; invalid client payloads rejected before handle
- [x] Workspace/MCP handlers live outside the giant switch body
- [x] Frontend `receive` side effects live in a dedicated module
- [x] Existing domain/protocol/session tests still pass

**Phase 1 completed:** 2026-07-10

---

## Self-review

1. **Spec coverage:** P0 hygiene/CI, P1 normalize, message validate, WS loopback, handler routing covered. God-file and orch deferred with explicit backlog.
2. **Placeholders:** None in Phase 1 steps.
3. **Type consistency:** `normalizeSessionConfig(config: SessionConfig): SessionConfig`; `parseClientMessage(raw: unknown): ClientMessage | null`; handlers return `Promise<boolean> | boolean` for “handled”.
