/**
 * WeCom (Enterprise WeChat) IM adapter.
 *
 * Uses bare WebSocket to connect to wss://openws.work.weixin.qq.com.
 * Protocol: aibot_subscribe → aibot_msg_callback / aibot_event_callback.
 * Sends via aibot_respond_msg / aibot_respond_update_msg.
 * 30-second heartbeat; single connection per bot (platform kicks old connection).
 *
 * All WS operations go through an injectable `WebSocketLike` interface for testing.
 */

import { AbstractBaseAdapter } from './base.js'
import type { ImMessageEvent, ImChatTarget, ImOutbound, CardPatch, SendResult } from '../types.js'

// ── Injectable WebSocket interface ─────────────────────────────────────

export interface WebSocketLike {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onclose: (() => void) | null
  onerror: ((err: unknown) => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  readyState: number
}

export const WS_OPEN = 1

export interface WecomAdapterConfig {
  connectorId: string
  botId: string
  secret: string
}

export class WecomAdapter extends AbstractBaseAdapter {
  private ws?: WebSocketLike
  private heartbeatTimer?: ReturnType<typeof setInterval>
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private readonly connectorId: string
  private wsFactory: (url: string) => WebSocketLike

  constructor(
    private readonly config: WecomAdapterConfig,
    opts?: { wsFactory?: (url: string) => WebSocketLike },
  ) {
    super()
    this.connectorId = config.connectorId
    this.wsFactory = opts?.wsFactory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike)
  }

  async connect(): Promise<void> {
    this.setStatus('connecting')
    try {
      const ws = this.wsFactory('wss://openws.work.weixin.qq.com')
      this.ws = ws

      ws.onopen = () => {
        // Subscribe to bot messages
        ws.send(JSON.stringify({
          action: 'aibot_subscribe',
          botid: this.config.botId,
          secret: this.config.secret,
        }))
      }

      ws.onmessage = (ev) => {
        this.handleRawMessage(ev.data)
      }

      ws.onerror = () => {
        this.setStatus('error', 'WebSocket error')
      }

      ws.onclose = () => {
        this.stopHeartbeat()
        this.setStatus('disconnected')
        // Auto-reconnect with backoff
        this.scheduleReconnect()
      }

      // Start heartbeat after connection
      this.startHeartbeat()
      this.setStatus('connected')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus('error', msg)
      throw err
    }
  }

  protected async doDisconnect(): Promise<void> {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    if (this.ws) {
      try { this.ws.close() } catch { /* best-effort */ }
      this.ws = undefined
    }
  }

  async send(chat: ImChatTarget, payload: ImOutbound): Promise<SendResult> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      return { ok: false, error: 'WebSocket not connected' }
    }

    try {
      const msg = this.buildRespondMessage(chat, payload)
      this.ws.send(JSON.stringify(msg))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async updateCard(chat: ImChatTarget, cardMessageId: string, patch: CardPatch): Promise<void> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return

    this.ws.send(JSON.stringify({
      action: 'aibot_respond_update_msg',
      msgid: cardMessageId,
      botid: this.config.botId,
      content: JSON.stringify({
        card: {
          processed: patch.processed,
          action: patch.action ?? '',
        },
      }),
    }))
  }

  // ── Message handling ───────────────────────────────────────────────

  private handleRawMessage(data: string): void {
    try {
      const msg = JSON.parse(data)
      switch (msg.action) {
        case 'aibot_subscribe_ack':
          // Subscription confirmed
          break
        case 'aibot_msg_callback':
          this.handleInboundMessage(msg)
          break
        case 'aibot_event_callback':
          this.handleCardEvent(msg)
          break
      }
    } catch {
      /* silently drop malformed messages */
    }
  }

  private handleInboundMessage(msg: Record<string, unknown>): void {
    const msgId = String(msg.msgid ?? msg.req_id ?? '')
    const fromUser = msg.from as Record<string, unknown> | undefined
    const senderId = String(fromUser?.userid ?? '')
    const senderName = String(fromUser?.name ?? '')
    const chatId = String(msg.chatid ?? `dm:${senderId}`)
    const chatKind = msg.chatid ? 'group' as const : 'dm' as const
    const chatName = String(msg.chatname ?? (chatKind === 'dm' ? senderName : ''))
    const text = String(msg.content ?? '')

    if (!msgId || !senderId) return

    const event: ImMessageEvent = {
      connectorId: this.connectorId,
      platform: 'wecom',
      messageId: msgId,
      chatId,
      chatName: chatName || undefined,
      chatKind,
      senderId,
      senderName: senderName || undefined,
      text,
      replyToken: msg.req_id ?? msgId,
    }

    this.emitMessage(event)
  }

  private handleCardEvent(msg: Record<string, unknown>): void {
    const actionId = String(msg.action_id ?? '')
    const senderId = String(msg.operator_userid ?? '')
    const msgId = String(msg.msgid ?? '')
    const chatId = String(msg.chatid ?? `dm:${senderId}`)

    if (!actionId || !senderId) return

    const event: ImMessageEvent = {
      connectorId: this.connectorId,
      platform: 'wecom',
      messageId: `card:${msgId}:${actionId}`,
      chatId,
      chatKind: msg.chatid ? 'group' as const : 'dm' as const,
      senderId,
      text: '',
      replyToken: msg.req_id ?? msgId,
      interactive: {
        actionId,
        cardMessageId: msgId,
      },
    }

    this.emitMessage(event)
  }

  // ── Outbound message building ─────────────────────────────────────

  private buildRespondMessage(chat: ImChatTarget, payload: ImOutbound): Record<string, unknown> {
    const base = {
      action: 'aibot_respond_msg',
      botid: this.config.botId,
    }

    switch (payload.kind) {
      case 'text':
        return { ...base, msgtype: 'text', content: payload.text }
      case 'markdown':
        return { ...base, msgtype: 'markdown', content: payload.markdown }
      case 'card':
        return { ...base, msgtype: 'template', content: JSON.stringify(payload.card) }
    }
  }

  // ── Heartbeat ─────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WS_OPEN) {
        try {
          this.ws.send(JSON.stringify({ action: 'ping' }))
        } catch {
          /* heartbeat failure — onclose will trigger reconnect */
        }
      }
    }, 30_000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.connect().catch(() => {})
    }, 5000)
  }
}
