export type MemoryScope = 'global' | 'project' | 'session'
export type MemoryKind = 'preference' | 'convention' | 'lesson' | 'workflow' | 'profile'
export type MemoryStatus = 'active' | 'archived' | 'deleted'
export type MemorySource = 'extract' | 'user' | 'import' | 'tool' | 'consolidate'

export interface MemoryItem {
  id: string
  scope: MemoryScope
  projectKey?: string
  projectKeyHash?: string
  sessionId?: string
  kind: MemoryKind
  title: string
  content: string
  confidence: number
  status: MemoryStatus
  source: MemorySource
  sourceSessionId?: string
  tags: string[]
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
  useCount: number
  pinned: boolean
}

export interface MemoryCitation {
  memoryId: string
  title?: string
  note?: string
}

/** Provider/model reference for memory role models (extract / embed / rerank). */
export interface MemoryModelRef {
  providerID: string
  modelID: string
  baseURL?: string
}

/** Writable global memory flags (memory.json). */
export interface MemoryFileConfig {
  version: 1
  useMemories: boolean
  generateMemories: boolean
  defaultScope: 'project' | 'global'
  idleMinutes: number
  maxCoreSummaryChars: number
  maxPrefetchChars: number
  exportMarkdownMirror: boolean
  maxUnusedDays: number
  minUserTurns?: number
  minUserChars?: number
  /** Skip Phase1 if a successful extract for this session ran within this many hours. Default 6. */
  minExtractIntervalHours?: number
  decayFactor?: number
  forgetConfidence?: number
  /**
   * Chat model used for background extract/consolidate.
   * @deprecated string form still accepted on load; prefer MemoryModelRef.
   */
  extractModel?: string | MemoryModelRef
  extractMaxTokens?: number
  onboardingTipDismissed?: boolean
  simpleExtract?: boolean
  /** OpenAI-compatible embedding model for hybrid search. */
  embeddingModel?: MemoryModelRef
  /** Optional rerank model; unset skips rerank. */
  rerankModel?: MemoryModelRef
  /** Hybrid (vector + FTS) search. Default false. Requires embeddingModel when enabled. */
  hybridSearchEnabled?: boolean
  /** Max Phase1 extract LLM calls per UTC day. Default 20. */
  maxExtractsPerDay?: number
  /** Soft-deleted memories hard-purged after this many days. Default 30. */
  trashRetentionDays?: number
}

export const MEMORY_FILE_CONFIG_DEFAULTS: MemoryFileConfig = {
  version: 1,
  useMemories: false,
  generateMemories: false,
  defaultScope: 'project',
  idleMinutes: 15,
  maxCoreSummaryChars: 1500,
  maxPrefetchChars: 2500,
  exportMarkdownMirror: true,
  maxUnusedDays: 90,
  minUserTurns: 2,
  minUserChars: 80,
  minExtractIntervalHours: 6,
  decayFactor: 0.92,
  forgetConfidence: 0.15,
  simpleExtract: false,
  hybridSearchEnabled: false,
  maxExtractsPerDay: 20,
  trashRetentionDays: 30,
}

/**
 * Normalize extract model override from legacy `provider/model` string or MemoryModelRef.
 * Bare model ids fall back to provider `openai` as a last resort.
 */
export function normalizeExtractModel(
  v: string | MemoryModelRef | undefined | null,
): MemoryModelRef | undefined {
  if (v == null || v === '') return undefined
  if (typeof v === 'string') {
    const raw = v.trim()
    if (!raw) return undefined
    const i = raw.indexOf('/')
    if (i > 0) {
      const providerID = raw.slice(0, i)
      const modelID = raw.slice(i + 1)
      if (providerID && modelID) return { providerID, modelID }
    }
    return { providerID: 'openai', modelID: raw }
  }
  if (typeof v === 'object' && typeof v.providerID === 'string' && typeof v.modelID === 'string') {
    if (!v.providerID.trim() || !v.modelID.trim()) return undefined
    return {
      providerID: v.providerID,
      modelID: v.modelID,
      ...(v.baseURL ? { baseURL: v.baseURL } : {}),
    }
  }
  return undefined
}
