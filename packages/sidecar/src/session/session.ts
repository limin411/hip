import type { ServerMessage, SessionConfig, AgentRole } from '@hip/protocol'
import { createDeepAgent } from 'deepagents'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import { SUBAGENTS, SUPERVISOR_PROMPT, roleForName } from './agents.js'

type SendFn = (msg: ServerMessage) => void

const DEFAULT_MODEL = 'deepseek-chat'

function buildModel(config: SessionConfig): ChatOpenAI {
  return new ChatOpenAI({
    model: config.model || DEFAULT_MODEL,
    apiKey: process.env.DEEPSEEK_API_KEY || 'sk-missing',
    configuration: {
      baseURL: 'https://api.deepseek.com/v1',
    },
  })
}

export class Session {
  private readonly agent: ReturnType<typeof createDeepAgent>
  private readonly messages: BaseMessage[] = []
  private abortController: AbortController | null = null
  private readonly usesEnvModel: boolean

  constructor(
    readonly id: string,
    readonly config: SessionConfig,
    model?: BaseLanguageModel,
  ) {
    this.usesEnvModel = !model
    this.agent = createDeepAgent({
      model: model ?? buildModel(config),
      systemPrompt: config.systemPrompt ?? SUPERVISOR_PROMPT,
      subagents: SUBAGENTS as unknown as NonNullable<Parameters<typeof createDeepAgent>[0]>['subagents'],
    })
  }

  async sendMessage(content: string, _send: SendFn): Promise<void> {
    if (this.usesEnvModel && !process.env.DEEPSEEK_API_KEY?.trim()) {
      _send({
        type: 'error',
        sessionId: this.id,
        code: 'NO_API_KEY',
        message: 'DeepSeek API key not configured. Set it in Settings.',
      })
      return
    }
    this.messages.push(new HumanMessage(content))
    this.abortController = new AbortController()

    const started = new Set<string>()
    const ensureStarted = (agentId: string, role: AgentRole) => {
      if (started.has(agentId)) return
      started.add(agentId)
      _send({ type: 'agent:started', sessionId: this.id, agentId, role })
    }
    const finishRemaining = () => {
      for (const id of started) _send({ type: 'agent:finished', sessionId: this.id, agentId: id })
      started.clear()
    }

    let supervisorText = ''
    // The supervisor always runs; announce it up front so its card appears even
    // if it delegates without emitting any top-level text of its own.
    ensureStarted('supervisor', 'supervisor')
    try {
      const run = await this.agent.streamEvents(
        { messages: this.messages },
        { version: 'v3', signal: this.abortController.signal },
      )

      const pumpSupervisor = async () => {
        for await (const msg of run.messages) {
          for await (const delta of msg.text) {
            if (!delta) continue
            supervisorText += delta
            _send({ type: 'token:stream', sessionId: this.id, agentId: 'supervisor', delta })
          }
        }
      }

      const pumpSubagents = async () => {
        for await (const sub of run.subagents) {
          const agentId = sub.name
          ensureStarted(agentId, roleForName(sub.name))
          for await (const msg of sub.messages) {
            for await (const delta of msg.text) {
              if (!delta) continue
              _send({ type: 'token:stream', sessionId: this.id, agentId, delta })
            }
          }
          if (started.delete(agentId)) _send({ type: 'agent:finished', sessionId: this.id, agentId })
        }
      }

      await Promise.all([pumpSupervisor(), pumpSubagents()])
      finishRemaining()
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      finishRemaining()
      _send({
        type: 'error',
        sessionId: this.id,
        code: isAbort ? 'CANCELLED' : 'AGENT_ERROR',
        message: isAbort
          ? 'User cancelled the request'
          : err instanceof Error
            ? err.message
            : String(err),
      })
      return
    }

    // Don't append an empty assistant turn — some providers reject an empty
    // assistant message on the next request, corrupting multi-turn history.
    if (supervisorText) this.messages.push(new AIMessage(supervisorText))

    _send({
      type: 'message:complete',
      sessionId: this.id,
      message: {
        id: `asst-supervisor-${Date.now()}`,
        role: 'assistant',
        content: supervisorText,
        agentId: 'supervisor',
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
