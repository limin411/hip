import type { DatabaseSync } from './sqlite.js'
import type {
  AgentRole,
  AgentRun,
  Attachment,
  Checkpoint,
  MemoryCitation,
  Message,
  SessionConfig,
  SessionSummary,
  TrashedSessionSummary,
  SearchHit,
  TimelineStep,
  ToolCall,
  ToolStatus,
  TurnUsage,
} from '@hip/protocol'
import { sumUsage } from '../session/usage.js'
import { surfaceOf } from '../session/surface.js'
import { logInfo } from '../debug-logger.js'

const PREVIEW_LEN = 80

/** One pending input row from `session_input`. */
export interface PendingInputRow {
  id: string
  sessionId: string
  prompt: string
  delivery: 'steer' | 'queue'
  admittedSeq: number
  timeCreated: number
}

export type { TrashedSessionSummary }

/** All persisted reads/writes for sessions. Synchronous (node:sqlite). */
export class SessionStore {
  constructor(private readonly db: DatabaseSync, private readonly ftsEnabled: boolean) {}

  /** Expose the database handle for callers that need to share a transaction. */
  getDb(): DatabaseSync {
    return this.db
  }

  insertSession(r: { id: string; title: string; config: string; createdAt: number; updatedAt: number }): void {
    this.db.prepare(`INSERT INTO sessions(id,title,config,created_at,updated_at) VALUES(?,?,?,?,?)`)
      .run(r.id, r.title, r.config, r.createdAt, r.updatedAt)
  }

  getSession(id: string) {
    return this.db.prepare(
      `SELECT id,title,config,created_at,updated_at,diff_base_sha,deleted_at,delete_derived_memories FROM sessions WHERE id=?`,
    ).get(id) as
      | {
          id: string
          title: string
          config: string
          created_at: number
          updated_at: number
          diff_base_sha: string | null
          deleted_at: number | null
          delete_derived_memories: number
        }
      | undefined
  }

  /** True when the session row exists and `deleted_at` is set. */
  isSessionTrashed(id: string): boolean {
    const row = this.db.prepare(`SELECT deleted_at FROM sessions WHERE id=?`).get(id) as
      | { deleted_at: number | null }
      | undefined
    return row != null && row.deleted_at != null
  }

