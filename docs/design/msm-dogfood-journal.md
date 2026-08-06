# make-stock-money dogfood journal

Log long-task runs against `HIP_EVAL_MSM_PATH` here. One entry per session.

Template:

```md
## YYYY-MM-DD — <task id or scenario>

- Mode: UI | CLI dogfood | free
- Model:
- Wall time:
- Result: pass | fail | partial
- Verify: cargo test …
- hip issues observed:
  1. …
- Repro:
- Fix PR / commit (hip):
- Notes:
```

---

## Entries

### Baseline capture note (PR-3 / P0b)

Before hybrid dogfood, freeze one row of msm counters from `loop.compact` / overflow recovery: `llm_compacts`, `prunes`, `overflow_recoveries`, `prefire` (hit|pass2|started), plus tags `hybrid` / `throttled`. Compare post-hybrid runs against that row.

_(no run entries yet)_
