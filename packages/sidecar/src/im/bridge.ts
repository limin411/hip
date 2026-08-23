/**
 * Session Bridge — connects IM gateway events to hip session lifecycle.
 *
 * Responsibilities:
 * - Ensure a hip session exists for each (connector, IM chat) pair
 * - Forward inbound messages into the session as user messages
 * - Listen for turn completion and send replies back to IM
 * - Handle HITL permission requests via IM interactive cards
 * - Manage busy queue (depth 1 per session)
 */

import type {
  ServerMessage,
  ImConnectorRecord,
  ImSessionOrigin,
  PermissionMode,
} from '@hip/protocol'
import type { ImMessageEvent, BaseImAdapter, ImChatTarget, ImOutbound } from './types.js'
import { resolveSessionId, frameInbound, deriveSessionTitle, buildOrigin } from './gateway.js'

// ── Types ──────────────────────────────────────────────────────────────

export interface SessionBridgeDeps {
  /** Create a new session (delegates to SessionManager.createSession). */
  createSession: (id: string, title: string, permissionMode: PermissionMode, origin: ImSessionOrigin) => void
  /** Check if a session exists. */
  hasSession: (id: string) => boolean
  /** Send a user message into an existing session. */
  sendMessage: (sessionId: string, content: string) => void
  /** Register a callback for session turn completion. */
  onTurnComplete: (sessionId: string, cb: (text: string, error?: string) => void) => void
  /** Register a callback for permission requests in a session. */
  onPermissionRequest: (sessionId: string, cb: (requestId: string, tool: string, options: unknown[]) => void) => void
  /** Respond to a permission request. */
  respondPermission: (sessionId: string, requestId: string, optionId: string) => void
}

/** In-flight message waiting for session to be ready. */
interface QueuedMessage {
  event: ImMessageEvent
  enqueuedAt: number
}

// ── Bridge ─────────────────────────────────────────────────────────────

const BUSY_QUEUE_MAX = 1

export class SessionBridge {
  /** sessionId → queued messages (depth 1). */
  private readonly busyQueues = new Map<string, QueuedMessage[]>()
  /** sessionId → adapter (for sending replies). */
  private readonly sessionAdapters = new Map<string, BaseImAdapter>()
  /** sessionId → connector id. */
  private readonly sessionConnectors = new Map<string, string>()

  constructor(private readonly deps: SessionBridgeDeps) {}

  /**
   * Handle an authorized inbound message.
   * Ensures session exists, queues if busy, injects message.
   */
  handleInbound(event: ImMessageEvent, connector: ImConnectorRecord): void {
    const sessionId = resolveSessionId(event.platform, event.chatId)

    // Track adapter for this session
    const adapter = this.findAdapter(connector.id)
    if (adapter) {
      this.sessionAdapters.set(sessionId, adapter)
      this.sessionConnectors.set(sessionId, connector.id)
    }

    // Handle interactive (HITL) card button clicks
    if (event.interactive) {
      this.handleInteractive(sessionId, event)
      return
    }

    // Ensure session exists
    if (!this.deps.hasSession(sessionId)) {
      const origin = buildOrigin(event, connector.id)
      const title = deriveSessionTitle(event)
      // Map IM permission mode to session permission mode
      const sessionPermMode: PermissionMode =
        connector.permissionMode === 'auto' ? 'full' : 'edit'
      this.deps.createSession(
        sessionId,
        title,
        sessionPermMode,
        origin,
      )

      // Register turn completion listener for this new session
      this.registerTurnListener(sessionId)
      this.registerPermissionListener(sessionId, connector)
    }

    // Check busy queue
    const queue = this.busyQueues.get(sessionId)
    if (queue && queue.length >= BUSY_QUEUE_MAX) {
      // Queue full — send "busy" reply
      this.sendToSession(sessionId, {
        kind: 'text',
        text: '正在处理上一条消息，请稍后。',
      })
      return
    }

    // Enqueue or inject immediately
    if (queue && queue.length > 0) {
      queue.push({ event, enqueuedAt: Date.now() })
    } else {
      // Inject message into session
      const framed = frameInbound(event)
      this.deps.sendMessage(sessionId, framed)
      // Mark as busy
      this.busyQueues.set(sessionId, [{ event, enqueuedAt: Date.now() }])
    }
  }

