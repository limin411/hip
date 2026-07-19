import type { SessionConfig } from '@hip/protocol'
import type { SessionStore } from '../persistence/store.js'
import { readAgentsConfig } from './agents/index.js'
import { createAgentProvider, type AgentProvider } from './agents/index.js'
import type { AgentInvoker } from './agents/invoker.js'

export class AgentProviderManager {
  private externalProvider: AgentProvider | null = null

  constructor(
    private readonly sessionId: string,
    private readonly store: SessionStore | undefined,
    private readonly getConfig: () => SessionConfig,
    private readonly invokerFactory: (cwd: string) => AgentInvoker,
  ) {}

  /** True when this session routes turns to an external agent rather than the built-in graph. */
  isExternalAgent(): boolean {
    const a = this.getConfig().agentId
    return !!a && a !== 'builtin'
  }

  /** Lazily build (and cache) the provider for this session's external agent. Throws on an unknown id. */
  ensureExternalProvider(): AgentProvider {
    if (!this.externalProvider) {
      const config = this.getConfig()
      const agent = readAgentsConfig(config.cwd ?? process.cwd()).find((x) => x.id === config.agentId)
      if (!agent) throw new Error(`Unknown agent: ${config.agentId}`)
      const model = null
      const resume = this.store?.getAcpSessionId(this.sessionId) ?? null
      this.externalProvider = createAgentProvider(agent, config.cwd ?? process.cwd(), model)
      ;(this.externalProvider as { setResumeSessionId?: (id: string | null) => void }).setResumeSessionId?.(resume)
    }
    return this.externalProvider
  }

  /** Drive the external agent's live model/mode selector (ACP control-plane). No-op for inline/custom agents. */
  async setAgentConfigOption(configId: string, value: string): Promise<void> {
    await this.externalProvider?.setConfigOption?.(configId, value)
  }

  /** Dispose the cached external provider (awaits ACP session/close when applicable). */
  async dispose(): Promise<void> {
    await this.externalProvider?.dispose()
    this.externalProvider = null
  }

  /** Get the ACP session ID for persistence. */
  get acpSessionId(): string | null | undefined {
    return (this.externalProvider as { sessionId?: string | null })?.sessionId
  }

  /** Get the invoker factory (for creating per-turn AgentInvoker instances). */
  get invoker(): (cwd: string) => AgentInvoker {
    return this.invokerFactory
  }
}
