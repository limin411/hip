import { describe, it, expect } from 'vitest'
import { openDatabase } from './open.js'
import { migrate } from './schema.js'

describe('openDatabase', () => {
  it('creates core tables and sets user_version = 9', () => {
    const { db, ftsEnabled } = openDatabase(':memory:')
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['sessions', 'messages', 'agent_runs']))
    const cols = (db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('timeline')
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(13)
    expect(ftsEnabled).toBe(true)
    db.close()
  })

  it('is idempotent across re-open (no duplicate-table error)', () => {
    const { db } = openDatabase(':memory:')
    expect(() => migrate(db)).not.toThrow()
    db.close()
  })
})
