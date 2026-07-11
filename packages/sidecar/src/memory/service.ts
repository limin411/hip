import { randomUUID } from 'node:crypto'
import type { MemoryFileConfig, MemoryItem, MemorySource } from '@hip/protocol'
import {
  loadMemoryConfig,
  saveMemoryConfig,
  resolveSessionMemoryFlags,
  type SessionMemoryFlagsInput,
  type ResolvedSessionMemoryFlags,
} from './config.js'
import { getMemoryCoreBudget, getMemoryPrefetchBudget } from './budget.js'
import { redactSecrets } from './redact.js'
import { scanMemoryContent } from './threat-scan.js'
import { resolveProjectKey } from './project-key.js'
import { runDecayJob } from './pipeline/evolution.js'
import { runTrashRetentionJob } from './trash.js'
import type {
  MemoryListFilter,
  MemorySearchOpts,
  MemorySearchInScopesOpts,
  MemoryStore,
} from './store.js'

export type MemoryUpsertInput = Partial<MemoryItem> &
  Pick<MemoryItem, 'title' | 'content' | 'kind' | 'scope'>

export type MemoryImportConflict = 'keep' | 'overwrite' | 'merge'

/** Injected memory block plus item ids available for citation allowedIds. */
export type MemoryInjectBlock = { text: string; ids: string[] }

interface SummaryRow {
  id: string
  scope: string
  project_key: string | null
  project_key_hash: string | null
  summary_md: string
  updated_at: number
}

function truncateToBudget(text: string, budget: number): string {
  if (text.length <= budget) return text
  if (budget <= 1) return text.slice(0, budget)
  return `${text.slice(0, budget - 1)}…`
}

/** Facade over store + config: read snapshots, upsert with redact/scan, import/export. */
export class MemoryService {
  private readonly configPath?: string
  private startupDecayRan = false

  constructor(
    readonly store: MemoryStore,
    opts?: { configPath?: string },
  ) {
    this.configPath = opts?.configPath
  }

