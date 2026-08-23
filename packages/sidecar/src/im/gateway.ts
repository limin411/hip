/**
 * IM Gateway — pipeline pure functions + adapter lifecycle.
 *
 * Pure functions are independently unit-testable without any adapter.
 * The wiring layer (register/connect/disconnect) ties adapters to the pipeline.
 */

import type {
  ImConnectorRecord,
  ImParkedEntry,
  ImSessionOrigin,
} from '@hip/protocol'
import type { ImMessageEvent, BaseImAdapter, GatewayStatusCallback } from './types.js'
import type { ImConnectorStore } from './store.js'

// ── Dedup filter ───────────────────────────────────────────────────────

interface DedupEntry {
  ts: number
}

const DEDUP_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Creates a dedup filter. Returns true if the message is NEW (not a duplicate).
 * `(connectorId, messageId)` pair used as dedup key.
 */
export function createDedupeFilter(): (connectorId: string, messageId: string) => boolean {
  const seen = new Map<string, DedupEntry>()

  return (connectorId: string, messageId: string): boolean => {
    const key = `${connectorId}:${messageId}`
    const now = Date.now()
    // Purge expired entries periodically
    if (seen.size > 1000) {
      for (const [k, v] of seen) {
        if (now - v.ts > DEDUP_TTL_MS) seen.delete(k)
      }
    }
    const existing = seen.get(key)
    if (existing && now - existing.ts < DEDUP_TTL_MS) {
      return false // duplicate
    }
    seen.set(key, { ts: now })
    return true // new message
  }
}

// ── Rate limiter ───────────────────────────────────────────────────────

const RATE_LIMIT_MAX = 10 // messages per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute

/**
 * Creates a rate limiter. Returns true if the message is within limit.
 * `(connectorId, senderId)` pair is rate-limited.
 */
export function createRateLimiter(): (connectorId: string, senderId: string) => boolean {
  const buckets = new Map<string, number[]>()

  return (connectorId: string, senderId: string): boolean => {
    const key = `${connectorId}:${senderId}`
    const now = Date.now()
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
    }
    // Remove expired entries
    while (bucket.length > 0 && bucket[0] < now - RATE_LIMIT_WINDOW_MS) {
      bucket.shift()
    }
    if (bucket.length >= RATE_LIMIT_MAX) {
      return false // rate limited
    }
    bucket.push(now)
    return true // within limit
  }
}

// ── Authorize ──────────────────────────────────────────────────────────

/** Check if a sender or chat is in the allowlist. */
export function isAuthorized(
  allowlist: ImConnectorRecord['allowlist'],
  senderId: string,
  chatId: string,
): boolean {
  return allowlist.some(
    (entry) =>
      (entry.kind === 'user' && entry.id === senderId) ||
      (entry.kind === 'chat' && entry.id === chatId),
  )
}

/** Create a parked entry from an unauthorized message event. */
export function createParkedEntry(event: ImMessageEvent): ImParkedEntry {
  return {
    kind: 'user',
    id: event.senderId,
    name: event.senderName,
    firstSeenAt: Date.now(),
  }
}

// ── Session ID resolver ────────────────────────────────────────────────

/** Resolve a deterministic session id from platform + chat. */
export function resolveSessionId(platform: string, chatId: string): string {
  return `im:${platform}:${chatId}`
}

// ── Inbound frame formatter ────────────────────────────────────────────

/** Format an inbound IM message as a tagged frame for the hip session. */
export function frameInbound(event: ImMessageEvent): string {
  const parts: string[] = [event.platform]
  if (event.chatName) parts.push(event.chatName)
  if (event.senderName) parts.push(event.senderName)
  const tag = parts.join(' · ')
  return `[${tag}] ${event.text}`
}

// ── Session title ──────────────────────────────────────────────────────

/** Derive session title from event metadata. */
export function deriveSessionTitle(event: ImMessageEvent): string {
  const name = event.chatKind === 'group'
    ? (event.chatName || event.chatId)
    : (event.senderName || event.senderId)
  return `${name}（IM）`
}

