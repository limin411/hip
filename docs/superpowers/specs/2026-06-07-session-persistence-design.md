# Session Persistence (SQLite) — Design

**Date:** 2026-06-07
**Status:** Approved (pending written-spec review)
**Goal:** Persist chat sessions to a local SQLite database so conversations survive sidecar/app restarts, are browsable and full-text searchable from the sidebar, and can be resumed with full LLM context — including the multi-agent trajectory of each turn.

---

## 1. Scope

### In scope (v1)
- Persist **sessions**, **conversation messages** (user + assistant), and the **multi-agent trajectory** (`agent_runs`) of each turn.
- Durable, browsable session list in the sidebar that survives frontend reload and sidecar restart.
- **Resume with context:** opening an old session and sending a new message continues the conversation with the full prior history fed to the agent.
- **Full-text search** across message content + session titles (FTS5, CJK-aware).
- **Delete** a session (hard delete + cascade).

### Out of scope (explicit non-goals)
- Encryption at rest — we store plaintext and rely on OS disk encryption (FileVault). The DeepSeek API key stays in the OS keychain as today; it is **not** written to SQLite.
- Full-text search over `agent_runs.output` (only message content + titles are indexed).
- Soft delete / trash / undo.
- Pagination or list virtualization (the list query returns all sessions; revisit at scale).
- Export/import, multi-window sync, editing or branching past messages.

### Constraints
- Single-user, single desktop window. One sidecar process owns the DB; `node:sqlite` is synchronous, so no cross-process locking concerns.
- The frontend remains a **read-only view** of sidecar truth; the sidecar is authoritative for all persisted rows.

---

## 2. Architecture

| Concern | Decision | Rationale |
|---|---|---|
| **DB owner** | The **sidecar** (Node) | It is already the single source of truth for session state (`SessionManager` Map + LangChain history). Reads/writes happen in the process that already holds the data — no new IPC. |
| **Engine** | Node 24 built-in **`node:sqlite`** (`DatabaseSync`), WAL journal mode | Zero native addons; `ncc` treats `node:` imports as externals automatically. Bundled SQLite includes FTS5. |
| **DB file** | Tauri `app_data_dir` → `hip.db` (macOS: `~/Library/Application Support/com.ljm.app/hip.db`) | Per-user, survives app updates, covered by FileVault. |
| **Path injection** | `spawn_sidecar` sets env var `HIP_DB_PATH` when launching the sidecar (mirrors existing `DEEPSEEK_API_KEY` injection) | Reuses the established injection pattern. Missing/empty → sidecar falls back to `:memory:` (standalone runs, tests). |

**Rejected alternative — Rust-owned DB (`tauri-plugin-sql` / `rusqlite`):** session data never flows through Rust today. Rust ownership would require a new Tauri command + WS round-trip for every read/write, and the sidecar (which runs the agents and holds LangChain history) still couldn't touch its own session store without IPC. More moving parts, worse cohesion, no benefit for a local single-user app.

### Spike (must run before building search) — FTS feasibility
Confirm Node 24's bundled SQLite has **FTS5** and the **`trigram`** tokenizer by creating a throwaway virtual table at startup. If unavailable:
- Fallback A (preferred): swap engine to `better-sqlite3` (bundles SQLite with FTS5; `ncc` copies the `.node` addon).
- Fallback B (degrade): keep `node:sqlite`, drop the FTS table, and implement search with `LIKE '%query%'` over `messages.content` + `sessions.title`.

The startup probe also runs in production: if FTS init throws, log a warning and degrade search to `LIKE` rather than crashing the sidecar.

---

## 3. Data model

