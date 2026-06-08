import { describe, it, expect } from 'vitest'
import { DatabaseSync } from './sqlite.js'
import { migrate } from './schema.js'

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
}

describe('migrate', () => {
  it('adds title_custom, a stopped column, and reaches user_version 3', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'sessions')).toContain('title_custom')
    expect(columns(db, 'messages')).toContain('stopped')
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3)
    db.exec(`INSERT INTO sessions(id,title,config,created_at,updated_at) VALUES('s','t','{}',1,1)`)
    db.exec(`INSERT INTO messages(id,session_id,seq,role,content,timestamp) VALUES('m','s',1,'user','hi',1)`)
    expect((db.prepare(`SELECT stopped FROM messages WHERE id='m'`).get() as { stopped: number }).stopped).toBe(0)
  })

  it('is idempotent and upgrades an existing v1 database in place', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    migrate(db) // second run must not throw (e.g. duplicate column)
    expect(columns(db, 'sessions').filter((c) => c === 'title_custom')).toHaveLength(1)
    expect(columns(db, 'messages').filter((c) => c === 'stopped')).toHaveLength(1)
  })
})
