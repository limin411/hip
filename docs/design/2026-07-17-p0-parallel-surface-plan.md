# P0 Parallel Surface — Implementation Plan

| Field | Value |
|-------|-------|
| **Spec** | [`2026-07-17-p0-parallel-surface-spec.md`](./2026-07-17-p0-parallel-surface-spec.md) |
| **Date** | 2026-07-17 |
| **Status** | Plan — executing with staged commits |

---

## Commits（预期）

| # | Commit theme | Deliverable |
|---|--------------|-------------|
| 1 | `docs: lock P0 parallel surface decision + spec/plan` | 决策锁定 + spec/plan |
| 2 | `feat(worktree): createBranch/pathKey + parallel run UI` | 协议、sidecar、parallelStore、Composer/侧栏 |
| 3 | `feat(cli): session create/send + worktree commands` | CLI |
| 4 | `feat(diff): annotate hunks and send to agent` | 批注 |
| 5 | `feat(terminal): send selection to composer` | 终端回灌 |

---

## Task breakdown

### T1 — Docs / decision
- [x] 锁定默认决议到 upgrade brief
- [x] Spec + Plan

### T2 — Worktree + Parallel Studio
- [x] Protocol message fields
- [x] Sidecar handler + `gitCreateBranch` startPoint
- [x] Tests for create with createBranch/pathKey
- [x] `parallelStore` + `startParallelRun`
- [x] Composer Parallel control
- [x] Sidebar parallel group
- [x] i18n en/zh-CN/zh-TW

### T3 — CLI
- [x] `session create` / `session send`
- [x] `worktree` command group
- [x] Wire `bin.ts`

### T4 — Diff annotations
- [x] `diffAnnotationStore`
- [x] Hunk provider actions
- [x] InputBar chip + send packaging
- [x] Unit test format helper

### T5 — Terminal
- [x] Context menu item
- [x] i18n

### T6 — Verify
- [x] workspace-git tests (91)
- [x] Frontend unit tests for new modules
- [x] type-check frontend + cli
- [x] Summary feedback

---

## Risk notes

- Fan-out cost: default N=2, max 4.
- Unique branch: `hip-p-{run8}-{i}`.
- Host session used only for git ops; slots are real agent sessions.
