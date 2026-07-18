import { randomUUID } from 'node:crypto'
import type { MemoryFileConfig, MemoryItem, MemoryKind, MemoryScope } from '@hip/protocol'
import { redactSecrets } from '../redact.js'
import { scanMemoryContent } from '../threat-scan.js'
import type { MemoryStage1Row, MemoryStore } from '../store.js'
import type { MemoryLlmClient } from '../llm-client.js'
import {
  PHASE2_SYSTEM_PROMPT,
  buildPhase2UserPrompt,
  type Phase2LlmItem,
  type Phase2LlmOutput,
} from './prompts.js'
import { rewriteMirrorsFromDb, type MemoryMutationScopes } from '../mirror.js'

/** Default stage1 rows loaded per Phase2 run (design phase2_max_stage1_inputs). */
export const PHASE2_MAX_STAGE1_DEFAULT = 20

/** New extract/consolidate items default confidence cap (B.7.d). */
export const PHASE2_NEW_EXTRACT_CONFIDENCE_CAP = 0.7

const MEMORY_KINDS = new Set<MemoryKind>([
  'preference',
  'convention',
  'lesson',
  'workflow',
  'profile',
])

export type Phase2ConsolidateStatus = 'succeeded' | 'succeeded_no_output' | 'skipped' | 'failed'

export type Phase2ConsolidateResult = {
  status: Phase2ConsolidateStatus
  reason?: string
  upserted?: number
  archived?: number
  dropped?: number
  stage1Ids?: string[]
  summaryId?: string
}

export type RunPhase2ConsolidateOpts = {
  store: MemoryStore
  llm: MemoryLlmClient | null
  config: MemoryFileConfig
  /** When set, consolidate project stage1 + project summary; else global. */
  projectKeyHash?: string
  projectKey?: string
  now?: number
  /** Override stage1 limit (default 20). */
  stage1Limit?: number
  /** Optional: bump core generation after multi-scope mirror rewrite. */
  onMutation?: (scopes: MemoryMutationScopes) => void
}

export type Phase2PostPassItem = {
  action: 'upsert' | 'archive'
  id: string
  title: string
  content: string
  kind: MemoryKind
  scope: 'global' | 'project'
  confidence: number
  isNew: boolean
}

export type Phase2PostPassResult = {
  items: Phase2PostPassItem[]
  summaryMd: string
  dropped: number
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase()
}

function asKind(raw: unknown): MemoryKind {
  if (typeof raw === 'string' && MEMORY_KINDS.has(raw as MemoryKind)) {
    return raw as MemoryKind
  }
  return 'preference'
}

function asScope(raw: unknown, fallback: 'global' | 'project'): 'global' | 'project' {
  if (raw === 'global' || raw === 'project') return raw
  return fallback
}

/** Parse flexible Phase2 LLM JSON into a typed shape. */
export function parsePhase2LlmOutput(raw: unknown): Phase2LlmOutput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Phase2: LLM output is not an object')
  }
  const o = raw as Record<string, unknown>
  const itemsRaw = Array.isArray(o.items) ? o.items : []
  const items: Phase2LlmItem[] = []
  for (const it of itemsRaw) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue
    const r = it as Record<string, unknown>
    const action = r.action === 'archive' ? 'archive' : 'upsert'
    const title = typeof r.title === 'string' ? r.title : ''
    const content = typeof r.content === 'string' ? r.content : ''
    const kind = typeof r.kind === 'string' ? r.kind : 'preference'
    const scope = r.scope === 'global' ? 'global' : r.scope === 'project' ? 'project' : 'project'
    const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : undefined
    const confidence = typeof r.confidence === 'number' ? r.confidence : undefined
    items.push({ action, id, title, content, kind, scope, confidence })
  }
  const summary_md = typeof o.summary_md === 'string' ? o.summary_md : 'v1\n'
  const project_key_hash =
    typeof o.project_key_hash === 'string' && o.project_key_hash.trim()
      ? o.project_key_hash.trim()
      : undefined
  return { items, summary_md, ...(project_key_hash ? { project_key_hash } : {}) }
}

