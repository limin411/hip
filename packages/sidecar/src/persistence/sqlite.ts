import { createRequire } from 'node:module'

// `node:sqlite` is an experimental Node 24 builtin. Vite (used by vitest) can't
// resolve a static `import ... from 'node:sqlite'` — its resolver strips the
// `node:` prefix and then fails trying to bundle `sqlite`. Loading it through
// createRequire keeps the specifier a runtime string Vite never analyzes, so it
// resolves natively under both vitest and production (`node --import tsx`).
//
// The pinned @types/node predates node:sqlite, so we declare the minimal surface
// the persistence layer uses rather than depend on upstream types.
export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}
export interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

const nodeRequire = createRequire(import.meta.url)
const sqlite = nodeRequire('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase }

/** The node:sqlite synchronous database class, loaded natively (Vite-safe). */
export const DatabaseSync = sqlite.DatabaseSync
export type DatabaseSync = SqliteDatabase
