# mini-go (non-Bytebase)

Proves the UI eval harness is not Bytebase-specific.

## Bootstrap (once per machine)

```bash
eval "$(scripts/hip-eval-bootstrap-mini-go.sh)"
# sets HIP_EVAL_MINI_GO_PATH and HIP_EVAL_MINI_GO_BASE_SHA
```

## Live

```bash
eval "$(scripts/hip-eval-bootstrap-mini-go.sh)"
E2E_LIVE_LLM=1 yarn test:e2e --spec e2e/specs/eval-mini-fix-greet.spec.ts
# or
scripts/hip-eval-ui-mini-go.sh
```

## Unpaid

Pack load is covered by `eval-matrix-load.spec.ts`.
