import type { DatabaseSync } from './sqlite.js'

const DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, config TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, role TEXT NOT NULL, agent_id TEXT,
  content TEXT NOT NULL, timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, agent_id TEXT NOT NULL, role TEXT NOT NULL,
  output TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id, seq);
`

// FTS objects are created separately so a probe failure degrades search to LIKE
// without losing the core tables.
const FTS_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content, content='messages', content_rowid='rowid', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`

/** Create core tables (v1) and apply incremental migrations. Idempotent. */
export function migrate(db: DatabaseSync): void {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (version < 1) {
    db.exec('BEGIN')
    try {
      db.exec(DDL)
      db.exec('PRAGMA user_version = 1')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (version < 2) {
    db.exec('BEGIN')
    try {
      // title_custom: 0 = auto-derived title, 1 = user-set (never auto-overwritten).
      db.exec(`ALTER TABLE sessions ADD COLUMN title_custom INTEGER NOT NULL DEFAULT 0`)
      db.exec('PRAGMA user_version = 2')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (version < 3) {
    db.exec('BEGIN')
    try {
      // stopped: 1 = assistant turn was cancelled mid-stream (partial content kept).
      db.exec(`ALTER TABLE messages ADD COLUMN stopped INTEGER NOT NULL DEFAULT 0`)
      db.exec('PRAGMA user_version = 3')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (version < 4) {
    db.exec('BEGIN')
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tool_calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          agent_run_id INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
          call_id TEXT NOT NULL, agent_id TEXT NOT NULL, name TEXT NOT NULL,
          input TEXT NOT NULL, output TEXT, status TEXT NOT NULL, error TEXT,
          seq INTEGER NOT NULL, truncated INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON tool_calls(agent_run_id);
      `)
      db.exec(`ALTER TABLE agent_runs ADD COLUMN task_input TEXT`)
      db.exec(`ALTER TABLE agent_runs ADD COLUMN parent_agent_id TEXT`)
      db.exec('PRAGMA user_version = 4')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (version < 5) {
    db.exec('BEGIN')
    try {
      // timeline: JSON blob of TimelineStep[] for an assistant turn (reasoning
      // content inline; tool steps reference tool_calls rows by call_id). NULL
      // for user rows and legacy (pre-v5) assistant turns.
      db.exec(`ALTER TABLE messages ADD COLUMN timeline TEXT`)
      db.exec('PRAGMA user_version = 5')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (version < 6) {
    db.exec('BEGIN')
    try {
      // Provider-reported token counts per agent run (nullable; old rows stay NULL).
      // Turn total = sum across the turn's runs; $ cost is computed in the renderer.
      db.exec(`ALTER TABLE agent_runs ADD COLUMN prompt_tokens INTEGER`)
      db.exec(`ALTER TABLE agent_runs ADD COLUMN completion_tokens INTEGER`)
      db.exec(`ALTER TABLE agent_runs ADD COLUMN total_tokens INTEGER`)
      db.exec('PRAGMA user_version = 6')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (version < 7) {
    db.exec('BEGIN')
    try {
      // diff_base_sha: 会话起点工作区快照树 SHA（用于「自会话起点」diff base）。
      // NULL = 无快照（老会话 / 非 git 工作区）→ 客户端回退 HEAD。
      db.exec(`ALTER TABLE sessions ADD COLUMN diff_base_sha TEXT`)
      db.exec('PRAGMA user_version = 7')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (version < 8) {
    db.exec('BEGIN')
    try {
      // Per-turn checkpoint chain (Zed-style detached commit-tree on a private ref). commit_sha
      // is the GC-protected ref target; tree_sha drives diffs + restore. No agent_commits table —
      // the 更改 tab reads the commit log live from `git log`.
      db.exec(`
        CREATE TABLE IF NOT EXISTS checkpoints (
          id         TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          turn_id    TEXT,
          kind       TEXT NOT NULL DEFAULT 'turn',
          label      TEXT,
          tree_sha   TEXT NOT NULL,
          commit_sha TEXT NOT NULL,
          branch     TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, created_at);
      `)
      // current_branch: last-seen branch. session_start_commit: branch HEAD at session create
      // (commit-log lower bound; NULL on an unborn HEAD).
      db.exec(`ALTER TABLE sessions ADD COLUMN current_branch TEXT`)
      db.exec(`ALTER TABLE sessions ADD COLUMN session_start_commit TEXT`)
      db.exec('PRAGMA user_version = 8')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (version < 9) {
    db.exec('BEGIN')
    try {
      // acp_session_id: the external ACP agent's own session handle (e.g. OpenCode's
      // `ses_…`), captured after the first turn so a reopened hip session can resume the
      // agent-side conversation via loadSession. NULL for non-ACP / never-run sessions.
      db.exec('ALTER TABLE sessions ADD COLUMN acp_session_id TEXT')
      db.exec('PRAGMA user_version = 9')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (version < 10) {
    db.exec('BEGIN')
    try {
      // Event-sourced persistence foundation (Wave 1 of agent-design-remediation).
      // `event_sequence` tracks the per-aggregate monotonic sequence number; `event`
      // is the append-only log; `snapshots` stores periodic aggregate state for fast
      // crash recovery. These are the source of truth — session_message (added in a
      // later todo) is a denormalized projection. No FK to sessions(id): events must
      // survive a sessions-row delete (the event log is the source of truth).
      db.exec(`
        CREATE TABLE IF NOT EXISTS event_sequence (
          aggregate_id TEXT PRIMARY KEY,
          seq          INTEGER NOT NULL,
          owner_id     TEXT
        );
        CREATE TABLE IF NOT EXISTS event (
          id           TEXT PRIMARY KEY,
          aggregate_id TEXT NOT NULL,
          seq          INTEGER NOT NULL,
          type         TEXT NOT NULL,
          data         TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_event_aggregate_seq
          ON event(aggregate_id, seq);
        CREATE INDEX IF NOT EXISTS idx_event_aggregate_type_seq
          ON event(aggregate_id, type, seq);
        CREATE TABLE IF NOT EXISTS snapshots (
          session_id TEXT PRIMARY KEY,
          seq        INTEGER NOT NULL,
          state      TEXT NOT NULL,
          timestamp  INTEGER NOT NULL
        );
      `)
      db.exec('PRAGMA user_version = 10')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (version < 11) {
    db.exec('BEGIN')
    try {
      // session_message: denormalized projection of the event log into per-message
      // rows (Wave 1, Todo 2 of agent-design-remediation). The event table is the
      // source of truth; this table is a read-optimized view rebuilt by the
      // SessionMessageUpdater. `seq` mirrors the event's seq for replay idempotency.
      // `data` is JSON carrying role/content/toolCalls/usage/etc. No FK to sessions
      // or event: a rebuilt projection must survive source-table lifecycle changes.
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_message (
          id           TEXT PRIMARY KEY,
          session_id   TEXT NOT NULL,
          type         TEXT NOT NULL,
          seq          INTEGER NOT NULL,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL,
          data         TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_session_message_session_seq
          ON session_message(session_id, seq);
        CREATE INDEX IF NOT EXISTS idx_session_message_session_type_seq
          ON session_message(session_id, type, seq);
      `)
      db.exec('PRAGMA user_version = 11')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (version < 12) {
    db.exec('BEGIN')
    try {
      // Context epoch (Wave 3, Todo 9 of agent-design-remediation). One row per
      // session, holding the durable SystemContext baseline + snapshot with
      // revision-based optimistic concurrency fencing. `revision` is bumped on
      // every mutation; callers guard writes with `WHERE revision = expected`
      // to detect races. `replacement_seq` (non-NULL) flags the next prepare()
      // to do a full replace — set by agent switch, model switch, or compaction.
      // `location` stores the cwd at initialize() time for the session-move fence.
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_context_epoch (
          session_id      TEXT PRIMARY KEY,
          baseline        TEXT NOT NULL,
          agent           TEXT NOT NULL DEFAULT 'builtin',
          snapshot        TEXT NOT NULL,
          baseline_seq    INTEGER NOT NULL,
          replacement_seq INTEGER,
          revision        INTEGER NOT NULL DEFAULT 0,
          location        TEXT NOT NULL
        );
      `)
      db.exec('PRAGMA user_version = 12')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}

/** Try to create the FTS5 objects. Returns true if FTS is available. */
export function tryEnableFts(db: DatabaseSync): boolean {
  try {
    db.exec(FTS_DDL)
    return true
  } catch (e) {
    console.warn('[persistence] FTS5/trigram unavailable; search will use LIKE.', e)
    return false
  }
}
