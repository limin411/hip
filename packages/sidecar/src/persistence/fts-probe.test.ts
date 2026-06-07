import { describe, it, expect } from 'vitest'
import { DatabaseSync } from './sqlite.js'

// Spike: confirm Node's bundled SQLite has FTS5 + the trigram tokenizer, that
// trigram MATCH finds a Chinese substring, and that our createRequire loader makes
// node:sqlite usable under vitest (a static `import` from 'node:sqlite' fails to
// resolve in Vite). If FTS itself were missing, the fallback is better-sqlite3.
describe('node:sqlite FTS5 + trigram feasibility', () => {
  it('creates a trigram FTS table and matches a Chinese substring', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`CREATE VIRTUAL TABLE t USING fts5(body, tokenize='trigram')`)
    db.prepare(`INSERT INTO t(body) VALUES (?)`).run('未配置密钥请在设置中配置')
    const rows = db.prepare(`SELECT body FROM t WHERE t MATCH ?`).all('"设置中"')
    expect(rows).toHaveLength(1)
    db.close()
  })
})
