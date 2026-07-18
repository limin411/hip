import { randomUUID } from 'node:crypto'
import type {
  MemoryFileConfig,
  MemoryItem,
  MemoryModelRef,
  MemoryPipelineStatus,
  MemorySource,
} from '@hip/protocol'
import { DOGFOOD_MEMORY_PRESET, MEMORY_FILE_CONFIG_DEFAULTS, normalizeExtractModel } from '@hip/protocol'
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
import { searchHybrid } from './hybrid-search.js'
import { embeddingIndexStatus, getEmbedding, upsertEmbedding } from './vec.js'
import {
  detectMirrorDesync,
  importFromMirror,
  listKnownProjectKeyHashes,
  rewriteMirrorsFromDb,
  writeUserProfileMirror,
  type MemoryMutationScopes,
} from './mirror.js'
import { rerankByQuery, sortByMemoryRank } from './ranking.js'
import { runtimeGet, runtimeGetNumber, runtimeSet, runtimeSetNumber } from './runtime-kv.js'
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

export type MemoryUpsertInput = Partial<Omit<MemoryItem, 'expiresAt' | 'agentId'>> &
  Pick<MemoryItem, 'title' | 'content' | 'kind' | 'scope'> & {
    /** Epoch ms; pass `null` to clear. */
    expiresAt?: number | null
    /** Managed-agent bucket; pass `null` to clear. */
    agentId?: string | null
  }

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
  /** Process-local core generation (L1). Hydrated from memory_runtime when available (L2). */
  private coreGeneration = 0
  private coreGenerationHydrated = false
  private lastMirrorDesync = false
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
    this.hydrateCoreGeneration()
  }

  getCoreGeneration(): number {
    this.hydrateCoreGeneration()
    return this.coreGeneration
  }

  bumpCoreGeneration(): number {
    this.hydrateCoreGeneration()
    this.coreGeneration += 1
    try {
      runtimeSetNumber(this.store.getDb(), 'core_generation', this.coreGeneration)
    } catch {
      // L2 optional when table missing (pre-migration tests)
    }
    return this.coreGeneration
  }

  private hydrateCoreGeneration(): void {
    if (this.coreGenerationHydrated) return
    this.coreGenerationHydrated = true
    try {
      const n = runtimeGetNumber(this.store.getDb(), 'core_generation')
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
        this.coreGeneration = Math.floor(n)
      }
    } catch {
      // table may not exist in older DBs until migrate runs
    }
  }

  /**
   * Single chokepoint after logical mutations: bump generation; rewrite mirrors when enabled.
   */
  afterMemoryMutation(scopes: MemoryMutationScopes = { all: true }): void {
    this.bumpCoreGeneration()
    const config = this.getConfig()
    try {
      const result = rewriteMirrorsFromDb({
        store: this.store,
        config,
        scopes,
      })
      if (!result.skipped && result.written.length > 0) {
        // best-effort USER.md when global scope touched
        if (scopes.all || scopes.global) {
          try {
            writeUserProfileMirror({ store: this.store, config })
          } catch {
            // optional
          }
        }
      }
    } catch (err) {
      console.warn(
        '[memory] afterMemoryMutation mirror rewrite failed',
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  /**
   * Best-effort decay + trash + mirror reconcile once per service instance.
   * Safe to invoke repeatedly; only the first call runs the jobs.
   */
  runStartupDecayOnce(): void {
    if (this.startupDecayRan) return
    this.startupDecayRan = true
    const config = this.getConfig()
    try {
      const decay = runDecayJob(this.store, config)
      if (decay.archived > 0 || decay.decayed > 0) {
        this.afterMemoryMutation({ all: true })
      }
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
    try {
      this.reconcileMirrorsOnStartup(config)
    } catch (err) {
      console.warn(
        '[memory] startup mirror reconcile failed',
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  private reconcileMirrorsOnStartup(config: MemoryFileConfig): void {
    if (config.importMirrorIfDbEmpty !== false) {
      const counts = this.store.countItemsByStatus()
      if (counts.active === 0) {
        // Import global + each project mirror when DB empty
        try {
          importFromMirror({ store: this.store, conflict: 'keep' })
        } catch {
          // ignore
        }
        for (const hash of this.store.listDistinctProjectKeyHashes()) {
          try {
            importFromMirror({
              store: this.store,
              projectKeyHash: hash,
              conflict: 'keep',
            })
          } catch {
            // ignore
          }
        }
        // Also scan disk project dirs when DB truly empty
        for (const hash of listKnownProjectKeyHashes(this.store)) {
          try {
            importFromMirror({
              store: this.store,
              projectKeyHash: hash,
              conflict: 'keep',
            })
          } catch {
            // ignore
          }
        }
      }
    }

    // Detect desync (mirror has ids SQLite no longer has) then DB-wins rewrite.
    let foundOrphans = false
    try {
      const g = detectMirrorDesync({ store: this.store })
      if (!g.inSync && g.mirrorOnlyIds.length > 0) foundOrphans = true
    } catch {
      // ignore
    }
    if (foundOrphans) {
      console.warn('[memory] mirror_desync detected; rewriting mirrors from DB')
    }
    rewriteMirrorsFromDb({ store: this.store, config, scopes: { all: true } })
    // Re-check after rewrite so the UI flag is not sticky for the whole process.
    // Previously lastMirrorDesync stayed true forever → Memory page always warned.
    try {
      if (!config.exportMarkdownMirror) {
        this.lastMirrorDesync = false
      } else {
        const after = detectMirrorDesync({ store: this.store })
        this.lastMirrorDesync = !after.inSync && after.mirrorOnlyIds.length > 0
        if (this.lastMirrorDesync) {
          console.warn(
            '[memory] mirror_desync persists after rewrite',
            after.mirrorPath,
            `mirrorOnly=${after.mirrorOnlyIds.length}`,
            `dbOnly=${after.dbOnlyIds.length}`,
          )
        }
      }
    } catch {
      this.lastMirrorDesync = false
    }
    // Generation bump so host caches invalidate after startup import/rewrite
    this.bumpCoreGeneration()
  }

  getConfig(): MemoryFileConfig {
    return loadMemoryConfig(this.configPath)
  }

  setConfig(partial: Partial<MemoryFileConfig>): MemoryFileConfig {
    const current = this.getConfig()
    // Mirror mergeMemoryConfig clear semantics for optional role models.
    const embedRaw =
      (partial as { embeddingModel?: MemoryModelRef | null | '' }).embeddingModel !== undefined
        ? (partial as { embeddingModel?: MemoryModelRef | null | '' }).embeddingModel
        : current.embeddingModel
    const effectiveEmbed =
      embedRaw === null || embedRaw === '' || embedRaw === undefined
        ? undefined
        : normalizeExtractModel(embedRaw)
    const effectiveHybrid =
      partial.hybridSearchEnabled !== undefined
        ? !!partial.hybridSearchEnabled
        : !!current.hybridSearchEnabled
    if (effectiveHybrid && !effectiveEmbed) {
      throw new Error('hybridSearchEnabled requires embeddingModel')
    }

    // Dogfood preset when enabling both use+generate from cold defaults.
    let toSave = { ...partial }
    const enablingBoth =
      partial.useMemories === true &&
      partial.generateMemories === true &&
      !current.useMemories &&
      !current.generateMemories
    if (enablingBoth) {
      if (
        (toSave.idleMinutes === undefined || toSave.idleMinutes === MEMORY_FILE_CONFIG_DEFAULTS.idleMinutes) &&
        current.idleMinutes === MEMORY_FILE_CONFIG_DEFAULTS.idleMinutes
      ) {
        toSave.idleMinutes = DOGFOOD_MEMORY_PRESET.idleMinutes
      }
      const coldInterval = MEMORY_FILE_CONFIG_DEFAULTS.minExtractIntervalHours ?? 6
      const curInterval = current.minExtractIntervalHours ?? coldInterval
      if (
        (toSave.minExtractIntervalHours === undefined || toSave.minExtractIntervalHours === coldInterval) &&
        curInterval === coldInterval
      ) {
        toSave.minExtractIntervalHours = DOGFOOD_MEMORY_PRESET.minExtractIntervalHours
      }
    }

    const saved = saveMemoryConfig(toSave, this.configPath)
    this.bumpCoreGeneration()
    return saved
  }

  resolveFlags(sessionConfig: SessionMemoryFlagsInput): ResolvedSessionMemoryFlags {
    return resolveSessionMemoryFlags(this.getConfig(), sessionConfig)
  }

  /**
   * Core inject block: rich (default) or legacy titles-only.
   * `ids` lists item ids whose bodies appear (citation allowedIds).
   * When `perAgentMemory` and `opts.agentId` are set, includes shared + that agent’s items.
   */
  loadCoreSnapshot(
    projectKeyHash: string | undefined,
    contextWindowTokens?: number,
    opts?: { agentId?: string },
  ): MemoryInjectBlock {
    const cfg = this.getConfig()
    const mode = cfg.coreInjectionMode ?? 'rich'
    const agentId =
      cfg.perAgentMemory && opts?.agentId?.trim() ? opts.agentId.trim() : undefined
    if (mode === 'legacy') {
      return this.loadCoreSnapshotLegacy(projectKeyHash, contextWindowTokens, agentId)
    }
    return this.loadCoreSnapshotRich(projectKeyHash, contextWindowTokens, agentId)
  }

  private loadCoreSnapshotLegacy(
    projectKeyHash: string | undefined,
    contextWindowTokens?: number,
    agentId?: string,
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

    const pinned = this.loadPinnedItems(projectKeyHash, agentId)
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

  private loadCoreSnapshotRich(
    projectKeyHash: string | undefined,
    contextWindowTokens?: number,
    agentId?: string,
  ): MemoryInjectBlock {
    const cfg = this.getConfig()
    const budget = getMemoryCoreBudget(cfg.maxCoreSummaryChars, contextWindowTokens)
    const bodyCap = cfg.coreItemBodyChars ?? 280
    const maxActive = cfg.coreMaxItems ?? 12
    const now = Date.now()
    const ids: string[] = []
    const sections: string[] = []
    let used = 0

    const appendSection = (text: string): boolean => {
      if (!text.trim()) return true
      const next = used === 0 ? text : `\n\n${text}`
      if (used + next.length > budget && used > 0) return false
      if (used + next.length > budget) {
        sections.push(truncateToBudget(text, Math.max(40, budget - used)))
        used = budget
        return false
      }
      sections.push(text)
      used += next.length
      return true
    }

    // Collect candidates in scope
    const candidates = this.loadActiveCoreItems(projectKeyHash, agentId)
    const profile = candidates.filter((i) => i.kind === 'profile' && i.scope === 'global')
    const pinned = candidates.filter((i) => i.pinned && i.kind !== 'profile')
    const profileIds = new Set(profile.map((p) => p.id))
    const pinnedIds = new Set(pinned.map((p) => p.id))
    const activePool = sortByMemoryRank(
      candidates.filter((i) => !profileIds.has(i.id) && !pinnedIds.has(i.id) && i.kind !== 'profile'),
      now,
    ).slice(0, maxActive)

    // Profile reserve
    const profileBudget = Math.min(400, Math.floor(0.25 * budget))
    if (profile.length > 0) {
      const lines: string[] = ['### User profile']
      let pUsed = 0
      for (const p of sortByMemoryRank(profile, now)) {
        const body = truncateToBudget(p.content.replace(/\s+/g, ' ').trim(), bodyCap)
        const line = `- **${p.title}**: ${body}`
        if (pUsed + line.length + 1 > profileBudget && lines.length > 1) break
        lines.push(line)
        pUsed += line.length + 1
        ids.push(p.id)
      }
      if (lines.length > 1) appendSection(lines.join('\n'))
    }

    // Summaries
    const summaries = this.loadSummaries(projectKeyHash)
    const sumParts: string[] = []
    for (const s of summaries) {
      const label = s.scope === 'global' ? 'Global' : 'Project'
      const body = s.summary_md.trim()
      if (!body) continue
      sumParts.push(`#### ${label}\n${body}`)
    }
    if (sumParts.length > 0) {
      appendSection(`### Summaries\n${sumParts.join('\n\n')}`)
    }

    // Pinned bodies
    if (pinned.length > 0) {
      const lines: string[] = ['### Pinned']
      for (const p of sortByMemoryRank(pinned, now)) {
        const body = truncateToBudget(p.content.replace(/\s+/g, ' ').trim(), bodyCap)
        const line = `- **${p.title}**: ${body}`
        if (used + line.length + 20 > budget && lines.length > 1) break
        lines.push(line)
        ids.push(p.id)
      }
      if (lines.length > 1) appendSection(lines.join('\n'))
    }

    // Active top-N
    if (activePool.length > 0) {
      const lines: string[] = ['### Active']
      for (const a of activePool) {
        const body = truncateToBudget(a.content.replace(/\s+/g, ' ').trim(), bodyCap)
        const line = `- **[${a.scope}/${a.kind}] ${a.title}**: ${body}`
        if (used + line.length + 20 > budget && lines.length > 1) break
        lines.push(line)
        ids.push(a.id)
      }
      if (lines.length > 1) appendSection(lines.join('\n'))
    }

    if (sections.length === 0) return { text: '', ids: [] }

    const body = sections.join('\n\n')
    const usedChars = Math.min(budget, body.length + 40)
    const percent = budget > 0 ? Math.floor((100 * usedChars) / budget) : 0
    const header = `## Memory (core) [${percent}% — ${usedChars}/${budget} chars]`
    return {
      text: truncateToBudget(`${header}\n${body}`, budget),
      ids: [...new Set(ids)],
    }
  }

  private loadActiveCoreItems(
    projectKeyHash: string | undefined,
    agentId?: string,
  ): MemoryItem[] {
    const db = this.store.getDb()
    const now = Date.now()
    const agentClause = agentId ? ' AND (agent_id IS NULL OR agent_id = ?)' : ''
    const expireClause = ' AND (expires_at IS NULL OR expires_at > ?)'
    if (projectKeyHash) {
      const params: unknown[] = [projectKeyHash]
      if (agentId) params.push(agentId)
      params.push(now)
      const rows = db.prepare(`
        SELECT * FROM memory_items
        WHERE status = 'active'
          AND scope != 'session'
          AND (
            scope = 'global'
            OR (scope = 'project' AND project_key_hash = ?)
          )
          ${agentClause}
          ${expireClause}
        ORDER BY updated_at DESC
        LIMIT 500
      `).all(...params) as Array<Record<string, unknown>>
      return rows.map((r) => this.rowToItemLoose(r))
    }
    const params: unknown[] = []
    if (agentId) params.push(agentId)
    params.push(now)
    const rows = db.prepare(`
      SELECT * FROM memory_items
      WHERE status = 'active' AND scope = 'global'
        ${agentClause}
        ${expireClause}
      ORDER BY updated_at DESC
      LIMIT 500
    `).all(...params) as Array<Record<string, unknown>>
    return rows.map((r) => this.rowToItemLoose(r))
  }

  private rowToItemLoose(r: Record<string, unknown>): MemoryItem {
    let tags: string[] = []
    try {
      const parsed = JSON.parse(String(r.tags_json ?? '[]')) as unknown
      if (Array.isArray(parsed)) tags = parsed.map(String)
    } catch {
      tags = []
    }
    return {
      id: String(r.id),
      scope: r.scope as MemoryItem['scope'],
      projectKey: (r.project_key as string | null) ?? undefined,
      projectKeyHash: (r.project_key_hash as string | null) ?? undefined,
      sessionId: (r.session_id as string | null) ?? undefined,
      kind: r.kind as MemoryItem['kind'],
      title: String(r.title),
      content: String(r.content),
      confidence: Number(r.confidence),
      status: r.status as MemoryItem['status'],
      source: r.source as MemoryItem['source'],
      sourceSessionId: (r.source_session_id as string | null) ?? undefined,
      tags,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      lastUsedAt: (r.last_used_at as number | null) ?? undefined,
      useCount: Number(r.use_count ?? 0),
      pinned: Number(r.pinned ?? 0) !== 0,
      agentId: (r.agent_id as string | null) ?? undefined,
      expiresAt: (r.expires_at as number | null) ?? undefined,
    }
  }

  /**
   * Dynamic prefetch block: FTS/LIKE (or hybrid) top hits for query, scoped to
   * global ∪ project(cwd) ∪ session, truncated to prefetch budget.
   * `ids` lists hit item ids considered for injection (citation allowedIds).
   */
  async formatPrefetch(
    query: string,
    cwd: string | undefined,
    sessionId: string | undefined,
    contextWindowTokens?: number,
    opts?: { agentId?: string },
  ): Promise<MemoryInjectBlock> {
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

    const agentId =
      cfg.perAgentMemory && opts?.agentId?.trim() ? opts.agentId.trim() : undefined

    // SQL-level scope OR so LIMIT cannot drop all in-scope hits behind foreign projects.
    const hits = await this.searchScoped(q, {
      projectKeyHash,
      sessionId: sessionId ?? undefined,
      limit: 30,
      agentId,
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

    // expiresAt: explicit null clears; undefined keeps existing / leaves unset
    let expiresAt: number | undefined
    if (input.expiresAt === null) {
      expiresAt = undefined
    } else if (typeof input.expiresAt === 'number' && Number.isFinite(input.expiresAt)) {
      expiresAt = input.expiresAt
    } else {
      expiresAt = existing?.expiresAt
    }

    // agentId: explicit null clears; undefined keeps existing
    let agentId: string | undefined
    if (input.agentId === null) {
      agentId = undefined
    } else if (typeof input.agentId === 'string' && input.agentId.trim()) {
      agentId = input.agentId.trim()
    } else {
      agentId = existing?.agentId
    }

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
      agentId,
      expiresAt,
    }

    // Soft store capacity (Hermes-style string errors for tools)
    if (!existing || existing.status !== 'active') {
      this.assertUnderStoreCapacity(item)
    }

    this.store.upsertItem(item)
    // Best-effort async embed when embeddingModel is configured; never throws on upsert.
    this.queueEmbed(item.id)
    this.afterMemoryMutation(scopesFromItem(item))
    return item
  }

  /** Throws Error with a clear message when over maxActiveItems / maxActiveItemChars. */
  assertUnderStoreCapacity(incoming: Pick<MemoryItem, 'content' | 'title'>): void {
    const cfg = this.getConfig()
    const maxItems = cfg.maxActiveItems ?? 200
    const maxChars = cfg.maxActiveItemChars ?? 50_000
    const counts = this.store.countItemsByStatus()
    if (counts.active >= maxItems) {
      throw new Error(
        `Memory store full (${counts.active}/${maxItems} active items). Archive or delete memories before adding more.`,
      )
    }
    const active = this.store.listItems({ status: 'active', limit: 10_000 })
    let charSum = 0
    for (const a of active) charSum += a.title.length + a.content.length
    charSum += incoming.title.length + incoming.content.length
    if (charSum > maxChars) {
      throw new Error(
        `Memory store character budget exceeded (${charSum}/${maxChars}). Consolidate or delete before adding more.`,
      )
    }
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

  /**
   * Scoped search: hybrid (FTS candidates + query embed + score) when enabled
   * and an embedding client is available; otherwise plain FTS `searchInScopes`.
   * Always applies query-aware re-rank (keyword + tag + recency core) so FTS-only
   * paths still surface relevant hits.
   */
  async searchScoped(
    query: string,
    opts?: MemorySearchInScopesOpts,
  ): Promise<MemoryItem[]> {
    const q = query.trim()
    if (!q) return []
    const cfg = this.getConfig()
    const ref = normalizeExtractModel(cfg.embeddingModel)
    const limit = opts?.limit ?? 50
    const searchOpts: MemorySearchInScopesOpts = {
      ...opts,
      limit: Math.max(limit * 2, limit),
    }

    let hits: MemoryItem[]
    if (cfg.hybridSearchEnabled && ref) {
      const client = this.createEmbeddingClient(ref)
      if (client) {
        const modelKey = embeddingModelKey(ref)
        const rerankRef = normalizeExtractModel(cfg.rerankModel)
        hits = await searchHybrid({
          store: this.store,
          query: q,
          projectKeyHash: opts?.projectKeyHash,
          sessionId: opts?.sessionId,
          limit: searchOpts.limit ?? limit,
          agentId: opts?.agentId,
          includeExpired: opts?.includeExpired,
          now: opts?.now,
          embedQuery: async () => {
            try {
              const vecs = await client.embed([q])
              const v = vecs[0]
              return v && v.length > 0 ? v : null
            } catch (e) {
              console.warn(
                '[memory] query embed failed; hybrid falls back to FTS order',
                e instanceof Error ? e.message : String(e),
              )
              return null
            }
          },
          getEmbedding: (id) => {
            const row = getEmbedding(this.store.getDb(), id)
            if (!row || row.modelKey !== modelKey) return null
            return row.embedding
          },
          rerankModel: rerankRef,
        })
      } else {
        hits = this.store.searchInScopes(q, searchOpts)
      }
    } else {
      hits = this.store.searchInScopes(q, searchOpts)
    }

    return rerankByQuery(hits, q, opts?.now ?? Date.now()).slice(0, limit)
  }

  softDelete(id: string): boolean {
    const prev = this.store.getItem(id)
    const ok = this.store.softDelete(id)
    if (ok && prev) this.afterMemoryMutation(scopesFromItem(prev))
    return ok
  }

  hardDelete(id: string): boolean {
    const prev = this.store.getItem(id)
    const ok = this.store.hardDelete(id)
    if (ok && prev) this.afterMemoryMutation(scopesFromItem(prev))
    return ok
  }

  /**
   * Restore a soft-deleted memory to active and schedule re-embed when configured.
   */
  restore(id: string): MemoryItem | undefined {
    const ok = this.store.restoreItem(id)
    if (!ok) return undefined
    const item = this.store.getItem(id)
    if (item) {
      this.queueEmbed(item.id)
      this.afterMemoryMutation(scopesFromItem(item))
    }
    return item
  }

  /** Hard-delete all soft-deleted memories (also drops embedding rows via store). */
  emptyTrash(): number {
    const n = this.store.emptyTrash()
    if (n > 0) this.afterMemoryMutation({ all: true })
    return n
  }

  rewriteMirrors(projectKeyHash?: string): string[] {
    const scopes: MemoryMutationScopes = projectKeyHash
      ? { projectKeyHashes: [projectKeyHash], global: true }
      : { all: true }
    this.afterMemoryMutation(scopes)
    const result = rewriteMirrorsFromDb({
      store: this.store,
      config: this.getConfig(),
      scopes,
    })
    return result.written
  }

  importMirror(opts: {
    projectKeyHash?: string
    conflict?: 'keep' | 'overwrite'
  }): { imported: number; skipped: number } {
    const result = importFromMirror({
      store: this.store,
      projectKeyHash: opts.projectKeyHash,
      conflict: opts.conflict ?? 'keep',
    })
    if (result.imported > 0) {
      this.afterMemoryMutation(
        opts.projectKeyHash
          ? { projectKeyHashes: [opts.projectKeyHash] }
          : { global: true },
      )
    }
    return result
  }

  /**
   * Pipeline + store health for UI poll. Capacity only when projectKeyHash provided.
   */
  getPipelineStatus(opts?: {
    projectKeyHash?: string
    contextWindowTokens?: number
    llmAvailable?: boolean
  }): MemoryPipelineStatus {
    const cfg = this.getConfig()
    const pipeline = (runtimeGet(this.store.getDb(), 'pipeline_status') ?? {}) as Partial<MemoryPipelineStatus>
    const extracts = (runtimeGet(this.store.getDb(), 'extracts_day') ?? {}) as {
      day?: string
      count?: number
    }
    const today = new Date().toISOString().slice(0, 10)
    const extractsToday =
      extracts.day === today && typeof extracts.count === 'number' ? extracts.count : 0

    const status: MemoryPipelineStatus = {
      lastPhase1At: pipeline.lastPhase1At,
      lastPhase1Status: pipeline.lastPhase1Status,
      lastPhase1Reason: pipeline.lastPhase1Reason,
      lastPhase1SessionId: pipeline.lastPhase1SessionId,
      lastPhase2At: pipeline.lastPhase2At,
      lastPhase2Status: pipeline.lastPhase2Status,
      lastPhase2Reason: pipeline.lastPhase2Reason,
      extractsToday,
      maxExtractsPerDay: cfg.maxExtractsPerDay ?? 20,
      llmAvailable: opts?.llmAvailable ?? true,
      itemCounts: this.store.countItemsByStatus(),
      summaryCounts: this.store.countSummaries(),
      stage1Pending: this.store.countStage1Pending(),
      coreGeneration: this.getCoreGeneration(),
      mirrorDesync: this.lastMirrorDesync,
      index: this.getIndexStatus(),
    }

    if (opts?.projectKeyHash) {
      const block = this.loadCoreSnapshot(opts.projectKeyHash, opts.contextWindowTokens)
      const budget = getMemoryCoreBudget(cfg.maxCoreSummaryChars, opts.contextWindowTokens)
      const used = block.text.length
      status.capacity = {
        usedChars: used,
        budgetChars: budget,
        percent: budget > 0 ? Math.floor((100 * used) / budget) : 0,
      }
    }

    return status
  }

  /** Persist pipeline outcome for poll UI (called from queue). */
  recordPipelineStatus(partial: Partial<MemoryPipelineStatus>): void {
    try {
      const prev = (runtimeGet(this.store.getDb(), 'pipeline_status') ?? {}) as Record<string, unknown>
      runtimeSet(this.store.getDb(), 'pipeline_status', { ...prev, ...partial })
    } catch {
      // ignore
    }
  }

  recordExtractsToday(count: number, day?: string): void {
    try {
      runtimeSet(this.store.getDb(), 'extracts_day', {
        day: day ?? new Date().toISOString().slice(0, 10),
        count,
      })
    } catch {
      // ignore
    }
  }

  getExtractsToday(): { day: string; count: number } {
    try {
      const extracts = (runtimeGet(this.store.getDb(), 'extracts_day') ?? {}) as {
        day?: string
        count?: number
      }
      const today = new Date().toISOString().slice(0, 10)
      if (extracts.day === today && typeof extracts.count === 'number') {
        return { day: today, count: extracts.count }
      }
    } catch {
      // ignore
    }
    return { day: new Date().toISOString().slice(0, 10), count: 0 }
  }

  getSessionLastExtractAt(sessionId: string): number | undefined {
    try {
      const map = (runtimeGet(this.store.getDb(), 'session_last_extract') ?? {}) as Record<
        string,
        number
      >
      const v = map[sessionId]
      return typeof v === 'number' ? v : undefined
    } catch {
      return undefined
    }
  }

  setSessionLastExtractAt(sessionId: string, atMs: number): void {
    try {
      const map = (runtimeGet(this.store.getDb(), 'session_last_extract') ?? {}) as Record<
        string,
        number
      >
      map[sessionId] = atMs
      runtimeSet(this.store.getDb(), 'session_last_extract', map)
    } catch {
      // ignore
    }
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
    // upsert already bumps mirrors; ensure full rewrite for multi-scope import
    if (imported > 0) this.afterMemoryMutation({ all: true })
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
    agentId?: string,
  ): Array<{ id: string; title: string }> {
    const db = this.store.getDb()
    const now = Date.now()
    const agentClause = agentId ? ' AND (agent_id IS NULL OR agent_id = ?)' : ''
    const expireClause = ' AND (expires_at IS NULL OR expires_at > ?)'
    if (projectKeyHash) {
      const params: unknown[] = [projectKeyHash]
      if (agentId) params.push(agentId)
      params.push(now)
      return db.prepare(`
        SELECT id, title FROM memory_items
        WHERE status = 'active' AND pinned = 1
          AND (
            scope = 'global'
            OR (scope = 'project' AND project_key_hash = ?)
          )
          ${agentClause}
          ${expireClause}
        ORDER BY updated_at DESC
        LIMIT 50
      `).all(...params) as Array<{ id: string; title: string }>
    }
    const params: unknown[] = []
    if (agentId) params.push(agentId)
    params.push(now)
    return db.prepare(`
      SELECT id, title FROM memory_items
      WHERE status = 'active' AND pinned = 1 AND scope = 'global'
        ${agentClause}
        ${expireClause}
      ORDER BY updated_at DESC
      LIMIT 50
    `).all(...params) as Array<{ id: string; title: string }>
  }

}

function scopesFromItem(item: Pick<MemoryItem, 'scope' | 'projectKeyHash'>): MemoryMutationScopes {
  if (item.scope === 'global') return { global: true }
  if (item.scope === 'project' && item.projectKeyHash) {
    return { projectKeyHashes: [item.projectKeyHash] }
  }
  return { global: true }
}
