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
