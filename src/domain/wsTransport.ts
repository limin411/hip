// src/domain/wsTransport.ts
import { invoke } from '@tauri-apps/api/core'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { wsClient } from '@/ipc/ws-client'
import type { Transport } from './transport'

async function getSidecarPort(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const port = await invoke<number | null>('get_sidecar_port')
    if (port !== null) return port
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('sidecar port not available after 10 s')
}

/** 真后端缝。日后把 sessionService 单例从 MockTransport 换成它即可。 */
export class WsTransport implements Transport {
  async connect(): Promise<void> {
    const port = await getSidecarPort()
    await wsClient.connect(port)
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
}