```sql
-- One row per conversation.
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,        -- stable ID (see §6)
  title       TEXT NOT NULL,           -- default '新对话'; derived from first user message
  config      TEXT NOT NULL,           -- JSON-serialized SessionConfig
  created_at  INTEGER NOT NULL,        -- epoch ms
  updated_at  INTEGER NOT NULL         -- bumped on each new message; drives sidebar ordering
);

-- One row per finalized conversation message (user + assistant).
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,        -- stable ID
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,        -- monotonic order within session
  role        TEXT NOT NULL,           -- 'user' | 'assistant'
  agent_id    TEXT,                    -- e.g. 'supervisor'; NULL for user messages
  content     TEXT NOT NULL,
  timestamp   INTEGER NOT NULL         -- epoch ms
);
CREATE INDEX idx_messages_session ON messages(session_id, seq);

-- Multi-agent trajectory: one row per agent invocation within a turn.
CREATE TABLE agent_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id  TEXT REFERENCES messages(id) ON DELETE CASCADE,  -- the turn's assistant message; NULL if the turn produced none
  seq         INTEGER NOT NULL,        -- order of agents within the turn
  agent_id    TEXT NOT NULL,           -- supervisor | planner | coder | reviewer
  role        TEXT NOT NULL,           -- AgentRole
  output      TEXT NOT NULL,           -- the agent's accumulated token output
  started_at  INTEGER NOT NULL,
  finished_at INTEGER                  -- finished_at - started_at = elapsedMs; NULL if interrupted
);
CREATE INDEX idx_agent_runs_session ON agent_runs(session_id, seq);

-- Full-text search over message content (FTS5, external-content table).
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid',
  tokenize='trigram'                   -- CJK-aware substring matching (unicode61 cannot segment Chinese)
);

-- Keep messages_fts in sync with messages.
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
```

**Schema versioning:** `PRAGMA user_version` gates migrations. On open, if `user_version < 1`, run the v1 DDL above inside a transaction and set `user_version = 1`. Future changes add forward migrations keyed by version.

**Pragmas on open:** `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`.

---

## 4. Protocol changes (`packages/protocol/src/index.ts`)

New shared types:

```ts
export interface AgentRun {
  agentId: string          // 'supervisor' | 'planner' | 'coder' | 'reviewer'
  role: AgentRole
  output: string
  startedAt: number
  finishedAt: number | null
  seq: number
}

export interface SessionSummary {
  id: string
  title: string
  preview: string          // snippet of the latest message
  updatedAt: number        // epoch ms
  messageCount: number
}

export interface SearchHit {
  sessionId: string
  messageId: string | null // null when the hit is a title match
  title: string
  snippet: string          // FTS5 snippet() with match markers
  timestamp: number
}
```

`ClientMessage` — additions and one modification:

```ts
// Added:
| { type: 'session:list' }
| { type: 'session:load'; sessionId: string }
| { type: 'session:search'; query: string }
| { type: 'session:delete'; sessionId: string }

// Modified — carries the client-generated stable user-message id:
| { type: 'message:send'; sessionId: string; id: string; content: string; role: 'user' }
```

`ServerMessage` — additions:

```ts
| { type: 'session:list:result'; sessions: SessionSummary[] }
| { type: 'session:loaded'; sessionId: string; messages: Message[]; agentRuns: AgentRun[] }
| { type: 'session:search:result'; query: string; hits: SearchHit[] }
| { type: 'session:deleted'; sessionId: string }
```

`session:create` already carries `id` (only the generator changes; see §6). `session:destroy` keeps its current meaning — release the in-memory session — and does **not** delete from the DB. Durable deletion is `session:delete`.

---

## 5. Components & flows

### 5.1 Sidecar persistence module (new)
- `packages/sidecar/src/persistence/open.ts` — `openDatabase(path: string): DatabaseSync`: opens the file, applies pragmas, runs migrations, probes FTS5/trigram (sets a `ftsEnabled` flag).
- `packages/sidecar/src/persistence/schema.ts` — DDL strings + `migrate(db)`.
- `packages/sidecar/src/persistence/store.ts` — `SessionStore` class wrapping prepared statements:
  - `insertSession(row)`, `touchSession(id, updatedAt)`, `updateTitle(id, title)`
  - `insertMessage(row)` (computes `seq = MAX(seq)+1` for the session inside the txn)
  - `insertTurn(assistantMsg, agentRuns)` — one transaction: insert assistant message, insert N agent_runs linked to it, touch session
  - `listSessions(): SessionSummary[]` — ordered by `updated_at DESC`
  - `loadMessages(sessionId): Message[]`, `loadAgentRuns(sessionId): AgentRun[]`
  - `search(query): SearchHit[]` — FTS5 `MATCH` + `snippet()` over messages, `UNION` title `LIKE` matches (or `LIKE`-only when `ftsEnabled` is false)
  - `deleteSession(id)`

