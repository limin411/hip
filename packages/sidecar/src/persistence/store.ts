import type { DatabaseSync } from './sqlite.js'
import type { AgentRole, AgentRun, Checkpoint, Message, SessionSummary, SearchHit, TimelineStep, ToolCall, ToolStatus, TurnUsage } from '@hip/protocol'
import { sumUsage } from '../session/usage.js'

const PREVIEW_LEN = 80

/** All persisted reads/writes for sessions. Synchronous (node:sqlite). */
export class SessionStore {
  constructor(private readonly db: DatabaseSync, private readonly ftsEnabled: boolean) {}

  insertSession(r: { id: string; title: string; config: string; createdAt: number; updatedAt: number }): void {
    this.db.prepare(`INSERT INTO sessions(id,title,config,created_at,updated_at) VALUES(?,?,?,?,?)`)
      .run(r.id, r.title, r.config, r.createdAt, r.updatedAt)
  }

  getSession(id: string) {
    return this.db.prepare(`SELECT id,title,config,created_at,updated_at,diff_base_sha FROM sessions WHERE id=?`).get(id) as
      | { id: string; title: string; config: string; created_at: number; updated_at: number; diff_base_sha: string | null }
      | undefined
  }

  /** Replace the persisted config blob (e.g. when cwd changes). */
  updateConfig(id: string, config: string): void {
    this.db.prepare(`UPDATE sessions SET config=? WHERE id=?`).run(config, id)
  }

  /** 写入会话起点快照树 SHA（null = 清除）。 */
  setDiffBaseSha(id: string, sha: string | null): void {
    this.db.prepare(`UPDATE sessions SET diff_base_sha=? WHERE id=?`).run(sha, id)
  }

  /** Insert a checkpoint row. `id` is unique (e.g. "<sid>:<turnId>"); INSERT OR REPLACE so a
   *  recapture of the same turn overwrites cleanly. */
  insertCheckpoint(c: Checkpoint): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO checkpoints(id,session_id,turn_id,kind,label,tree_sha,commit_sha,branch,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(c.id, c.sessionId, c.turnId, c.kind, c.label, c.treeSha, c.commitSha, c.branch, c.createdAt)
  }

  /** All checkpoints for a session, newest-first (created_at DESC). */
  listCheckpoints(sessionId: string): Checkpoint[] {
    const rows = this.db.prepare(
      `SELECT id,session_id,turn_id,kind,label,tree_sha,commit_sha,branch,created_at FROM checkpoints WHERE session_id=? ORDER BY created_at DESC, rowid DESC`,
    ).all(sessionId) as { id: string; session_id: string; turn_id: string | null; kind: Checkpoint['kind']; label: string | null; tree_sha: string; commit_sha: string; branch: string | null; created_at: number }[]
    return rows.map((r) => ({ id: r.id, sessionId: r.session_id, turnId: r.turn_id, kind: r.kind, label: r.label, treeSha: r.tree_sha, commitSha: r.commit_sha, branch: r.branch, createdAt: r.created_at }))
  }

  /** Record the session's last-seen branch (NULL clears). */
  setSessionBranch(id: string, branch: string | null): void {
    this.db.prepare(`UPDATE sessions SET current_branch=? WHERE id=?`).run(branch, id)
  }

  /** Record the session-start commit (commit-log lower bound; NULL on unborn HEAD). */
  setSessionStartCommit(id: string, sha: string | null): void {
    this.db.prepare(`UPDATE sessions SET session_start_commit=? WHERE id=?`).run(sha, id)
  }

