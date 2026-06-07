# SQLite Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist chat sessions, messages, and the multi-agent trajectory to a local SQLite database so conversations survive restarts, are browsable + full-text searchable in the sidebar, and resume with full LLM context.

**Architecture:** The **sidecar** (Node) owns the database via Node 24's built-in **`node:sqlite`** (`DatabaseSync`, WAL mode). The DB file lives in Tauri's `app_data_dir` (`hip.db`); Tauri injects its path via the `HIP_DB_PATH` env var when spawning the sidecar (mirroring the existing `DEEPSEEK_API_KEY` injection). The frontend stays a read-only view; the sidecar is authoritative. Full-text search uses FTS5 with the `trigram` tokenizer (CJK-aware). IDs switch from ephemeral counters to `nanoid()`.

**Tech Stack:** TypeScript, `node:sqlite` (FTS5/trigram), `ws`, LangChain, Zustand, React, Tauri v2 (Rust), `nanoid`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-session-persistence-design.md`

---

## File Structure

**New (sidecar persistence module):**
- `packages/sidecar/src/persistence/schema.ts` — DDL strings + `migrate(db)` (one responsibility: schema/migrations).
- `packages/sidecar/src/persistence/open.ts` — `openDatabase(path)`: pragmas, migrate, FTS probe.
- `packages/sidecar/src/persistence/store.ts` — `SessionStore` class: all prepared-statement CRUD + search.
- `packages/sidecar/src/persistence/store.test.ts` — unit tests (`:memory:` DB).
- `packages/sidecar/src/persistence/fts-probe.test.ts` — spike: FTS5 + trigram availability.

**Modified:**
- `packages/protocol/src/index.ts` — new message types + `AgentRun`/`SessionSummary`/`SearchHit`; `message:send` gains `id`.
- `packages/sidecar/src/session/session.ts` — inject store, accept `userMessageId`, accumulate trajectory, persist user msg + turn, `hydrate()`.
- `packages/sidecar/src/session/session-manager.ts` — hold store; persist on create; lazy rehydrate; list/load/search/delete handlers.
- `packages/sidecar/src/server/ws-server.ts` — accept a store, pass to manager.
- `packages/sidecar/src/main.ts` — open DB from `HIP_DB_PATH`, build store, pass to `WsServer`.
- `src/domain/sessionStore.ts` — `loaded`/`updatedAtMs`/`searchHits`; new reducer cases; `appendUserMessage(id)`; nanoid.
- `src/domain/sessionService.ts` — nanoid ids; `message:send.id`; list-on-ready; lazy load; `search`; `delete`.
- `src/domain/hooks.ts`, `src/domain/index.ts` — new selectors/exports.
- `src/components/sidebar/SearchBox.tsx`, `SessionList.tsx`, `SessionItem.tsx` — content search + snippets.
- `src-tauri/src/sidecar.rs` — inject `HIP_DB_PATH`.

---

## Shared type/method contract (used across tasks — keep names consistent)

```ts
// packages/protocol/src/index.ts
export interface AgentRun { agentId: string; role: AgentRole; output: string; startedAt: number; finishedAt: number | null; seq: number }
export interface SessionSummary { id: string; title: string; preview: string; updatedAt: number; messageCount: number }
export interface SearchHit { sessionId: string; messageId: string | null; title: string; snippet: string; timestamp: number }
```

```ts
// packages/sidecar/src/persistence/store.ts — SessionStore public surface
insertSession(r: { id: string; title: string; config: string; createdAt: number; updatedAt: number }): void
getSession(id: string): { id: string; title: string; config: string; created_at: number; updated_at: number } | undefined
touchSession(id: string, updatedAt: number): void
updateTitle(id: string, title: string): void
listSessions(): SessionSummary[]
insertMessage(r: { id: string; sessionId: string; role: 'user' | 'assistant'; agentId: string | null; content: string; timestamp: number }): number // returns assigned seq
insertTurn(assistant: { id: string; sessionId: string; agentId: string; content: string; timestamp: number } | null, sessionId: string, runs: AgentRun[]): void
loadMessages(sessionId: string): Message[]
loadAgentRuns(sessionId: string): AgentRun[]
search(query: string): SearchHit[]
deleteSession(id: string): void
```

---

## Task 0: Spike — verify FTS5 + `trigram` on `node:sqlite`

**Files:**
- Create: `packages/sidecar/src/persistence/fts-probe.test.ts`

This decides the engine. If it fails, switch the engine in later tasks to `better-sqlite3` (same SQL; `ncc` copies the `.node`), or degrade search to `LIKE`.

- [ ] **Step 1: Write the probe test**

```ts
// packages/sidecar/src/persistence/fts-probe.test.ts
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// Spike: confirm Node's bundled SQLite has FTS5 + the trigram tokenizer, and that
// trigram MATCH finds a Chinese substring. If this fails, see plan Task 1 fallback.
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
```

- [ ] **Step 2: Run it**

Run: `yarn vitest run packages/sidecar/src/persistence/fts-probe.test.ts`
Expected: PASS. If it throws `no such tokenizer: trigram` or `no such module: fts5`, STOP and record the fallback decision (better-sqlite3) before continuing — every later FTS step depends on this.

- [ ] **Step 3: Commit**

```bash
git add packages/sidecar/src/persistence/fts-probe.test.ts
git commit -m "test(persistence): spike node:sqlite FTS5 + trigram feasibility"
```

---

## Task 1: Schema + open + migrations

**Files:**
- Create: `packages/sidecar/src/persistence/schema.ts`
- Create: `packages/sidecar/src/persistence/open.ts`
- Create: `packages/sidecar/src/persistence/open.test.ts`

- [ ] **Step 1: Write `schema.ts`**

```ts
// packages/sidecar/src/persistence/schema.ts
import type { DatabaseSync } from 'node:sqlite'

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

/** Create core tables (migration v1). Returns nothing; idempotent. */
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
```

- [ ] **Step 2: Write `open.ts`**

```ts
// packages/sidecar/src/persistence/open.ts
import { DatabaseSync } from 'node:sqlite'
import { migrate, tryEnableFts } from './schema.js'

export interface OpenedDb { db: DatabaseSync; ftsEnabled: boolean }

