import type { AgentConfig, SkillMeta, PermissionMode } from '@hip/protocol'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ApprovalFn } from '../tools.js'
import type { GraphEmit } from '../graph.js'
import type { NetworkPolicy } from '../network-policy.js'
import type { ToolOutputStore } from '../tool-output-store.js'
import type { GuardianReviewer } from '../guardian.js'
import type { AttachmentPayload, ContentPart } from '../attachments.js'
import { runManagedAgent } from '../internal-runner.js'
import { childMaxStepsForAgent } from '../loop-control.js'
import { createAgentProvider } from './index.js'
import { readAgentsConfig, resolveAgentModel, type ResolvedModel } from './registry.js'
import type { AgentProvider, ExternalAgentHooks } from './types.js'
import type { HookRegistry } from '../hooks/registry.js'

/** Run one configured external agent's turn and return its final text.
 *  Shaped like the orchestrator's AgentRunner (agentId + task → text), but it also
 *  takes a live `emit` sink. A later orchestrator adapter is NOT trivial: it must
 *  bridge this `Promise<string>` to AgentRunner's `Promise<NodeOutput>` and supply a
 *  no-op `emit` (the DAG path has no streaming card to feed). */
/** Per-turn capabilities the parent session threads into an internal sub-agent's loop. */
export interface InvokerExtras {
  mcpTools?: StructuredToolInterface[]
  skills?: SkillMeta[]
  requestApproval?: ApprovalFn
  permissionMode?: PermissionMode
  sessionId?: string
  networkPolicy?: NetworkPolicy
  toolOutputStore?: ToolOutputStore
  guardianReviewer?: GuardianReviewer
  /** Pre-built content parts for the agent's HumanMessage. When provided, the runner skips
   * re-validating/re-reading raw attachments. */
  attachmentParts?: ContentPart[]
  /**
   * Session plugin HookRegistry for internal-loop tool interception.
   * Distinct from the `hooks?: ExternalAgentHooks` argument on `invoke` (ACP permission bridge).
   */
  pluginHooks?: HookRegistry
  turnId?: string
  runId?: string
  nodeId?: string
  agentId?: string
  parentAgentId?: string
}

export interface AgentInvoker {
  invoke(agentId: string, task: string, emit: GraphEmit, signal: AbortSignal, hooks?: ExternalAgentHooks, extras?: InvokerExtras, attachments?: AttachmentPayload[]): Promise<string>
}

/** Args handed to the internal-loop runner (a seam so tests can stub the loop). skills/mcpTools are
 *  ALREADY narrowed to the agent's allowedSkills/allowedMcpServers before they reach here. */
export interface RunInternalArgs {
  agentId: string
  resolved: ResolvedModel | null
  cwd: string
  prompt: string
  task: string
  emit: GraphEmit
  signal: AbortSignal
  /** Loop budget for this managed agent (explore uses a higher cap). */
  childMaxSteps?: number
  mcpTools?: StructuredToolInterface[]
  skills?: SkillMeta[]
  requestApproval?: ApprovalFn
  permissionMode?: PermissionMode
  sessionId?: string
  networkPolicy?: NetworkPolicy
  toolOutputStore?: ToolOutputStore
  guardianReviewer?: GuardianReviewer
  attachments?: AttachmentPayload[]
  /** Pre-built content parts; passed through to runManagedAgent to avoid duplicate file I/O. */
  attachmentParts?: ContentPart[]
  pluginHooks?: HookRegistry
  turnId?: string
  runId?: string
  nodeId?: string
  parentAgentId?: string
}

export interface InvokerDeps {
  readAgents?: () => AgentConfig[]
  createProvider?: (agent: AgentConfig, cwd: string, model: ResolvedModel | null) => AgentProvider
  resolveModel?: (agent: AgentConfig, cwd: string) => ResolvedModel | null
  runInternal?: (args: RunInternalArgs) => Promise<string>
}

/** Parse server ids from legacy `allowedTools` wildcards of the form `mcp__<id>__*` (back-compat). */
function grantedMcpServerIdsFromLegacy(allowedTools?: string[]): string[] {
  if (!allowedTools) return []
  const ids: string[] = []
  for (const a of allowedTools) {
    const m = /^mcp__(.+)__\*$/.exec(a)
    if (m && !ids.includes(m[1])) ids.push(m[1])
  }
  return ids
}

/** Resolve the agent's effective MCP server allow-list: explicit allowedMcpServers, else (back-compat)
 *  the legacy allowedTools `mcp__<id>__*` wildcards, else []. */
