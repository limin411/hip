# E2E business coverage audit (2026-07-13)

Maps hip product surfaces → existing `e2e/**/*.spec.ts` / tags → covered vs gap.  
Strategy for **agent loop** and **workflow**: safe DEV harness / `window.__hipE2E` inject only; no host-destructive shell, no default paid `@live`.

Related: [e2e/README.md](../../../e2e/README.md).

## Tag legend

| Tag | Gate role |
|-----|-----------|
| `@smoke` | Gate |
| `@core` | Gate |
| `@harness` | Gate |
| `@panel` | Optional / nightly |
| `@settings` | Optional |
| `@memory` | Optional (unpaid) |
| `@live` | Opt-in paid only |
| `@context-menu` | Smoke/core cases also gate-tagged |

## Coverage matrix

| Product surface | Specs (primary) | Tags | Status | Notes |
|-----------------|-----------------|------|--------|-------|
| App launch / login skip | `app-launch.spec.ts` | `@smoke` | **ok** | Login screen + main shell |
| Chat / Code surface switch | `surface-switch.spec.ts` | `@smoke` `@core` | **ok** | |
| Session create / tabs | `session-management.spec.ts` | `@smoke` `@core` | **ok** | Draft + commit + tab switch |
| Session history UI | `session-history.spec.ts` | `@smoke` `@core` | **ok** | Open + filters; not full CRUD matrix |
| New conversation / project folder | `project-workspace.spec.ts` | `@core` | **ok** | Folder chip, previews, first send |
| Composer widgets (model / perm / attach / send) | `composer-widgets.spec.ts` | `@core` | **ok** | |
| Slash commands (chat/code filter) | `slash-commands.spec.ts` | `@core` | **ok** | |
| Skills / fixture plugin dialogue | `skill-plugin-dialogue.spec.ts` | `@core` | **ok** | sample-greet / sample-format |
| Agent loop: turn run + cancel + partial | `harness-cancel.spec.ts` | `@harness` `@smoke` | **ok** | Single-step harness |
| Agent loop: cancel keeps Changes | `harness-cancel-keeps-diff.spec.ts` | `@harness` `@core` | **ok** | |
| Agent loop: write → Changes | `write-to-changes.spec.ts` | `@core` `@harness` | **ok** | |
| Agent loop: permission modal | `harness-permission.spec.ts` | `@harness` `@smoke` | **ok** | |
| Agent loop: copy-debug on error | `harness-copy-debug.spec.ts` | `@harness` `@smoke` | **ok** | |
| Agents panel / collaboration | `harness-agents.spec.ts` | `@harness` `@panel` | **ok** | Not in gate grep alone if only `@panel`—but also `@harness` so gate includes it |
| Delegation jump (chat + agents) | `harness-delegation.spec.ts` | `@harness` `@panel` | **ok** | |
| **Complex multi-step agent loop** (tool + multi-agent + perm + cancel in one flow) | — (to add: `harness-complex-agent-loop.spec.ts`) | `@harness` | **gap → planned** | Chained inject; no live LLM |
| Permissions (HITL) | `harness-permission.spec.ts` | `@harness` `@smoke` | **ok** | Modal only; mode chip in composer-widgets |
| Plan approval card | ChatPage getters only | — | **gap** | Unit tests on card; no e2e inject seed yet |
| Changes / git diff workspace | `diff-workspace.spec.ts` | `@core` | **ok** | Temp git only |
| Timeline list | `timeline-panel.spec.ts` | `@panel` `@harness` | **ok** | |
| Timeline revert confirm | `timeline-revert.spec.ts` | `@panel` `@harness` | **ok** | Seed auto-succeeds |
| Terminal panel | `code-terminal.spec.ts` | `@panel` | **ok** | No shell mutation of home |
| Settings shell / tabs | `settings-smoke.spec.ts` | `@settings` `@smoke` | **ok** | Tab switch + model key precheck |
| Token usage chip | `token-usage-chip.spec.ts` | `@settings` | **ok** | |
| Plugin install error | `plugin-install-error.spec.ts` | `@settings` `@harness` | **ok** | Simulated error |
| Memory settings CRUD | `memory-settings.spec.ts` | `@memory` | **ok** | Unpaid harness seeds |
| Memory slash | `memory-slash.spec.ts` | `@memory` | **ok** | |
| Memory citations UI | `memory-citations-harness.spec.ts` | `@memory` `@harness` | **ok** | |
| Command palette | `command-palette.spec.ts` | `@smoke` `@core` | **ok** | |
| Context menus smoke/core/panel | `context-menu-*.spec.ts` | `@context-menu` + gate tags | **ok** | See context-menu plan |
| **Workflow message projection** | unit: `serverMessageEffects` / `workflowStore` | — | **gap → planned** | No dedicated product DAG UI; `workflow:getActive` removed. E2E via inject + store + Agents tab focus |
| Hooks settings honesty | unit + settings components | — | **product gap (not e2e-block)** | Documented in hooks specs; static overview only |
| MCP / Agent management deep edit | unit tests | — | **gap (accept)** | Settings smoke opens tabs; deep editor not required for unpaid gate |
| Live chat / live memory | `live-chat.spec.ts`, `live-memory.spec.ts` | `@live` | **ok (opt-in)** | Self-skip without `E2E_LIVE_LLM=1` |

