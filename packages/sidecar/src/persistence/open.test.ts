import { describe, it, expect } from 'vitest'
import { openDatabase } from './open.js'
import { migrate } from './schema.js'

describe('openDatabase', () => {
  it('creates core tables and sets user_version = 3', () => {
    const { db, ftsEnabled } = openDatabase(':memory:')
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['sessions', 'messages', 'agent_runs']))
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3)
    expect(ftsEnabled).toBe(true)
    db.close()
  })

  it('is idempotent across re-open (no duplicate-table error)', () => {
    const { db } = openDatabase(':memory:')
    expect(() => migrate(db)).not.toThrow()
    db.close()
  })
})