function effectiveMcpServers(agent: AgentConfig): string[] {
  if (agent.allowedMcpServers !== undefined) return agent.allowedMcpServers
  return grantedMcpServerIdsFromLegacy(agent.allowedTools)
}

export function createAgentInvoker(cwd: string, deps: InvokerDeps = {}): AgentInvoker {
  const readAgents = deps.readAgents ?? (() => readAgentsConfig(cwd))
  const createProvider = deps.createProvider ?? createAgentProvider
  const resolveModel = deps.resolveModel ?? resolveAgentModel
  const runInternal = deps.runInternal ?? ((a: RunInternalArgs) =>
    runManagedAgent({
      resolved: a.resolved, cwd: a.cwd, prompt: a.prompt, task: a.task,
      emit: a.emit, signal: a.signal,
      // Prefer explicit budget (from config agent id); fall back if tests omit it.
      childMaxSteps: a.childMaxSteps ?? childMaxStepsForAgent(a.agentId),
      mcpTools: a.mcpTools, skills: a.skills, requestApproval: a.requestApproval, permissionMode: a.permissionMode,
      sessionId: a.sessionId, networkPolicy: a.networkPolicy,
      toolOutputStore: a.toolOutputStore, guardianReviewer: a.guardianReviewer,
      attachments: a.attachments,
      attachmentParts: a.attachmentParts,
      hooks: a.pluginHooks,
      turnId: a.turnId,
      runId: a.runId,
      nodeId: a.nodeId,
      agentId: a.agentId,
      parentAgentId: a.parentAgentId,
    }))
  return {
    // `hooks` here is ExternalAgentHooks (ACP permission bridge), not HookRegistry.
    async invoke(agentId, task, emit, signal, externalHooks, extras, attachments) {
      const agent = readAgents().find((a) => a.id === agentId && a.enabled)
      if (!agent) throw new Error(`unknown or disabled agent: ${agentId}`)

      if (agent.kind === 'internal') {
        // Attachment forwarding is unconditional: the caller (dispatch path) is responsible
        // for ensuring only image attachments are passed and the agent is eligible.
        // hip's own loop — no external provider, no token-teeing (runManagedAgent returns the final text).
        // Per-agent narrowing happens HERE on the inputs: built-ins are always on (no allowedTools gate);
        // only the skills/mcp tools the agent was granted are passed through. When extras are absent
        // (back-compat callers), skills/mcpTools stay undefined ⇒ runManagedAgent grants neither.
        const allowedSkills = agent.allowedSkills ?? []
        const serverIds = effectiveMcpServers(agent)
        const narrowedSkills = extras?.skills?.filter((s) => allowedSkills.includes(s.id))
        const narrowedMcp = extras?.mcpTools?.filter((t) => serverIds.some((id) => t.name.startsWith(`mcp__${id}__`)))
        return runInternal({
          agentId: extras?.agentId ?? agentId,
          // Budget from config id (`explore`), not runtime child id (`subagent-N`).
          childMaxSteps: childMaxStepsForAgent(agentId),
          resolved: resolveModel(agent, cwd), cwd, prompt: agent.prompt ?? '',
          task, emit, signal,
          mcpTools: narrowedMcp, skills: narrowedSkills,
          requestApproval: extras?.requestApproval, permissionMode: extras?.permissionMode,
          sessionId: extras?.sessionId, networkPolicy: extras?.networkPolicy,
          toolOutputStore: extras?.toolOutputStore, guardianReviewer: extras?.guardianReviewer,
          attachments,
          attachmentParts: extras?.attachmentParts,
          pluginHooks: extras?.pluginHooks,
          turnId: extras?.turnId,
          runId: extras?.runId,
          nodeId: extras?.nodeId,
          parentAgentId: extras?.parentAgentId,
        })
      }

      // Model rollback (spec §D): every agent reaching this line is external (the internal branch
      // returned above) and self-manages its own model — ACP & CLI agents never receive a hip model.
      // Mirrors session.ts (`const model = null`). resolveModel is left injectable for the internal
      // branch only; resolving here would be dead work that contradicts the UI promise.
      const model = null
      const provider = createProvider(agent, cwd, model)
      let text = ''
      // Tee token deltas so we can return the final text while still forwarding
      // every event to the caller's sink (the dispatch tool-card).
      const teed: GraphEmit = {
        token: (d) => { text += d; emit.token(d) },
        reasoning: emit.reasoning,
        toolStarted: emit.toolStarted,
        toolFinished: emit.toolFinished,
        usage: emit.usage,
        planDelta: emit.planDelta,
        compaction: emit.compaction,
      }
      try {
        await provider.runTurn(task, teed, signal, externalHooks)
        return text
      } finally {
        provider.dispose()
      }
    },
  }
}
