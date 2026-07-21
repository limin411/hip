/** Plugin marketplace sources, catalog entries, and model-review types. */

export type MarketSourceId = 'grok-official' | 'claude-official'

export type MarketKind = 'grok' | 'claude' | 'custom'

export type MarketDownloadState =
  | 'not_downloaded'
  | 'downloading'
  | 'downloaded'
  | 'review_failed'

export type MarketTab = 'grok' | 'claude' | 'custom'

export interface MarketInstallSpec {
  kind: 'git'
  url: string
  sha?: string
  ref?: string
  subpath?: string
}

export interface PluginModelReviewFinding {
  path: string
  original?: { providerID?: string; modelID?: string; raw?: string }
  action: 'keep' | 'rewrite_to_default' | 'strip' | 'error'
  message?: string
}

export interface PluginModelReviewSummary {
  status: 'ok' | 'rewritten' | 'failed'
  defaultModel: { providerID: string; modelID: string }
  findings: PluginModelReviewFinding[]
  reviewedAt: string
}

export interface MarketPluginEntry {
  /** Stable key: `${marketSourceId}::${name}` */
  key: string
  marketSourceId: MarketSourceId
  marketKind: 'grok' | 'claude'
  name: string
  description?: string
  author?: string
  category?: string
  keywords?: string[]
  homepage?: string
  license?: string
  install: MarketInstallSpec | null
  installBlockedReason?: string
  downloadState: MarketDownloadState
  /** Meaningful only when downloadState === 'downloaded' */
  enabled: boolean
  localPluginId?: string
  modelReview?: PluginModelReviewSummary
}

export interface MarketSourceState {
  id: MarketSourceId
  kind: 'grok' | 'claude'
  name: string
  description: string
  catalogRepo: string
  catalogUrl: string
  enabled: boolean
  lastFetchedAt?: string
  lastError?: string
  pluginCount?: number
}

export interface MarketplaceSnapshot {
  sources: MarketSourceState[]
  entries: MarketPluginEntry[]
}

/** Built-in official marketplace definitions (URLs are fixed; not user-editable). */
export const BUILTIN_MARKET_SOURCES: Record<
  MarketSourceId,
  {
    id: MarketSourceId
    kind: 'grok' | 'claude'
    name: string
    description: string
    catalogRepo: string
    catalogUrl: string
  }
> = {
  'grok-official': {
    id: 'grok-official',
    kind: 'grok',
    name: 'Grok Official',
    description: 'Official xAI plugin marketplace for Grok Build',
    catalogRepo: 'https://github.com/xai-org/plugin-marketplace',
    catalogUrl:
      'https://raw.githubusercontent.com/xai-org/plugin-marketplace/main/.grok-plugin/marketplace.json',
  },
  'claude-official': {
    id: 'claude-official',
    kind: 'claude',
    name: 'Claude Official',
    description: 'Official Anthropic directory of Claude Code plugins',
    catalogRepo: 'https://github.com/anthropics/claude-plugins-official',
    catalogUrl:
      'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json',
  },
}

export const MARKET_SOURCE_IDS: MarketSourceId[] = ['grok-official', 'claude-official']
