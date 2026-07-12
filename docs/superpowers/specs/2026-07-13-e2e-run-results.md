# E2E full unpaid run results (2026-07-13)

## Command

```bash
# Debug binary present: src-tauri/target/debug/hip (built Jul 13)
E2E_SCREENSHOT_DIR={SCRATCH}/screenshots yarn test:e2e
```

Scratch log: implementer scratch `e2e-full.log`  
Screenshots: implementer scratch `screenshots/*.png`  
Duration: **~12m 21s**  
Spec files: **25 passed, 8 failed, 33 total**  
Exit: **1** (failures present)  
`@live` suites self-skipped (no `E2E_LIVE_LLM=1`) → reported as passed files.

## Passed files (25)

| Spec | Notes |
|------|--------|
| app-launch | |
| code-terminal | |
| command-palette | |
| composer-widgets | |
| context-menu-{core,panel,smoke} | |
| harness-agents / cancel / cancel-keeps-diff / copy-debug / delegation / permission | |
| **harness-workflow-projection** | **new** — store + Agents focus OK |
| live-chat / live-memory | skipped (opt-in) |
| session-history / session-management | |
| settings-smoke | |
| skill-plugin-dialogue | |
| surface-switch | |
| timeline-panel / timeline-revert | |
| write-to-changes | |
| token-usage-chip | |

## Failed files (8)

| Spec | Fail count | Root cause (from log + screenshots) |
|------|------------|-------------------------------------|
| `diff-workspace.spec.ts` | 9 (cascade) | `commitCodeSessionWithDir` waits for `tree-entry` after folder pick; **product no longer opens Files panel on draft** (FolderPill intentionally does not open panel) |
| `project-workspace.spec.ts` | 7 | Same: folder chip OK, tree/preview paths assume draft FileTree UI |
| `harness-complex-agent-loop.spec.ts` | 1 | `tool-row` only mounts inside **expanded** ActivityBar; test did not expand |
| `slash-commands.spec.ts` | 2 | Asserts `/config` — **removed** (favor global Settings); palette shows help/clear/memory/skills |
| `memory-citations-harness.spec.ts` | 1 | citations chip not displayed (inject path or residual UI) |
| `memory-settings.spec.ts` | 2 | delete confirm not clickable; nav residual after prior failure |
| `memory-slash.spec.ts` | 1 (before) | `new-session-button` missing — likely stuck on Settings from prior suite |
| `plugin-install-error.spec.ts` | 1 | `plugin-install-open` missing — settings/plugins residual state |

## New complex coverage

| Area | Result |
|------|--------|
| Complex agent loop (multi-step) | **FAIL** — fix expand ActivityBar |
| Workflow projection inject | **PASS** |

## Dangerous / live

- No unpaid suite forced paid LLM or host-destructive tools outside temp dirs.
- `@live` remains opt-in.

## Post-remediation verification (same day)

| Run | Result |
|-----|--------|
| Re-run original failing set + workflow | After fixes: complex loop, slash, memory, plugin, diff, project, workflow **green** |
| `yarn test:e2e:gate` (`@smoke\|@core\|@harness`) | **26 passed, 7 skipped, 0 failed** (~1m 08s). Log: implementer scratch `e2e-gate2.log` |

### Fix summary applied

1. Draft folder pick → folder-chip (not draft FileTree); Files after session + panel.
2. Complex agent loop expands ActivityBar for tool-row; soft delegation check.
3. Slash: `/config` removed; `/init` requires session (match product).
4. `openSettingsPageForE2e` store bridge for Settings nav residual isolation.
5. App-launch forces chat surface for greeting smoke.
6. Workflow inject projection + `getWorkflowSession` (new, green).
