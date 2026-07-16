# bytebase-hard (L2)

Axes: `multi_file`, `test_loop`, `add_feature`.

| Task ID | Fixture |
|---------|---------|
| `bb-hard-multi-file-common` | `fixtures/break-multi-file-common.patch` (util.go + resource_name.go) |
| `bb-hard-tdd-has-prefixes` | `fixtures/break-has-prefixes.patch` |
| `bb-hard-add-has-any-suffix` | none |

Pinned `base_sha`: `ac0061377bfdd05813e4747df971b0e3737fbe61`

```bash
export HIP_EVAL_BYTEBASE_PATH=/path/to/bytebase
# apply --check
git -C "$HIP_EVAL_BYTEBASE_PATH" worktree add --detach /tmp/bb-pin ac0061377bfdd05813e4747df971b0e3737fbe61
git -C /tmp/bb-pin apply --check e2e/eval/tasks/bytebase-hard/fixtures/break-multi-file-common.patch

E2E_LIVE_LLM=1 yarn test:e2e:eval-hard
# or
scripts/hip-eval-ui-hard.sh
```

## Live archive (2026-07-16)

| Task | Result | Notes |
|------|--------|-------|
| `bb-hard-tdd-has-prefixes` | **pass** (~15m38s) | verify green; single-file fix |
| `bb-hard-multi-file-common` | **pass** (~1m06s, retry) | First run **timeout** (~20m) with `verifyPassed=true` but turn never settled. Retry after Continue button + longer timeout: `tags: pass`, both common files fixed, verify green (`~/.hip/eval-runs/bb-hard-multi-file-common-2026-07-16T07-25-19-19c040`). |
| `bb-hard-add-has-any-suffix` | **pass** (~1m01s) | After long-prompt composer fix; `~/.hip/eval-runs/bb-hard-add-has-any-suffix-2026-07-16T07-30-37-10828d` |

Reports (local scratch, not in git): search `bb-hard-*-2026-07-16T*` under eval `HIP_EVAL_REPORT_DIR` / goal implementer `m1-hard/reports/`.