/** Normalize summary_md: force first line `v1`, truncate to maxCoreSummaryChars. */
export function normalizeSummaryMd(summaryMd: string, maxChars: number): string {
  const redacted = redactSecrets(summaryMd ?? '')
  const lines = redacted.replace(/\r\n/g, '\n').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  if (lines.length === 0) {
    return truncateBudget('v1\n', maxChars)
  }
  if (lines[0].trim() !== 'v1') {
    lines.unshift('v1')
  } else {
    lines[0] = 'v1'
  }
  return truncateBudget(lines.join('\n'), maxChars)
}

function truncateBudget(text: string, budget: number): string {
  if (budget <= 0) return ''
  if (text.length <= budget) return text
  if (budget <= 1) return text.slice(0, budget)
  return `${text.slice(0, budget - 1)}…`
}

type WorkingItem = {
  id: string
  title: string
  content: string
  kind: MemoryKind
  scope: 'global' | 'project'
  confidence: number
  updatedAt: number
  /** When set, came from this post-pass action request. */
  pendingAction?: 'upsert' | 'archive'
  isNew: boolean
  /** Protected: source=user or pinned — never archive via LLM / title conflict. */
  protected: boolean
  /** Present in DB already. */
  exists: boolean
}

/**
 * Deterministic post-pass (design B.7). Rule order:
 * a) redact + threat-scan each content; fail → drop
 * b) never archive source=user or pinned=1 existing rows via LLM archive
 * c) title conflict (trim+lower): keep higher confidence; archive loser with [superseded by id]
 * d) confidence clamp [0,1]; new extract default max 0.7
 * e) summary_md: first line v1 + budget
 */
