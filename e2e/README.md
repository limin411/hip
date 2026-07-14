# hip E2E tests

WebdriverIO + `@wdio/tauri-service` against a debug Tauri binary and Vite on `:1420`.

Harness overview lives in this file. Feature plans:

- Business coverage audit: [`docs/superpowers/specs/2026-07-13-e2e-business-coverage-audit.md`](../docs/superpowers/specs/2026-07-13-e2e-business-coverage-audit.md)
- Run results (2026-07-13 unpaid): [`docs/superpowers/specs/2026-07-13-e2e-run-results.md`](../docs/superpowers/specs/2026-07-13-e2e-run-results.md)
- Fix plan: [`docs/superpowers/specs/2026-07-13-e2e-fix-spec.md`](../docs/superpowers/specs/2026-07-13-e2e-fix-spec.md)
- **Agent runtime multi-track E2E plan:** [`docs/superpowers/specs/2026-07-13-agent-runtime-e2e-plan.md`](../docs/superpowers/specs/2026-07-13-agent-runtime-e2e-plan.md)
- Context menu (recent): [`docs/superpowers/specs/2026-07-12-context-menu-e2e-plan.md`](../docs/superpowers/specs/2026-07-12-context-menu-e2e-plan.md)

## Prerequisites

```bash
# Debug app binary (default path used by wdio.conf.ts)
yarn tauri build --debug
# or: cargo build in src-tauri → target/debug/hip

# Port 1420 free, or already running hip Vite (title contains "hip")
```

Optional env:

| Env | Purpose |
|-----|---------|
| `E2E_BINARY` | Path to hip binary (default `./src-tauri/target/debug/hip`) |
| `E2E_DATA_DIR` | Fixed data dir (skip auto cleanup) |
| `E2E_GREP` | Mocha grep (use suite tags below) |
| `E2E_INVERT` | `1` to invert grep |
| `E2E_LIVE_LLM` | `1` to enable `@live` suites (paid / real model) |
| `E2E_SCREENSHOT_DIR` | Failure PNGs (default `/tmp/hip-e2e-screenshots`) |
| `HIP_E2E_SKIP_PORT_GUARD` | `1` to skip foreign-server port check |

## Commands

```bash
# Full suite (skips @live unless E2E_LIVE_LLM=1 — live suite self-skips)
yarn test:e2e

# Smoke only
yarn test:e2e:smoke

# Pre-public gate: smoke + core + harness (no paid LLM)
yarn test:e2e:gate

# Live LLM (opt-in; needs ~/.hip/config/auth.json staged by wdio)
yarn test:e2e:live

# Memory UI (unpaid; Settings / slash / citations harness)
E2E_GREP=@memory yarn test:e2e

# Live memory cross-session (opt-in; paid; needs auth.json)
E2E_LIVE_LLM=1 E2E_GREP=@live.*memory yarn test:e2e --spec e2e/specs/live-memory.spec.ts

# Single file
yarn test:e2e --spec e2e/specs/write-to-changes.spec.ts

# Custom grep
E2E_GREP=@panel yarn test:e2e
E2E_GREP=@live E2E_INVERT=1 yarn test:e2e
```

## Timeouts (tiers)

| Layer | Default | Notes |
|-------|---------|-------|
| WDIO `waitforTimeout` | 20s | Element waits unless overridden |
| Mocha suite timeout | 180s | Per-test; live L1 uses up to 120s wait inside |
| App ready / session tab | 30–60s | Cold start / surface switch |
| Prefer `waitUntil` | — | Avoid fixed `browser.pause` except short Radix animation gaps |

## Tags (in `describe` titles)

| Tag | Meaning | Default gate |
|-----|---------|--------------|
| `@smoke` | Launch, shell, settings entry | yes |
| `@core` | Session + Code workspace + Changes | yes |
| `@harness` | Inject bridge (write/cancel/debug/agents) | yes |
| `@panel` | Terminal / Agents panels | optional / nightly |
| `@settings` | Settings smoke, usage chip | optional |
| `@memory` | Memory settings / slash / citations harness (no paid LLM) | optional (not yet in gate) |
| `@live` | Real LLM (opt-in only) | **no** |
| `@context-menu` | Right-click menus (see plan) | smoke/core cases also tagged `@smoke`/`@core` → in gate |
| `@knowledge` | Knowledge base full business flows | main path also `@core` → in gate |

Context-menu helpers: `e2e/helpers/context-menu.ts`. Specs: `context-menu-smoke.spec.ts`, `context-menu-core.spec.ts`, `context-menu-panel.spec.ts`.

Knowledge helpers: `e2e/helpers/knowledge.ts`. Specs (all unpaid, isolated `HIP_DATA_DIR`, no `@live`):

