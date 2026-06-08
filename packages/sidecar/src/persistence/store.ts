import type { DatabaseSync } from './sqlite.js'
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

  /** Replace the persisted config blob (e.g. when cwd changes). */
  updateConfig(id: string, config: string): void {
    this.db.prepare(`UPDATE sessions SET config=? WHERE id=?`).run(config, id)
  }

  touchSession(id: string, updatedAt: number): void {
    this.db.prepare(`UPDATE sessions SET updated_at=? WHERE id=?`).run(updatedAt, id)
  }

  /** Set the title only if it hasn't been user-pinned. Returns the number of rows changed (0 or 1). */
  updateTitleIfAuto(id: string, title: string): number {
    return this.db.prepare(`UPDATE sessions SET title=? WHERE id=? AND title_custom=0`).run(title, id).changes
  }

  /** Set a user-chosen title and pin it so auto-titling never overwrites it. */
  setCustomTitle(id: string, title: string): void {
    this.db.prepare(`UPDATE sessions SET title=?, title_custom=1 WHERE id=?`).run(title, id)
  }

  private nextSeq(sessionId: string): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(seq),0)+1 AS n FROM messages WHERE session_id=?`).get(sessionId) as { n: number }
    return row.n
  }

  insertMessage(r: { id: string; sessionId: string; role: 'user' | 'assistant'; agentId: string | null; content: string; timestamp: number; stopped?: boolean }): number {
    const seq = this.nextSeq(r.sessionId)
    this.db.prepare(`INSERT INTO messages(id,session_id,seq,role,agent_id,content,timestamp,stopped) VALUES(?,?,?,?,?,?,?,?)`)
      .run(r.id, r.sessionId, seq, r.role, r.agentId, r.content, r.timestamp, r.stopped ? 1 : 0)
    return seq
  }

  insertTurn(
    assistant: { id: string; sessionId: string; agentId: string; content: string; timestamp: number; stopped?: boolean } | null,
    sessionId: string,
    runs: AgentRun[],
  ): void {
    this.db.exec('BEGIN')
    try {
      if (assistant) {
        this.insertMessage({ id: assistant.id, sessionId, role: 'assistant', agentId: assistant.agentId, content: assistant.content, timestamp: assistant.timestamp, stopped: assistant.stopped })
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
    const rows = this.db.prepare(`SELECT id,role,agent_id,content,timestamp,stopped FROM messages WHERE session_id=? ORDER BY seq`).all(sessionId) as
      { id: string; role: 'user' | 'assistant'; agent_id: string | null; content: string; timestamp: number; stopped: number }[]
    return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, agentId: r.agent_id ?? undefined, timestamp: r.timestamp, ...(r.stopped ? { stopped: true } : {}) }))
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

    // trigram MATCH needs >=3 chars and a quoted literal to avoid FTS syntax errors.
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
    const rows = this.db.prepare(`
      SELECT m.session_id AS sessionId, m.id AS messageId, s.title AS title,
        substr(m.content,1,80) AS snippet, m.timestamp AS timestamp
      FROM messages m JOIN sessions s ON s.id = m.session_id
      WHERE m.content LIKE ? ORDER BY m.timestamp DESC LIMIT 50
    `).all(like) as SearchHit[]
    return [...titleOut, ...rows]
  }

  /** Delete the most recent message iff it is an assistant turn. Cascades agent_runs + FTS via triggers/FKs. Returns true if one was removed. */
  deleteLastAssistantMessage(sessionId: string): boolean {
    const last = this.db.prepare(`SELECT id, role FROM messages WHERE session_id=? ORDER BY seq DESC LIMIT 1`).get(sessionId) as
      | { id: string; role: string }
      | undefined
    if (!last || last.role !== 'assistant') return false
    this.db.prepare(`DELETE FROM messages WHERE id=?`).run(last.id)
    return true
  }

  deleteSession(id: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id=?`).run(id)
  }
}