// ── Origin builder ─────────────────────────────────────────────────────

/** Build session origin metadata from an event. */
export function buildOrigin(
  event: ImMessageEvent,
  connectorId: string,
): ImSessionOrigin {
  return {
    kind: 'im',
    platform: event.platform,
    connectorId,
    chatId: event.chatId,
    chatName: event.chatName,
  }
}

// ── Gateway (wiring layer) ─────────────────────────────────────────────

export interface GatewayAdapterEntry {
  connectorId: string
  adapter: BaseImAdapter
}

/**
 * IM Gateway: manages adapter lifecycle and message pipeline.
 * Adapters are registered and connected/disconnected as a group.
 */
export class ImGateway {
  private readonly adapters = new Map<string, GatewayAdapterEntry>()
  private readonly dedupe = createDedupeFilter()
  private readonly rateLimiter = createRateLimiter()
  private statusCallback?: GatewayStatusCallback
  private messageCallback?: (event: ImMessageEvent, connector: ImConnectorRecord) => void

  constructor(private readonly store: ImConnectorStore) {}

  /** Register a status change callback. */
  onStatus(cb: GatewayStatusCallback): void {
    this.statusCallback = cb
  }

  /** Register the inbound message handler (bridge entry). */
  onMessage(cb: (event: ImMessageEvent, connector: ImConnectorRecord) => void): void {
    this.messageCallback = cb
  }

  /** Register an adapter for a connector. */
  register(entry: GatewayAdapterEntry): void {
    this.adapters.set(entry.connectorId, entry)
    entry.adapter.setMessageHandler((event) => this.handleInbound(event))
  }

  /** Unregister an adapter. */
  unregister(connectorId: string): void {
    const entry = this.adapters.get(connectorId)
    if (entry) {
      void entry.adapter.disconnect().catch(() => {})
      this.adapters.delete(connectorId)
    }
  }

  /** Connect all registered adapters. */
  async connectAll(): Promise<void> {
    for (const [id, entry] of this.adapters) {
      this.setStatus(id, 'connecting')
      try {
        await entry.adapter.connect()
        this.setStatus(id, 'connected')
      } catch (err) {
        this.setStatus(id, 'error', err instanceof Error ? err.message : String(err))
      }
    }
  }

  /** Disconnect all adapters. */
  async disconnectAll(): Promise<void> {
    for (const [id, entry] of this.adapters) {
      try {
        await entry.adapter.disconnect()
      } catch {
        /* best-effort */
      }
      this.setStatus(id, 'disconnected')
    }
  }

  /** Set adapter status and broadcast. */
  setStatus(
    connectorId: string,
    status: ImConnectorRecord['status'],
    lastError?: string | null,
  ): void {
    this.store.updateStatus(connectorId, status, lastError)
    this.statusCallback?.(connectorId, status, lastError)
  }

  /** Get adapter by connector id. */
  getAdapter(connectorId: string): BaseImAdapter | undefined {
    return this.adapters.get(connectorId)?.adapter
  }

  /** Pipeline: handle an inbound message event. */
  private handleInbound(event: ImMessageEvent): void {
    // 1. Dedup
    if (!this.dedupe(event.connectorId, event.messageId)) {
      return // duplicate, silently drop
    }

    // 2. Rate limit
    if (!this.rateLimiter(event.connectorId, event.senderId)) {
      // TODO: send "too frequent" reply (requires adapter.send)
      return
    }

    // 3. Authorize
    const connector = this.store.get(event.connectorId)
    if (!connector) return

    if (!isAuthorized(connector.allowlist, event.senderId, event.chatId)) {
      // Park the unauthorized message
      const entry = createParkedEntry(event)
      const existing = connector.parked.filter((p) => p.id !== entry.id)
      const parked = [...existing, entry]
      this.store.updateParked(connector.id, parked)
      this.statusCallback?.(connector.id, connector.status) // trigger parked:updated via handler
      return
    }

    // 4. Forward to bridge
    this.messageCallback?.(event, connector)
  }
}
