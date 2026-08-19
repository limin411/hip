# Forgejo eval pack

Scoped coding tasks against a local [Forgejo](https://codeberg.org/forgejo/forgejo) checkout.
Uses **worktree isolation** (`workspace.strategy=worktree`) so the primary tree stays clean.

## Prerequisites

```bash
export HIP_EVAL_FORGEJO_PATH=/path/to/forgejo
# optional override of base pin
# export HIP_EVAL_FORGEJO_BASE_SHA=$(git -C "$HIP_EVAL_FORGEJO_PATH" rev-parse HEAD)
```

Real keys in `~/.hip/config/auth.json` for live runs.

## Tasks

| Id | Scope | Verify |
|----|-------|--------|
| `fj-util-fix-truncate-runes` | `modules/util/truncate.go` | `go test ./modules/util/ -count=1 -timeout 60s` |

## Live UI (WDIO)

```bash
E2E_LIVE_LLM=1 HIP_EVAL_FORGEJO_PATH=… \
  yarn test:e2e --spec e2e/specs/eval-forgejo-util-truncate.spec.ts
```

## Headless CLI dogfood

See scripts under the goal scratch / `scripts/` dogfood notes; product path is
`yarn workspace @hip/cli dev run` against a prepared eval worktree.
