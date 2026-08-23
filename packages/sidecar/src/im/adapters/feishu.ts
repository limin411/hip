/**
 * Feishu (Lark) IM adapter.
 *
 * Uses @larksuiteoapi/node-sdk WSClient for long-connection mode.
 * Handles im.message.receive_v1 and card.action.trigger events.
 *
 * All Lark API calls go through an injected `LarkImClient` interface
 * so tests can mock without hitting the network.
 */

import { AbstractBaseAdapter, type AdapterStatus } from './base.js'
import type { ImMessageEvent, ImChatTarget, ImOutbound, CardPatch, SendResult } from '../types.js'

// ── Injectable Lark client interface (minimal surface) ─────────────────

/** Minimal Lark IM client interface for send/receive operations. */
export interface LarkImClient {
  sendMessage(params: {
    receive_id_type: string
    receive_id: string
    msg_type: string
    content: string
  }): Promise<{ data?: { message_id?: string }; code?: number; msg?: string }>

  patchMessage(params: {
    message_id: string
    content: string
  }): Promise<{ code?: number; msg?: string }>
}

/** Lark WSClient interface for long-connection mode. */
export interface LarkWSClient {
  start(): Promise<void>
  close(): Promise<void>
  on(event: string, handler: (...args: unknown[]) => void): void
}

/** Lark EventDispatcher interface. */
export interface LarkEventDispatcher {
  register(event: string, handler: (data: unknown) => void): void
  registerCardAction(handler: (data: unknown) => void): void
}

// ── Feishu Adapter ─────────────────────────────────────────────────────

export interface FeishuAdapterConfig {
  connectorId: string
  appId: string
  appSecret: string
}

/**
 * Feishu adapter. Inject `larkClient` and `wsClient`/`eventDispatcher` for testing.
 * In production, the gateway creates real Lark SDK instances.
 */
export class FeishuAdapter extends AbstractBaseAdapter {
  private wsClient?: LarkWSClient
  private larkClient?: LarkImClient
  private eventDispatcher?: LarkEventDispatcher
  private readonly connectorId: string

  constructor(
    private readonly config: FeishuAdapterConfig,
    opts?: {
      larkClient?: LarkImClient
      wsClient?: LarkWSClient
      eventDispatcher?: LarkEventDispatcher
    },
  ) {
    super()
    this.connectorId = config.connectorId
    this.larkClient = opts?.larkClient
    this.wsClient = opts?.wsClient
    this.eventDispatcher = opts?.eventDispatcher
  }

  async connect(): Promise<void> {
    this.setStatus('connecting')
    try {
      if (!this.wsClient || !this.eventDispatcher) {
        throw new Error('Lark WSClient not configured — inject wsClient and eventDispatcher')
      }

      // Register event handlers
      this.eventDispatcher.register('im.message.receive_v1', (data: unknown) => {
        this.handleMessageEvent(data)
      })
      this.eventDispatcher.registerCardAction((data: unknown) => {
        this.handleCardAction(data)
      })

      // Start long-connection
      await this.wsClient.start()
      this.setStatus('connected')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus('error', msg)
      throw err
    }
  }

  protected async doDisconnect(): Promise<void> {
    if (this.wsClient) {
      try {
        await this.wsClient.close()
      } catch {
        /* best-effort */
      }
    }
  }

  async send(chat: ImChatTarget, payload: ImOutbound): Promise<SendResult> {
    if (!this.larkClient) {
      return { ok: false, error: 'Lark client not configured' }
    }

    try {
      const { msg_type, content } = this.buildMessagePayload(payload)
      const res = await this.larkClient.sendMessage({
        receive_id_type: 'chat_id',
        receive_id: chat.chatId,
        msg_type,
        content,
      })

      if (res.code && res.code !== 0) {
        return { ok: false, error: res.msg || `Lark error code ${res.code}` }
      }
      return { ok: true, messageId: res.data?.message_id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async updateCard(chat: ImChatTarget, cardMessageId: string, patch: CardPatch): Promise<void> {
    if (!this.larkClient) return

    const content = JSON.stringify({
      type: 'template',
      data: {
        template_id: 'processed_card',
        template_variable: {
          processed: patch.processed,
          action: patch.action ?? '',
        },
      },
    })

    try {
      await this.larkClient.patchMessage({
        message_id: cardMessageId,
        content,
      })
    } catch {
      /* best-effort card update */
    }
  }

  // ── Event handlers ─────────────────────────────────────────────────

  /** Handle im.message.receive_v1 event from Lark. */
  private handleMessageEvent(data: unknown): void {
    try {
      const raw = data as Record<string, unknown>
      const event = raw.event as Record<string, unknown> | undefined
      if (!event) return

      const message = event.message as Record<string, unknown> | undefined
      if (!message) return

      const messageId = String(message.message_id ?? '')
      const chatId = String(message.chat_id ?? '')
      const chatType = String(message.chat_type ?? '')
      const sender = event.sender as Record<string, unknown> | undefined
      const senderIdObj = sender?.sender_id as Record<string, unknown> | undefined
      const senderId = String(senderIdObj?.open_id ?? senderIdObj?.user_id ?? '')
      const senderName = String(senderIdObj?.name ?? '')

      // Extract text from content
      const content = typeof message.content === 'string'
        ? JSON.parse(message.content)
        : message.content
      const text = String((content as Record<string, unknown>)?.text ?? '')

      // Determine chat kind
      const chatKind: 'dm' | 'group' = chatType === 'p2p' ? 'dm' : 'group'

      const event_: ImMessageEvent = {
        connectorId: this.connectorId,
        platform: 'feishu',
        messageId,
        chatId,
        chatKind,
        senderId,
        senderName: senderName || undefined,
        text,
        replyToken: chatId, // Feishu uses chat_id as reply handle
      }

      this.emitMessage(event_)
    } catch {
      /* silently drop malformed events — Feishu will retry */
    }
  }

  /** Handle card.action.trigger event (HITL button clicks). */
  private handleCardAction(data: unknown): void {
    try {
      const raw = data as Record<string, unknown>
      const event = raw.event as Record<string, unknown> | undefined
      if (!event) return

      const action = event.action as Record<string, unknown> | undefined
      const actionId = String(action?.value ?? action?.action_id ?? '')
      const operator = event.operator as Record<string, unknown> | undefined
      const senderId = String(operator?.open_id ?? '')
      const context = event?.context as Record<string, unknown> | undefined
      const messageId = String(raw.message_id ?? context?.message_id ?? '')
      const chatId = String(context?.open_chat_id ?? '')

      if (!actionId || !senderId) return

      const event_: ImMessageEvent = {
        connectorId: this.connectorId,
        platform: 'feishu',
        messageId: `card:${messageId}:${actionId}`,
        chatId,
        chatKind: 'dm', // Card actions default to DM context
        senderId,
        text: '',
        replyToken: chatId,
        interactive: {
          actionId,
          cardMessageId: messageId,
        },
      }

      this.emitMessage(event_)
    } catch {
      /* silently drop malformed card events */
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private buildMessagePayload(payload: ImOutbound): { msg_type: string; content: string } {
    switch (payload.kind) {
      case 'text':
        return { msg_type: 'text', content: JSON.stringify({ text: payload.text }) }
      case 'markdown':
        // Feishu uses post type for markdown-like content
        return {
          msg_type: 'post',
          content: JSON.stringify({
            zh_cn: {
              title: '',
              content: [[{ tag: 'text', text: payload.markdown }]],
            },
          }),
        }
      case 'card':
        return { msg_type: 'interactive', content: JSON.stringify(payload.card) }
    }
  }
}
