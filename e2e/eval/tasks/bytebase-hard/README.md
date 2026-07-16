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
