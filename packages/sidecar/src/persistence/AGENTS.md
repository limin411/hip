# packages/sidecar/src/persistence/ — AGENTS.md

SQLite persistence layer with FTS5 full-text search and incremental schema migrations (v1→v9). Uses `node:sqlite` via `createRequire` (Vite workaround).

## STRUCTURE

```
persistence/
├── open.ts      # openDatabase(): WAL journal, FK enforcement, migration, FTS5 probe
├── sqlite.ts    # Vite-safe createRequire(import.meta.url)('node:sqlite') import
├── schema.ts    # Incremental ALTER TABLE migrations (v1→v9), FTS5 trigram virtual table
└── store.ts     # SessionStore (251 lines): CRUD for sessions, messages, agent_runs, tool_calls, checkpoints + FTS search
```

## SCHEMA (v9)

| Table | Purpose |
|-------|---------|
| `sessions` | id, title, config (JSON), title_custom, stopped, diff_base_sha, current_branch, session_start_commit, acp_session_id |
| `messages` | id, session_id, seq, role, agent_id, content, timestamp, stopped, timeline (JSON) |
| `agent_runs` | session_id, message_id, agent_id, role, output, task_input, parent_agent_id, prompt_tokens, completion_tokens |
| `tool_calls` | session_id, agent_run_id, call_id, agent_id, name, input, output, status, error, seq, truncated |
| `checkpoints` | id, session_id, turn_id, kind, label, tree_sha, commit_sha, branch |
| `messages_fts` | FTS5 trigram virtual table with auto-maintaining triggers |

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Add migration | `schema.ts` | Incremental ALTER TABLE — append to `MIGRATIONS` array |
| Add query | `store.ts` | All DB operations: load, save, delete, search |
| DB open | `open.ts` | WAL mode, FK pragma, migration gate |

## CONVENTIONS

- **Incremental migrations only**: Never modify existing migrations — always append
- **WAL mode**: Enabled at open for concurrent read performance
- **No raw SQL outside store.ts**: schema.ts defines DDL, store.ts defines DML
- **FTS5**: Trigram tokenizer for CJK support; LIKE fallback when FTS unavailable
