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

## Memory embedding tables (v18)

Portable vector store for hybrid search. Cosine scoring over **BLOB** rows works
without the native `sqlite-vec` extension; optional `vec0` virtual tables are a
runtime mirror when the extension loads.

### `memory_embedding_meta`

One row per embedding model identity.

| Column | Notes |
|--------|--------|
| `model_key` | PK; stable key e.g. `provider/model` |
| `dim` | Vector dimension (set on first successful embed for that model) |
| `updated_at` | Epoch ms |

### `memory_embedding_rows`

One embedding per memory item (latest model only; reindex rewrites).

| Column | Notes |
|--------|--------|
| `memory_id` | PK; same id as `memory_items.id` (not a SQL FK cascade) |
| `model_key` | Model that produced this vector |
| `dim` | Dimension of `embedding` |
| `embedding` | Float32 little-endian BLOB |
| `updated_at` | Epoch ms |

Hard-delete of a memory (or trash purge / empty trash / derived hard-delete)
also deletes the corresponding embedding row(s). Soft-delete leaves the row so
restore can re-use or re-embed.

Optional runtime tables: `memory_vec_{dim}` (`vec0`) when
`tryEnableSqliteVec` succeeds (`openDatabase` → `memoriesVecEnabled`). Failure
is non-fatal: hybrid cosine still uses BLOB rows.

## Delete / trash semantics

### Soft delete (trash)

User delete (default UI / tool path) sets `memory_items.status = 'deleted'` and
bumps `updated_at`. Item is hidden from search, prefetch, and active lists but
**row remains**. Restore sets `status = 'active'` and may schedule re-embed when
an embedding model is configured.

- `trashRetentionDays` (default **30**) in `memory.json`: startup job
  hard-purges soft-deleted rows with `updated_at` older than the cutoff.
- `emptyTrash`: hard-delete **all** `status='deleted'` rows (+ embedding cleanup).

### Hard delete

`hardDelete(id)` / `memory:delete` with `hard: true` removes the row and
embedding immediately (not recoverable).

### Default `session:delete`

1. Delete session-scoped rows:  
   `memory_items` where `scope='session' AND session_id=?`  
   `memory_stage1` where `session_id=?`
2. **Keep** project/global items whose `source_session_id` matches; only clear the
   provenance pointer: `source_session_id = NULL`.

### Optional `deleteDerivedMemories: true`

**Hard**-delete all items derived from that conversation (not trash):

```sql
DELETE FROM memory_items WHERE source_session_id=?;
```

(Embeddings for those ids are removed; stage1 for the session is cleaned up.)

UI: “Also delete long-term memories derived from this session” on
`DeleteSessionDialog`.

### `memory:deleteBySourceSession`

Default **hard** delete by `source_session_id` (and related stage1 cleanup in
store). Optional `soft: true` marks items `status='deleted'` only (API /
advanced); stage1 is still hard-deleted.

| Path | Soft (trash) | Hard (gone) |
|------|--------------|-------------|
| User delete item | default | optional `hard` |
| Empty trash / retention job | — | yes |
| Session delete + derived | — | yes when opted in |
| `deleteBySourceSession` | optional `soft: true` | **default** |

## Hybrid search flags

Live in `MemoryFileConfig` (`~/.hip/config/memory.json`), not SQLite:

| Flag | Default | Notes |
|------|---------|--------|
| `hybridSearchEnabled` | `false` | When true, requires `embeddingModel` |
| `embeddingModel` | unset | OpenAI-compatible embed ref; required if hybrid on |
| `rerankModel` | unset | Optional; unset skips rerank |
| `trashRetentionDays` | `30` | Soft-delete purge window |

Runtime:

- **Hybrid on + embed client available:** FTS/LIKE candidates → query embed →
  hybrid score (FTS rank + cosine + confidence + recency + pin) → optional
  rerank pass-through.
- **Hybrid off / no embed model / embed client fails:** plain FTS/LIKE
  `searchInScopes` order (V1 behavior).
- **sqlite-vec probe false:** no crash; BLOB cosine still usable when hybrid on;
  FTS always available independently.

## Config file

Writable global flags live in `~/.hip/config/memory.json` (`MemoryFileConfig`),
not in SQLite. Session overrides: `SessionConfig.useMemories` /
`generateMemories` / `incognito`.
