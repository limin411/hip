// src/domain/wsTransport.ts
import { invoke } from '@tauri-apps/api/core'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
// 注意：wsClient 是模块级单例；多个 WsTransport 实例会共享同一连接（接 live 时若需多实例须重构）。
import { wsClient } from '@/ipc/ws-client'
import type { Transport, ConnectionStatus } from './transport'

interface SidecarInfo { port: number; token: string }

async function getSidecarInfo(): Promise<SidecarInfo> {
  for (let i = 0; i < 20; i++) {
    const info = await invoke<SidecarInfo | null>('get_sidecar_info')
    if (info) return info
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('sidecar info not available after 10 s')
}

/** WsTransport: WebSocket implementation between the domain layer and the live sidecar. */
export class WsTransport implements Transport {
  connect(): Promise<void> {
    return wsClient.start(getSidecarInfo)
  }
  disconnect(): void {
    wsClient.disconnect()
  }
  send(msg: ClientMessage): void {
    wsClient.send(msg)
  }
  onMessage(handler: (m: ServerMessage) => void): () => void {
    return wsClient.onMessage(handler)
  }
  onStatus(handler: (s: ConnectionStatus) => void): () => void {
    return wsClient.onStatus(handler)
  }
}
