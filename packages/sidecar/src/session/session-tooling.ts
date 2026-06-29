import type { StructuredToolInterface } from '@langchain/core/tools'
import type { PermissionMode, SkillMeta, McpServerConfig, AgentConfig } from '@hip/protocol'
import { ToolRegistry, createScope } from './tool-registry.js'
import { mcpManager, DEFAULT_LAZY_THRESHOLD } from './mcp/manager.js'
import { buildTools, SELF_GATED_TOOLS, type ApprovalFn, type DispatchSpec } from './tools.js'
import { ToolRunner } from './tool-runner/tool-runner.js'
import { defaultToolPolicy } from './tool-runner/tool-policy.js'
import { SessionApprovalCache } from './tool-runner/approval-cache.js'
import { ToolOutputStore } from './tool-output-store.js'
import type { NetworkPolicy } from './network-policy.js'
import { GuardianReviewer } from './guardian.js'
import type { HookRegistry } from './hooks/registry.js'
import type { ModelRunner } from './model-runner.js'
import type { GoalManager } from './goal.js'
import { buildGoalTools } from './tools/goal.js'
import type { CronManager } from './cron.js'
import { buildCronTools } from './cron.js'
export interface SessionTooling {
  tools: StructuredToolInterface[]
  toolRunner: ToolRunner
  cleanup(): void
}

export interface BuildSessionToolingInput {
  cwd: string
  sessionId: string
  mode: PermissionMode
  skills: SkillMeta[]
  mcpConfigs: McpServerConfig[]
  enabledAgents: AgentConfig[]
  dispatch?: DispatchSpec
  spawnSubagent: (description: string, mode?: 'foreground' | 'background', taskId?: string, signal?: AbortSignal) => Promise<string>
  retrySubagent?: (agentId: string) => Promise<string>
  stopBackgroundTask?: (taskId: string, reason?: string) => string
  getBackgroundTaskOutput?: (taskId: string) => string
  hooks: HookRegistry
  approvalCache: SessionApprovalCache
  requestApproval?: ApprovalFn
  allowedTools?: string[]
  blockedTools?: string[]
  usesEnvModel: boolean
  runner: ModelRunner
  toolOutputStore?: ToolOutputStore
  networkPolicy: NetworkPolicy
  guardianReviewer?: GuardianReviewer
  onToolStarted: (name: string, callId: string, input: unknown) => void
  onToolFinished: (callId: string, status: 'finished' | 'error', output?: string, error?: string) => void
  emitRisk: (toolName: string, risk: 'low' | 'medium' | 'high', approval: string) => void
  goalManager?: GoalManager
  cronManager?: CronManager
}

export async function buildSessionTooling(input: BuildSessionToolingInput): Promise<SessionTooling> {
  await mcpManager.reconcile(input.mcpConfigs)

  const registry = new ToolRegistry()
  const scope = createScope()
  const builtInTools = buildTools(
    input.cwd,
    input.spawnSubagent,
    undefined,
    input.dispatch,
    {
      mcpTools: mcpManager.tools(input.usesEnvModel ? { lazyThreshold: DEFAULT_LAZY_THRESHOLD } : undefined),
      skills: input.skills,
      requestApproval: input.requestApproval,
      permissionMode: input.mode,
      webSearchEnabled: true,
      generateAgentEnabled: true,
      sessionId: input.sessionId,
      allowedTools: input.allowedTools,
      blockedTools: input.blockedTools,
      networkPolicy: input.networkPolicy,
    },
    input.retrySubagent,
    input.stopBackgroundTask,
    input.getBackgroundTaskOutput,
  )
  for (const t of builtInTools) {
    registry.register(t)
  }
  if (input.goalManager) {
    const goalTools = buildGoalTools(input.goalManager)
    for (const t of goalTools) {
      registry.register(t)
    }
  }
  if (input.cronManager) {
    const cronTools = buildCronTools(input.cronManager)
    for (const t of cronTools) {
      registry.register(t)
    }
  }
  mcpManager.registerWithRegistry?.(registry, scope)

  const materialization = registry.materialize({
    allowed: input.allowedTools,
    blocked: input.blockedTools,
  })

  const toolRunner = new ToolRunner({
    tools: new Map(materialization.definitions.map((t) => [t.name, t])),
    hooks: input.hooks,
    toolPolicy: defaultToolPolicy({ selfGatedTools: SELF_GATED_TOOLS }),
    approvalCache: input.approvalCache,
    permissionMode: input.mode,
    requestApproval: input.requestApproval,
    sessionId: input.sessionId,
    toolOutputStore: input.toolOutputStore,
    guardianReviewer: input.guardianReviewer,
    onToolStarted: input.onToolStarted,
    onToolFinished: input.onToolFinished,
    emitRisk: input.emitRisk,
  })

  return {
    tools: materialization.definitions,
    toolRunner,
    cleanup: () => mcpManager.deregisterScope?.(scope),
  }
}