/** Open (or create) the SQLite database, apply pragmas, migrate, and probe FTS. */
export function openDatabase(path: string): OpenedDb {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  const ftsEnabled = tryEnableFts(db)
  return { db, ftsEnabled }
}
```

- [ ] **Step 3: Write `open.test.ts`**

```ts
// packages/sidecar/src/persistence/open.test.ts
import { describe, it, expect } from 'vitest'
import { openDatabase } from './open.js'

describe('openDatabase', () => {
  it('creates core tables and sets user_version = 1', () => {
    const { db, ftsEnabled } = openDatabase(':memory:')
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['sessions', 'messages', 'agent_runs']))
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1)
    expect(ftsEnabled).toBe(true) // assumes Task 0 passed
    db.close()
  })

  it('is idempotent across re-open (no duplicate-table error)', () => {
    const { db } = openDatabase(':memory:')
    expect(() => migrateAgain(db)).not.toThrow()
    db.close()
  })
})

function migrateAgain(db: import('node:sqlite').DatabaseSync) {
  // Re-running migrate on an already-migrated db is a no-op.
  return require('./schema.js').migrate(db)
}
```

- [ ] **Step 4: Run + commit**

Run: `yarn vitest run packages/sidecar/src/persistence/open.test.ts` → Expected: PASS.

```bash
git add packages/sidecar/src/persistence/schema.ts packages/sidecar/src/persistence/open.ts packages/sidecar/src/persistence/open.test.ts
git commit -m "feat(persistence): schema, migrations, and WAL/FTS open()"
```

---

## Task 2: `SessionStore` — CRUD + FTS search

**Files:**
- Create: `packages/sidecar/src/persistence/store.ts`
- Create: `packages/sidecar/src/persistence/store.test.ts`

- [ ] **Step 1: Write the failing test (`store.test.ts`)**

```ts
// packages/sidecar/src/persistence/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from './open.js'
import { SessionStore } from './store.js'

function freshStore() {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
}

const cfg = JSON.stringify({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] })

