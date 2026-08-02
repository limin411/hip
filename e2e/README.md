# hip E2E tests

WebdriverIO + `@wdio/tauri-service` against a debug Tauri binary and Vite on `:1420`.

Harness overview lives in this file.

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

# Pre-merge gate: smoke + core + harness + memory + panel + settings + voice (no paid LLM)
# Sets HIP_VOICE_MOCK=1 so voice specs do not need whisper-cli / mic.
yarn test:e2e:gate

# Full unpaid suite (everything except @live — knowledge-phase1/p2, perf, …)
yarn test:e2e:full

# Voice only (mock engine)
yarn test:e2e:voice

# Live LLM (opt-in; needs ~/.hip/config/auth.json staged by wdio)
yarn test:e2e:live

# Capability eval (UI-first; unpaid smoke + optional live Bytebase packs)
yarn test:e2e:eval-smoke
# Live: export HIP_EVAL_BYTEBASE_PATH=/path/to/bytebase
#   yarn test:e2e:eval          # all @eval live
#   yarn test:e2e:eval-hard     # L2 hard pack
#   yarn test:e2e:eval-orch     # L3 orchestration
#   yarn test:e2e:eval-adv      # L4 adversarial
#   scripts/hip-eval-ui-matrix.sh
# Design: docs/design/2026-07-16-hip-capability-matrix-spec.md

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
| `@panel` | Right-panel / terminal panels | yes (in gate) |
| `@settings` | Settings smoke, usage chip | yes (in gate) |
| `@memory` | Memory settings / slash / citations harness (no paid LLM) | yes (in gate) |
| `@voice` | Composer voice dictation (Settings + mic; use `HIP_VOICE_MOCK=1`) | yes (in gate) |
| `@live` | Real LLM (opt-in only) | **no** |
| `@eval` | UI-first capability eval (smoke unpaid; live needs `HIP_EVAL_BYTEBASE_PATH`) | smoke yes via `@eval @smoke`; live **no** |
| `@hard` | L2 multi-file / TDD / feature (`bytebase-hard`) | **no** (live opt-in) |
| `@orch` | L3 plan / delegate / hitl (`bytebase-orch`) | **no** |
| `@adv` | L4 noisy / safety (`bytebase-adv`) | **no** |
| `@context-menu` | Right-click menus (see plan) | smoke/core cases also tagged `@smoke`/`@core` → in gate |
| `@knowledge` | Knowledge base full business flows | main path also `@core` → in gate |
| `@knowledge-perf` | Knowledge open/type usability budgets + unusable hard lines | **no** (nightly / `test:e2e:full`) |
| `@work-items` | Work item tracking (事项追踪) full business flows | smoke/core cases also tagged → in gate |
| `@automations` | Automations page (local schedule jobs) | smoke also `@smoke` → in gate |

Context-menu helpers: `e2e/helpers/context-menu.ts`. Specs: `context-menu-smoke.spec.ts`, `context-menu-core.spec.ts`, `context-menu-panel.spec.ts`.

Knowledge helpers: `e2e/helpers/knowledge.ts`. Specs (all unpaid, isolated `HIP_DATA_DIR`, no `@live`):

| Spec | Cases |
|------|--------|
| `knowledge-editor.spec.ts` | KE: open → space → default Live/Source → title → bold → export md → tree filter |
| `knowledge-advanced.spec.ts` | KA: palette nav/search, context newDoc, DnD, import folder (KA5 may skip) |
| `knowledge-lifecycle.spec.ts` | KL: create → disk save → export md/zip → **delete space** → shell reopen |
| `knowledge-home.spec.ts` | KH: multi-space, rename, delete/cancel |
| `knowledge-tree-crud.spec.ts` | KT: folder/doc rename, delete, context newDoc |
| `knowledge-preview.spec.ts` | KP1: GFM task checkbox write-back (Live/Source; no Preview writing mode) |
| `knowledge-nav.spec.ts` | KN1: flush-fail + durability; KN2: multi-space sidebar reopen |
| `knowledge-wiki.spec.ts` | KW1–KW4: `[[title]]` navigate, create/cancel (some soft) |
| `knowledge-phase1.spec.ts` | K1C–G: templates, versions, frontmatter, assets, portable zip (`@knowledge`, not `@core`) |
| `knowledge-live.spec.ts` | KF1 Source slash `/h1`; KF2 Live type + disk; KF3 live blocks hard (`@knowledge`) |
| `knowledge-live-r3.spec.ts` | KR1–4: default Live, Live slash, fixture blocks hard, large→Source (`@knowledge @core`) |
| `knowledge-p2.spec.ts` | KP2: graph modal, table/board views, outline, backlinks, soft-delete restore (`@knowledge`) |
| `knowledge-board.spec.ts` | KB1–5: create hip whiteboard → draw rect → leaf switch → structure click (if rail) → export JSON (`@knowledge @core`) |
| `knowledge-perf.spec.ts` | KP-O/T: fixture open/type budgets; large-doc → Source (`@knowledge-perf`) |

