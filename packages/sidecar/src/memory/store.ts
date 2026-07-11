import type { MemoryItem, MemoryKind, MemoryScope, MemorySource, MemoryStatus } from '@hip/protocol'
import type { DatabaseSync } from '../persistence/sqlite.js'

export interface MemoryListFilter {
  scope?: string
  projectKeyHash?: string
  sessionId?: string
  status?: string
  /** Single source or any-of list. */
  source?: string | string[]
  pinned?: boolean
  limit?: number
}

export interface MemoryStage1ListFilter {
  status?: string
  /** When set, filter selected_for_phase2 (0/1). */
  selectedForPhase2?: boolean
  projectKeyHash?: string
  /** When true, only rows with NULL project_key_hash (global). */
  globalOnly?: boolean
  limit?: number
}

export interface MemorySummaryRow {
  id: string
  scope: string
  projectKey?: string
  projectKeyHash?: string
  summaryMd: string
  updatedAt: number
}

export interface MemorySearchOpts {
  projectKeyHash?: string
  sessionId?: string
  limit?: number
}

/** Read-path scopes: global ∪ matching project ∪ matching session. */
export interface MemorySearchInScopesOpts {
  projectKeyHash?: string
  sessionId?: string
  limit?: number
}

export interface MemoryStage1Row {
  id: string
  sessionId: string
  projectKey?: string
  projectKeyHash?: string
  cwd?: string
  rawMemory: string
  rolloutSummary: string
  rolloutSlug?: string
  status: string
  selectedForPhase2?: boolean
  leaseOwner?: string
  leaseUntil?: number
  retryAfter?: number
  sourceUpdatedAt: number
  createdAt: number
}

interface MemoryItemRow {
  id: string
  scope: string
  project_key: string | null
  project_key_hash: string | null
  session_id: string | null
  kind: string
  title: string
  content: string
  confidence: number
  status: string
  source: string
  source_session_id: string | null
  tags_json: string
  created_at: number
  updated_at: number
  last_used_at: number | null
  use_count: number
  pinned: number
}

function rowToItem(r: MemoryItemRow): MemoryItem {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(r.tags_json) as unknown
    if (Array.isArray(parsed)) tags = parsed.map(String)
  } catch {
    tags = []
  }
  return {
    id: r.id,
    scope: r.scope as MemoryScope,
    projectKey: r.project_key ?? undefined,
    projectKeyHash: r.project_key_hash ?? undefined,
    sessionId: r.session_id ?? undefined,
    kind: r.kind as MemoryKind,
    title: r.title,
    content: r.content,
    confidence: r.confidence,
    status: r.status as MemoryStatus,
    source: r.source as MemorySource,
    sourceSessionId: r.source_session_id ?? undefined,
    tags,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at ?? undefined,
    useCount: r.use_count,
    pinned: r.pinned !== 0,
  }
}