## Agent loop coverage strategy

| Scenario | Mechanism | Dangerous? |
|----------|-----------|------------|
| Streaming partial + tool:started | `simulateTurnRunning` | No |
| Cancel / Stop UI | UI click + `simulateTurnCancelled` | No |
| Multi-agent structure + cards | `seedAgentCollaboration` | No |
| Delegation row + jump-to-turn | same seed + UI | No |
| Permission HITL | `simulatePermissionRequest` | No |
| Write tool → Changes | disk write under temp + `simulateAgentWriteFinished` | Temp `HIP_DATA_DIR` / mkdtemp only |
| Error + copy-debug | `simulateSessionError` | No |
| Complex chain (new) | Ordered inject of above on one code session | No live tools against user home |

## Workflow coverage strategy

| Behavior | Product-reachable? | E2E approach |
|----------|--------------------|--------------|
| `workflow:started` → store slice | Yes (effects) | `injectServerMessage` + `getWorkflowSession` |
| Code surface: open panel + Agents tab | Yes | Assert `panel-view-agents` / active tab |
| Chat surface: store only, no panel force | Yes | Assert store; panel not forced open |
| `workflow:event` node/run status | Store only | Inject events; assert status via hook |
| `workflow:snapshot` / `workflow:cleared` | Store only | Inject; assert replace/clear |
| Dedicated DAG editor in main shell | **No** (`DagEditor` residual; product removed getActive) | Record as **product gap** — do not fake full editor E2E |
| Live workflow:run with real agent tools | Paid / host risk | **Out of unpaid suite** |

## Intentional non-coverage (this audit)

- Paid `@live` as gate requirement
- Host-destructive commands outside e2e temp dirs
- Exhaustive settings field matrix (hooks/MCP/agent editor)
- Building a full workflow product surface solely for e2e

## Follow-ups from this audit

1. Add `harness-complex-agent-loop.spec.ts` (`@harness`) — multi-step conversation projection.
2. Add `harness-workflow-projection.spec.ts` (`@harness`) — inject workflow messages; store + Agents focus.
3. Expose `getWorkflowSession` on `__hipE2E` (DEV only) for honest store assertions.
4. Optional later: plan-approval inject seed (gap, not blocking unpaid gate).
5. Run full unpaid `yarn test:e2e`; record results; then fix-spec before remediations.

## Files inventory (current)

```
e2e/specs/*.spec.ts          # 31 files under specs/
e2e/token-usage-chip.spec.ts # settings usage chip
e2e/helpers/*                # app, auth, composer, context-menu, e2e-hooks, …
e2e/page-objects/*           # Chat, Code, Login, Settings
```