describe('SessionStore', () => {
  let store: SessionStore
  beforeEach(() => { store = freshStore() })

  it('inserts and lists sessions newest-first with preview + count', () => {
    store.insertSession({ id: 's1', title: '新对话', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'm1', sessionId: 's1', role: 'user', agentId: null, content: '你好世界', timestamp: 2 })
    store.touchSession('s1', 2)
    const list = store.listSessions()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 's1', preview: '你好世界', messageCount: 1, updatedAt: 2 })
  })

  it('assigns monotonic seq per session', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    expect(store.insertMessage({ id: 'a', sessionId: 's1', role: 'user', agentId: null, content: 'x', timestamp: 1 })).toBe(1)
    expect(store.insertMessage({ id: 'b', sessionId: 's1', role: 'assistant', agentId: 'supervisor', content: 'y', timestamp: 2 })).toBe(2)
  })

  it('insertTurn writes assistant message + linked agent_runs atomically', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3 },
      's1',
      [{ agentId: 'planner', role: 'planner', output: 'plan', startedAt: 1, finishedAt: 2, seq: 0 },
       { agentId: 'supervisor', role: 'supervisor', output: 'done', startedAt: 1, finishedAt: 3, seq: 1 }],
    )
    expect(store.loadMessages('s1').map((m) => m.id)).toEqual(['u1', 'a1'])
    const runs = store.loadAgentRuns('s1')
    expect(runs.map((r) => r.agentId)).toEqual(['planner', 'supervisor'])
    expect(runs[0]).toMatchObject({ output: 'plan', startedAt: 1, finishedAt: 2, seq: 0 })
  })

  it('loadMessages returns protocol Message shape (agentId undefined for user)', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 7 })
    expect(store.loadMessages('s1')[0]).toEqual({ id: 'u1', role: 'user', content: 'hi', agentId: undefined, timestamp: 7 })
  })

  it('search finds a Chinese substring via FTS and returns a snippet', () => {
    store.insertSession({ id: 's1', title: '关于配置', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: '未配置密钥请在设置中配置', timestamp: 1 })
    const hits = store.search('设置中')
    expect(hits.some((h) => h.sessionId === 's1' && h.messageId === 'u1')).toBe(true)
  })

  it('search matches session titles too', () => {
    store.insertSession({ id: 's1', title: '部署笔记', config: cfg, createdAt: 1, updatedAt: 1 })
    const hits = store.search('部署')
    expect(hits.some((h) => h.sessionId === 's1' && h.messageId === null)).toBe(true)
  })

  it('deleteSession cascades to messages, agent_runs, and FTS', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: '可搜索内容', timestamp: 1 })
    store.deleteSession('s1')
    expect(store.listSessions()).toHaveLength(0)
    expect(store.loadMessages('s1')).toHaveLength(0)
    expect(store.search('可搜索内容')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn vitest run packages/sidecar/src/persistence/store.test.ts` → Expected: FAIL (`SessionStore` not found).

- [ ] **Step 3: Implement `store.ts`**

```ts
// packages/sidecar/src/persistence/store.ts
import type { DatabaseSync } from 'node:sqlite'
import type { AgentRole, AgentRun, Message, SessionSummary, SearchHit } from '@hip/protocol'

const PREVIEW_LEN = 80

/** All persisted reads/writes for sessions. Synchronous (node:sqlite). */
export class SessionStore {
  constructor(private readonly db: DatabaseSync, private readonly ftsEnabled: boolean) {}

  insertSession(r: { id: string; title: string; config: string; createdAt: number; updatedAt: number }): void {
    this.db.prepare(`INSERT INTO sessions(id,title,config,created_at,updated_at) VALUES(?,?,?,?,?)`)
      .run(r.id, r.title, r.config, r.createdAt, r.updatedAt)
  }

  getSession(id: string) {
    return this.db.prepare(`SELECT id,title,config,created_at,updated_at FROM sessions WHERE id=?`).get(id) as
      | { id: string; title: string; config: string; created_at: number; updated_at: number }
      | undefined
  }

  touchSession(id: string, updatedAt: number): void {
    this.db.prepare(`UPDATE sessions SET updated_at=? WHERE id=?`).run(updatedAt, id)
  }

  updateTitle(id: string, title: string): void {
    this.db.prepare(`UPDATE sessions SET title=? WHERE id=?`).run(title, id)
  }

  private nextSeq(sessionId: string): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(seq),0)+1 AS n FROM messages WHERE session_id=?`).get(sessionId) as { n: number }
    return row.n
  }

  insertMessage(r: { id: string; sessionId: string; role: 'user' | 'assistant'; agentId: string | null; content: string; timestamp: number }): number {
    const seq = this.nextSeq(r.sessionId)
    this.db.prepare(`INSERT INTO messages(id,session_id,seq,role,agent_id,content,timestamp) VALUES(?,?,?,?,?,?,?)`)
      .run(r.id, r.sessionId, seq, r.role, r.agentId, r.content, r.timestamp)
    return seq
  }

  insertTurn(
    assistant: { id: string; sessionId: string; agentId: string; content: string; timestamp: number } | null,
    sessionId: string,
    runs: AgentRun[],
  ): void {
    this.db.exec('BEGIN')
    try {
      if (assistant) {
        this.insertMessage({ id: assistant.id, sessionId, role: 'assistant', agentId: assistant.agentId, content: assistant.content, timestamp: assistant.timestamp })
      }
      const stmt = this.db.prepare(
        `INSERT INTO agent_runs(session_id,message_id,seq,agent_id,role,output,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?)`,
      )
      for (const run of runs) {
        stmt.run(sessionId, assistant?.id ?? null, run.seq, run.agentId, run.role, run.output, run.startedAt, run.finishedAt)
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  loadMessages(sessionId: string): Message[] {
    const rows = this.db.prepare(`SELECT id,role,agent_id,content,timestamp FROM messages WHERE session_id=? ORDER BY seq`).all(sessionId) as
      { id: string; role: 'user' | 'assistant'; agent_id: string | null; content: string; timestamp: number }[]
    return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, agentId: r.agent_id ?? undefined, timestamp: r.timestamp }))
  }

  loadAgentRuns(sessionId: string): AgentRun[] {
    const rows = this.db.prepare(`SELECT agent_id,role,output,started_at,finished_at,seq FROM agent_runs WHERE session_id=? ORDER BY seq`).all(sessionId) as
      { agent_id: string; role: AgentRole; output: string; started_at: number; finished_at: number | null; seq: number }[]
    return rows.map((r) => ({ agentId: r.agent_id, role: r.role, output: r.output, startedAt: r.started_at, finishedAt: r.finished_at, seq: r.seq }))
  }

  listSessions(): SessionSummary[] {
    const rows = this.db.prepare(`
      SELECT s.id, s.title, s.updated_at AS updatedAt,
        (SELECT content FROM messages m WHERE m.session_id=s.id ORDER BY seq DESC LIMIT 1) AS preview,
        (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id) AS messageCount
      FROM sessions s ORDER BY s.updated_at DESC
    `).all() as { id: string; title: string; updatedAt: number; preview: string | null; messageCount: number }[]
    return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, messageCount: r.messageCount, preview: (r.preview ?? '').slice(0, PREVIEW_LEN) }))
  }

  search(query: string): SearchHit[] {
    const q = query.trim()
    if (!q) return []
    const like = `%${q}%`
    const titleHits = this.db.prepare(`SELECT id AS sessionId, title, updated_at AS timestamp FROM sessions WHERE title LIKE ? ORDER BY updated_at DESC LIMIT 20`)
      .all(like) as { sessionId: string; title: string; timestamp: number }[]
    const titleOut: SearchHit[] = titleHits.map((t) => ({ sessionId: t.sessionId, messageId: null, title: t.title, snippet: t.title, timestamp: t.timestamp }))

    // trigram MATCH needs ≥3 chars and a quoted literal to avoid FTS syntax errors.
    const useFts = this.ftsEnabled && q.length >= 3
    if (useFts) {
      const literal = `"${q.replace(/"/g, '""')}"`
      const rows = this.db.prepare(`
        SELECT m.session_id AS sessionId, m.id AS messageId, s.title AS title,
          snippet(messages_fts, 0, '[', ']', '…', 12) AS snippet, m.timestamp AS timestamp
        FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
        JOIN sessions s ON s.id = m.session_id
        WHERE messages_fts MATCH ? ORDER BY rank LIMIT 50
      `).all(literal) as SearchHit[]
      return [...titleOut, ...rows]
    }
    // Fallback: LIKE over message content.
    const rows = this.db.prepare(`
      SELECT m.session_id AS sessionId, m.id AS messageId, s.title AS title,
        substr(m.content,1,80) AS snippet, m.timestamp AS timestamp
      FROM messages m JOIN sessions s ON s.id = m.session_id
      WHERE m.content LIKE ? ORDER BY m.timestamp DESC LIMIT 50
    `).all(like) as SearchHit[]
    return [...titleOut, ...rows]
  }

  deleteSession(id: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id=?`).run(id)
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run packages/sidecar/src/persistence/store.test.ts` → Expected: PASS (all cases). If the title-LIKE + FTS union produces a duplicate for a session matching both, that's acceptable (different `messageId`).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
git commit -m "feat(persistence): SessionStore CRUD + FTS/LIKE search"
```

---

## Task 3: Protocol types

**Files:**
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Add types + messages**

Add after the `Message` interface:

```ts
export interface AgentRun {
  agentId: string
  role: AgentRole
  output: string
  startedAt: number
  finishedAt: number | null
  seq: number
}

export interface SessionSummary {
  id: string
  title: string
  preview: string
  updatedAt: number
  messageCount: number
}

export interface SearchHit {
  sessionId: string
  messageId: string | null
  title: string
  snippet: string
  timestamp: number
}
```

Replace the `message:send` line and add the four new client messages in `ClientMessage`:

```ts
  | { type: 'message:send'; sessionId: string; id: string; content: string; role: 'user' }
  | { type: 'session:list' }
  | { type: 'session:load'; sessionId: string }
  | { type: 'session:search'; query: string }
  | { type: 'session:delete'; sessionId: string }
```

Add the four new server messages in `ServerMessage`:

```ts
  | { type: 'session:list:result'; sessions: SessionSummary[] }
  | { type: 'session:loaded'; sessionId: string; messages: Message[]; agentRuns: AgentRun[] }
  | { type: 'session:search:result'; query: string; hits: SearchHit[] }
  | { type: 'session:deleted'; sessionId: string }
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: FAIL — existing `message:send` call sites now miss `id` (sidecar `session-manager.ts:18` reads `msg.content`; frontend `sessionService.ts:71` builds the message). These are fixed in Tasks 4–5 and 8. (Type-check passes fully only after those.) Confirm the only errors are the expected `message:send.id` / new-message sites.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): persistence messages + AgentRun/SessionSummary/SearchHit; message:send.id"
```

---

## Task 4: Session — persist user message, trajectory, turn; `hydrate()`

**Files:**
- Modify: `packages/sidecar/src/session/session.ts`
- Create: `packages/sidecar/src/session/session-persist.test.ts`

The store is injected as an **optional 4th constructor arg**, so existing tests (`new Session(id, config, model)`) keep working with no persistence.

- [ ] **Step 1: Write the failing test**

```ts
// packages/sidecar/src/session/session-persist.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { Session } from './session.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }
function store() { const { db, ftsEnabled } = openDatabase(':memory:'); return new SessionStore(db, ftsEnabled) }