export function applyPhase2PostPass(
  llmItems: Phase2LlmItem[],
  existing: MemoryItem[],
  summaryMd: string,
  maxCoreSummaryChars: number,
  defaultScope: 'global' | 'project',
  now: number = Date.now(),
): Phase2PostPassResult {
  const byId = new Map(existing.map((e) => [e.id, e]))
  let dropped = 0

  // Start from active existing items
  const working = new Map<string, WorkingItem>()
  for (const e of existing) {
    if (e.status !== 'active') continue
    working.set(e.id, {
      id: e.id,
      title: e.title,
      content: e.content,
      kind: e.kind,
      scope: e.scope === 'global' ? 'global' : 'project',
      confidence: e.confidence,
      updatedAt: e.updatedAt,
      isNew: false,
      protected: e.source === 'user' || e.pinned,
      exists: true,
    })
  }

  for (const raw of llmItems) {
    const action = raw.action === 'archive' ? 'archive' : 'upsert'

    if (action === 'archive') {
      const id = raw.id?.trim()
      if (!id || !working.has(id)) {
        dropped += 1
        continue
      }
      const cur = working.get(id)!
      // b) never archive user or pinned
      if (cur.protected) {
        dropped += 1
        continue
      }
      cur.pendingAction = 'archive'
      continue
    }

    // upsert
    const titleRaw = (raw.title ?? '').trim()
    const contentRaw = raw.content ?? ''
    const title = redactSecrets(titleRaw)
    const content = redactSecrets(contentRaw)
    if (!title) {
      dropped += 1
      continue
    }
    // a) if redaction removed secrets, drop the item (do not store redacted shells)
    if (title !== titleRaw || content !== contentRaw) {
      dropped += 1
      continue
    }
    // a) threat-scan
    if (scanMemoryContent(content)) {
      dropped += 1
      continue
    }

    const existingRow = raw.id ? byId.get(raw.id) : undefined
    // Do not overwrite protected (user/pinned) rows via consolidate upsert
    if (existingRow && (existingRow.source === 'user' || existingRow.pinned)) {
      dropped += 1
      continue
    }

    const id = (existingRow?.id ?? (raw.id?.trim() || '')) || randomUUID()
    const isNew = !byId.has(id) && !working.has(id)
    let confidence =
      typeof raw.confidence === 'number'
        ? raw.confidence
        : existingRow?.confidence ?? PHASE2_NEW_EXTRACT_CONFIDENCE_CAP
    confidence = clamp01(confidence)
    if (isNew || !existingRow) {
      // d) new extract default max 0.7
      if (!existingRow || existingRow.source === 'extract' || existingRow.source === 'consolidate') {
        if (isNew) confidence = Math.min(confidence, PHASE2_NEW_EXTRACT_CONFIDENCE_CAP)
      }
    }
    if (isNew) {
      confidence = Math.min(confidence, PHASE2_NEW_EXTRACT_CONFIDENCE_CAP)
    }

    const kind = asKind(raw.kind)
    const scope = asScope(
      raw.scope,
      existingRow?.scope === 'global' ? 'global' : defaultScope,
    )

    working.set(id, {
      id,
      title,
      content,
      kind,
      scope,
      confidence,
      updatedAt: now,
      pendingAction: 'upsert',
      isNew,
      protected: false,
      exists: Boolean(existingRow) || working.get(id)?.exists === true,
    })
  }

  // c) title conflict: among non-archived working items, same scope + norm title
  const activeList = [...working.values()].filter((w) => w.pendingAction !== 'archive')
  const groups = new Map<string, WorkingItem[]>()
  for (const w of activeList) {
    const key = `${w.scope}::${normalizeTitle(w.title)}`
    const list = groups.get(key) ?? []
    list.push(w)
    groups.set(key, list)
  }

  for (const [, list] of groups) {
    if (list.length <= 1) continue
    // Protected always beat non-protected; else higher confidence; tie → newer updatedAt
    list.sort((a, b) => {
      if (a.protected !== b.protected) return a.protected ? -1 : 1
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      return b.updatedAt - a.updatedAt
    })
    const winner = list[0]
    for (let i = 1; i < list.length; i++) {
      const loser = list[i]
      if (loser.protected) continue
      loser.pendingAction = 'archive'
      loser.content = `[superseded by ${winner.id}] ${loser.content}`
      loser.updatedAt = now
    }
  }

  const items: Phase2PostPassItem[] = []
  for (const w of working.values()) {
    // Only emit items that need a write: pending upsert/archive, or supersede archive on existing
    if (w.pendingAction === 'archive') {
      if (!w.exists && w.isNew) {
        // brand-new that lost title conflict: just drop, no archive row needed
        dropped += 1
        continue
      }
      if (!w.exists && !w.isNew) continue
      items.push({
        action: 'archive',
        id: w.id,
        title: w.title,
        content: w.content,
        kind: w.kind,
        scope: w.scope,
        confidence: w.confidence,
        isNew: false,
      })
      continue
    }
    if (w.pendingAction === 'upsert') {
      items.push({
        action: 'upsert',
        id: w.id,
        title: w.title,
        content: w.content,
        kind: w.kind,
        scope: w.scope,
        confidence: w.confidence,
        isNew: w.isNew,
      })
    }
  }

  return {
    items,
    summaryMd: normalizeSummaryMd(summaryMd, maxCoreSummaryChars),
    dropped,
  }
}

/**
 * Heuristic Stage1 → items when config.simpleExtract is true (skip LLM).
 */
export function simpleExtractFromStage1(
  stage1Rows: Array<{ rawMemory: string; rolloutSummary: string }>,
  defaultScope: 'global' | 'project',
): Phase2LlmOutput {
  const items: Phase2LlmItem[] = []
  for (const row of stage1Rows) {
    const lines = (row.rawMemory || '')
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-*•]\s*/, '').trim())
      .filter(Boolean)
    for (const line of lines) {
      const title = line.length > 80 ? `${line.slice(0, 77)}…` : line
      items.push({
        action: 'upsert',
        title,
        content: line,
        kind: 'preference',
        scope: defaultScope,
        confidence: 0.5,
      })
    }
  }
  const summaries = stage1Rows.map((r) => r.rolloutSummary.trim()).filter(Boolean)
  const summary_md = summaries.length
    ? `v1\n${summaries.slice(0, 3).join('\n')}`
    : 'v1\n'
  return { items, summary_md }
}