Whiteboard helpers (`.board.json` primary, hip-board type): `createBoardAndExpectCanvas`, `drawHipBoardRect`, `clickBoardStructureItemIfAvailable`, `findBoardPathOnDisk` in `e2e/helpers/knowledge.ts`. Pure path helpers are covered by `e2e/eval/board-disk.test.ts` (vitest; no display). Full GUI smoke needs the Tauri app: `yarn test:e2e --spec e2e/specs/knowledge-board.spec.ts`.

Perf budgets: `e2e/helpers/knowledge-perf-budgets.ts` (hard unusable lines always; targets soft unless `KNOWLEDGE_PERF_STRICT=1`).

Fixtures: `e2e/fixtures/knowledge/` (`small-prose.md`, `medium-rich.md`, …).  
Perf seam: `window.__hipKnowledgePerf` (`enable` / `reset` / `snapshot`) — see `src/domain/knowledge/knowledgePerf.ts`.  
Write-fail seam: `window.__hipKnowledgeWriteFail` (see `installWriteFailSeam` / `src/ipc/knowledge.ts`).  
Attachment seam: `window.__hipPickAttachmentFiles`. Live flag: `localStorage.hip-knowledge-live=true`.

```bash
# All knowledge functional specs
yarn test:e2e:knowledge
# Usability / perf (not in gate)
yarn test:e2e:knowledge-perf
```

Work-item helpers: `e2e/helpers/work-items.ts`. Specs (all unpaid, isolated `HIP_DATA_DIR`, no `@live`):

| Spec | Cases |
|------|--------|
| `work-items-smoke.spec.ts` | WS1–2: nav → page (not placeholder); sidebar filters / inbox / CTAs (`@smoke`) |
| `work-items-lifecycle.spec.ts` | WL1–7: create → fields → disk → complete/cancel/archive/delete → leave flush (`@core`) |
| `work-items-filters.spec.ts` | WF1–6: smart filters, search, user list CRUD + migrate-to-inbox (`@core`) |
| `work-items-nav.spec.ts` | WN1–5: palette nav, empty-title discard/Untitled, keyboard N/Space, re-enter (`@core`) |

Persistence: `HIP_DATA_DIR/work-items/catalog.json` (Tauri IPC `work_items_list` / `work_items_save`).  
List create/rename/delete and hard-delete use in-app Modals (never `window.prompt` / `confirm` — freezes Tauri WKWebView).

```bash
# All work-item functional specs
yarn test:e2e:work-items
# Gate-relevant work-item paths
E2E_GREP='@work-items @core' yarn test:e2e
```

Automations helpers: `e2e/helpers/automations.ts`. Specs (unpaid, isolated `HIP_DATA_DIR`, no `@live`):

| Spec | Cases |
|------|--------|
| `automations-smoke.spec.ts` | AS1–3: sidebar nav → page (not placeholder); palette `nav-automations`; `__hipE2E.automationTick` callable (`@smoke`) |

Persistence: `HIP_DATA_DIR/automations/catalog.json` + `runs.json` (Tauri IPC).  
Schedule due is forced via `window.__hipE2E.automationTick(now)` — never wait the real 30s host interval.

```bash
E2E_GREP=@automations yarn test:e2e
yarn test:e2e --spec e2e/specs/automations-smoke.spec.ts
```

