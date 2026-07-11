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
  decayFactor?: number
  forgetConfidence?: number
  extractModel?: string
  extractMaxTokens?: number
  onboardingTipDismissed?: boolean
  simpleExtract?: boolean
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
  decayFactor: 0.92,
  forgetConfidence: 0.15,
  simpleExtract: false,
}