`main.ts` reads `process.env.HIP_DB_PATH ?? ':memory:'`, calls `openDatabase`, and hands the `SessionStore` to the `SessionManager`.

### 5.2 SessionManager / Session wiring
- **`session:create`** → `store.insertSession({ id, title: '新对话', config, created_at, updated_at })`.
- **`message:send`**:
  1. If `sessionId` is **not in the in-memory Map**, lazily **rehydrate**: `store.loadMessages(sessionId)` → rebuild LangChain `BaseMessage[]` (`HumanMessage`/`AIMessage` by role) → reconstruct the `Session` with that history. This is what makes resume-after-restart work transparently.
  2. `store.insertMessage({ id, session_id, role:'user', content, timestamp })`; `store.touchSession`.
  3. If the session title is still the default and this is the first user message, derive a title from a snippet of `content` and `store.updateTitle`.
  4. Run the turn as today; accumulate each agent's output + start/finish times in memory.
- **Turn completion** (current `message:complete` path): `store.insertTurn(assistantMessage, agentRuns)` in one transaction. FTS stays in sync via triggers.
- **Cancel / error:** the user message is already persisted; no assistant message or agent_runs are written for the aborted turn (matches current in-memory behavior). Partial agent outputs are discarded.

### 5.3 ws-server handlers (new)
- `session:list` → `store.listSessions()` → `session:list:result`.
- `session:load` → `store.loadMessages` + `store.loadAgentRuns` → `session:loaded`. (Read-only; does **not** rehydrate the LangChain `Session` — that happens lazily on the next `message:send`, so previewing a session is cheap.)
- `session:search` → `store.search(query)` → `session:search:result`.
- `session:delete` → `store.deleteSession(id)` + drop from the in-memory Map → `session:deleted`.

### 5.4 Frontend (`src/domain`, `src/components/sidebar`)
- **IDs:** switch session id and user-message id generators from counters to `nanoid()` (already a dependency); include the user-message `id` in `message:send`.
- **On connect** (after `ready`): dispatch `session:list` to populate the sidebar from the DB.
- **Store:** `SessionVM` gains a `loaded: boolean` flag. `session:list:result` populates summaries (`loaded:false`, empty `messages`). Opening a session with `loaded:false` dispatches `session:load`; `session:loaded` fills `messages` and rebuilds `agents: AgentVM[]` from `agentRuns`, then sets `loaded:true`.
- **Search:** the existing sidebar search box debounces into `session:search`; `session:search:result` renders hits (title + snippet); clicking a hit opens/loads that session.
- **Delete:** the existing per-session delete affordance dispatches `session:delete`; `session:deleted` removes it from the store.
- New reducer cases in `applyServerMessage` for the four new server messages; new hooks/selectors as needed (`useSessionSummaries`, `useSearchResults`).

### 5.5 Rust / Tauri (`src-tauri/src/sidecar.rs`)
- In `spawn_sidecar`: resolve `app.path().app_data_dir()`, create the directory if absent, build `<dir>/hip.db`, and set `cmd.env("HIP_DB_PATH", db_path)` — alongside the existing `DEEPSEEK_API_KEY` env. No new Rust crate or Tauri plugin is required (SQLite lives entirely in the sidecar).

### 5.6 Startup recovery
Sidecar restart leaves the DB intact and the in-memory Map empty. The frontend repopulates the sidebar via `session:list` on reconnect; opening/sending lazily rehydrates only the touched session. No eager "load every session's history into memory" step.

---

## 6. ID strategy (must change)

Current IDs are ephemeral frontend counters (`s-new-1`, `u-1`) that reset on reload and collide across restarts — unusable as durable primary keys. v1 switches to **stable IDs minted at creation and persisted verbatim**:
- **Session id:** `nanoid()` on the frontend in `session:create` (sidecar stores it as-is).
- **User message id:** `nanoid()` on the frontend, carried in `message:send.id`, stored as-is — so the optimistic-UI id equals the persisted id (no reconciliation on reload).
- **Assistant message id:** generated by the sidecar as today (`asst-<agentId>-<timestamp>`), already unique.

