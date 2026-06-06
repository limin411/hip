import type { ServerMessage, SessionConfig, AgentRole } from '@hip/protocol'
import { createDeepAgent } from 'deepagents'
import { ChatOpenAI } from '@langchain/openai'

type SendFn = (msg: ServerMessage) => void

const DEFAULT_MODEL = 'deepseek-chat'
const AGENT_ID = 'deepagent'
const AGENT_ROLE: AgentRole = 'supervisor'

function buildModel(config: SessionConfig): ChatOpenAI {
  return new ChatOpenAI({
    model: config.model || DEFAULT_MODEL,
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: {
      baseURL: 'https://api.deepseek.com/v1',
    },
  })
}

export class Session {
  private readonly agent: ReturnType<typeof createDeepAgent>
  private abortController: AbortController | null = null

  constructor(
    readonly id: string,
    readonly config: SessionConfig,
  ) {
    this.agent = createDeepAgent({
      model: buildModel(config),
      systemPrompt: config.systemPrompt ?? 'You are a helpful coding assistant.',
    })
  }

  async sendMessage(content: string, _send: SendFn): Promise<void> {
    this.abortController = new AbortController()
    let fullContent = ''

    _send({
      type: 'agent:started',
      sessionId: this.id,
      agentId: AGENT_ID,
      role: AGENT_ROLE,
    })

    try {
      const run = await this.agent.streamEvents(
        { messages: [{ role: 'user' as const, content }] },
        { version: 'v3' },
      )

      for await (const msg of run.messages) {
        for await (const token of msg.text) {
          fullContent += token
          _send({
            type: 'token:stream',
            sessionId: this.id,
            agentId: AGENT_ID,
            delta: token,
          })
        }
      }

      _send({
        type: 'agent:finished',
        sessionId: this.id,
        agentId: AGENT_ID,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return

      _send({
        type: 'error',
        sessionId: this.id,
        code: 'AGENT_ERROR',
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    _send({
      type: 'message:complete',
      sessionId: this.id,
      message: {
        id: `asst-${AGENT_ID}-${Date.now()}`,
        role: 'assistant',
        content: fullContent,
        agentId: AGENT_ID,
        timestamp: Date.now(),
      },
    })
  }

  cancel(): void {
    this.abortController?.abort()
  }

  destroy(): void {
    this.cancel()
  }
}