| Spec | Cases |
|------|--------|
| `knowledge-editor.spec.ts` | KE: open → space → edit/preview → title → bold → export md → tree filter |
| `knowledge-advanced.spec.ts` | KA: palette nav/search, context newDoc, DnD, import folder |
| `knowledge-lifecycle.spec.ts` | KL: create → disk save → search → export md/zip → **delete space** → chip reopen |
| `knowledge-home.spec.ts` | KH: multi-space, rename, recent, search empty, delete/cancel |
| `knowledge-tree-crud.spec.ts` | KT: folder/doc rename, delete, context newDoc |

```bash
E2E_GREP=@context-menu yarn test:e2e
# or panel-only:
E2E_GREP='@context-menu @panel' yarn test:e2e --spec e2e/specs/context-menu-panel.spec.ts

# All knowledge business flows
E2E_GREP=@knowledge yarn test:e2e
yarn test:e2e --spec e2e/specs/knowledge-lifecycle.spec.ts
yarn test:e2e --spec e2e/specs/knowledge-home.spec.ts
yarn test:e2e --spec e2e/specs/knowledge-tree-crud.spec.ts
yarn test:e2e --spec e2e/specs/knowledge-editor.spec.ts
```

## Isolation notes

- One shared Tauri process per run (`maxInstances: 1`).
- Fresh `HIP_DATA_DIR` per run; fixture plugin staged under it.
- User `~/.hip/config/auth.json` may be copied for live paths — default gate must not require model replies.
- Temp git workspaces: use `mkdtemp`, never mutate `e2e/fixtures/sample-project` as a git repo.

## DEV inject bridge

Non-production frontend installs `window.__hipE2E` (see `sessionService.installE2eHooks`):

- `getActiveSessionId` / `injectServerMessage`
- `simulateAgentWriteFinished` — write → Changes (H1)
- `createChatSessionForE2e` / `createCodeSessionForE2e` — session without LLM
- `simulateTurnRunning` / `simulateTurnCancelled` — cancel UI (H2/H3)
- `simulateSessionError` / `getSessionDebugBundleJson` — copy-debug (H4)
- `simulatePermissionRequest` — HITL modal (H5)
- `seedAgentCollaboration` — Agents panel (H6) + chat delegation (H7)
- `seedCheckpoints` — Timeline rows (P4); also makes `revertCheckpoint` auto-succeed (H8)
- `openCommandPaletteForE2e` / `closeCommandPaletteForE2e` — S5
- `simulatePluginInstallError` — T2 (after Settings form submit)
- `getWorkflowSession` — read workflow store slice after inject (no product DAG shell)
- Memory: `getMemoryConfig` / `setMemoryConfig` / `seedMemoryItem` / `listMemories` /
  `deleteMemory` / `restoreMemory` / `emptyMemoryTrash` / `triggerMemoryConsolidate` /
  `getActiveSessionMemoryFlags`

Complex harness (safe inject chains, no paid LLM):

- `harness-complex-agent-loop.spec.ts` — multi-step tool / multi-agent / permission / cancel
- `harness-workflow-projection.spec.ts` — `workflow:*` messages → store + Agents tab on code; failed / cancelled / stale runId
- `harness-subagent-pause.spec.ts` — `[hip:subagent_paused]` marker + delegation (not `Error: sub-agent paused`)
- `harness-agent-interrupt.spec.ts` — `agent:interrupt` banner + resume clears interrupt
- `harness-plan-approval.spec.ts` — plan approval card + approve
- `harness-invalid-workflow.spec.ts` — `INVALID_WORKFLOW` error bar; workflow store idle
- `harness-background-killed.spec.ts` — background task killed notification (`@panel`)
- `harness-orchmode-compat.spec.ts` — deprecated `session:orchMode` does not break session (optional gate)

Bridge seeds (DEV `__hipE2E`):

- `seedSubagentPause` / `seedAgentInterrupt` / `seedPlanApproval` / `seedBackgroundTaskKilled`
- `simulateInvalidWorkflowError` / `getLastAssistantText` / `getPendingInterrupt`

Helpers: `e2e/helpers/e2e-hooks.ts`, `e2e/helpers/memory.ts`, `git-workspace.ts`, `history.ts`.

## CI suggestion

| Job | Grep | When |
|-----|------|------|
| Gate | `@smoke\|@core\|@harness` | PR / main |
| Nightly | (full, exclude `@live`) | schedule |
| Live | `@live` | manual / secret present |
| Live memory | `@live` + `@memory` | manual; stages accelerated `memory.json` (`idleMinutes: 0`) |

## Flakes

- Radix menus: use `pointerdown` / focus+Enter (see `helpers/surface.ts`, `panel.ts`).
- Prefer `waitUntil` over fixed `pause` unless WebKit animation requires it.
- Shared app state: each harness file should create its own session via `__hipE2E` or explicit UI setup.
- On failure, `wdio.conf.ts` writes a PNG under `E2E_SCREENSHOT_DIR` (or `/tmp/hip-e2e-screenshots`).
- Spec layout stays flat under `e2e/specs/` for now (`specs/{smoke,core,…}` deferred — imports and `--spec` paths stay stable).