`seq` (not timestamp) is the canonical ordering key within a session, so ties and clock jitter never reorder a conversation.

---

## 7. Testing strategy

- **Persistence unit tests** (`packages/sidecar/src/persistence/store.test.ts`) with `:memory:` DB:
  - insert/list/load round-trip for sessions, messages, agent_runs
  - `insertTurn` writes assistant message + linked agent_runs atomically
  - FTS: a Chinese substring query matches via the `trigram` tokenizer; `snippet()` returns markers
  - cascade delete: deleting a session removes its messages, agent_runs, and FTS rows
  - migration idempotency: opening twice does not duplicate tables; `user_version` ends at 1
- **Rehydrate test** (SessionManager): a cold manager (empty Map) + a DB pre-seeded with prior messages → a `message:send` rebuilds the LangChain history; assert the reconstructed `BaseMessage[]` carries the prior turns (no real LLM call needed).
- **FTS-disabled path:** with the probe forced off, `search` degrades to `LIKE` and still returns matches.
- **Existing tests:** run the sidecar with `HIP_DB_PATH=':memory:'` (or inject a `:memory:` store) so no suite touches the real DB file. Real-LLM tests stay gated by their existing `skipIf`.

---

## 8. Edge cases & notes

- **Turn with no final supervisor text:** no assistant message is emitted; `agent_runs` for that turn are written with `message_id = NULL` and grouped by `session_id` + `seq`. The panel reconstruction tolerates null `message_id`.
- **`node:sqlite` ExperimentalWarning:** acceptable; optionally suppressed via process warning filter. Functionality is stable on Node 24.
- **WAL sidecar files:** `hip.db-wal` / `hip.db-shm` live next to `hip.db` in the app data dir; expected, not an error.
- **Large content:** message content is unbounded TEXT; no truncation in v1.
- **Concurrency:** single synchronous writer (the sidecar); `busy_timeout` covers transient WAL contention from the checkpointer.

---

## 9. File map

**New**
- `packages/sidecar/src/persistence/open.ts`
- `packages/sidecar/src/persistence/schema.ts`
- `packages/sidecar/src/persistence/store.ts`
- `packages/sidecar/src/persistence/store.test.ts`

**Modified**
- `packages/protocol/src/index.ts` — new message types + `AgentRun`/`SessionSummary`/`SearchHit`; `message:send` gains `id`
- `packages/sidecar/src/main.ts` — open DB from `HIP_DB_PATH`, pass store to manager
- `packages/sidecar/src/session/session-manager.ts` — hold the store; persist on create/send; lazy rehydrate
- `packages/sidecar/src/session/session.ts` — collect agent trajectory; persist turn on completion
- `packages/sidecar/src/server/ws-server.ts` — handlers for list/load/search/delete
- `src/domain/sessionStore.ts` — `loaded` flag; reducer cases; nanoid ids
- `src/domain/sessionService.ts` — nanoid ids; `message:send.id`; dispatch list on connect
- `src/domain/hooks.ts`, `src/domain/index.ts` — new selectors/exports
- `src/components/sidebar/*` — wire search to FTS, list to summaries, delete to `session:delete`
- `src-tauri/src/sidecar.rs` — inject `HIP_DB_PATH`

---

## 10. Build order (for the plan)

1. **Spike:** verify FTS5 + `trigram` on Node 24 `node:sqlite`; decide engine.
2. Persistence module (`open`/`schema`/`store`) + unit tests with `:memory:`.
3. Protocol types (incl. `message:send.id`); stable nanoid IDs end-to-end.
4. SessionManager wiring: persist create/send/turn; lazy rehydrate (+ rehydrate test).
5. ws-server handlers: list / load / search / delete.
6. Rust `HIP_DB_PATH` injection.
7. Frontend: list-on-connect, lazy load, search, delete; `loaded` flag + reducers.
8. Full test pass + GUI acceptance.