  /** Active sessions only: missing or trashed → undefined. */
  getActiveSession(id: string) {
    const row = this.getSession(id)
    if (!row || row.deleted_at != null) return undefined
    return row
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

  /** Record the session-start commit (checkpoint seed / session-start marker; NULL on unborn HEAD). */
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

  /**
   * Record the external ACP agent's session handle so a reopened session can resume it.
   * Pass `null` to clear (SQL NULL) — used on agent switch / dispose.
   */
  setAcpSessionId(id: string, acpSessionId: string | null): void {
    this.db.prepare('UPDATE sessions SET acp_session_id = ? WHERE id = ?').run(acpSessionId, id)
  }

  /** Read the persisted ACP session handle (NULL for non-ACP / never-run sessions). */
  getAcpSessionId(id: string): string | null {
    const row = this.db.prepare('SELECT acp_session_id FROM sessions WHERE id = ?').get(id) as { acp_session_id: string | null } | undefined
    return row?.acp_session_id ?? null
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

  insertMessage(r: { id: string; sessionId: string; role: 'user' | 'assistant'; agentId: string | null; content: string; timestamp: number; stopped?: boolean; attachments?: Attachment[] }): number {
    const seq = this.nextSeq(r.sessionId)
    const attachments = r.attachments?.length ? JSON.stringify(r.attachments) : null
    this.db.prepare(`INSERT INTO messages(id,session_id,seq,role,agent_id,content,timestamp,stopped,attachments) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(r.id, r.sessionId, seq, r.role, r.agentId, r.content, r.timestamp, r.stopped ? 1 : 0, attachments)
    return seq
  }

  insertTurn(
    assistant: { id: string; sessionId: string; agentId: string; content: string; timestamp: number; stopped?: boolean; timeline?: TimelineStep[]; memoryCitations?: MemoryCitation[] } | null,
    sessionId: string,
    runs: AgentRun[],
  ): void {
    this.db.exec('BEGIN')
    try {
      this.insertTurnBody(assistant, sessionId, runs)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /** Same writes as insertTurn, but without transaction management. Used by
   *  Session.emit() so legacy persistence and new events share one transaction. */
  insertTurnBody(
    assistant: { id: string; sessionId: string; agentId: string; content: string; timestamp: number; stopped?: boolean; timeline?: TimelineStep[]; memoryCitations?: MemoryCitation[] } | null,
    sessionId: string,
    runs: AgentRun[],
  ): void {
    if (assistant) {
      this.insertMessage({ id: assistant.id, sessionId, role: 'assistant', agentId: assistant.agentId, content: assistant.content, timestamp: assistant.timestamp, stopped: assistant.stopped })
      const tl = assistant.timeline && assistant.timeline.length ? JSON.stringify(assistant.timeline) : null
      this.db.prepare(`UPDATE messages SET timeline=? WHERE id=?`).run(tl, assistant.id)
      const cites = assistant.memoryCitations && assistant.memoryCitations.length
        ? JSON.stringify(assistant.memoryCitations)
        : null
      this.db.prepare(`UPDATE messages SET memory_citations=? WHERE id=?`).run(cites, assistant.id)
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
  }

  /** Public alias for loadMessages — used by subagent continuation to load prior context. */
  getMessages(sessionId: string): Message[] {
    return this.loadMessages(sessionId)
  }

  hasMessages(sessionId: string): boolean {
    const row = this.db.prepare(`SELECT EXISTS(SELECT 1 FROM messages WHERE session_id=?) AS has`).get(sessionId) as { has: number }
    return row.has === 1
  }

  loadMessages(sessionId: string): Message[] {
    const rows = this.db.prepare(`SELECT id,role,agent_id,content,timestamp,stopped,timeline,attachments,memory_citations FROM messages WHERE session_id=? ORDER BY seq`).all(sessionId) as
      { id: string; role: 'user' | 'assistant'; agent_id: string | null; content: string; timestamp: number; stopped: number; timeline: string | null; attachments: string | null; memory_citations: string | null }[]
    const toolStmt = this.db.prepare(
      `SELECT tc.call_id,tc.agent_id,tc.name,tc.input,tc.output,tc.status,tc.error,tc.seq,tc.truncated
       FROM tool_calls tc JOIN agent_runs ar ON ar.id = tc.agent_run_id
       WHERE ar.message_id=? ORDER BY tc.seq`,
    )
    return rows.map((r) => {
      const attachments = r.attachments != null ? (JSON.parse(r.attachments) as Attachment[]) : undefined
      const base: Message = { id: r.id, role: r.role, content: r.content, agentId: r.agent_id ?? undefined, timestamp: r.timestamp, ...(r.stopped ? { stopped: true } : {}), ...(attachments?.length ? { attachments } : {}) }
      if (r.timeline != null) {
        base.timeline = JSON.parse(r.timeline) as TimelineStep[]
      }
      if (r.memory_citations != null) {
        try {
          const cites = JSON.parse(r.memory_citations) as MemoryCitation[]
          if (Array.isArray(cites) && cites.length) base.memoryCitations = cites
        } catch {
          // ignore corrupt column
        }
      }
      // toolCalls are keyed by agent_runs.message_id — load them even when timeline is null
      // (e.g. tool-only artifact turns that still produced write_file rows).
      const tools = (toolStmt.all(r.id) as { call_id: string; agent_id: string; name: string; input: string; output: string | null; status: ToolStatus; error: string | null; seq: number; truncated: number }[])
        .map((t): ToolCall => ({ callId: t.call_id, agentId: t.agent_id, name: t.name, input: t.input, status: t.status, seq: t.seq, ...(t.output != null ? { output: t.output } : {}), ...(t.error != null ? { error: t.error } : {}), ...(t.truncated ? { truncated: true } : {}) }))
      if (tools.length) base.toolCalls = tools
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
      SELECT s.id, s.title, s.config AS config, s.updated_at AS updatedAt,
        (SELECT content FROM messages m WHERE m.session_id=s.id ORDER BY seq DESC LIMIT 1) AS preview,
        (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id) AS messageCount
      FROM sessions s
      WHERE s.deleted_at IS NULL
      ORDER BY s.updated_at DESC
    `).all() as { id: string; title: string; config: string; updatedAt: number; preview: string | null; messageCount: number }[]
    return rows.map((r) => this.toSessionSummary(r))
  }

  /**
   * Soft-deleted sessions newest-trash-first.
   * Messages remain in place until hard purge.
   */
  listTrashedSessions(): TrashedSessionSummary[] {
    const rows = this.db.prepare(`
      SELECT s.id, s.title, s.config AS config, s.updated_at AS updatedAt,
        s.deleted_at AS deletedAt, s.delete_derived_memories AS deleteDerivedMemories,
        (SELECT content FROM messages m WHERE m.session_id=s.id ORDER BY seq DESC LIMIT 1) AS preview,
        (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id) AS messageCount
      FROM sessions s
      WHERE s.deleted_at IS NOT NULL
      ORDER BY s.deleted_at DESC
    `).all() as {
      id: string
      title: string
      config: string
      updatedAt: number
      deletedAt: number
      deleteDerivedMemories: number
      preview: string | null
      messageCount: number
    }[]
    return rows.map((r) => ({
      ...this.toSessionSummary(r),
      deletedAt: r.deletedAt,
      deleteDerivedMemories: !!r.deleteDerivedMemories,
    }))
  }

  private toSessionSummary(r: {
    id: string
    title: string
    config: string
    updatedAt: number
    preview: string | null
    messageCount: number
  }): SessionSummary {
    let surface: 'chat' | 'code' = 'code'
    let cwd: string | undefined
    try {
      const cfg = JSON.parse(r.config) as SessionConfig
      surface = surfaceOf(cfg, r.id)
      const raw = typeof cfg.cwd === 'string' ? cfg.cwd.trim() : ''
      if (raw) cwd = raw
    } catch {
      surface = 'code'
    }
    return {
      id: r.id,
      title: r.title,
      surface,
      updatedAt: r.updatedAt,
      messageCount: r.messageCount,
      preview: (r.preview ?? '').slice(0, PREVIEW_LEN),
      ...(cwd ? { cwd } : {}),
    }
  }

  search(query: string): SearchHit[] {
    const q = query.trim()
    if (!q) return []
    const like = `%${q}%`
    const titleHits = this.db.prepare(
      `SELECT id AS sessionId, title, updated_at AS timestamp FROM sessions WHERE deleted_at IS NULL AND title LIKE ? ORDER BY updated_at DESC LIMIT 20`,
    )
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
        WHERE s.deleted_at IS NULL AND messages_fts MATCH ? ORDER BY rank LIMIT 50
      `).all(literal) as SearchHit[]
      return [...titleOut, ...rows]
    }
    const rows = this.db.prepare(`
      SELECT m.session_id AS sessionId, m.id AS messageId, s.title AS title,
        substr(m.content,1,80) AS snippet, m.timestamp AS timestamp
      FROM messages m JOIN sessions s ON s.id = m.session_id
      WHERE s.deleted_at IS NULL AND m.content LIKE ? ORDER BY m.timestamp DESC LIMIT 50
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

  /**
   * Soft-delete a session into the product recycle bin.
   * Keeps messages/checkpoints/scratch; tears down are the caller's job (SessionManager).
   *
   * Memory (aligned with design K8):
   * - session-scoped memory_items → soft-delete (status=deleted)
   * - memory_stage1 → hard-delete (staging only)
   * - if deleteDerivedMemories: soft-delete project/global items with this source_session_id
   * - else leave derived items and keep source_session_id
   *
   * @returns true if the session was soft-deleted (or already trashed = idempotent true when row exists)
   */
  softDeleteSession(
    id: string,
    opts?: { deleteDerivedMemories?: boolean; deletedAt?: number },
  ): boolean {
    const runIgnoreMissing = (sql: string, ...params: unknown[]) => {
      try {
        this.db.prepare(sql).run(...params)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('no such table')) return
        throw e
      }
    }
    const existing = this.getSession(id)
    if (!existing) return false
    if (existing.deleted_at != null) return true

    const deletedAt = opts?.deletedAt ?? Date.now()
    const deleteDerived = opts?.deleteDerivedMemories ? 1 : 0

    this.db.exec('BEGIN')
    try {
      const changes = this.db.prepare(
        `UPDATE sessions SET deleted_at=?, delete_derived_memories=?, updated_at=? WHERE id=? AND deleted_at IS NULL`,
      ).run(deletedAt, deleteDerived, deletedAt, id).changes

      // Staging is never recoverable from trash; drop eagerly.
      runIgnoreMissing(`DELETE FROM memory_stage1 WHERE session_id=?`, id)
      // Hide session-scoped memories from active Memory lists until restore/hard-purge.
      runIgnoreMissing(
        `UPDATE memory_items SET status='deleted', updated_at=? WHERE scope='session' AND session_id=? AND status!='deleted'`,
        deletedAt,
        id,
      )
      if (deleteDerived) {
        runIgnoreMissing(
          `UPDATE memory_items SET status='deleted', updated_at=? WHERE source_session_id=? AND status!='deleted'`,
          deletedAt,
          id,
        )
      }
      this.db.exec('COMMIT')
      logInfo('session-trash', 'store.softDelete', {
        sessionId: id,
        deletedAt,
        deleteDerivedMemories: !!deleteDerived,
        changed: changes > 0,
      })
      return true
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /**
   * Restore a soft-deleted session (clears deleted_at / delete_derived_memories).
   * Restores session-scoped memory_items that were soft-deleted with the session.
   * Does **not** auto-restore derived (source_session_id) memories — those stay in Memory trash (design).
   *
   * @returns true if a trashed session was restored
   */
  restoreSession(id: string, opts?: { restoredAt?: number }): boolean {
    const runIgnoreMissing = (sql: string, ...params: unknown[]) => {
      try {
        this.db.prepare(sql).run(...params)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('no such table')) return
        throw e
      }
    }
    const existing = this.getSession(id)
    if (!existing || existing.deleted_at == null) return false

    const restoredAt = opts?.restoredAt ?? Date.now()
    this.db.exec('BEGIN')
    try {
      const changes = this.db.prepare(
        `UPDATE sessions SET deleted_at=NULL, delete_derived_memories=0, updated_at=? WHERE id=? AND deleted_at IS NOT NULL`,
      ).run(restoredAt, id).changes
      runIgnoreMissing(
        `UPDATE memory_items SET status='active', updated_at=? WHERE scope='session' AND session_id=? AND status='deleted'`,
        restoredAt,
        id,
      )
      this.db.exec('COMMIT')
      logInfo('session-trash', 'store.restore', { sessionId: id, restoredAt, changed: changes > 0 })
      return changes > 0
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /**
   * Hard-purge soft-deleted sessions with deleted_at &lt; cutoffMs.
   * Callers compute cutoff from configured retentionDays (store does not hardcode 7).
   * @returns purged session ids
   */
  purgeTrashedOlderThan(cutoffMs: number): string[] {
    const rows = this.db.prepare(
      `SELECT id, delete_derived_memories FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    ).all(cutoffMs) as { id: string; delete_derived_memories: number }[]
    const purged: string[] = []
    for (const r of rows) {
      this.deleteSession(r.id, { deleteDerivedMemories: !!r.delete_derived_memories })
      purged.push(r.id)
    }
    if (purged.length) {
      logInfo('session-trash', 'store.purgeOlderThan', { cutoffMs, count: purged.length, ids: purged })
    }
    return purged
  }

  /**
   * Convenience: purge using retention days (default product policy is 7; Settings may override).
   * @param retentionDays must be >= 1
   */
  purgeTrashedByRetentionDays(retentionDays: number, nowMs = Date.now()): string[] {
    const days = Math.max(1, Math.floor(retentionDays))
    const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000
    return this.purgeTrashedOlderThan(cutoffMs)
  }

  /**
   * Delete a session and all related rows (Sprint C option P: true delete for privacy).
   * FK cascades cover messages/agent_runs/tool_calls/checkpoints when present.
   * Event log / session_message / snapshots have no FK to sessions — purge explicitly.
   * Tables that only exist after newer migrations are best-effort (ignore missing).
   *
   * Memory cleanup (v16 / recycle-bin):
   * - always hard-delete session-scoped memory_items and memory_stage1 for this session
   * - by default null `source_session_id` on retained project/global items
   * - if `deleteDerivedMemories`, hard-delete all memory_items with that source session instead
   * - when opts omitted, honor stored `sessions.delete_derived_memories` (trash forever / retention)
   */
  deleteSession(id: string, opts?: { deleteDerivedMemories?: boolean }): void {
    const runIgnoreMissing = (sql: string, ...params: unknown[]) => {
      try {
        this.db.prepare(sql).run(...params)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('no such table')) return
        throw e
      }
    }
    // Best-effort pre-counts for forensics (visible under HIP_DEBUG via callers; always log via console in store would be too noisy).
    let hadRow = false
    let deleteDerived = opts?.deleteDerivedMemories
    try {
      const row = this.db.prepare(`SELECT delete_derived_memories FROM sessions WHERE id=?`).get(id) as
        | { delete_derived_memories: number }
        | undefined
      hadRow = !!row
      if (deleteDerived === undefined) {
        deleteDerived = !!row?.delete_derived_memories
      }
    } catch {
      /* ignore — column may be missing on partial fixtures */
    }
    this.db.exec('BEGIN')
    try {
      runIgnoreMissing(
        `DELETE FROM workflow_events WHERE run_id IN (SELECT run_id FROM workflow_runs WHERE session_id=?)`,
        id,
      )
      runIgnoreMissing(`DELETE FROM workflow_runs WHERE session_id=?`, id)
      runIgnoreMissing(`DELETE FROM event WHERE aggregate_id=?`, id)
      runIgnoreMissing(`DELETE FROM event_sequence WHERE aggregate_id=?`, id)
      runIgnoreMissing(`DELETE FROM snapshots WHERE session_id=?`, id)
      runIgnoreMissing(`DELETE FROM session_message WHERE session_id=?`, id)
      runIgnoreMissing(`DELETE FROM session_input WHERE session_id=?`, id)
      runIgnoreMissing(`DELETE FROM session_context_epoch WHERE session_id=?`, id)
      runIgnoreMissing(`DELETE FROM cron_tasks WHERE session_id=?`, id)
      // Memory tables (v16): may be missing on older fixtures / partial schemas.
      runIgnoreMissing(`DELETE FROM memory_items WHERE scope='session' AND session_id=?`, id)
      runIgnoreMissing(`DELETE FROM memory_stage1 WHERE session_id=?`, id)
      if (deleteDerived) {
        runIgnoreMissing(`DELETE FROM memory_items WHERE source_session_id=?`, id)
      } else {
        runIgnoreMissing(`UPDATE memory_items SET source_session_id=NULL WHERE source_session_id=?`, id)
      }
      const changes = this.db.prepare(`DELETE FROM sessions WHERE id=?`).run(id).changes
      this.db.exec('COMMIT')
      // Always-on so even partial purge / double-delete is greppable next to session-manager audit.
      logInfo('session-delete', 'store.purge', {
        sessionId: id,
        hadRow,
        deletedRows: changes,
        deleteDerivedMemories: !!deleteDerived,
      })
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /** Admit a pending input into the durable queue. */
  admitSessionInput(r: { id: string; sessionId: string; prompt: string; delivery: 'steer' | 'queue'; timeCreated: number }): void {
    const seq = this.nextInputSeq(r.sessionId)
    this.db.prepare(
      `INSERT INTO session_input(id, session_id, prompt, delivery, admitted_seq, promoted_seq, time_created) VALUES(?,?,?,?,?,NULL,?)`,
    ).run(r.id, r.sessionId, r.prompt, r.delivery, seq, r.timeCreated)
  }

  private nextInputSeq(sessionId: string): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(admitted_seq),0)+1 AS n FROM session_input WHERE session_id=?`).get(sessionId) as { n: number }
    return row.n
  }

  private nextInputPromotedSeq(sessionId: string): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(promoted_seq),0)+1 AS n FROM session_input WHERE session_id=?`).get(sessionId) as { n: number }
    return row.n
  }

  /** Pending inputs for a session, in admission order. */
  listPendingSessionInputs(sessionId: string): PendingInputRow[] {
    const rows = this.db.prepare(
      `SELECT id, session_id, prompt, delivery, admitted_seq, time_created FROM session_input WHERE session_id=? AND promoted_seq IS NULL ORDER BY admitted_seq`,
    ).all(sessionId) as { id: string; session_id: string; prompt: string; delivery: 'steer' | 'queue'; admitted_seq: number; time_created: number }[]
    return rows.map((r) => ({ id: r.id, sessionId: r.session_id, prompt: r.prompt, delivery: r.delivery, admittedSeq: r.admitted_seq, timeCreated: r.time_created }))
  }

  /** Promote the most recent steer and drop all older inputs. Returns the steer. */
  promoteSteerSessionInput(sessionId: string): PendingInputRow | undefined {
    const row = this.db.prepare(
      `SELECT id, session_id, prompt, delivery, admitted_seq, time_created FROM session_input WHERE session_id=? AND delivery='steer' AND promoted_seq IS NULL ORDER BY admitted_seq DESC LIMIT 1`,
    ).get(sessionId) as { id: string; session_id: string; prompt: string; delivery: 'steer' | 'queue'; admitted_seq: number; time_created: number } | undefined
    if (!row) return undefined
    const promotedSeq = this.nextInputPromotedSeq(sessionId)
    this.db.prepare(
      `UPDATE session_input SET promoted_seq=? WHERE session_id=? AND promoted_seq IS NULL AND admitted_seq <= ?`,
    ).run(promotedSeq, sessionId, row.admitted_seq)
    return { id: row.id, sessionId: row.session_id, prompt: row.prompt, delivery: row.delivery, admittedSeq: row.admitted_seq, timeCreated: row.time_created }
  }

  /** Promote the oldest queued (non-steer) input. */
  promoteNextQueuedSessionInput(sessionId: string): PendingInputRow | undefined {
    const row = this.db.prepare(
      `SELECT id, session_id, prompt, delivery, admitted_seq, time_created FROM session_input WHERE session_id=? AND delivery='queue' AND promoted_seq IS NULL ORDER BY admitted_seq LIMIT 1`,
    ).get(sessionId) as { id: string; session_id: string; prompt: string; delivery: 'steer' | 'queue'; admitted_seq: number; time_created: number } | undefined
    if (!row) return undefined
    const promotedSeq = this.nextInputPromotedSeq(sessionId)
    this.db.prepare(
      `UPDATE session_input SET promoted_seq=? WHERE session_id=? AND id=?`,
    ).run(promotedSeq, sessionId, row.id)
    return { id: row.id, sessionId: row.session_id, prompt: row.prompt, delivery: row.delivery, admittedSeq: row.admitted_seq, timeCreated: row.time_created }
  }

  /** Mark a specific input as promoted (popped for processing). */
  promoteSessionInputById(sessionId: string, id: string): void {
    const promotedSeq = this.nextInputPromotedSeq(sessionId)
    this.db.prepare(`UPDATE session_input SET promoted_seq=? WHERE session_id=? AND id=? AND promoted_seq IS NULL`).run(promotedSeq, sessionId, id)
  }

  insertCronTask(r: { id: string; sessionId: string; prompt: string; scheduleType: string; scheduleAt: number | null; scheduleIntervalMs: number | null; nextFireAt: number; createdAt: number }): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO cron_tasks(id, session_id, prompt, schedule_type, schedule_at, schedule_interval_ms, next_fire_at, created_at) VALUES(?,?,?,?,?,?,?,?)`,
    ).run(r.id, r.sessionId, r.prompt, r.scheduleType, r.scheduleAt, r.scheduleIntervalMs, r.nextFireAt, r.createdAt)
  }

  updateCronTaskNextFire(id: string, nextFireAt: number): void {
    this.db.prepare(`UPDATE cron_tasks SET next_fire_at=? WHERE id=?`).run(nextFireAt, id)
  }

  loadCronTasks(sessionId: string): { id: string; sessionId: string; prompt: string; scheduleType: string; scheduleAt: number | null; scheduleIntervalMs: number | null; nextFireAt: number; createdAt: number }[] {
    return this.db.prepare(
      `SELECT id, session_id AS sessionId, prompt, schedule_type AS scheduleType, schedule_at AS scheduleAt, schedule_interval_ms AS scheduleIntervalMs, next_fire_at AS nextFireAt, created_at AS createdAt FROM cron_tasks WHERE session_id=? ORDER BY created_at`,
    ).all(sessionId) as { id: string; sessionId: string; prompt: string; scheduleType: string; scheduleAt: number | null; scheduleIntervalMs: number | null; nextFireAt: number; createdAt: number }[]
  }

  deleteCronTask(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM cron_tasks WHERE id=?`).run(id)
    return result.changes > 0
  }
}