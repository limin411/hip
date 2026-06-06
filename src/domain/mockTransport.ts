// src/domain/mockTransport.ts
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { tokenize } from '@/lib/stream'
import { CANNED_REPLY } from '@/mock/messages'
import type { Transport } from './transport'

let replySeq = 0

export class MockTransport implements Transport {
  private readonly handlers = new Set<(m: ServerMessage) => void>()
  private timers: ReturnType<typeof setTimeout>[] = []

  async connect(): Promise<void> {
    // 会话列表已 seed 进 domain store；mock 无需回放历史。
  }

  disconnect(): void {
    this.timers.forEach((t) => clearTimeout(t))
    this.timers = []
  }

  onMessage(handler: (m: ServerMessage) => void): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  send(msg: ClientMessage): void {
    if (msg.type === 'message:send') this.runTimeline(msg.sessionId)
    // session:create / session:destroy / message:cancel 对 mock 无副作用
  }

  private emit(m: ServerMessage): void {
    this.handlers.forEach((h) => h(m))
  }

  private at(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms))
  }

  private runTimeline(sessionId: string): void {
    this.timers.forEach((t) => clearTimeout(t))
    this.timers = []

    // t0：supervisor 立即开始
    this.emit({ type: 'agent:started', sessionId, agentId: 'a0', role: 'supervisor' })

    this.at(300, () => {
      this.emit({ type: 'agent:started', sessionId, agentId: 'a1', role: 'planner' })
      this.emit({ type: 'token:stream', sessionId, agentId: 'a1', delta: '拆解任务边界：3 个子模块。' })
    })
    this.at(600, () => {
      this.emit({ type: 'agent:started', sessionId, agentId: 'a2', role: 'coder' })
      this.emit({ type: 'token:stream', sessionId, agentId: 'a2', delta: '生成实现代码与组合层。' })
    })
    this.at(900, () => {
      this.emit({ type: 'agent:started', sessionId, agentId: 'a3', role: 'reviewer' })
      this.emit({ type: 'token:stream', sessionId, agentId: 'a3', delta: '审查边界条件与正确性。' })
    })

    // 助手回复作为 supervisor(a0) token 流（聊天区据此逐字流式）
    const chunks = tokenize(CANNED_REPLY, 2)
    chunks.forEach((chunk, i) => {
      this.at(1000 + i * 28, () => this.emit({ type: 'token:stream', sessionId, agentId: 'a0', delta: chunk }))
    })

    this.at(2000, () => this.emit({ type: 'agent:finished', sessionId, agentId: 'a1' }))
    this.at(2400, () => this.emit({ type: 'agent:finished', sessionId, agentId: 'a3' }))

    const total = 1000 + chunks.length * 28
    this.at(total + 100, () => this.emit({ type: 'agent:finished', sessionId, agentId: 'a0' }))
    this.at(total + 200, () => {
      this.emit({ type: 'agent:finished', sessionId, agentId: 'a2' })
      this.emit({
        type: 'message:complete',
        sessionId,
        message: { id: `a-${(replySeq += 1)}`, role: 'assistant', content: CANNED_REPLY, agentId: 'a0', timestamp: replySeq },
      })
    })
  }
}
