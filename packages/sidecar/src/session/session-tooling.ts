import type { StructuredToolInterface } from '@langchain/core/tools'
import type { PermissionMode, SkillMeta, McpServerConfig, AgentConfig } from '@hip/protocol'
import { ToolRegistry, createScope } from './tool-registry.js'
import { mcpManager, DEFAULT_LAZY_THRESHOLD } from './mcp/manager.js'
import { buildTools, SELF_GATED_TOOLS, type ApprovalFn, type DispatchSpec } from './tools.js'
import type { ParallelChoiceFn, ParallelSlotSpawnFn } from './tools/parallel-worktree.js'
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
import type { PlanMode } from './plan-mode.js'
import type { MemoryService } from '../memory/service.js'
import { buildMemoryTools } from '../memory/tools.js'
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
  /** Multi-choice HITL (parallel_worktrees). */
  requestChoice?: ParallelChoiceFn
  /** Background worker forced into a pre-created worktree. */
  spawnInWorktree?: ParallelSlotSpawnFn
  onParallelRunStarted?: import('./tools/helpers.js').BuildToolsOpts['onParallelRunStarted']
  onWorktreeChanged?: import('./tools/helpers.js').BuildToolsOpts['onWorktreeChanged']
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
  /** Emit goal:updated to the UI when goal tools change state. */
  onGoalUpdated?: (goal: import('./goal.js').Goal | null) => void
  cronManager?: CronManager
  planMode?: PlanMode
  memoryService?: MemoryService
  useMemories?: boolean
  /** Optional HookContext frame fields for the supervisor tool loop. */
  turnId?: string
  agentId?: string
}

export async function buildSessionTooling(input: BuildSessionToolingInput): Promise<SessionTooling> {
  await mcpManager.reconcile(input.mcpConfigs)

  const registry = new ToolRegistry()
  const scope = createScope()
  const builtInTools = buildTools(
    input.cwd,
    input.spawnSubagent,
    input.cwd,
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
      requestChoice: input.requestChoice,
      spawnInWorktree: input.spawnInWorktree,
      onParallelRunStarted: input.onParallelRunStarted,
      onWorktreeChanged: input.onWorktreeChanged,
    },
    input.retrySubagent,
    input.stopBackgroundTask,
    input.getBackgroundTaskOutput,
    input.planMode,
  )
  for (const t of builtInTools) {
    registry.register(t)
  }
  if (input.goalManager) {
    const goalTools = buildGoalTools(input.goalManager, input.onGoalUpdated)
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
  if (input.useMemories && input.memoryService) {
    const memoryTools = buildMemoryTools(input.memoryService, {
      sessionId: input.sessionId,
      cwd: input.cwd,
      defaultScope: input.memoryService.getConfig().defaultScope,
    })
    for (const t of memoryTools) {
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
    turnId: input.turnId,
    agentId: input.agentId ?? 'supervisor',
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
