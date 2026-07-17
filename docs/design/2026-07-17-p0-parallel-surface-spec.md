# P0 Parallel Surface — Spec

| Field | Value |
|-------|-------|
| **Title** | P0: Worktree Studio + CLI + Diff 批注 + Terminal 回灌 |
| **Date** | 2026-07-17 |
| **Status** | Spec — implementing |
| **Decision** | 默认决议已锁定：主叙事 A Parallel Studio（见 `docs/upgrade/00-decision-brief.md`） |
| **Plan** | [`2026-07-17-p0-parallel-surface-plan.md`](./2026-07-17-p0-parallel-surface-plan.md) |
| **Reading guide** | §0 → §1 范围 → §2 分主题需求 → §3 验收 → §4 非目标 |

---

## §0 一页纸

**问题：** hip 有 worktree/session/CLI 底座，但缺产品级「并行隔离跑 + 脚本化 + review 回灌」。

**目标（P0 MVP）：**

1. **Worktree Studio：** 一 prompt × N worktree × N session，侧栏可切换，可选「采用此方案」。
2. **产品 CLI：** `session create|send`、`worktree create|list|remove`。
3. **Diff 批注：** 批注/整 hunk 送 agent，Composer 可见 chip。
4. **Terminal 回灌：** 选中终端输出 → 送入 Composer。

**成功标准：** 见 §3。不做 SSH/mobile/Design Mode/Computer Use。

---

## §1 范围与原则

| ID | 原则 |
|----|------|
| P1 | 优先组合现有协议（`git:worktree:*` + `session:create` + `message:send`） |
| P2 | worktree 路径必须在 managed dir（`~/.hip/worktrees`） |
| P3 | 扇出不写坏 primary tree；分支名/路径唯一 |
| P4 | 终端 PTY 仍归 Tauri；本阶段不迁 sidecar |
| P5 | 测试覆盖关键纯逻辑 + 关键协议路径 |

---

## §2 需求

### 2.1 Worktree create 增强（协议/sidecar）

| 字段 | 说明 |
|------|------|
| `branch` | 目标分支名（safe） |
| `createBranch?` | true 时先 `git branch <name> [baseRef]` |
| `baseRef?` | 起点 ref，默认 HEAD |
| `pathKey?` | 相对 managed dir 的子路径（sanitize 分段）；默认 branch |

结果：`ok` + `path` | `error`。

### 2.2 Parallel Run（UI + domain）

```text
ParallelRun { id, baseCwd, prompt, hostSessionId, slots[], selectedSessionId?, createdAt }
Slot { index, sessionId, worktreePath, branch, status, error? }
```

- 入口：Code 会话 Composer「并行」控件（N=2..4，默认 2）。
- 流程：host session（baseCwd）→ 每 slot 建 branch+worktree → session(cwd=wt) → send 同 prompt。
- 侧栏：并行组标题 + slot 列表；点击 selectSession。
- 「采用此方案」：标记 selected，select 该 session 继续；不自动 merge。
- 清理：可选 remove 未选 worktree（best-effort）。

### 2.3 CLI

| 命令 | 行为 |
|------|------|
| `hip session create --cwd <dir> [--json]` | 创建 code session |
| `hip session send <id> <prompt> [--hitl auto\|fail]` | 一轮 turn |
| `hip worktree create --session <id> --branch <b> [--create-branch] [--json]` | 创建 worktree |
| `hip worktree list --session <id> [--json]` | 列表 |
| `hip worktree remove --session <id> --path <p>` | 删除 managed worktree |

### 2.4 Diff 批注

- 每 session 草稿 `DiffAnnotation[]`。
- Hunk 菜单：加入批注 / 直接 quote 到 Composer。
- Composer chip：N 条批注；Send 时 prepend 结构化 Markdown。

### 2.5 Terminal

- Canvas 菜单：「发送选区到对话」→ `setComposerQuote` 或 `insertComposerText`。

---

## §3 验收

| # | 标准 |
|---|------|
| A1 | 协议：`createBranch`+`pathKey` 创建成功；路径在 managed dir |
| A2 | UI：N=2 扇出后 2 session 不同 cwd，均可打开 |
| A3 | CLI：无 UI create+send 完成一轮（无 key 时明确失败码） |
| A4 | Diff：批注进入 outbound 用户消息 |
| A5 | Terminal：选区可送入 Composer |
| A6 | unit/integration 测试相关路径绿 |

---

## §4 非目标（P0）

- 自动 merge / 开 PR  
- `parallel:*` 服务端权威持久化（可后置；MVP 客户端 store + host session）  
- WebGL 终端 / 多分屏  
- SSH / mobile / Design Mode / 宽 vendor ACP  
