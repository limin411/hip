// packages/sidecar/src/session/remote-compactor.ts
// Remote/server-side compaction interface (G7, P2 placeholder).
//
// Codex (compact_remote_v2) ships history groups to the provider's `compact`
// endpoint and installs the returned compacted history. hip's current
// providers (DeepSeek etc.) do not expose a compact endpoint, so this is an
// interface-only seam: the default implementation is the local summarizer
// fallback (current behavior). When a provider ships compaction support, a
// RemoteCompactor implementation can be plugged here without touching
// compactMessages.
import type { BaseMessage } from '@langchain/core/messages'

export interface RemoteCompactRequest {
  /** History groups sent to the remote endpoint (provider-dependent shape). */
  messages: BaseMessage[]
  sessionId?: string
}

export interface RemoteCompactResult {
  /** Compacted history to install in place of the middle span. */
  messages: BaseMessage[]
  /** Provider-reported summary text (optional). */
  summary?: string
}

export interface RemoteCompactor {
  readonly supported: boolean
  /** Compress the middle span remotely. Throws when unsupported/unavailable. */
  compact(req: RemoteCompactRequest): Promise<RemoteCompactResult>
}

/**
 * Default compactor: not supported — callers MUST fall back to the local
 * summarizer path (compactMessages). Kept as the seam for future providers.
 */
export const localFallbackCompactor: RemoteCompactor = {
  supported: false,
  async compact() {
    throw new Error('remote compaction not supported by the active provider')
  },
}
