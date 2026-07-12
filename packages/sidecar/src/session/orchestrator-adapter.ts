import type { StructuredToolInterface } from '@langchain/core/tools'
import type { PermissionMode, SkillMeta } from '@hip/protocol'
import type { NodeOutput } from '@hip/protocol'
import type { AgentRunner, AgentRunRequest } from '../orchestrator/ports.js'
import type { GraphEmit } from './graph.js'
import type { ApprovalFn } from './tools.js'
import type { AgentInvoker, InvokerExtras } from './agents/invoker.js'
import type { ExternalAgentHooks, PermissionChoice } from './agents/types.js'
import type { HookRegistry } from './hooks/registry.js'

/** Signature for the worker subagent runner (task-tool depth-1 subagent or workflow node). */
export type RunSubagentFn = (input: string, signal: AbortSignal, nodeId?: string) => Promise<string>

/** Optional knobs threaded through to the invoker (MCP tools, skills, approval seam, permission mode). */
export interface SessionAgentRunnerOpts {
  mcpTools?: StructuredToolInterface[]
  skills?: SkillMeta[]
  requestApproval?: ApprovalFn
  permissionMode?: PermissionMode
  emit?: (nodeId: string) => GraphEmit
  /**
   * Session plugin HookRegistry for internal-loop tool interception.
   * Distinct from ExternalAgentHooks used for ACP permission bridges.
   */
  pluginHooks?: HookRegistry
  sessionId?: string
  runId?: string
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
        const text = await subagentRunner(req.input.text, signal, req.nodeId)
        return { text, data: req.input.data }
      }

      // No-op emit fallback — used when the caller does not supply a per-node emit factory.
      const noopEmit: GraphEmit = {
        token: () => {},
        reasoning: () => {},
        toolStarted: () => {},
        toolFinished: () => {},
        usage: () => {},
        planDelta: () => {},
        compaction: () => {},
      }
      const emit = opts?.emit?.(req.nodeId) ?? noopEmit

      // Auto-reject HITL — orchestrator nodes cannot block waiting for user feedback.
      // This is ExternalAgentHooks (ACP), not the plugin HookRegistry.
      const externalHooks: ExternalAgentHooks = {
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
              sessionId: opts.sessionId,
              pluginHooks: opts.pluginHooks,
              runId: opts.runId ?? req.runId,
              nodeId: req.nodeId,
              agentId: req.agentId,
              parentAgentId: 'supervisor',
            }
          : {
              pluginHooks: undefined,
              runId: req.runId,
              nodeId: req.nodeId,
              agentId: req.agentId,
              parentAgentId: 'supervisor',
            }

      // The invoker handles agent lookup and throws for unknown/disabled agents.
      const text = await invoker.invoke(req.agentId, req.input.text, emit, signal, externalHooks, extras)
      return { text, data: req.input.data }
    },
  }
}
