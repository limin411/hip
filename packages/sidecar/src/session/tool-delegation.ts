import type { ToolRunner } from './tool-runner/tool-runner.js'

export interface ToolDelegateOptions {
  /** Whether delegation is enabled for this agent. Default false (opt-in). */
  enabled: boolean
  /** Optional whitelist of tool names that may be delegated. */
  allowedTools?: string[]
}

const BLOCKED_TOOLS = new Set(['dispatch_agent', 'task'])

/**
 * Allows an ACP external agent to call back into hip's local tool system.
 *
 * The delegate is opt-in ({@link ToolDelegateOptions.enabled} defaults to false).
 * Before routing any tool call, the agent must be explicitly marked ready via
 * {@link markReady}. Anti-recursion rules reject the `dispatch_agent` and `task`
 * tools regardless of configuration.
 */
export class ToolDelegate {
  private readonly readyAgents = new Set<string>()
  private callCounter = 0

  constructor(
    private readonly opts: ToolDelegateOptions,
    private readonly toolRunner: ToolRunner,
  ) {}

  async invokeTool(
    agentId: string,
    toolCall: { name: string; input: Record<string, unknown> },
  ): Promise<{ output: string; error?: string }> {
    if (!this.opts.enabled) {
      return { output: '', error: 'delegation not enabled' }
    }

    if (!this.isReady(agentId)) {
      return { output: '', error: 'agent not ready' }
    }

    const { name, input } = toolCall

    if (BLOCKED_TOOLS.has(name)) {
      return { output: '', error: `tool "${name}" cannot be delegated` }
    }

    if (this.opts.allowedTools !== undefined && !this.opts.allowedTools.includes(name)) {
      return { output: '', error: `tool "${name}" is not allowed for delegation` }
    }

    const callId = this.makeCallId(agentId, name)

    try {
      const result = await this.toolRunner.runToolCall({
        name,
        callId,
        args: input,
      })

      // ToolRunner encodes execution failures as `Error: <reason>` content.
      if (result.content.startsWith('Error: ')) {
        return { output: '', error: result.content.slice('Error: '.length) }
      }

      return { output: result.content }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { output: '', error: message }
    }
  }

  markReady(agentId: string): void {
    this.readyAgents.add(agentId)
  }

  markUnready(agentId: string): void {
    this.readyAgents.delete(agentId)
  }

  isReady(agentId: string): boolean {
    return this.readyAgents.has(agentId)
  }

  private makeCallId(agentId: string, toolName: string): string {
    const n = ++this.callCounter
    return `delegate:${agentId}:${toolName}:${n}`
  }
}
