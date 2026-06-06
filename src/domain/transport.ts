// src/domain/transport.ts
import type { ClientMessage, ServerMessage } from '@hip/protocol'

/** mock 与真后端共用的可替换缝。facade 只依赖这个接口。 */
export interface Transport {
  connect(): Promise<void>
  disconnect(): void
  send(msg: ClientMessage): void
  /** 注册入站 ServerMessage 处理器；返回取消订阅函数。 */
  onMessage(handler: (msg: ServerMessage) => void): () => void
}