describe('Session persistence', () => {
  let st: SessionStore
  beforeEach(() => { st = store(); st.insertSession({ id: 's1', title: '新对话', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 }) })

  it('persists the user message and the assistant turn', async () => {
    const model = new FakeListChatModel({ responses: ['hello world'] })
    const session = new Session('s1', cfg, model, st)
    await session.sendMessage('hi there', () => {}, 'u-1')
    const msgs = st.loadMessages('s1')
    expect(msgs[0]).toMatchObject({ id: 'u-1', role: 'user', content: 'hi there' })
    expect(msgs.at(-1)).toMatchObject({ role: 'assistant', content: 'hello world' })
  })

  it('derives the session title from the first user message', async () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    await new Session('s1', cfg, model, st).sendMessage('给会话加持久化', () => {}, 'u-1')
    expect(st.getSession('s1')!.title).toContain('给会话加持久化')
  })

  it('hydrate() seeds prior history so a follow-up turn has context', async () => {
    st.insertMessage({ id: 'u0', sessionId: 's1', role: 'user', agentId: null, content: '我叫小明', timestamp: 1 })
    st.insertMessage({ id: 'a0', sessionId: 's1', role: 'assistant', agentId: 'supervisor', content: '好的', timestamp: 2 })
    const model = new FakeListChatModel({ responses: ['小明'] })
    const session = new Session('s1', cfg, model, st)
    session.hydrate(st.loadMessages('s1'))
    const events: { type: string }[] = []
    await session.sendMessage('我叫什么', (m) => events.push(m), 'u1')
    // The fake model echoes a fixed response; the assertion is that hydrate ran
    // without error and a complete turn was produced on top of prior history.
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    expect(st.loadMessages('s1').map((m) => m.id)).toContain('u0')
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `yarn vitest run packages/sidecar/src/session/session-persist.test.ts` → Expected: FAIL (constructor has no 4th param; no `hydrate`).

- [ ] **Step 3: Implement the edits in `session.ts`**

Add the import and a small helper near the top:

```ts
import type { ServerMessage, SessionConfig, AgentRole, Message, AgentRun } from '@hip/protocol'
import type { SessionStore } from '../persistence/store.js'
```

```ts
const TITLE_LEN = 40
function deriveTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > TITLE_LEN ? oneLine.slice(0, TITLE_LEN) + '…' : oneLine || '新对话'
}
```

Add the store field + constructor param (after `model?`):

```ts
  constructor(
    readonly id: string,
    readonly config: SessionConfig,
    model?: BaseLanguageModel,
    private readonly store?: SessionStore,
  ) {
    this.usesEnvModel = !model
    this.agent = createDeepAgent({ /* unchanged */ })
  }

  /** Seed prior conversation so the agent resumes with full context. */
  hydrate(messages: Message[]): void {
    for (const m of messages) {
      this.messages.push(m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))
    }
  }
```

Change `sendMessage` signature and add persistence. Replace the body from the `this.messages.push(new HumanMessage(content))` line through the final `message:complete` send:

```ts
  async sendMessage(content: string, _send: SendFn, userMessageId?: string): Promise<void> {
    if (this.usesEnvModel && !process.env.DEEPSEEK_API_KEY?.trim()) {
      _send({ type: 'error', sessionId: this.id, code: 'NO_API_KEY', message: 'DeepSeek API key not configured. Set it in Settings.' })
      return
    }

    // Persist the user message + bump/derive session metadata before running.
    const userTs = Date.now()
    if (this.store) {
      const seq = this.store.insertMessage({ id: userMessageId ?? `u-${userTs}`, sessionId: this.id, role: 'user', agentId: null, content, timestamp: userTs })
      this.store.touchSession(this.id, userTs)
      if (seq === 1) this.store.updateTitle(this.id, deriveTitle(content))
    }

    this.messages.push(new HumanMessage(content))
    this.abortController = new AbortController()

    // Trajectory: per-agent accumulated output + timings, in start order.
    type Run = { role: AgentRole; output: string; startedAt: number; finishedAt: number | null; seq: number }
    const trajectory = new Map<string, Run>()
    let agentSeq = 0

    const started = new Set<string>()
    const ensureStarted = (agentId: string, role: AgentRole) => {
      if (started.has(agentId)) return
      started.add(agentId)
      trajectory.set(agentId, { role, output: '', startedAt: Date.now(), finishedAt: null, seq: agentSeq++ })
      _send({ type: 'agent:started', sessionId: this.id, agentId, role })
    }
    const finishRemaining = () => {
      for (const id of started) {
        const r = trajectory.get(id); if (r) r.finishedAt = Date.now()
        _send({ type: 'agent:finished', sessionId: this.id, agentId: id })
      }
      started.clear()
    }

    let supervisorText = ''
    ensureStarted('supervisor', 'supervisor')
    try {
      const run = await this.agent.streamEvents({ messages: this.messages }, { version: 'v3', signal: this.abortController.signal })

      const pumpSupervisor = async () => {
        for await (const msg of run.messages) {
          for await (const delta of msg.text) {
            if (!delta) continue
            supervisorText += delta
            const r = trajectory.get('supervisor'); if (r) r.output += delta
            _send({ type: 'token:stream', sessionId: this.id, agentId: 'supervisor', delta })
          }
        }
      }
      const pumpSubagents = async () => {
        for await (const sub of run.subagents) {
          const agentId = sub.name
          ensureStarted(agentId, roleForName(sub.name))
          for await (const msg of sub.messages) {
            for await (const delta of msg.text) {
              if (!delta) continue
              const r = trajectory.get(agentId); if (r) r.output += delta
              _send({ type: 'token:stream', sessionId: this.id, agentId, delta })
            }
          }
          if (started.delete(agentId)) {
            const r = trajectory.get(agentId); if (r) r.finishedAt = Date.now()
            _send({ type: 'agent:finished', sessionId: this.id, agentId })
          }
        }
      }

      await Promise.all([pumpSupervisor(), pumpSubagents()])
      finishRemaining()
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      finishRemaining()
      _send({ type: 'error', sessionId: this.id, code: isAbort ? 'CANCELLED' : 'AGENT_ERROR',
        message: isAbort ? 'User cancelled the request' : err instanceof Error ? err.message : String(err) })
      return
    }

    if (supervisorText) this.messages.push(new AIMessage(supervisorText))

    const ts = Date.now()
    const assistantId = `asst-supervisor-${ts}`
    // Trajectory is keyed by agentId — build AgentRun[] directly from its entries.
    const runs: AgentRun[] = [...trajectory.entries()].map(([agentId, r]) => ({
      agentId, role: r.role, output: r.output, startedAt: r.startedAt, finishedAt: r.finishedAt, seq: r.seq,
    }))
    // Persist the turn (assistant message only when non-empty, matching LangChain history).
    if (this.store) {
      this.store.insertTurn(
        supervisorText ? { id: assistantId, sessionId: this.id, agentId: 'supervisor', content: supervisorText, timestamp: ts } : null,
        this.id,
        runs,
      )
      this.store.touchSession(this.id, ts)
    }

    _send({ type: 'message:complete', sessionId: this.id,
      message: { id: assistantId, role: 'assistant', content: supervisorText, agentId: 'supervisor', timestamp: ts } })
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run packages/sidecar/src/session/session-persist.test.ts` → Expected: PASS.
Run the existing session tests to confirm no regression: `yarn vitest run packages/sidecar/src/session/session-unit.test.ts` → Expected: PASS (no store passed → no persistence path).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-persist.test.ts
git commit -m "feat(sidecar): persist user message, multi-agent trajectory, and turn; hydrate() for resume"
```

---

## Task 5: SessionManager — persist on create, lazy rehydrate, list/load/search/delete

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts`
- Create: `packages/sidecar/src/session/session-manager-persist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/sidecar/src/session/session-manager-persist.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }
function mk() {
  const { db, ftsEnabled } = openDatabase(':memory:')
  const store = new SessionStore(db, ftsEnabled)
  // Inject a fake model factory so the manager builds offline sessions in tests.
  const mgr = new SessionManager(store, () => new FakeListChatModel({ responses: ['ok'] }))
  return { store, mgr }
}

describe('SessionManager persistence', () => {
  let store: SessionStore, mgr: SessionManager, sent: ServerMessage[]
  const send = (m: ServerMessage) => sent.push(m)
  beforeEach(() => { ({ store, mgr } = mk()); sent = [] })

  it('persists the session row on session:create', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    expect(store.getSession('s1')).toBeDefined()
  })

  it('session:list returns persisted sessions', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    sent = []
    mgr.handle({ type: 'session:list' }, send)
    const res = sent.find((m) => m.type === 'session:list:result') as Extract<ServerMessage, { type: 'session:list:result' }>
    expect(res.sessions.map((s) => s.id)).toContain('s1')
  })

  it('session:load returns messages + agentRuns', async () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    await mgr.handleAsync({ type: 'message:send', sessionId: 's1', id: 'u1', content: 'hi', role: 'user' }, send)
    sent = []
    mgr.handle({ type: 'session:load', sessionId: 's1' }, send)
    const loaded = sent.find((m) => m.type === 'session:loaded') as Extract<ServerMessage, { type: 'session:loaded' }>
    expect(loaded.messages.some((m) => m.id === 'u1')).toBe(true)
    expect(loaded.agentRuns.length).toBeGreaterThan(0)
  })

  it('rehydrates a cold session from the DB on message:send', async () => {
    // Seed DB directly, with NO in-memory session.
    store.insertSession({ id: 's9', title: 't', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u0', sessionId: 's9', role: 'user', agentId: null, content: '我叫小明', timestamp: 1 })
    await mgr.handleAsync({ type: 'message:send', sessionId: 's9', id: 'u1', content: '再见', role: 'user' }, send)
    // Prior message survives and a new turn was appended.
    const ids = store.loadMessages('s9').map((m) => m.id)
    expect(ids).toEqual(expect.arrayContaining(['u0', 'u1']))
  })

  it('session:delete removes the session and emits session:deleted', async () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    sent = []
    mgr.handle({ type: 'session:delete', sessionId: 's1' }, send)
    expect(store.getSession('s1')).toBeUndefined()
    expect(sent.some((m) => m.type === 'session:deleted')).toBe(true)
  })
})
```

> NOTE: this introduces an async path. `sendMessage` is async, but the current `handle` is sync and fire-and-forgets it. Add a thin `handleAsync` that awaits message-send (used by tests); production `handle` can keep calling it without awaiting. Keep both.

- [ ] **Step 2: Run to verify fail**

Run: `yarn vitest run packages/sidecar/src/session/session-manager-persist.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement `session-manager.ts`**

```ts
// packages/sidecar/src/session/session-manager.ts
import type { ClientMessage, ServerMessage, SessionConfig } from '@hip/protocol'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import { Session } from './session.js'
import type { SessionStore } from '../persistence/store.js'

type SendFn = (msg: ServerMessage) => void
type ModelFactory = (config: SessionConfig) => BaseLanguageModel | undefined

export class SessionManager {
  private readonly sessions = new Map<string, Session>()

  // modelFactory defaults to undefined → Session builds the real env-keyed model.
  constructor(
    private readonly store?: SessionStore,
    private readonly modelFactory: ModelFactory = () => undefined,
  ) {}

  handle(msg: ClientMessage, send: SendFn): void {
    void this.handleAsync(msg, send)
  }

  async handleAsync(msg: ClientMessage, send: SendFn): Promise<void> {
    switch (msg.type) {
      case 'session:create':
        this.createSession(msg.id, msg.config, send)
        break
      case 'session:destroy':
        this.destroySession(msg.sessionId)
        break
      case 'message:send':
        await this.ensureSession(msg.sessionId).sendMessage(msg.content, send, msg.id)
        break
      case 'message:cancel':
        this.sessions.get(msg.sessionId)?.cancel()
        break
      case 'session:list':
        send({ type: 'session:list:result', sessions: this.store?.listSessions() ?? [] })
        break
      case 'session:load':
        send({ type: 'session:loaded', sessionId: msg.sessionId,
          messages: this.store?.loadMessages(msg.sessionId) ?? [],
          agentRuns: this.store?.loadAgentRuns(msg.sessionId) ?? [] })
        break
      case 'session:search':
        send({ type: 'session:search:result', query: msg.query, hits: this.store?.search(msg.query) ?? [] })
        break
      case 'session:delete':
        this.store?.deleteSession(msg.sessionId)
        this.sessions.delete(msg.sessionId)
        send({ type: 'session:deleted', sessionId: msg.sessionId })
        break
    }
  }

  private createSession(id: string, config: SessionConfig, send: SendFn): void {
    const now = Date.now()
    this.store?.insertSession({ id, title: '新对话', config: JSON.stringify(config), createdAt: now, updatedAt: now })
    this.sessions.set(id, new Session(id, config, this.modelFactory(config), this.store))
    send({ type: 'session:created', sessionId: id })
  }

  /** Get the in-memory session, or rebuild it from the DB (lazy resume). */
  private ensureSession(id: string): Session {
    const existing = this.sessions.get(id)
    if (existing) return existing
    const row = this.store?.getSession(id)
    const config: SessionConfig = row ? JSON.parse(row.config) : { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }
    const session = new Session(id, config, this.modelFactory(config), this.store)
    if (this.store) session.hydrate(this.store.loadMessages(id))
    this.sessions.set(id, session)
    return session
  }

  private destroySession(id: string): void {
    this.sessions.get(id)?.destroy()
    this.sessions.delete(id)
  }
}
```

> NOTE: `ensureSession` also covers the case where a brand-new session sends before `session:create` was persisted (e.g. a row missing in the DB): it falls back to a default config and creates an unpersisted in-memory session. If you want a strict FK guarantee, have `ensureSession` insert a session row when `row` is undefined.

- [ ] **Step 4: Run to verify pass**

Run: `yarn vitest run packages/sidecar/src/session/session-manager-persist.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-persist.test.ts
git commit -m "feat(sidecar): persist sessions, lazy rehydrate, and list/load/search/delete handlers"
```

---

## Task 6: Wire the DB into the process (main + WsServer)

**Files:**
- Modify: `packages/sidecar/src/server/ws-server.ts`
- Modify: `packages/sidecar/src/main.ts`

- [ ] **Step 1: Thread the store through `WsServer`**

In `ws-server.ts`, import the store type and accept it; pass to the manager:

```ts
import type { SessionStore } from '../persistence/store.js'
// ...
  constructor(private readonly port: number, private readonly token: string, store?: SessionStore) {
    this.wss = new WebSocketServer({ port })
    this.sessionManager = new SessionManager(store)
  }
```

- [ ] **Step 2: Open the DB in `main.ts`**

```ts
// packages/sidecar/src/main.ts
import { randomUUID } from 'node:crypto'
import { WsServer } from './server/ws-server.js'
import { openDatabase } from './persistence/open.js'
import { SessionStore } from './persistence/store.js'

async function main(): Promise<void> {
  const dbPath = process.env.HIP_DB_PATH?.trim() || ':memory:'
  const { db, ftsEnabled } = openDatabase(dbPath)
  const store = new SessionStore(db, ftsEnabled)

  const port = await WsServer.findAvailablePort()
  const token = randomUUID()
  const server = new WsServer(port, token, store)
  await server.start()
  process.stdout.write(JSON.stringify({ port, token }) + '\n')
}

main().catch((err) => {
  console.error('[sidecar] fatal', err)
  process.exit(1)
})
```

- [ ] **Step 3: Type-check the sidecar package + run all sidecar tests**

Run: `yarn type-check && yarn vitest run packages/sidecar`
Expected: PASS (the `message:send.id` protocol error from Task 3 is now resolved on the sidecar side; the frontend side is fixed in Task 8 — if type-check still flags `sessionService.ts`, that's expected until Task 8).

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/server/ws-server.ts packages/sidecar/src/main.ts
git commit -m "feat(sidecar): open HIP_DB_PATH database and inject the store"
```

---

## Task 7: Rust — inject `HIP_DB_PATH`

**Files:**
- Modify: `src-tauri/src/sidecar.rs`

- [ ] **Step 1: Add a pure path helper + test**

Add to `sidecar.rs` (above `#[cfg(test)]`):

```rust
use std::path::{Path, PathBuf};

/// The sidecar's SQLite file lives in the app data dir as `hip.db`.
pub fn db_path_for(data_dir: &Path) -> PathBuf {
    data_dir.join("hip.db")
}
```

Add to the `tests` module:

```rust
    #[test]
    fn db_path_is_hip_db_under_data_dir() {
        let p = super::db_path_for(std::path::Path::new("/tmp/app"));
        assert_eq!(p, std::path::PathBuf::from("/tmp/app/hip.db"));
    }
```

- [ ] **Step 2: Inject the env var in `spawn_sidecar`**

After the `DEEPSEEK_API_KEY` injection block, before `cmd.spawn()`:

```rust
    // Tell the sidecar where to persist sessions. Create the dir if needed so the
    // first launch on a fresh machine succeeds.
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        cmd = cmd.env("HIP_DB_PATH", db_path_for(&dir));
    }
```

(`tauri::Manager` is already imported, which brings `app.path()` into scope.)

- [ ] **Step 3: Build + test the Rust crate**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (`db_path_is_hip_db_under_data_dir` plus existing tests). If the workspace is configured for `yarn tauri` only, run `cd src-tauri && cargo test`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/sidecar.rs
git commit -m "feat(tauri): inject HIP_DB_PATH so the sidecar persists to app_data_dir"
```

---

## Task 8: Frontend domain — stable IDs, list/load/search/delete

**Files:**
- Modify: `src/domain/sessionStore.ts`
- Modify: `src/domain/sessionService.ts`
- Modify: `src/domain/hooks.ts`
- Modify: `src/domain/index.ts`
- Modify: `src/domain/sessionStore.test.ts`
- Modify: `src/domain/sessionService.test.ts`

- [ ] **Step 1: Extend the store — types + reducer cases (failing tests first)**

Add to `sessionStore.test.ts` (new cases):

```ts
it('session:list:result populates unloaded summaries', () => {
  const s0 = { sessions: [] as SessionVM[] }
  const next = applyServerMessage(s0 as any, { type: 'session:list:result', sessions: [
    { id: 's1', title: 'T', preview: 'P', updatedAt: 1000, messageCount: 2 },
  ] } as any, 2000)
  expect(next.sessions[0]).toMatchObject({ id: 's1', title: 'T', loaded: false, updatedAtMs: 1000 })
})

it('session:loaded fills messages + agents and marks loaded', () => {
  const base = { sessions: [{ ...emptySession('s1'), loaded: false }] as any }
  const next = applyServerMessage(base, { type: 'session:loaded', sessionId: 's1',
    messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 1 }],
    agentRuns: [{ agentId: 'planner', role: 'planner', output: 'p', startedAt: 1, finishedAt: 2, seq: 0 }] } as any, 0)
  expect(next.sessions[0].loaded).toBe(true)
  expect(next.sessions[0].messages).toHaveLength(1)
  expect(next.sessions[0].agents[0].id).toBe('planner')
})

it('session:deleted removes the session', () => {
  const base = { sessions: [emptySession('s1'), emptySession('s2')] }
  const next = applyServerMessage(base as any, { type: 'session:deleted', sessionId: 's1' } as any, 0)
  expect(next.sessions.map((s) => s.id)).toEqual(['s2'])
})
```

Update `SessionVM` and `emptySession`, and add the reducer cases. In `sessionStore.ts`:

```ts
export interface SessionVM {
  id: string
  config: SessionConfig
  title: string
  preview: string
  updatedAt: string
  updatedAtMs: number   // numeric sort key (epoch ms)
  loaded: boolean       // false = summary only (messages not yet fetched)
  messages: Message[]
  agents: AgentVM[]
  status: 'idle' | 'running' | 'error'
  error: SessionError | null
}
```

```ts
export function emptySession(id: string): SessionVM {
  return { id, config: DEFAULT_CONFIG, title: '新对话', preview: '开始一段新的对话…', updatedAt: 'now', updatedAtMs: Date.now(), loaded: true, messages: [], agents: [], status: 'idle', error: null }
}

function summaryToVM(s: SessionSummary): SessionVM {
  return { id: s.id, config: DEFAULT_CONFIG, title: s.title, preview: s.preview, updatedAt: formatRelative(s.updatedAt), updatedAtMs: s.updatedAt, loaded: false, messages: [], agents: [], status: 'idle', error: null }
}

function agentVMfromRun(r: AgentRun): AgentVM {
  return { id: r.agentId, role: r.role, title: ROLE_TITLE[r.role], status: r.finishedAt ? 'done' : 'running', tokens: r.output, tokenCount: r.output.length, elapsedMs: r.finishedAt ? r.finishedAt - r.startedAt : 0, startedAt: r.startedAt }
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
```

Import the new protocol types at the top: `import type { AgentRole, AgentRun, Message, ServerMessage, SessionConfig, SessionSummary } from '@hip/protocol'`.

Add cases to `applyServerMessage` (before `default`):

```ts
    case 'session:list:result': {
      const incoming = msg.sessions.map(summaryToVM)
      // Keep any already-loaded sessions; replace/insert summaries; sort newest-first.
      const byId = new Map(state.sessions.map((s) => [s.id, s]))
      for (const vm of incoming) {
        const prev = byId.get(vm.id)
        byId.set(vm.id, prev?.loaded ? { ...prev, title: vm.title, preview: vm.preview, updatedAt: vm.updatedAt, updatedAtMs: vm.updatedAtMs } : vm)
      }
      return { sessions: [...byId.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs) }
    }

    case 'session:loaded':
      return update(msg.sessionId, (s) => ({ ...s, loaded: true, messages: msg.messages, agents: msg.agentRuns.map(agentVMfromRun) }))

    case 'session:deleted':
      return { sessions: state.sessions.filter((s) => s.id !== msg.sessionId) }
```

> `session:search:result` is handled in the store action (Step 2), not in `applyServerMessage`, because it touches `searchHits`, not `sessions`.

- [ ] **Step 2: Add search state + nanoid in the store action**

In the `DomainStore` interface add: `searchHits: SearchHit[]` and change `appendUserMessage` to `(sessionId: string, id: string, content: string) => void`. In the store body:

```ts
import { nanoid } from 'nanoid'
// ...
  searchHits: [],

  apply: (msg) =>
    set((s) => {
      if (msg.type === 'ready') return { hasApiKey: msg.hasApiKey }
      if (msg.type === 'session:search:result') return { searchHits: msg.hits }
      return applyServerMessage(s, msg, Date.now())
    }),

  appendUserMessage: (sessionId, id, content) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id !== sessionId ? sess
          : { ...sess, error: null, updatedAtMs: Date.now(), messages: [...sess.messages, { id, role: 'user' as const, content, timestamp: Date.now() }] },
      ),
    })),
