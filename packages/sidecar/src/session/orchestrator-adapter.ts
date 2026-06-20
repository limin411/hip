import type { StructuredToolInterface } from '@langchain/core/tools'
import type { PermissionMode, SkillMeta } from '@hip/protocol'
import type { NodeOutput } from '@hip/protocol'
import type { AgentRunner, AgentRunRequest } from '../orchestrator/ports.js'
import type { GraphEmit } from './graph.js'
import type { ApprovalFn } from './tools.js'
import type { AgentInvoker, InvokerExtras } from './agents/invoker.js'
import type { ExternalAgentHooks, PermissionChoice } from './agents/types.js'

/** Signature for the worker subagent runner (task-tool depth-1 subagent). */
export type RunSubagentFn = (input: string, signal: AbortSignal) => Promise<string>

/** Optional knobs threaded through to the invoker (MCP tools, skills, approval seam, permission mode). */
export interface SessionAgentRunnerOpts {
  mcpTools?: StructuredToolInterface[]
  skills?: SkillMeta[]
  requestApproval?: ApprovalFn
  permissionMode?: PermissionMode
}

/**
 * Create an AgentRunner backed by the session's AgentInvoker.
 *
 * The orchestrator (batch DAG) does not stream UI events, so we supply a no-op
 * `GraphEmit` and auto-reject any HITL permission requests that an external agent
 * might attempt in this context.
 *
 * @param cwd               Working directory for file-tool paths.
 * @param invokerFactory    Creates an AgentInvoker (typically `createAgentInvoker`).
 * @param subagentRunner    Optional: if set, `agentId === 'worker'` delegates here
 *                          instead of the invoker (depth-1 task subagent).
 * @param opts              Optional extras threaded to the invoker on each run.
 */
export function createSessionAgentRunner(
  cwd: string,
  invokerFactory: (cwd: string) => AgentInvoker,
  subagentRunner?: RunSubagentFn,
  opts?: SessionAgentRunnerOpts,
): AgentRunner {
  const invoker = invokerFactory(cwd)

  return {
    async run(req: AgentRunRequest, signal: AbortSignal): Promise<NodeOutput> {
      // Respect an already-aborted signal at entry.
      if (signal.aborted) {
        const e: NodeJS.ErrnoException = new Error('aborted')
        e.name = 'AbortError'
        throw e
      }

      // Worker-agent shortcut — depth-1 task subagent, not an external provider.
      if (req.agentId === 'worker') {
        if (!subagentRunner) throw new Error('worker subagent runner not configured')
        const text = await subagentRunner(req.input.text, signal)
        return { text, data: req.input.data }
      }

      // No-op emit — batch DAG, no streaming card to feed.
      const noopEmit: GraphEmit = {
        token: () => {},
        reasoning: () => {},
        toolStarted: () => {},
        toolFinished: () => {},
        usage: () => {},
        planDelta: () => {},
      }

      // Auto-reject HITL — orchestrator nodes cannot block waiting for user feedback.
      const hooks: ExternalAgentHooks = {
        requestPermission: async (_req): Promise<PermissionChoice> => ({ cancelled: true }),
        configOptions: () => {},
      }

      const extras: InvokerExtras | undefined =
        opts
          ? {
              mcpTools: opts.mcpTools,
              skills: opts.skills,
              requestApproval: opts.requestApproval,
              permissionMode: opts.permissionMode,
            }
          : undefined

      // The invoker handles agent lookup and throws for unknown/disabled agents.
      const text = await invoker.invoke(req.agentId, req.input.text, noopEmit, signal, hooks, extras)
      return { text, data: req.input.data }
    },
  }
}
