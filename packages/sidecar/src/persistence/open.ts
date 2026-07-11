import { DatabaseSync } from './sqlite.js'
import { migrate, tryEnableFts, tryEnableMemoriesFts, tryEnableSqliteVec } from './schema.js'

export interface OpenedDb {
  db: DatabaseSync
  ftsEnabled: boolean
  memoriesFtsEnabled: boolean
  /**
   * True when the sqlite-vec extension loaded successfully (optional vec0 KNN).
   * BLOB embeddings in memory_embedding_rows work regardless.
   */
  memoriesVecEnabled: boolean
}

/** Open (or create) the SQLite database, apply pragmas, migrate, and probe FTS/vec. */
export function openDatabase(path: string): OpenedDb {
  // allowExtension is required for sqlite-vec; load is still gated by tryEnableSqliteVec.
  const db = new DatabaseSync(path, { allowExtension: true })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  const ftsEnabled = tryEnableFts(db)
  const memoriesFtsEnabled = tryEnableMemoriesFts(db)
  const memoriesVecEnabled = tryEnableSqliteVec(db)
  return { db, ftsEnabled, memoriesFtsEnabled, memoriesVecEnabled }
}