function formatStage1Blocks(rows: MemoryStage1Row[]): string {
  return rows
    .map((r, i) => {
      const slug = r.rolloutSlug ? ` slug=${r.rolloutSlug}` : ''
      return `### stage1[${i}] id=${r.id}${slug}\nraw_memory:\n${r.rawMemory || '(empty)'}\n\nrollout_summary:\n${r.rolloutSummary || '(empty)'}`
    })
    .join('\n\n')
}

function formatExistingItems(items: MemoryItem[]): string {
  return items
    .map(
      (it) =>
        `- id=${it.id} scope=${it.scope} kind=${it.kind} conf=${it.confidence.toFixed(2)} pinned=${it.pinned ? 1 : 0} source=${it.source} title=${JSON.stringify(it.title)}\n  ${it.content.replace(/\s+/g, ' ').slice(0, 400)}`,
    )
    .join('\n')
}

function summaryIdFor(scope: 'global' | 'project', projectKeyHash?: string): string {
  if (scope === 'global') return 'summary:global'
  return `summary:project:${projectKeyHash ?? 'unknown'}`
}

function loadExistingForScope(store: MemoryStore, projectKeyHash?: string): MemoryItem[] {
  const global = store.listItems({ scope: 'global', status: 'active', limit: 500 })
  if (!projectKeyHash) return global
  const project = store.listItems({
    scope: 'project',
    projectKeyHash,
    status: 'active',
    limit: 500,
  })
  return [...global, ...project]
}

/**
 * Run Phase2 consolidate: load stage1 → LLM (or simpleExtract) → post-pass → write items/summary/mirror.
 */
