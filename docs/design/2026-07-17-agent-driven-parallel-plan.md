# Agent-driven Parallel Worktrees — Plan

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Status** | Implementing |
| **Supersedes UX** | Composer `ParallelRunChip` as primary entry (removed) |
| **Related** | `2026-07-17-p0-parallel-surface-spec.md` §2.2 (reoriented) |

---

## §0 Goal

Parallel worktree 扇出由 **内生 agent** 在对话中提议；经 **HITL（PermissionModal）** 由用户选择路数或拒绝；确认后 sidecar 创建持久 worktree 并后台跑子任务。

**非目标：** 输入框常驻「并行 ×N」；多 session 宿主扇出作为主路径。

---

## §1 Tasks

| ID | Task | Done |
|----|------|------|
| T1 | 设计 plan（本文） | ✓ |
| T2 | 移除 `ParallelRunChip` 与 InputBar 挂载 | ✓ |
| T3 | `PermissionManager.requestChoice`（自定义 optionId） | ✓ |
| T4 | 工具 `parallel_worktrees` + 测试 | ✓ |
| T5 | `runBackgroundSubagent` 支持固定 root / 保留 worktree | ✓ |
| T6 | 协议 `parallel:started` + UI store 挂接（侧栏仍可见） | ✓ |
| T7 | i18n 清理 chip 文案；补 permission 内容依赖现有 modal | ✓ |
| T8 | 验证 + commit | |

---

## §2 Tool contract

```text
parallel_worktrees
  goal: string              # 每路要做的事（或基础 prompt）
  suggested_count: 2|3|4    # agent 建议
  rationale: string         # 展示给用户的理由
  variants?: string[]       # 可选：每路不同说明（长度应 = count 或忽略）
```

HITL options: `n2` / `n3` / `n4`（kind allow_once）+ `reject`（kind reject_once）。  
建议路数可在 content 中标注。

成功返回 JSON：`{ runId, count, slots: [{ index, branch, path, taskId }] }`。

---

## §3 Flow

```text
Agent calls parallel_worktrees
  → permission:request (content = rationale + suggested N)
  → User picks N or reject
  → create N branches + managed worktrees (persistent)
  → spawn N background workers with root=worktree, keepWorktree
  → parallel:started → UI parallelStore
  → tool result to agent
```

---

## §4 Cleanup of host-driven path

- Delete / unmount ParallelRunChip  
- Keep `sessionService.startParallelRun` only if still useful for tests; prefer remove call sites  
- CLI worktree commands remain (scripting surface)
