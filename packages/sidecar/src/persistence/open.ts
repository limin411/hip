import { DatabaseSync } from './sqlite.js'
import { migrate, tryEnableFts, tryEnableMemoriesFts } from './schema.js'

export interface OpenedDb {
  db: DatabaseSync
  ftsEnabled: boolean
  memoriesFtsEnabled: boolean
}

/** Open (or create) the SQLite database, apply pragmas, migrate, and probe FTS. */
export function openDatabase(path: string): OpenedDb {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  const ftsEnabled = tryEnableFts(db)
  const memoriesFtsEnabled = tryEnableMemoriesFts(db)
  return { db, ftsEnabled, memoriesFtsEnabled }
}
