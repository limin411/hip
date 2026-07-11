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

/**
 * HTTP API shape for memory embedding / rerank endpoints.
 * - Embedding uses industry-standard OpenAI Embeddings (`POST …/embeddings`).
 * - Rerank has no OpenAI standard; industry de facto are Cohere and Jina
 *   (`POST …/rerank` / `…/v1/rerank` / `…/v2/rerank`).
 */
export type MemoryEndpointApiFormat = 'openai' | 'cohere' | 'jina'

/** Provider/model reference for memory role models (extract / embed / rerank). */
export interface MemoryModelRef {
  providerID: string
  modelID: string
  baseURL?: string
  /**
   * Wire protocol for this endpoint.
   * Embedding: always `openai`. Rerank: `cohere` | `jina` (default `cohere` when omitted).
   */
  apiFormat?: MemoryEndpointApiFormat
}

/** Writable global memory flags (memory.json). */
export interface MemoryFileConfig {
  version: 1
  useMemories: boolean
  generateMemories: boolean
  defaultScope: 'project' | 'global'
  /**
   * Minutes of session idle before Phase1 extract is scheduled after a turn.
   * Default 15. **0 is valid** and means schedule on the next timer turn (immediate
   * debounce expiry) — used by E2E / advanced configs; do not coerce 0 to default.
   */
  idleMinutes: number
  maxCoreSummaryChars: number
  maxPrefetchChars: number
  exportMarkdownMirror: boolean
  maxUnusedDays: number
  minUserTurns?: number
  minUserChars?: number
  /**
   * Skip Phase1 if a successful extract for this session ran within this many hours. Default 6.
   * **0 is valid** and disables the interval throttle (still subject to maxExtractsPerDay).
   */
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
  /** Embedding model for hybrid search (OpenAI Embeddings API format). */
  embeddingModel?: MemoryModelRef
  /** Optional rerank model (Cohere or Jina API format); unset skips rerank. */
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
    const apiFormat = normalizeMemoryApiFormat(v.apiFormat)
    return {
      providerID: v.providerID,
      modelID: v.modelID,
      ...(v.baseURL ? { baseURL: v.baseURL } : {}),
      ...(apiFormat ? { apiFormat } : {}),
    }
  }
  return undefined
}

const MEMORY_API_FORMATS: ReadonlySet<string> = new Set(['openai', 'cohere', 'jina'])

/** Keep only known endpoint formats; drop garbage from disk / UI. */
export function normalizeMemoryApiFormat(
  v: unknown,
): MemoryEndpointApiFormat | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().toLowerCase()
  return MEMORY_API_FORMATS.has(s) ? (s as MemoryEndpointApiFormat) : undefined
}

/** Default wire format for a memory endpoint purpose. */
export function defaultMemoryApiFormat(
  purpose: 'embedding' | 'rerank',
): MemoryEndpointApiFormat {
  return purpose === 'embedding' ? 'openai' : 'cohere'
}

/**
 * Resolve apiFormat on a ref for a purpose (defaults when omitted / invalid).
 * Embedding is always coerced to `openai`.
 */
export function resolveMemoryApiFormat(
  purpose: 'embedding' | 'rerank',
  ref?: Pick<MemoryModelRef, 'apiFormat'> | null,
): MemoryEndpointApiFormat {
  if (purpose === 'embedding') return 'openai'
  const f = normalizeMemoryApiFormat(ref?.apiFormat)
  if (f === 'cohere' || f === 'jina') return f
  return 'cohere'
}
