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
  /**
   * Optional managed-agent bucket. When `perAgentMemory` is on, reads see
   * shared items (`agentId` unset) plus this agent's private items.
   */
  agentId?: string
  /** Epoch ms after which the item is hidden from default list/search/core (still get-by-id). */
  expiresAt?: number
}

export interface MemoryCitation {
  memoryId: string
  title?: string
  note?: string
}

/** Provider/model reference for memory role models (extract). */
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
  /** Max Phase1 extract LLM calls per UTC day. Default 20. */
  maxExtractsPerDay?: number
  /** Soft-deleted memories hard-purged after this many days. Default 30. */
  trashRetentionDays?: number
  /**
   * Core inject mode. `rich` = profile + summaries + pinned/active bodies + capacity.
   * `legacy` = summaries + pinned titles only.
   */
  coreInjectionMode?: 'legacy' | 'rich'
  /** Max active (non-profile, non-pinned) items in rich core. Default 12. */
  coreMaxItems?: number
  /** Max chars per item body in rich core. Default 280. */
  coreItemBodyChars?: number
  /** Soft store cap on active items (tool add/replace). Default 200. */
  maxActiveItems?: number
  /** Soft store cap on sum of active content lengths. Default 50_000. */
  maxActiveItemChars?: number
  /**
   * When true, `succeeded_no_output` counts toward minExtractIntervalHours spacing.
   * Default false (cost still counts toward maxExtractsPerDay).
   */
  throttleOnEmptyExtract?: boolean
  /** Import hip memories mirror files when that scope's DB is empty. Default true. */
  importMirrorIfDbEmpty?: boolean
  /** Require UI confirmation before tool/UI memory writes. Default false. */
  requireWriteConfirmation?: boolean
  /** Tools exposed to managed subagents. Default `search`. */
  memoryToolsForSubagents?: 'none' | 'search' | 'all'
  /** Inject memory into external (ACP) agents. Default false. */
  useMemoriesWithExternal?: boolean
  /** Isolate memories by agent id (future). Default false. */
  perAgentMemory?: boolean
  /** Memory backend selector. Default `sqlite`. */
  backend?: 'sqlite' | 'noop'
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
  maxExtractsPerDay: 20,
  trashRetentionDays: 30,
  coreInjectionMode: 'rich',
  coreMaxItems: 12,
  coreItemBodyChars: 280,
  maxActiveItems: 200,
  maxActiveItemChars: 50_000,
  throttleOnEmptyExtract: false,
  importMirrorIfDbEmpty: true,
  requireWriteConfirmation: false,
  memoryToolsForSubagents: 'search',
  useMemoriesWithExternal: false,
  perAgentMemory: false,
  backend: 'sqlite',
}

/**
 * Applied when the user enables both use+generate and idle/interval still equal cold defaults.
 * Does not overwrite user-tuned values (e.g. e2e idleMinutes: 0).
 */
export const DOGFOOD_MEMORY_PRESET: Partial<MemoryFileConfig> = {
  idleMinutes: 2,
  minExtractIntervalHours: 0.25,
}

export type MemoryExtractSkipReason =
  | 'incognito'
  | 'generate_disabled'
  | 'not_idle'
  | 'min_content'
  | 'empty_transcript'
  | 'no_llm'
  | 'rate_limited'
  | 'interval_throttle'
  | 'inflight'
  | 'unknown'

/** Pipeline + store health for UI poll (`memory:getStatus`). */
export interface MemoryPipelineStatus {
  lastPhase1At?: number
  lastPhase1Status?: 'succeeded' | 'succeeded_no_output' | 'skipped' | 'failed'
  lastPhase1Reason?: string
  lastPhase1SessionId?: string
  lastPhase2At?: number
  lastPhase2Status?: 'succeeded' | 'succeeded_no_output' | 'skipped' | 'failed'
  lastPhase2Reason?: string
  extractsToday: number
  maxExtractsPerDay: number
  llmAvailable: boolean
  itemCounts: { active: number; deleted: number; archived: number }
  summaryCounts: { global: number; project: number }
  stage1Pending: number
  coreGeneration: number
  mirrorDesync?: boolean
  /** Only when client passed projectKeyHash (or cwd-resolved hash). */
  capacity?: { usedChars: number; budgetChars: number; percent: number }
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