  /** Handle HITL interactive card button click. */
  private handleInteractive(sessionId: string, event: ImMessageEvent): void {
    if (!event.interactive) return

    const actionId = event.interactive.actionId
    const optionId = mapActionToOptionId(actionId)
    if (!optionId) return

    // Find the pending permission request for this session
    // The bridge listens for permission requests and stores the requestId
    const requestId = this.pendingPermissions.get(sessionId)
    if (requestId) {
      this.deps.respondPermission(sessionId, requestId, optionId)
      this.pendingPermissions.delete(sessionId)

      // Update card to "processed"
      const adapter = this.sessionAdapters.get(sessionId)
      if (adapter && event.interactive.cardMessageId) {
        const chat: ImChatTarget = { chatId: event.chatId, chatKind: event.chatKind }
        void adapter.updateCard(chat, event.interactive.cardMessageId, {
          processed: true,
          action: actionId,
        })
      }
    }
  }

  /** Pending permission request ids per session. */
  private readonly pendingPermissions = new Map<string, string>()

  /** Register turn completion listener for a session. */
  private registerTurnListener(sessionId: string): void {
    this.deps.onTurnComplete(sessionId, (text, error) => {
      // Clear busy queue
      const queue = this.busyQueues.get(sessionId)
      if (queue) queue.shift()
      if (queue && queue.length === 0) {
        this.busyQueues.delete(sessionId)
      }

      // Send reply to IM
      if (error) {
        this.sendToSession(sessionId, {
          kind: 'text',
          text: `Error: ${error}`,
        })
      } else if (text) {
        this.sendToSession(sessionId, {
          kind: 'markdown',
          markdown: text,
        })
      }

      // Process next queued message if any
      const nextQueue = this.busyQueues.get(sessionId)
      if (nextQueue && nextQueue.length > 0) {
        const next = nextQueue[0]
        const framed = frameInbound(next.event)
        this.deps.sendMessage(sessionId, framed)
      }
    })
  }

  /** Register permission request listener for a session. */
  private registerPermissionListener(sessionId: string, connector: ImConnectorRecord): void {
    this.deps.onPermissionRequest(sessionId, (requestId, tool, options) => {
      this.pendingPermissions.set(sessionId, requestId)

      // Send HITL card to IM
      const card = buildHitlCard(tool, requestId)
      this.sendToSession(sessionId, card)
    })
  }

  /** Send a message to IM via the session's adapter. */
  private sendToSession(sessionId: string, payload: ImOutbound): void {
    const adapter = this.sessionAdapters.get(sessionId)
    if (!adapter) return

    // Find the chat from the session id
    // sessionId format: im:{platform}:{chatId}
    const parts = sessionId.split(':')
    const chatId = parts.slice(2).join(':')
    if (!chatId) return

    const chat: ImChatTarget = { chatId, chatKind: 'group' } // Default to group; adapter corrects
    void adapter.send(chat, payload).catch(() => {})
  }

  /** Find adapter by connector id. */
  private adapterMap = new Map<string, BaseImAdapter>()

  /** Register an adapter for a connector. */
  registerAdapter(connectorId: string, adapter: BaseImAdapter): void {
    this.adapterMap.set(connectorId, adapter)
  }

  /** Unregister an adapter. */
  unregisterAdapter(connectorId: string): void {
    this.adapterMap.delete(connectorId)
  }

  private findAdapter(connectorId: string): BaseImAdapter | undefined {
    return this.adapterMap.get(connectorId)
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Map HITL action id to permission option id. */
function mapActionToOptionId(actionId: string): string | undefined {
  switch (actionId) {
    case 'allow_once': return 'allow_once'
    case 'allow_always': return 'allow_always'
    case 'reject_once': return 'reject_once'
    default: return undefined
  }
}

/** Build a HITL card payload for a permission request. */
function buildHitlCard(tool: string, requestId: string): ImOutbound {
  return {
    kind: 'card',
    card: {
      type: 'template',
      data: {
        template_id: 'hitl_permission',
        template_variable: {
          tool,
          requestId,
          buttons: [
            { text: '允许一次', action_id: 'allow_once', type: 'primary' },
            { text: '总是允许', action_id: 'allow_always', type: 'default' },
            { text: '拒绝', action_id: 'reject_once', type: 'danger' },
          ],
        },
      },
    },
  }
}
