# hip 本地持久化数据模型（Sprint C）

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-10 |
| 状态 | **现行** |
| 路径 | `~/.hip/db/hip.db`（SQLite） |
| 工具大输出 | `~/.hip/data/tool-output/`（文件，非 DB 大 blob） |

---

## 1. 读路径（UI / session:load）

```
session:load / 前端恢复
  └─ 权威：messages 表 (+ agent_runs / tool_calls via loadMessagesWithRuns)
  └─ event：仅 crash rebuild / 高级调试（默认 UI 不整会话从 event 重建）
  └─ session_message：legacy 投影，勿作为新功能读路径
```

**代码锁定：**

- `SessionManager` 加载：`store.loadMessages` / `loadMessagesWithRuns`
- `runTurn` 默认从 `host.messages` 与（可选）event rebuild **仅当** `useEventSource` 且 messages 空/等长时

---

## 2. 表职责

| 表 | 职责 | 删会话 |
|----|------|--------|
| `sessions` | 会话元数据 + config JSON | 删除根行 |
| `messages` | UI 权威对话行 | FK CASCADE |
| `agent_runs` | 每轮 agent 输出/时序 | CASCADE |
| `tool_calls` | 工具调用明细 | CASCADE |
| `checkpoints` | git 检查点元数据 | CASCADE |
| `event` + `event_sequence` | 事件溯源（无 FK 到 sessions） | **显式 DELETE by aggregate_id** |
| `snapshots` | 会话快照 | 显式 DELETE |
| `session_message` | legacy 投影 | 显式 DELETE |
| `session_input` | steer/queue 输入 | 显式 DELETE |
| `session_context_epoch` | 上下文 epoch | 显式 DELETE |
| `cron_tasks` | 定时任务 | 显式 DELETE |
| `workflow_*` | 内部 workflow 引擎 | runs/events 按 session_id 显式 DELETE |
| `messages_fts` | FTS 索引 | 随 messages 触发器 |

---

## 3. 删除语义（选项 P）

用户删除会话 = **真删**（隐私优先）：

1. workflow_events / workflow_runs  
2. event / event_sequence / snapshots / session_message / session_input / epoch / cron  
3. `DELETE FROM sessions`（级联 messages 等）

实现：`SessionStore.deleteSession`（事务）。

---

## 4. 命名（agents）

| UI Fixed Agents | Sidecar profile id |
|-----------------|--------------------|
| coder | `coder` |
| explore | `explore` |
| plan | `plan` |
| — | `supervisor`（主循环） |
| — | `worker`（**legacy** 兼容） |

---

## 5. 运维

```bash
# 体积
ls -lh ~/.hip/db/hip.db

# 可选压缩（应用关闭后）
sqlite3 ~/.hip/db/hip.db 'VACUUM;'

# 工具输出目录
du -sh ~/.hip/data/tool-output
```
