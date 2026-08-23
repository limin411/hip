/**
 * IM Gateway unified event contracts and adapter interface.
 * Aligned with openworker's BasePlatformAdapter pattern.
 */

import type { ImPlatform, ImPermissionMode } from '@hip/protocol'

// ── Inbound event (platform → gateway) ────────────────────────────────

/** Unified inbound message event from any IM platform. */
export interface ImMessageEvent {
  connectorId: string
  platform: ImPlatform
  /** Platform message id — used as dedup key. */
  messageId: string
  /** Chat key (wecom DM uses from.userId when chatid is absent). */
  chatId: string
  /** Group name or DM partner name (best-effort). */
  chatName?: string
  chatKind: 'dm' | 'group'
  /** Platform user id (allowlist key). */
  senderId: string
  senderName?: string
  /** Plain text extracted from rich-text / card. */
  text: string
  /** Reply handle (feishu chat_id / wecom req_id / dingtalk sessionWebhook). */
  replyToken: unknown
  /** Card button callback (HITL). */
  interactive?: {
    actionId: string
    cardMessageId?: string
  }
}

// ── Outbound (gateway → platform) ─────────────────────────────────────

/** Chat target for send/updateCard. */
export interface ImChatTarget {
  chatId: string
  chatKind: 'dm' | 'group'
}

/** Outbound payload types. */
export type ImOutbound =
  | { kind: 'text'; text: string }
  | { kind: 'markdown'; markdown: string }
  | { kind: 'card'; card: Record<string, unknown> }

/** Card patch for HITL "processed" update. */
export interface CardPatch {
  processed: boolean
  action?: string
}

/** Result of a send operation. */
export interface SendResult {
  messageId?: string
  ok: boolean
  error?: string
}

// ── Adapter contract ───────────────────────────────────────────────────

/** Every platform adapter must implement this interface. */
export interface BaseImAdapter {
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(chat: ImChatTarget, payload: ImOutbound): Promise<SendResult>
  updateCard(chat: ImChatTarget, cardMessageId: string, patch: CardPatch): Promise<void>
  setMessageHandler(handler: (event: ImMessageEvent) => void): void
}

// ── Gateway context ────────────────────────────────────────────────────

/** Session creation request from the bridge. */
export interface ImSessionCreateRequest {
  sessionId: string
  title: string
  permissionMode: ImPermissionMode
  origin: {
    kind: 'im'
    platform: ImPlatform
    connectorId: string
    chatId: string
    chatName?: string
  }
}

/** Gateway status callback. */
export type GatewayStatusCallback = (
  connectorId: string,
  status: 'disconnected' | 'connecting' | 'connected' | 'error',
  lastError?: string | null,
) => void