export async function runPhase2Consolidate(
  opts: RunPhase2ConsolidateOpts,
): Promise<Phase2ConsolidateResult> {
  const now = opts.now ?? Date.now()
  const limit = opts.stage1Limit ?? PHASE2_MAX_STAGE1_DEFAULT
  const projectKeyHash = opts.projectKeyHash

  let stage1: MemoryStage1Row[]
  if (projectKeyHash) {
    stage1 = opts.store.listStage1({
      status: 'succeeded',
      selectedForPhase2: false,
      projectKeyHash,
      limit,
    })
  } else {
    stage1 = opts.store.listStage1({
      status: 'succeeded',
      selectedForPhase2: false,
      globalOnly: true,
      limit,
    })
    if (stage1.length === 0) {
      // Manual consolidate without hash: any unselected succeeded
      stage1 = opts.store.listStage1({
        status: 'succeeded',
        selectedForPhase2: false,
        limit,
      })
    }
  }

  if (stage1.length === 0) {
    return { status: 'skipped', reason: 'no_stage1' }
  }

  const resolvedHash =
    projectKeyHash ?? stage1.find((s) => s.projectKeyHash)?.projectKeyHash
  const projectKey = opts.projectKey ?? stage1.find((s) => s.projectKey)?.projectKey
  const defaultScope: 'global' | 'project' = resolvedHash ? 'project' : 'global'
  const stage1Ids = stage1.map((s) => s.id)
  const existing = loadExistingForScope(opts.store, resolvedHash)

  let llmOut: Phase2LlmOutput
  try {
    if (opts.config.simpleExtract) {
      llmOut = simpleExtractFromStage1(stage1, defaultScope)
    } else {
      if (!opts.llm) {
        return { status: 'skipped', reason: 'no_llm', stage1Ids }
      }
      const raw = await opts.llm.completeJson(
        PHASE2_SYSTEM_PROMPT,
        buildPhase2UserPrompt({
          stage1Blocks: formatStage1Blocks(stage1),
          existingItemsBlock: formatExistingItems(existing),
          projectKeyHash: resolvedHash,
        }),
        {
          model: opts.config.extractModel,
          maxTokens: opts.config.extractMaxTokens ?? 8192,
          temperature: 0,
          timeoutMs: 120_000,
        },
      )
      llmOut = parsePhase2LlmOutput(raw)
    }
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
      stage1Ids,
    }
  }

  const post = applyPhase2PostPass(
    llmOut.items,
    existing,
    llmOut.summary_md,
    opts.config.maxCoreSummaryChars,
    defaultScope,
    now,
  )

  // Provenance for delete-by-session: use primary stage1 session_id of this batch.
  // listStage1 is ORDER BY created_at DESC, so stage1[0] is the most recent row.
  // Multi-session batches still pin all new/updated items to this primary session for V1.
  const primarySourceSessionId = stage1[0]?.sessionId

  let upserted = 0
  let archived = 0

  for (const it of post.items) {
    if (it.action === 'archive') {
      const prev = opts.store.getItem(it.id)
      if (!prev) continue
      if (prev.source === 'user' || prev.pinned) continue
      opts.store.upsertItem({
        ...prev,
        content: it.content.includes('[superseded by') ? it.content : prev.content,
        status: 'archived',
        updatedAt: now,
      })
      archived += 1
      continue
    }

    const prev = opts.store.getItem(it.id)
    const item: MemoryItem = {
      id: it.id,
      scope: it.scope as MemoryScope,
      projectKey: it.scope === 'project' ? projectKey ?? prev?.projectKey : prev?.projectKey,
      projectKeyHash:
        it.scope === 'project' ? resolvedHash ?? prev?.projectKeyHash : prev?.projectKeyHash,
      sessionId: prev?.sessionId,
      kind: it.kind,
      title: it.title,
      content: it.content,
      confidence: it.confidence,
      status: 'active',
      source: 'consolidate',
      sourceSessionId: prev?.sourceSessionId ?? primarySourceSessionId,
      tags: prev?.tags ?? [],
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: prev?.lastUsedAt,
      useCount: prev?.useCount ?? 0,
      pinned: prev?.pinned ?? false,
    }
    opts.store.upsertItem(item)
    upserted += 1
  }

  const sumScope: 'global' | 'project' = resolvedHash ? 'project' : 'global'
  const sumId = summaryIdFor(sumScope, resolvedHash)
  opts.store.upsertSummary({
    id: sumId,
    scope: sumScope,
    projectKey: sumScope === 'project' ? projectKey : undefined,
    projectKeyHash: sumScope === 'project' ? resolvedHash : undefined,
    summaryMd: post.summaryMd,
    updatedAt: now,
  })

  opts.store.updateStage1Selected(stage1Ids, true)

  // Multi-scope mirror rewrite: global and/or every touched project hash.
  const scopes: MemoryMutationScopes = { global: false, projectKeyHashes: [] }
  for (const it of post.items) {
    if (it.scope === 'global') scopes.global = true
    if (it.scope === 'project') {
      const h = resolvedHash
      if (h) {
        scopes.projectKeyHashes = scopes.projectKeyHashes ?? []
        if (!scopes.projectKeyHashes.includes(h)) scopes.projectKeyHashes.push(h)
      }
    }
  }
  if (sumScope === 'global') scopes.global = true
  if (sumScope === 'project' && resolvedHash) {
    scopes.projectKeyHashes = scopes.projectKeyHashes ?? []
    if (!scopes.projectKeyHashes.includes(resolvedHash)) {
      scopes.projectKeyHashes.push(resolvedHash)
    }
  }
  if (!scopes.global && (!scopes.projectKeyHashes || scopes.projectKeyHashes.length === 0)) {
    scopes.global = sumScope === 'global'
    if (resolvedHash) scopes.projectKeyHashes = [resolvedHash]
  }

  try {
    if (opts.onMutation) {
      opts.onMutation(scopes)
    } else {
      rewriteMirrorsFromDb({
        store: opts.store,
        config: opts.config,
        scopes,
      })
    }
  } catch (err) {
    console.warn(
      '[memory-phase2] mirror rewrite failed',
      err instanceof Error ? err.message : String(err),
    )
  }

  const body = post.summaryMd.replace(/^v1\s*/m, '').trim()
  const empty = upserted === 0 && archived === 0 && !body
  return {
    status: empty ? 'succeeded_no_output' : 'succeeded',
    upserted,
    archived,
    dropped: post.dropped,
    stage1Ids,
    summaryId: sumId,
  }
}
