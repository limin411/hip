# make-stock-money eval / dogfood pack

Primary **long engineering task** target for hip: a real Tauri + Leptos + SQLite
desktop app (`make-stock-money`). Agents may edit freely inside an isolated
git worktree; the primary checkout stays clean (primary-guard).

Design context: `docs/design/2026-08-05-long-engineering-task-spec.md`.

## Repo

| Env | Default (this machine) |
|-----|------------------------|
| `HIP_EVAL_MSM_PATH` | `/Users/lijiamin/data/code-repository/project-rust/make-stock-money` |
| `HIP_EVAL_MSM_BASE_SHA` | optional pin; pack defaults to a known good SHA |

```bash
# one-shot env
eval "$(scripts/hip-eval-bootstrap-msm.sh)"
```

Requires: Rust toolchain, `cargo test` green on baseline.

## Tasks

| Id | Level | Kind | Setup |
|----|-------|------|-------|
| `msm-fix-priority-order` | L1 | fix | `break-priority-order.patch` |
| `msm-fix-validation` | L1 | fix | `break-validation.patch` |
| `msm-multi-file-db` | L2 | multi-bug | `break-multi-file-db.patch` |
| `msm-add-kind-filter` | L2 | add feature | none |
| `msm-longrun-watchlist` | L5 | multi-phase long | none |

Free-form multi-hour prompts (manual desktop / CLI): `scenarios/*.md`.

## Verify (all tasks default)

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

## Live UI (WDIO)

```bash
eval "$(scripts/hip-eval-bootstrap-msm.sh)"
E2E_LIVE_LLM=1 yarn test:e2e --spec e2e/specs/eval-msm-fix-priority.spec.ts
# or pack runner
scripts/hip-eval-ui-msm.sh
# long-run only
E2E_LIVE_LLM=1 E2E_GREP='@eval @msm @longrun' yarn test:e2e
```

## Headless CLI dogfood

```bash
eval "$(scripts/hip-eval-bootstrap-msm.sh)"
# structured task (worktree + hip run + verify)
yarn dogfood:msm -- --task msm-multi-file-db
# free-form long scenario
yarn dogfood:msm -- --scenario watchlist
# keep worktree for inspection
E2E_EVAL_KEEP_WORKSPACE=1 yarn dogfood:msm -- --task msm-longrun-watchlist
```

## Manual desktop (recommended for product UX)

1. `yarn tauri dev` (hip)
2. New Code session → bind folder to `HIP_EVAL_MSM_PATH` **or** a dogfood worktree
3. Paste a prompt from `scenarios/`
4. Log issues in `docs/design/msm-dogfood-journal.md`

## Unpaid smoke

Pack load is covered by `eval-matrix-load.spec.ts` (`@eval @smoke`).