  /** Read the session's git meta (both NULL for a missing/legacy session). */
  getSessionGitMeta(id: string): { currentBranch: string | null; sessionStartCommit: string | null } {
    const row = this.db.prepare(`SELECT current_branch, session_start_commit FROM sessions WHERE id=?`).get(id) as
      | { current_branch: string | null; session_start_commit: string | null }
      | undefined
    return { currentBranch: row?.current_branch ?? null, sessionStartCommit: row?.session_start_commit ?? null }
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
    assistant: { id: string; sessionId: string; agentId: string; content: string; timestamp: number; stopped?: boolean; timeline?: TimelineStep[] } | null,
    sessionId: string,
    runs: AgentRun[],
  ): void {
    this.db.exec('BEGIN')
    try {
      if (assistant) {
        this.insertMessage({ id: assistant.id, sessionId, role: 'assistant', agentId: assistant.agentId, content: assistant.content, timestamp: assistant.timestamp, stopped: assistant.stopped })
        const tl = assistant.timeline && assistant.timeline.length ? JSON.stringify(assistant.timeline) : null
        this.db.prepare(`UPDATE messages SET timeline=? WHERE id=?`).run(tl, assistant.id)
      }
      const runStmt = this.db.prepare(
        `INSERT INTO agent_runs(session_id,message_id,seq,agent_id,role,output,started_at,finished_at,task_input,parent_agent_id,prompt_tokens,completion_tokens,total_tokens) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      const toolStmt = this.db.prepare(
        `INSERT INTO tool_calls(session_id,agent_run_id,call_id,agent_id,name,input,output,status,error,seq,truncated) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      for (const run of runs) {
        const info = runStmt.run(sessionId, assistant?.id ?? null, run.seq, run.agentId, run.role, run.output, run.startedAt, run.finishedAt, run.taskInput ?? null, run.parentAgentId ?? null, run.usage?.inputTokens ?? null, run.usage?.outputTokens ?? null, run.usage?.totalTokens ?? null)
        const runId = info.lastInsertRowid
        for (const tc of run.toolCalls ?? []) {
          toolStmt.run(sessionId, runId, tc.callId, tc.agentId, tc.name, tc.input, tc.output ?? null, tc.status, tc.error ?? null, tc.seq, tc.truncated ? 1 : 0)
        }
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  loadMessages(sessionId: string): Message[] {
    const rows = this.db.prepare(`SELECT id,role,agent_id,content,timestamp,stopped,timeline FROM messages WHERE session_id=? ORDER BY seq`).all(sessionId) as
      { id: string; role: 'user' | 'assistant'; agent_id: string | null; content: string; timestamp: number; stopped: number; timeline: string | null }[]
    const toolStmt = this.db.prepare(
      `SELECT tc.call_id,tc.agent_id,tc.name,tc.input,tc.output,tc.status,tc.error,tc.seq,tc.truncated
       FROM tool_calls tc JOIN agent_runs ar ON ar.id = tc.agent_run_id
       WHERE ar.message_id=? ORDER BY tc.seq`,
    )
    return rows.map((r) => {
      const base: Message = { id: r.id, role: r.role, content: r.content, agentId: r.agent_id ?? undefined, timestamp: r.timestamp, ...(r.stopped ? { stopped: true } : {}) }
      if (r.timeline != null) {
        base.timeline = JSON.parse(r.timeline) as TimelineStep[]
        const tools = (toolStmt.all(r.id) as { call_id: string; agent_id: string; name: string; input: string; output: string | null; status: ToolStatus; error: string | null; seq: number; truncated: number }[])
          .map((t): ToolCall => ({ callId: t.call_id, agentId: t.agent_id, name: t.name, input: t.input, status: t.status, seq: t.seq, ...(t.output != null ? { output: t.output } : {}), ...(t.error != null ? { error: t.error } : {}), ...(t.truncated ? { truncated: true } : {}) }))
        if (tools.length) base.toolCalls = tools
      }
      return base
    })
  }

  loadAgentRuns(sessionId: string): AgentRun[] {
    const rows = this.db.prepare(`SELECT id,message_id,agent_id,role,output,started_at,finished_at,seq,task_input,parent_agent_id,prompt_tokens,completion_tokens,total_tokens FROM agent_runs WHERE session_id=? ORDER BY seq`).all(sessionId) as
      { id: number; message_id: string | null; agent_id: string; role: AgentRole; output: string; started_at: number; finished_at: number | null; seq: number; task_input: string | null; parent_agent_id: string | null; prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null }[]
    const toolStmt = this.db.prepare(`SELECT call_id,agent_id,name,input,output,status,error,seq,truncated FROM tool_calls WHERE agent_run_id=? ORDER BY seq`)
    return rows.map((r) => {
      const tools = (toolStmt.all(r.id) as { call_id: string; agent_id: string; name: string; input: string; output: string | null; status: ToolStatus; error: string | null; seq: number; truncated: number }[])
        .map((t): ToolCall => ({ callId: t.call_id, agentId: t.agent_id, name: t.name, input: t.input, status: t.status, seq: t.seq, ...(t.output != null ? { output: t.output } : {}), ...(t.error != null ? { error: t.error } : {}), ...(t.truncated ? { truncated: true } : {}) }))
      const usage: TurnUsage | undefined = r.total_tokens != null
        ? { inputTokens: r.prompt_tokens ?? 0, outputTokens: r.completion_tokens ?? 0, totalTokens: r.total_tokens }
        : undefined
      return { agentId: r.agent_id, role: r.role, output: r.output, startedAt: r.started_at, finishedAt: r.finished_at, seq: r.seq, ...(r.message_id != null ? { messageId: r.message_id } : {}), ...(r.task_input != null ? { taskInput: r.task_input } : {}), ...(r.parent_agent_id != null ? { parentAgentId: r.parent_agent_id } : {}), ...(usage ? { usage } : {}), toolCalls: tools }
    })
  }

  /** Load messages with each turn's agent runs attached by message_id. Runs with a NULL
   *  message_id (a turn that produced no assistant message) have no message to attach to and are dropped. */
  loadMessagesWithRuns(sessionId: string): Message[] {
    const messages = this.loadMessages(sessionId)
    const byMessage = new Map<string, AgentRun[]>()
    for (const r of this.loadAgentRuns(sessionId)) {
      if (r.messageId == null) continue
      const arr = byMessage.get(r.messageId) ?? []
      arr.push(r)
      byMessage.set(r.messageId, arr)
    }
    return messages.map((m) => {
      const runs = byMessage.get(m.id)
      if (!runs || !runs.length) return m
      const usage = sumUsage(runs.map((r) => r.usage))
      return { ...m, agentRuns: runs, ...(usage ? { usage } : {}) }
    })
  }

  /** Test/diagnostic helper: total tool_calls rows for a session. */
  countToolCalls(sessionId: string): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM tool_calls WHERE session_id=?`).get(sessionId) as { n: number }).n
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
          snippet(messages_fts, 0, char(1), char(2), '…', 12) AS snippet, m.timestamp AS timestamp
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
