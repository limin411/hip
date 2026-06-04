import type { ServerMessage, SessionConfig } from '@hip/protocol'
import { buildAgentGraph } from '../graph/builder.js'

type SendFn = (msg: ServerMessage) => void

export class Session {
  private readonly graph: ReturnType<typeof buildAgentGraph>
  private abortController: AbortController | null = null

  constructor(
    readonly id: string,
    readonly config: SessionConfig,
  ) {
    this.graph = buildAgentGraph(config)
  }

  async sendMessage(content: string, _send: SendFn): Promise<void> {
    this.abortController = new AbortController()
    // TODO: iterate this.graph.streamEvents() and call _send() for each
    // agent:started / token:stream / agent:finished / message:complete event
    void content
  }

  cancel(): void {
    this.abortController?.abort()
  }

  destroy(): void {
    this.cancel()
  }
}