```

Remove the `let userSeq = 0` counter. Import `SearchHit`.

- [ ] **Step 3: Update `sessionService.ts`**

```ts
import { nanoid } from 'nanoid'
// ...
  createSession(config: SessionConfig = DEFAULT_CONFIG): string {
    const id = nanoid()
    useDomainStore.getState().createSession(id, config)
    this.transport.send({ type: 'session:create', id, config })
    return id
  }

  selectSession(id: string): void {
    useDomainStore.getState().selectSession(id)
    const s = useDomainStore.getState().sessions.find((x) => x.id === id)
    if (s && !s.loaded) this.transport.send({ type: 'session:load', sessionId: id })
  }

  deleteSession(id: string): void {
    useDomainStore.getState().deleteSession(id)
    this.transport.send({ type: 'session:delete', sessionId: id })  // was session:destroy
  }

  search(query: string): void {
    this.transport.send({ type: 'session:search', query })
  }

  sendMessage(content: string): void {
    const text = content.trim()
    if (!text) return
    let { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) activeSessionId = this.createSession()
    const id = nanoid()
    useDomainStore.getState().appendUserMessage(activeSessionId, id, text)
    this.transport.send({ type: 'message:send', sessionId: activeSessionId, id, content: text, role: 'user' })
  }
```

And request the session list once the sidecar reports ready — in `receive`:

```ts
  private receive(msg: ServerMessage): void {
    useDomainStore.getState().apply(msg)
    if (msg.type === 'ready') this.transport.send({ type: 'session:list' })
  }
