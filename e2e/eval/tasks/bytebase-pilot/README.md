# Bytebase pilot pack (UI-first)

Three handcrafted tasks run through the **hip desktop UI** (WDIO e2e).

## Requirements

| Item | Value |
|------|--------|
| Bytebase checkout | Set `HIP_EVAL_BYTEBASE_PATH` to a **re-cloneable** clone |
| Pinned SHA | `ac0061377bfdd05813e4747df971b0e3737fbe61` |
| Go | Module declares `go 1.26.0` |
| Auth | `~/.hip/config/auth.json` (staged by wdio into e2e data dir) |
| App binary | `yarn tauri build --debug` → `src-tauri/target/debug/hip` |

**Do not** point `HIP_EVAL_BYTEBASE_PATH` at a tree you cannot re-clone. Eval creates git worktrees under `HIP_EVAL_ROOT` (default `~/.hip/eval-runs`).

## Tasks

| ID | Intent |
|----|--------|
| `bb-common-fix-has-prefixes` | Fix intentional `HasPrefixes` bug; `go test ./backend/common/` |
| `bb-common-nav-truncate` | Locate `TruncateString`; assistant text oracle |
| `bb-stress-timeout` | 60s timeout stress (often fails) |

## Fixture check

```bash
export HIP_EVAL_BYTEBASE_PATH=/path/to/bytebase-3.16.1
git -C "$HIP_EVAL_BYTEBASE_PATH" rev-parse HEAD  # should be able to resolve pin
# apply --check is done by hip-eval-ui-pilot.sh / workspace helper
```

## Run

```bash
# Unpaid: folder bind smoke only
yarn test:e2e:eval-smoke

# Live pilot (paid LLM)
export HIP_EVAL_BYTEBASE_PATH=/path/to/bytebase-3.16.1
E2E_LIVE_LLM=1 yarn test:e2e:eval
# or
scripts/hip-eval-ui-pilot.sh
```

Reports land under `$HIP_EVAL_ROOT/<run_id>/run-report.json`.
