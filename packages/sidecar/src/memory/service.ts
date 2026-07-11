import { randomUUID } from 'node:crypto'
import type { MemoryFileConfig, MemoryItem, MemoryModelRef, MemorySource } from '@hip/protocol'
import { normalizeExtractModel } from '@hip/protocol'
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
import {
  createOpenAICompatibleEmbeddingClient,
  embeddingModelKey,
  truncateForEmbed,
  type MemoryEmbeddingClient,
} from './embedding-client.js'
import { embeddingIndexStatus, upsertEmbedding } from './vec.js'
import type {
  MemoryListFilter,
  MemorySearchOpts,
  MemorySearchInScopesOpts,
  MemoryStore,
} from './store.js'

export type MemoryEmbeddingClientFactory = (
  ref: MemoryModelRef,
) => MemoryEmbeddingClient | null

export type MemoryIndexStatus = {
  embedded: number
  total: number
  failed?: number
  modelKey?: string
  vecEnabled: boolean
}

export type MemoryReindexResult = {
  embedded: number
  total: number
  failed: number
  modelKey?: string
}

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
  private readonly createEmbeddingClient: MemoryEmbeddingClientFactory
  private startupDecayRan = false
  /** In-flight embed jobs (dedupe concurrent scheduleEmbed for same id). */
  private readonly embedInFlight = new Map<string, Promise<void>>()

  constructor(
    readonly store: MemoryStore,
    opts?: {
      configPath?: string
      /** Inject embed client factory for tests; default is OpenAI-compatible HTTP. */
      createEmbeddingClient?: MemoryEmbeddingClientFactory
    },
  ) {
    this.configPath = opts?.configPath
    this.createEmbeddingClient =
      opts?.createEmbeddingClient ??
      ((ref) => {
        try {
          return createOpenAICompatibleEmbeddingClient(ref)
        } catch {
          return null
        }
      })
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
    // Best-effort async embed when embeddingModel is configured; never throws on upsert.
    this.queueEmbed(item.id)
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
   * Restore a soft-deleted memory to active and schedule re-embed when configured.
   */
  restore(id: string): MemoryItem | undefined {
    const ok = this.store.restoreItem(id)
    if (!ok) return undefined
    const item = this.store.getItem(id)
    if (item) this.queueEmbed(item.id)
    return item
  }

  /** Hard-delete all soft-deleted memories (also drops embedding rows via store). */
  emptyTrash(): number {
    return this.store.emptyTrash()
  }

  /** Index coverage for the configured embedding model (BLOB rows; vec0 optional). */
  getIndexStatus(): MemoryIndexStatus {
    const ref = this.resolveEmbeddingModel()
    const modelKey = ref ? embeddingModelKey(ref) : undefined
    const base = embeddingIndexStatus(this.store.getDb(), modelKey)
    return {
      ...base,
      vecEnabled: this.store.isVecEnabled(),
    }
  }

  /**
   * Re-embed all active memories with the configured embedding model.
   * No-op (failed=0, embedded=0) when embeddingModel is unset.
   */
  async reindexAll(): Promise<MemoryReindexResult> {
    const ref = this.resolveEmbeddingModel()
    if (!ref) {
      const total = embeddingIndexStatus(this.store.getDb(), undefined).total
      return { embedded: 0, total, failed: 0 }
    }
    const modelKey = embeddingModelKey(ref)
    const items = this.store.listItems({ status: 'active', limit: 100_000 })
    let embedded = 0
    let failed = 0
    for (const item of items) {
      try {
        const ok = await this.embedItem(item, ref)
        if (ok) embedded += 1
        else failed += 1
      } catch {
        failed += 1
      }
    }
    return { embedded, total: items.length, failed, modelKey }
  }

  /**
   * Schedule embed for one memory id (fire-and-forget). Safe when no model / no key.
   * Exposed for tests that await the returned promise.
   */
  scheduleEmbed(memoryId: string): Promise<void> {
    return this.embedById(memoryId)
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

  private resolveEmbeddingModel(): MemoryModelRef | undefined {
    return normalizeExtractModel(this.getConfig().embeddingModel)
  }

  private queueEmbed(memoryId: string): void {
    if (!this.resolveEmbeddingModel()) return
    void this.embedById(memoryId).catch((e) => {
      console.warn(
        '[memory] embed failed',
        memoryId,
        e instanceof Error ? e.message : String(e),
      )
    })
  }

  private async embedById(memoryId: string): Promise<void> {
    const existing = this.embedInFlight.get(memoryId)
    if (existing) return existing
    const ref = this.resolveEmbeddingModel()
    if (!ref) return
    const item = this.store.getItem(memoryId)
    if (!item || item.status !== 'active') return
    const job = (async () => {
      try {
        await this.embedItem(item, ref)
      } finally {
        this.embedInFlight.delete(memoryId)
      }
    })()
    this.embedInFlight.set(memoryId, job)
    return job
  }

  /** Returns true if embedding was written. */
  private async embedItem(item: MemoryItem, ref: MemoryModelRef): Promise<boolean> {
    const client = this.createEmbeddingClient(ref)
    if (!client) return false
    const text = truncateForEmbed(item.title, item.content)
    const vectors = await client.embed([text])
    const vec = vectors[0]
    if (!vec || vec.length === 0) return false
    upsertEmbedding(this.store.getDb(), {
      memoryId: item.id,
      modelKey: embeddingModelKey(ref),
      embedding: vec,
      vecEnabled: this.store.isVecEnabled(),
    })
    return true
  }

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
