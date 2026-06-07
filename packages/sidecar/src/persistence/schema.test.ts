import { describe, it, expect } from 'vitest'
import { DatabaseSync } from './sqlite.js'
import { migrate } from './schema.js'

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
}

describe('migrate', () => {
  it('adds title_custom (default 0) and reaches user_version 2', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'sessions')).toContain('title_custom')
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2)
    db.exec(`INSERT INTO sessions(id,title,config,created_at,updated_at) VALUES('s','t','{}',1,1)`)
    expect((db.prepare(`SELECT title_custom FROM sessions WHERE id='s'`).get() as { title_custom: number }).title_custom).toBe(0)
  })

  it('is idempotent and upgrades an existing v1 database in place', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    migrate(db) // second run must not throw (e.g. duplicate column)
    expect(columns(db, 'sessions').filter((c) => c === 'title_custom')).toHaveLength(1)
  })
})
