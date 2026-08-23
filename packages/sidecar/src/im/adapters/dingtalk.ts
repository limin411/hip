/**
 * DingTalk IM adapter.
 *
 * Uses dingtalk-stream-sdk-nodejs DWClient for Stream mode.
 * Registers /v1.0/im/bot/messages/get for inbound messages.
 * Replies via sessionWebhook (text/markdown) or actionCard.
 * Falls back to text-based confirmation when card callbacks are unavailable.
 *
 * All DWClient operations go through an injectable interface for testing.
 */

import { AbstractBaseAdapter } from './base.js'
import type { ImMessageEvent, ImChatTarget, ImOutbound, CardPatch, SendResult } from '../types.js'

// ── Injectable DWClient interface ──────────────────────────────────────

export interface DWClientLike {
  connect(): void
  close(): void
  register(route: string, handler: (res: unknown) => unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

export interface DingtalkAdapterConfig {
  connectorId: string
  clientId: string
  clientSecret: string
}

export class DingtalkAdapter extends AbstractBaseAdapter {
  private client?: DWClientLike
  private readonly connectorId: string
  private clientFactory: (clientId: string, clientSecret: string) => DWClientLike

  constructor(
    private readonly config: DingtalkAdapterConfig,
    opts?: { clientFactory?: (clientId: string, clientSecret: string) => DWClientLike },
  ) {
    super()
    this.connectorId = config.connectorId
    this.clientFactory = opts?.clientFactory ?? ((id, secret) => {
      // Default: require the real SDK (lazy to avoid import errors when not installed)
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const DWClient = require('dingtalk-stream-sdk-nodejs').default
        return new DWClient(id, secret)
      } catch {
        throw new Error('dingtalk-stream-sdk-nodejs not installed')
      }
    })
  }

  async connect(): Promise<void> {
    this.setStatus('connecting')
    try {
      const client = this.clientFactory(this.config.clientId, this.config.clientSecret)
      this.client = client

      // Register message handler
      client.register('/v1.0/im/bot/messages/get', (res: unknown) => {
        this.handleMessage(res as Record<string, unknown>)
        return { success: true }
      })

      client.on('error', (err: unknown) => {
        this.setStatus('error', err instanceof Error ? err.message : String(err))
      })

      client.on('close', () => {
        this.setStatus('disconnected')
      })

      client.connect()
      this.setStatus('connected')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus('error', msg)
      throw err
    }
  }

  protected async doDisconnect(): Promise<void> {
    if (this.client) {
      try { this.client.close() } catch { /* best-effort */ }
      this.client = undefined
    }
  }

  async send(chat: ImChatTarget, payload: ImOutbound): Promise<SendResult> {
    // DingTalk uses sessionWebhook for replies
    const sessionWebhook = this.sessionWebhooks.get(chat.chatId)
    if (!sessionWebhook) {
      return { ok: false, error: 'No sessionWebhook available for this chat' }
    }

    try {
      const body = this.buildSendBody(payload)
      const res = await fetch(sessionWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async updateCard(chat: ImChatTarget, cardMessageId: string, patch: CardPatch): Promise<void> {
    // DingTalk card update via Stream callback — best-effort
    // If not available, the card remains as-is
  }

  // ── Session webhook tracking ──────────────────────────────────────

  private readonly sessionWebhooks = new Map<string, string>()

  // ── Message handling ───────────────────────────────────────────────

  private handleMessage(raw: Record<string, unknown>): void {
    try {
      const data = raw.data as Record<string, unknown> | undefined
      if (!data) return

      const msgId = String(data.msgId ?? '')
      const senderStaffId = String(data.senderStaffId ?? '')
      const senderNick = String(data.senderNick ?? '')
      const conversationType = String(data.conversationType ?? '')
      const chatbotCorpId = String(data.chatbotCorpId ?? '')
      const conversationId = String(data.conversationId ?? '')
      const sessionWebhook = String(data.sessionWebhook ?? '')
      const textContent = data.text as Record<string, unknown> | undefined
      const text = String(textContent?.content ?? '')

      if (!msgId || !senderStaffId) return

      // Track sessionWebhook for this chat
      const chatId = conversationType === '1'
        ? `dm:${senderStaffId}`
        : conversationId
      if (sessionWebhook) {
        this.sessionWebhooks.set(chatId, sessionWebhook)
      }

      const event: ImMessageEvent = {
        connectorId: this.connectorId,
        platform: 'dingtalk',
        messageId: msgId,
        chatId,
        chatName: conversationType === '2' ? conversationId : senderNick,
        chatKind: conversationType === '1' ? 'dm' : 'group',
        senderId: senderStaffId,
        senderName: senderNick || undefined,
        text: text.trim(),
        replyToken: sessionWebhook,
      }

      this.emitMessage(event)
    } catch {
      /* silently drop malformed messages */
    }
  }

  // ── Outbound message building ─────────────────────────────────────

  private buildSendBody(payload: ImOutbound): Record<string, unknown> {
    switch (payload.kind) {
      case 'text':
        return {
          msgtype: 'text',
          text: { content: payload.text },
        }
      case 'markdown':
        return {
          msgtype: 'markdown',
          markdown: { title: 'hip', text: payload.markdown },
        }
      case 'card':
        return {
          msgtype: 'actionCard',
          actionCard: payload.card,
        }
    }
  }
}

/**
 * Parse text-based confirmation reply (for DingTalk fallback when card callbacks unavailable).
 * Returns the mapped action id or undefined if not a confirmation reply.
 */
export function parseTextConfirm(text: string): string | undefined {
  const trimmed = text.trim()
  switch (trimmed) {
    case '1': return 'allow_once'
    case '2': return 'allow_always'
    case '3': return 'reject_once'
    default: return undefined
  }
}