```bash
E2E_GREP=@context-menu yarn test:e2e
# or panel-only:
E2E_GREP='@context-menu @panel' yarn test:e2e --spec e2e/specs/context-menu-panel.spec.ts

# Gate: core knowledge paths (includes A–D)
E2E_GREP='@knowledge @core' yarn test:e2e

# All knowledge business flows (includes Phase1 + Live)
E2E_GREP=@knowledge yarn test:e2e
yarn test:e2e --spec e2e/specs/knowledge-lifecycle.spec.ts
yarn test:e2e --spec e2e/specs/knowledge-home.spec.ts
yarn test:e2e --spec e2e/specs/knowledge-tree-crud.spec.ts
yarn test:e2e --spec e2e/specs/knowledge-editor.spec.ts
yarn test:e2e --spec e2e/specs/knowledge-preview.spec.ts
yarn test:e2e --spec e2e/specs/knowledge-nav.spec.ts
yarn test:e2e --spec e2e/specs/knowledge-wiki.spec.ts
yarn test:e2e --spec e2e/specs/knowledge-phase1.spec.ts
yarn test:e2e --spec e2e/specs/knowledge-live.spec.ts
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
- `seedAgentCollaboration` — chat delegation (H6/H7)
- `openCommandPaletteForE2e` / `closeCommandPaletteForE2e` — S5
- `simulatePluginInstallError` — T2 (after Settings form submit)
- `getWorkflowSession` — read workflow store slice after inject (no product DAG shell)
- Memory: `getMemoryConfig` / `setMemoryConfig` / `seedMemoryItem` / `listMemories` /
  `deleteMemory` / `restoreMemory` / `emptyMemoryTrash` / `triggerMemoryConsolidate` /
  `getActiveSessionMemoryFlags`

Complex harness (safe inject chains, no paid LLM):

- `harness-complex-agent-loop.spec.ts` — multi-step tool / multi-agent / permission / cancel
- `harness-workflow-projection.spec.ts` — `workflow:*` messages → store; failed / cancelled / stale runId
- `harness-subagent-pause.spec.ts` — `[hip:subagent_paused]` marker + delegation (not `Error: sub-agent paused`)
- `harness-agent-interrupt.spec.ts` — `agent:interrupt` banner + resume clears interrupt
- `harness-plan-approval.spec.ts` — plan approval card + approve (+ plan-progress-panel)
- `harness-plan-progress-panel.spec.ts` — sticky plan-progress-panel via `plan:updated` / approve retain
- `harness-invalid-workflow.spec.ts` — `INVALID_WORKFLOW` error bar; workflow store idle
- `harness-background-killed.spec.ts` — background task killed notification (`@panel`)
- `harness-orchmode-compat.spec.ts` — deprecated `session:orchMode` does not break session (optional gate)

Bridge seeds (DEV `__hipE2E`):

- `seedSubagentPause` / `seedAgentInterrupt` / `seedPlanApproval` / `seedPlanProgress` / `seedBackgroundTaskKilled`
- `simulateInvalidWorkflowError` / `getLastAssistantText` / `getPendingInterrupt`

Helpers: `e2e/helpers/e2e-hooks.ts`, `e2e/helpers/memory.ts`, `git-workspace.ts`, `history.ts`.

## CI (`.github/workflows/test.yml`)

| Job | Command | When |
|-----|---------|------|
| `e2e-gate` | `yarn test:e2e:gate` | PR + push (not schedule); `continue-on-error` until stable |
| `e2e-full` | `yarn test:e2e:full` | Nightly schedule, push to `main`/`master`, or manual `workflow_dispatch` |
| Live | `yarn test:e2e:live` | **not in CI** (paid / secret) |

Gate grep: `@smoke\|@core\|@harness\|@memory\|@panel\|@settings\|@voice`  
Full unpaid: invert `@live` (includes knowledge-phase1/p2, knowledge-perf, etc.).

Failure PNGs upload as Actions artifacts (`e2e-*-screenshots`, 7-day retention).

## Feature coverage map (unpaid desktop)

| Product area | Specs (representative) | Gate? |
|--------------|------------------------|-------|
| App launch / shell | `app-launch`, `smooth-p0` | yes |
| Surfaces (chat/code) | `surface-switch`, `project-workspace` | yes |
| Sessions / history | `session-management`, `session-history` | yes |
| Composer / slash / @files | `composer-widgets`, `slash-commands`, `file-mention` | yes |
| Command palette | `command-palette` | yes |
| Settings | `settings-smoke` (+ model verify precheck) | yes |
| Voice dictation | `voice-dictation` (`HIP_VOICE_MOCK=1`) | yes |
| Memory | `memory-settings`, `memory-slash`, `memory-citations-harness` | yes |
| Knowledge (main) | `knowledge-*` with `@core` | yes |
| Knowledge (extra) | `knowledge-phase1`, `knowledge-live`, `knowledge-p2` | full only |
| Knowledge perf | `knowledge-perf` | full only |
| Work items | `work-items-*` | yes |
| Diff / Changes | `diff-workspace`, `write-to-changes`, harness cancel keeps diff | yes |
| Code terminal | `code-terminal` | yes |
| Context menus | `context-menu-*` | yes (panel via `@panel`) |
| Recycle bin / trash | `recycle-bin`, `context-menu-trash` | yes |
| Plugins / extensions | `plugin-install-error`, `extension-registry`, `skill-plugin-dialogue` | yes |
| Agents / plan / cancel | `harness-*`, `smooth-p*` | yes |
| Token usage chip | `token-usage-chip` | yes |
| Eval UI smoke | `eval-ui-smoke`, `eval-ui-visual-capture` | yes (`@eval @smoke`) |
| Live LLM / coding eval | `live-*`, `eval-*-hard/orch/adv` | **no** (paid) |

Not automated as full desktop e2e (unit/Rust/manual instead): real PTY bytes, SSH/SFTP hosts, paid model verify, native Gatekeeper signing, whisper model download integrity.

## Flakes

- Radix menus: use `pointerdown` / focus+Enter (see `helpers/surface.ts`, `panel.ts`).
- Prefer `waitUntil` over fixed `pause` unless WebKit animation requires it.
- Shared app state: each harness file should create its own session via `__hipE2E` or explicit UI setup.
- On failure, `wdio.conf.ts` writes a PNG under `E2E_SCREENSHOT_DIR` (or `/tmp/hip-e2e-screenshots`).
- Spec layout stays flat under `e2e/specs/` for now (`specs/{smoke,core,…}` deferred — imports and `--spec` paths stay stable).
- Voice mic record/transcribe depends on OS capture; CI uses mock engine and only asserts Settings + mic presence / no shell crash.