/** Persisted memory items + stage1 rows. Synchronous (node:sqlite). */
export class MemoryStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ftsEnabled: boolean,
  ) {}

  getDb(): DatabaseSync {
    return this.db
  }

  upsertItem(item: MemoryItem): void {
    this.db.prepare(`
      INSERT INTO memory_items(
        id, scope, project_key, project_key_hash, session_id, kind, title, content,
        confidence, status, source, source_session_id, tags_json,
        created_at, updated_at, last_used_at, use_count, pinned
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        scope=excluded.scope,
        project_key=excluded.project_key,
        project_key_hash=excluded.project_key_hash,
        session_id=excluded.session_id,
        kind=excluded.kind,
        title=excluded.title,
        content=excluded.content,
        confidence=excluded.confidence,
        status=excluded.status,
        source=excluded.source,
        source_session_id=excluded.source_session_id,
        tags_json=excluded.tags_json,
        created_at=memory_items.created_at,
        updated_at=excluded.updated_at,
        last_used_at=excluded.last_used_at,
        use_count=excluded.use_count,
        pinned=excluded.pinned
    `).run(
      item.id,
      item.scope,
      item.projectKey ?? null,
      item.projectKeyHash ?? null,
      item.sessionId ?? null,
      item.kind,
      item.title,
      item.content,
      item.confidence,
      item.status,
      item.source,
      item.sourceSessionId ?? null,
      JSON.stringify(item.tags ?? []),
      item.createdAt,
      item.updatedAt,
      item.lastUsedAt ?? null,
      item.useCount,
      item.pinned ? 1 : 0,
    )
  }

  getItem(id: string): MemoryItem | undefined {
    const row = this.db.prepare(`SELECT * FROM memory_items WHERE id=?`).get(id) as MemoryItemRow | undefined
    return row ? rowToItem(row) : undefined
  }

  listItems(filter: MemoryListFilter = {}): MemoryItem[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.scope !== undefined) {
      where.push('scope=?')
      params.push(filter.scope)
    }
    if (filter.projectKeyHash !== undefined) {
      where.push('project_key_hash=?')
      params.push(filter.projectKeyHash)
    }
    if (filter.sessionId !== undefined) {
      where.push('session_id=?')
      params.push(filter.sessionId)
    }
    if (filter.status !== undefined) {
      where.push('status=?')
      params.push(filter.status)
    }
    if (filter.source !== undefined) {
      const sources = Array.isArray(filter.source) ? filter.source : [filter.source]
      if (sources.length === 1) {
        where.push('source=?')
        params.push(sources[0])
      } else if (sources.length > 1) {
        where.push(`source IN (${sources.map(() => '?').join(',')})`)
        params.push(...sources)
      }
    }
    if (filter.pinned !== undefined) {
      where.push('pinned=?')
      params.push(filter.pinned ? 1 : 0)
    }
    const limit = filter.limit ?? 100
    const sql = `
      SELECT * FROM memory_items
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY pinned DESC, updated_at DESC
      LIMIT ?
    `
    params.push(limit)
    const rows = this.db.prepare(sql).all(...params) as MemoryItemRow[]
    return rows.map(rowToItem)
  }

  softDelete(id: string): boolean {
    const r = this.db.prepare(
      `UPDATE memory_items SET status='deleted', updated_at=? WHERE id=? AND status!='deleted'`,
    ).run(Date.now(), id)
    return (r.changes ?? 0) > 0
  }

  hardDelete(id: string): boolean {
    const r = this.db.prepare(`DELETE FROM memory_items WHERE id=?`).run(id)
    return (r.changes ?? 0) > 0
  }

  /**
   * Delete items derived from a session. Default HARD delete (+ stage1 rows).
   * Pass `{ soft: true }` to only mark items status=deleted (stage1 still hard-deleted).
   */
  deleteBySourceSession(sessionId: string, opts?: { soft?: boolean }): number {
    let n: number
    if (opts?.soft) {
      const r = this.db.prepare(
        `UPDATE memory_items SET status='deleted', updated_at=? WHERE source_session_id=? AND status!='deleted'`,
      ).run(Date.now(), sessionId)
      n = r.changes ?? 0
    } else {
      const r = this.db.prepare(`DELETE FROM memory_items WHERE source_session_id=?`).run(sessionId)
      n = r.changes ?? 0
    }
    this.deleteStage1ForSession(sessionId)
    return n
  }

  search(query: string, opts: MemorySearchOpts = {}): MemoryItem[] {
    const filters: string[] = [`m.status='active'`]
    const params: unknown[] = []
    if (opts.projectKeyHash !== undefined) {
      filters.push('m.project_key_hash=?')
      params.push(opts.projectKeyHash)
    }
    if (opts.sessionId !== undefined) {
      filters.push('m.session_id=?')
      params.push(opts.sessionId)
    }
    return this.searchWithFilters(query, filters, params, opts.limit ?? 50)
  }

  /**
   * Search limited to the normal read path: active items in
   * global ∪ project(projectKeyHash) ∪ session(sessionId).
   * Scope OR is applied in SQL so LIMIT cannot drop all in-scope hits.
   */
  searchInScopes(query: string, opts: MemorySearchInScopesOpts = {}): MemoryItem[] {
    const scopeOr: string[] = [`m.scope='global'`]
    const params: unknown[] = []
    if (opts.projectKeyHash !== undefined) {
      scopeOr.push(`(m.scope='project' AND m.project_key_hash=?)`)
      params.push(opts.projectKeyHash)
    }
    if (opts.sessionId !== undefined) {
      scopeOr.push(`(m.scope='session' AND m.session_id=?)`)
      params.push(opts.sessionId)
    }
    const filters = [`m.status='active'`, `(${scopeOr.join(' OR ')})`]
    return this.searchWithFilters(query, filters, params, opts.limit ?? 50)
  }

  private searchWithFilters(
    query: string,
    filters: string[],
    params: unknown[],
    limit: number,
  ): MemoryItem[] {
    const q = query.trim()
    if (!q) return []
    const whereExtra = filters.length ? `AND ${filters.join(' AND ')}` : ''

    // trigram MATCH needs >=3 chars and a quoted literal to avoid FTS syntax errors.
    const useFts = this.ftsEnabled && q.length >= 3
    if (useFts) {
      const literal = `"${q.replace(/"/g, '""')}"`
      const rows = this.db.prepare(`
        SELECT m.*
        FROM memories_fts
        JOIN memory_items m ON m.rowid = memories_fts.rowid
        WHERE memories_fts MATCH ?
        ${whereExtra}
        ORDER BY rank
        LIMIT ?
      `).all(literal, ...params, limit) as MemoryItemRow[]
      return rows.map(rowToItem)
    }

    const like = `%${q}%`
    const rows = this.db.prepare(`
      SELECT m.*
      FROM memory_items m
      WHERE (m.title LIKE ? OR m.content LIKE ?)
      ${whereExtra}
      ORDER BY m.pinned DESC, m.updated_at DESC
      LIMIT ?
    `).all(like, like, ...params, limit) as MemoryItemRow[]
    return rows.map(rowToItem)
  }

  deleteSessionScoped(sessionId: string): void {
    this.db.prepare(`DELETE FROM memory_items WHERE scope='session' AND session_id=?`).run(sessionId)
  }

  nullSourceSession(sessionId: string): void {
    this.db.prepare(`UPDATE memory_items SET source_session_id=NULL WHERE source_session_id=?`).run(sessionId)
  }

  upsertStage1(row: MemoryStage1Row): void {
    this.db.prepare(`
      INSERT INTO memory_stage1(
        id, session_id, project_key, project_key_hash, cwd, raw_memory, rollout_summary,
        rollout_slug, status, selected_for_phase2, lease_owner, lease_until, retry_after,
        source_updated_at, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        session_id=excluded.session_id,
        project_key=excluded.project_key,
        project_key_hash=excluded.project_key_hash,
        cwd=excluded.cwd,
        raw_memory=excluded.raw_memory,
        rollout_summary=excluded.rollout_summary,
        rollout_slug=excluded.rollout_slug,
        status=excluded.status,
        selected_for_phase2=excluded.selected_for_phase2,
        lease_owner=excluded.lease_owner,
        lease_until=excluded.lease_until,
        retry_after=excluded.retry_after,
        source_updated_at=excluded.source_updated_at,
        created_at=memory_stage1.created_at
    `).run(
      row.id,
      row.sessionId,
      row.projectKey ?? null,
      row.projectKeyHash ?? null,
      row.cwd ?? null,
      row.rawMemory,
      row.rolloutSummary,
      row.rolloutSlug ?? null,
      row.status,
      row.selectedForPhase2 ? 1 : 0,
      row.leaseOwner ?? null,
      row.leaseUntil ?? null,
      row.retryAfter ?? null,
      row.sourceUpdatedAt,
      row.createdAt,
    )
  }

  deleteStage1ForSession(sessionId: string): void {
    this.db.prepare(`DELETE FROM memory_stage1 WHERE session_id=?`).run(sessionId)
  }

  listStage1(filter: MemoryStage1ListFilter = {}): MemoryStage1Row[] {
    const where: string[] = []
    const params: unknown[] = []
    if (filter.status !== undefined) {
      where.push('status=?')
      params.push(filter.status)
    }
    if (filter.selectedForPhase2 !== undefined) {
      where.push('selected_for_phase2=?')
      params.push(filter.selectedForPhase2 ? 1 : 0)
    }
    if (filter.globalOnly) {
      where.push('project_key_hash IS NULL')
    } else if (filter.projectKeyHash !== undefined) {
      where.push('project_key_hash=?')
      params.push(filter.projectKeyHash)
    }
    const limit = filter.limit ?? 20
    const sql = `
      SELECT * FROM memory_stage1
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT ?
    `
    params.push(limit)
    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string
      session_id: string
      project_key: string | null
      project_key_hash: string | null
      cwd: string | null
      raw_memory: string
      rollout_summary: string
      rollout_slug: string | null
      status: string
      selected_for_phase2: number
      lease_owner: string | null
      lease_until: number | null
      retry_after: number | null
      source_updated_at: number
      created_at: number
    }>
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      projectKey: r.project_key ?? undefined,
      projectKeyHash: r.project_key_hash ?? undefined,
      cwd: r.cwd ?? undefined,
      rawMemory: r.raw_memory,
      rolloutSummary: r.rollout_summary,
      rolloutSlug: r.rollout_slug ?? undefined,
      status: r.status,
      selectedForPhase2: r.selected_for_phase2 !== 0,
      leaseOwner: r.lease_owner ?? undefined,
      leaseUntil: r.lease_until ?? undefined,
      retryAfter: r.retry_after ?? undefined,
      sourceUpdatedAt: r.source_updated_at,
      createdAt: r.created_at,
    }))
  }

  /** Mark stage1 rows as selected (or not) for Phase2. */
  updateStage1Selected(ids: string[], selected: boolean): void {
    if (ids.length === 0) return
    const flag = selected ? 1 : 0
    const stmt = this.db.prepare(`UPDATE memory_stage1 SET selected_for_phase2=? WHERE id=?`)
    for (const id of ids) {
      stmt.run(flag, id)
    }
  }

  upsertSummary(row: MemorySummaryRow): void {
    this.db.prepare(`
      INSERT INTO memory_summaries(id, scope, project_key, project_key_hash, summary_md, updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        scope=excluded.scope,
        project_key=excluded.project_key,
        project_key_hash=excluded.project_key_hash,
        summary_md=excluded.summary_md,
        updated_at=excluded.updated_at
    `).run(
      row.id,
      row.scope,
      row.projectKey ?? null,
      row.projectKeyHash ?? null,
      row.summaryMd,
      row.updatedAt,
    )
  }

  getSummary(id: string): MemorySummaryRow | undefined {
    const r = this.db.prepare(`SELECT * FROM memory_summaries WHERE id=?`).get(id) as
      | {
          id: string
          scope: string
          project_key: string | null
          project_key_hash: string | null
          summary_md: string
          updated_at: number
        }
      | undefined
    if (!r) return undefined
    return {
      id: r.id,
      scope: r.scope,
      projectKey: r.project_key ?? undefined,
      projectKeyHash: r.project_key_hash ?? undefined,
      summaryMd: r.summary_md,
      updatedAt: r.updated_at,
    }
  }
}