```

- [ ] **Step 4: Add selectors + exports**

`hooks.ts`:

```ts
import type { Message, SearchHit } from '@hip/protocol'
// ...
const EMPTY_HITS: SearchHit[] = []
export function useSearchHits(): SearchHit[] {
  return useDomainStore((s) => s.searchHits)
}
```

`index.ts` — add `useSearchHits` to the hooks export.

- [ ] **Step 5: Fix the existing tests for the new shapes**

In `sessionService.test.ts` `beforeEach`, add `loaded: true, updatedAtMs: 0` to the inline `SessionVM`. The `sendMessage` test now asserts an `id` is present:

```ts
expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', sessionId: 's1', content: 'hello' })
expect((t.sent.at(-1) as any).id).toBeTruthy()
```

In `sessionStore.test.ts`, any literal `SessionVM`/`baseSession()` gains `loaded: true, updatedAtMs: 0`. `appendUserMessage` call sites pass an id: `appendUserMessage('s1', 'u-test', 'hi')`.

- [ ] **Step 6: Run the domain tests + type-check**

Run: `yarn vitest run src/domain && yarn type-check`
Expected: PASS (frontend `message:send.id` now satisfied → whole-repo type-check is green).

- [ ] **Step 7: Commit**

```bash
git add src/domain/
git commit -m "feat(domain): stable nanoid ids; persist-driven list/load/search/delete; loaded flag"
```

---

## Task 9: Frontend sidebar — content search + snippets

**Files:**
- Modify: `src/components/sidebar/SearchBox.tsx`
- Modify: `src/components/sidebar/SessionList.tsx`
- Modify: `src/components/sidebar/SessionItem.tsx` (optional snippet rendering)

(Vitest only runs `*.test.ts`, so these `.tsx` components are covered by `tsc` type-check + the GUI pass in Task 10.)

- [ ] **Step 1: Debounce search dispatch in `SearchBox.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { sessionService } from '@/domain'
// ...
export function SearchBox() {
  const { t } = useTranslation()
  const search = useUiStore((s) => s.search)
  const setSearch = useUiStore((s) => s.setSearch)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => sessionService.search(search.trim()), 200)
    return () => clearTimeout(timer.current)
  }, [search])
  // ...unchanged input markup
}
```

- [ ] **Step 2: Render content hits in `SessionList.tsx`**

```tsx
import { useSessions, useActiveSessionId, useSearchHits, sessionService } from '@/domain'
// ...
export function SessionList() {
  const { t } = useTranslation()
  const sessions = useSessions()
  const search = useUiStore((s) => s.search)
  const activeSessionId = useActiveSessionId()
  const hits = useSearchHits()

  const q = search.trim()
  const local = filterSessions(sessions, q)            // instant title/preview filter
  const localIds = new Set(local.map((s) => s.id))
  // content-only hits for sessions not already shown locally
  const contentHits = q ? hits.filter((h) => h.sessionId && !localIds.has(h.sessionId)) : []

  if (local.length === 0 && contentHits.length === 0) {
    return <div className="px-2.5 py-4 text-[12px] text-ink-tertiary">{t('sidebar.noMatches')}</div>
  }

  return (
    <div className="flex flex-col gap-0.5">
      {local.map((session) => (
        <SessionItem key={session.id} session={session} active={session.id === activeSessionId}
          onSelect={() => sessionService.selectSession(session.id)}
          onDelete={() => sessionService.deleteSession(session.id)} />
      ))}
      {contentHits.map((h) => {
        const s = sessions.find((x) => x.id === h.sessionId)
        if (!s) return null
        return (
          <SessionItem key={`hit-${h.sessionId}-${h.messageId}`} session={{ ...s, preview: h.snippet }}
            active={s.id === activeSessionId}
            onSelect={() => sessionService.selectSession(s.id)}
            onDelete={() => sessionService.deleteSession(s.id)} />
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Type-check + commit**

Run: `yarn type-check` → Expected: PASS.

```bash
git add src/components/sidebar/
git commit -m "feat(sidebar): content full-text search with snippets backed by the sidecar"
```

---

## Task 10: Integration verification + GUI acceptance

**Files:** none (verification only)

- [ ] **Step 1: Full automated suite**

Run: `yarn type-check && yarn test`
Expected: all green. (Real-LLM tests stay skipped unless `DEEPSEEK_API_KEY` is set; persistence tests use `:memory:`.)

- [ ] **Step 2: Regenerate the dev sidecar + rebuild**

```bash
yarn sidecar:dev-bin   # picks up the new persistence module in the dev shim
```

- [ ] **Step 3: GUI acceptance (manual, in `yarn tauri dev`)**

Verify, with a configured key:
1. Send a message → a session appears with a derived title.
2. Fully quit and relaunch the app → the session and its messages are still in the sidebar.
3. Open the old session and send a follow-up that depends on earlier context → the model answers using prior history (resume works).
4. Open the agents/artifact panel on a restored turn → planner/coder/reviewer outputs + timings are reconstructed.
5. Type a Chinese substring in search → matching sessions appear with a highlighted snippet.
6. Delete a session → it disappears and stays gone after relaunch.
7. Confirm `hip.db` exists under `~/Library/Application Support/com.ljm.app/`.

- [ ] **Step 4: Final review + finish the branch**

Use `superpowers:finishing-a-development-branch` to merge/PR.

---

## Notes for the implementer

- **`message:send` ordering:** the protocol now requires `id` on `message:send`. The sidecar reads it as the persisted user-message id; the frontend mints it with `nanoid()` and uses the same value for the optimistic UI message — do not generate two different ids.
- **Atomicity:** `insertTurn` wraps the assistant message + agent_runs in `BEGIN/COMMIT`. Never write agent_runs outside that transaction.
- **Trajectory keying:** build `AgentRun[]` straight from the `trajectory` map's entries (key = agentId). Do not invent extra helpers.
- **FTS query safety:** always wrap the user query as a quoted FTS literal (`"…"` with internal `"`→`""`) and only use FTS for queries ≥ 3 chars; otherwise LIKE. This avoids FTS5 syntax errors on punctuation.
- **Backward-compatible Session:** the store is the 4th constructor arg and optional — existing `new Session(id, config, model)` tests must keep passing untouched.
