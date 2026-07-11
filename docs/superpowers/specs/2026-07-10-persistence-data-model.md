# Persistence data model (sessions + memory)

This document describes SQLite tables used by hip’s local persistence layer
(`packages/sidecar` → `~/.hip/data/…`). Focus is the **cross-session memory**
tables introduced with schema v16+, and how they interact with session delete.

## Sessions / messages (existing)

- `sessions` — conversation metadata + JSON `config`
- `messages` — turns; schema v17 adds optional `memory_citations` (JSON array of
  `{ memoryId, title?, note? }`). Loaded into `Message.memoryCitations` on
  `session:load`. Citation parse bumps `memory_items.use_count` **once per turn**
  at finalize; reload must **not** re-increment.

## Memory tables (v16)

### `memory_items`

Long-term memory entries (global / project / session).

| Column | Notes |
|--------|--------|
| `id` | Primary key |
| `scope` | `global` \| `project` \| `session` |
| `project_key` / `project_key_hash` | Project identity (canonical path + hash) |
| `session_id` | Set when `scope='session'` |
| `kind` | preference / convention / lesson / workflow / profile |
| `title`, `content` | Human-readable body |
| `confidence` | 0–1 |
| `status` | `active` \| `archived` \| `deleted` |
| `source` | extract / user / import / tool / consolidate |
| `source_session_id` | Session that produced the item (for derived delete) |
| `tags_json` | JSON string array |
| `created_at`, `updated_at`, `last_used_at` | Epoch ms |
| `use_count` | Citation bumps |
| `pinned` | Core snapshot priority |

Optional FTS5 virtual table `memories_fts` (trigram) mirrors title/content when
FTS is available.

### `memory_summaries`

Rolled-up markdown for inject “core” blocks (`scope` + optional project keys).

### `memory_stage1`

Idle-extract staging rows (raw memory + rollout summary) pending Phase2 consolidate.

### `memory_jobs`

Background job watermarks / leases (extract, consolidate, decay).

## Delete semantics

### Default `session:delete`

1. Delete session-scoped rows:  
   `memory_items` where `scope='session' AND session_id=?`  
   `memory_stage1` where `session_id=?`
2. **Keep** project/global items whose `source_session_id` matches; only clear the
   provenance pointer: `source_session_id = NULL`.

### Optional `deleteDerivedMemories: true`

Hard-delete all items derived from that conversation:

```sql
DELETE FROM memory_items WHERE source_session_id=?;
```

(UI: “Also delete long-term memories derived from this session” on
`DeleteSessionDialog`.)

### `memory:deleteBySourceSession`

Default **hard** delete by `source_session_id` (and related stage1 cleanup in
store). Optional `soft: true` marks `status='deleted'` only (API / advanced).

## Config file

Writable global flags live in `~/.hip/config/memory.json` (`MemoryFileConfig`),
not in SQLite. Session overrides: `SessionConfig.useMemories` /
`generateMemories` / `incognito`.