  /**
   * Best-effort decay + trash retention once per service instance
   * (call from getMemoryService / process startup).
   * Safe to invoke repeatedly; only the first call runs the jobs.
   */
  runStartupDecayOnce(): void {
    if (this.startupDecayRan) return
    this.startupDecayRan = true
    const config = this.getConfig()
    try {
      runDecayJob(this.store, config)
    } catch (err) {
      console.warn(
        '[memory] startup decay failed',
        err instanceof Error ? err.message : String(err),
      )
    }
    try {
      runTrashRetentionJob(this.store, config)
    } catch (err) {
      console.warn(
        '[memory] startup trash retention failed',
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  getConfig(): MemoryFileConfig {
    return loadMemoryConfig(this.configPath)
  }

  setConfig(partial: Partial<MemoryFileConfig>): MemoryFileConfig {
    return saveMemoryConfig(partial, this.configPath)
  }

  resolveFlags(sessionConfig: SessionMemoryFlagsInput): ResolvedSessionMemoryFlags {
    return resolveSessionMemoryFlags(this.getConfig(), sessionConfig)
  }

  /**
   * Frozen core block: global + project summaries and pinned item titles.
   * Empty text when nothing to inject. Truncated to core budget.
   * `ids` lists pinned memory item ids included (for citation allowedIds).
   */
  loadCoreSnapshot(
    projectKeyHash: string | undefined,
    contextWindowTokens?: number,
  ): MemoryInjectBlock {
    const cfg = this.getConfig()
    const budget = getMemoryCoreBudget(cfg.maxCoreSummaryChars, contextWindowTokens)
    const parts: string[] = []

    const summaries = this.loadSummaries(projectKeyHash)
    for (const s of summaries) {
      const label = s.scope === 'global' ? 'Global' : 'Project'
      const body = s.summary_md.trim()
      if (!body) continue
      parts.push(`### ${label}\n${body}`)
    }

    const pinned = this.loadPinnedItems(projectKeyHash)
    if (pinned.length > 0) {
      parts.push(`### Pinned\n${pinned.map((p) => `- ${p.title}`).join('\n')}`)
    }

    if (parts.length === 0) return { text: '', ids: [] }
    const body = parts.join('\n\n')
    const header = '## Memory (core)'
    return {
      text: truncateToBudget(`${header}\n${body}`, budget),
      ids: pinned.map((p) => p.id),
    }
  }

  /**
   * Dynamic prefetch block: FTS/LIKE top hits for query, scoped to
   * global ∪ project(cwd) ∪ session, truncated to prefetch budget.
   * `ids` lists hit item ids considered for injection (citation allowedIds).
   */
  formatPrefetch(
    query: string,
    cwd: string | undefined,
    sessionId: string | undefined,
    contextWindowTokens?: number,
  ): MemoryInjectBlock {
    const q = query.trim()
    if (!q) return { text: '', ids: [] }
    const cfg = this.getConfig()
    const budget = getMemoryPrefetchBudget(cfg.maxPrefetchChars, contextWindowTokens)

    let projectKeyHash: string | undefined
    if (cwd) {
      try {
        projectKeyHash = resolveProjectKey(cwd).projectKeyHash
      } catch {
        projectKeyHash = undefined
      }
    }

    // SQL-level scope OR so LIMIT cannot drop all in-scope hits behind foreign projects.
    const hits = this.store.searchInScopes(q, {
      projectKeyHash,
      sessionId: sessionId ?? undefined,
      limit: 30,
    })
    if (hits.length === 0) return { text: '', ids: [] }

    const lines: string[] = ['## Memory (prefetch)']
    const ids: string[] = []
    for (const h of hits) {
      const snippet = h.content.replace(/\s+/g, ' ').trim()
      const line = `- **${h.title}**: ${snippet}`
      lines.push(line)
      ids.push(h.id)
    }
    return {
      text: truncateToBudget(lines.join('\n'), budget),
      ids,
    }
  }

  /**
   * Upsert a memory item. Assigns id if missing, redacts title+content,
   * threat-scans content (throws if blocked), sets timestamps.
   * Default source: `user`.
   */
  upsert(input: MemoryUpsertInput): MemoryItem {
    const title = redactSecrets(input.title ?? '')
    const content = redactSecrets(input.content ?? '')
    const blocked = scanMemoryContent(content)
    if (blocked) {
      throw new Error(blocked)
    }

    const now = Date.now()
    const id = input.id?.trim() || randomUUID()
    const existing = this.store.getItem(id)
    const source: MemorySource = input.source ?? existing?.source ?? 'user'

    const item: MemoryItem = {
      id,
      scope: input.scope,
      projectKey: input.projectKey ?? existing?.projectKey,
      projectKeyHash: input.projectKeyHash ?? existing?.projectKeyHash,
      sessionId: input.sessionId ?? existing?.sessionId,
      kind: input.kind,
      title,
      content,
      confidence: input.confidence ?? existing?.confidence ?? 0.8,
      status: input.status ?? existing?.status ?? 'active',
      source,
      sourceSessionId: input.sourceSessionId ?? existing?.sourceSessionId,
      tags: input.tags ?? existing?.tags ?? [],
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: input.lastUsedAt ?? existing?.lastUsedAt,
      useCount: input.useCount ?? existing?.useCount ?? 0,
      pinned: input.pinned ?? existing?.pinned ?? false,
    }

    this.store.upsertItem(item)
    return item
  }

  getItem(id: string): MemoryItem | undefined {
    return this.store.getItem(id)
  }

  search(query: string, opts?: MemorySearchOpts): MemoryItem[] {
    return this.store.search(query, opts)
  }

  searchInScopes(query: string, opts?: MemorySearchInScopesOpts): MemoryItem[] {
    return this.store.searchInScopes(query, opts)
  }

  softDelete(id: string): boolean {
    return this.store.softDelete(id)
  }

  hardDelete(id: string): boolean {
    return this.store.hardDelete(id)
  }

  /**
   * Restore a soft-deleted memory to active.
   * Hybrid re-embed (if enabled) is a no-op until Task 6.
   */
  restore(id: string): MemoryItem | undefined {
    const ok = this.store.restoreItem(id)
    if (!ok) return undefined
    return this.store.getItem(id)
  }

  /** Hard-delete all soft-deleted memories. */
  emptyTrash(): number {
    return this.store.emptyTrash()
  }

  exportJsonl(filter: MemoryListFilter = {}): string {
    const items = this.store.listItems({ ...filter, limit: filter.limit ?? 10_000 })
    return items.map((it) => JSON.stringify(it)).join('\n') + (items.length ? '\n' : '')
  }

  importJsonl(
    data: string,
    conflict: MemoryImportConflict = 'keep',
  ): { imported: number } {
    const lines = data.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    let imported = 0
    for (const line of lines) {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const raw = parsed as Partial<MemoryItem>
      if (typeof raw.title !== 'string' || typeof raw.content !== 'string') continue
      if (typeof raw.kind !== 'string' || typeof raw.scope !== 'string') continue

      const id = typeof raw.id === 'string' && raw.id ? raw.id : randomUUID()
      const existing = this.store.getItem(id)

      if (existing) {
        if (conflict === 'keep') continue
        if (conflict === 'merge') {
          const incomingConf = typeof raw.confidence === 'number' ? raw.confidence : 0
          if (existing.confidence >= incomingConf) continue
        }
        // overwrite or merge-win: fall through to upsert
      }

      try {
        this.upsert({
          ...raw,
          id,
          title: raw.title,
          content: raw.content,
          kind: raw.kind as MemoryItem['kind'],
          scope: raw.scope as MemoryItem['scope'],
          source: (raw.source as MemorySource | undefined) ?? 'import',
        })
        imported += 1
      } catch {
        // threat-scan / validation failure — skip line
      }
    }
    return { imported }
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private loadSummaries(projectKeyHash: string | undefined): SummaryRow[] {
    const db = this.store.getDb()
    if (projectKeyHash) {
      return db.prepare(`
        SELECT * FROM memory_summaries
        WHERE scope = 'global'
           OR (scope = 'project' AND project_key_hash = ?)
        ORDER BY
          CASE scope WHEN 'global' THEN 0 ELSE 1 END,
          updated_at DESC
      `).all(projectKeyHash) as SummaryRow[]
    }
    return db.prepare(`
      SELECT * FROM memory_summaries
      WHERE scope = 'global'
      ORDER BY updated_at DESC
    `).all() as SummaryRow[]
  }

  private loadPinnedItems(
    projectKeyHash: string | undefined,
  ): Array<{ id: string; title: string }> {
    const db = this.store.getDb()
    if (projectKeyHash) {
      return db.prepare(`
        SELECT id, title FROM memory_items
        WHERE status = 'active' AND pinned = 1
          AND (
            scope = 'global'
            OR (scope = 'project' AND project_key_hash = ?)
          )
        ORDER BY updated_at DESC
        LIMIT 50
      `).all(projectKeyHash) as Array<{ id: string; title: string }>
    }
    return db.prepare(`
      SELECT id, title FROM memory_items
      WHERE status = 'active' AND pinned = 1 AND scope = 'global'
      ORDER BY updated_at DESC
      LIMIT 50
    `).all() as Array<{ id: string; title: string }>
  }

}
