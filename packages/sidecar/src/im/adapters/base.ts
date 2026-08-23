/**
 * Base IM adapter with shared lifecycle patterns.
 * Each platform adapter extends this and implements platform-specific logic.
 */

import type { BaseImAdapter, ImMessageEvent, ImChatTarget, ImOutbound, CardPatch, SendResult } from '../types.js'

export type AdapterStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type StatusChangeHandler = (status: AdapterStatus, error?: string | null) => void

/**
 * Abstract base adapter. Provides:
 * - Message handler registration
 * - Status tracking with change callback
 * - Idempotent disconnect
 */
export abstract class AbstractBaseAdapter implements BaseImAdapter {
  private messageHandler?: (event: ImMessageEvent) => void
  private statusChangeHandler?: StatusChangeHandler
  private _status: AdapterStatus = 'disconnected'
  private _disconnecting = false

  get status(): AdapterStatus {
    return this._status
  }

  setMessageHandler(handler: (event: ImMessageEvent) => void): void {
    this.messageHandler = handler
  }

  /** Register a status change callback (used by gateway). */
  onStatusChange(handler: StatusChangeHandler): void {
    this.statusChangeHandler = handler
  }

  /** Emit an inbound message event to the registered handler. */
  protected emitMessage(event: ImMessageEvent): void {
    this.messageHandler?.(event)
  }

  /** Update adapter status and notify. */
  protected setStatus(status: AdapterStatus, error?: string | null): void {
    if (this._status === status) return
    this._status = status
    this.statusChangeHandler?.(status, error)
  }

  /** Idempotent disconnect — safe to call multiple times. */
  async disconnect(): Promise<void> {
    if (this._disconnecting) return
    this._disconnecting = true
    try {
      await this.doDisconnect()
    } finally {
      this._disconnecting = false
      this.setStatus('disconnected')
    }
  }

  /** Platform-specific disconnect logic. */
  protected abstract doDisconnect(): Promise<void>

  /** Platform-specific connect logic. */
  abstract connect(): Promise<void>

  /** Platform-specific send logic. */
  abstract send(chat: ImChatTarget, payload: ImOutbound): Promise<SendResult>

  /** Platform-specific card update logic. */
  abstract updateCard(chat: ImChatTarget, cardMessageId: string, patch: CardPatch): Promise<void>
}
