import type { PermissionMode, SkillMeta } from '@hip/protocol'
import { SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { SessionStore } from '../persistence/store.js'
import { createFragmentSourceRegistry, type FragmentSourcesInput } from './fragments/index.js'
import { SystemContext, type Generation } from './system-context.js'
import {
  ContextEpoch,
  EpochAlreadyExistsError,
  LocationMismatchError,
  type PrepareResult,
} from './context-epoch.js'

export interface SessionContextState {
  cwd: string
  customSystemPrompt?: string
  skills: SkillMeta[]
  permissionMode: PermissionMode
  mcpCatalog?: string
  tokenBudgetPercent: number
  pendingSubagents?: Array<{
    id: string
    description: string
    status: 'running' | 'completed' | 'failed'
  }>
  completedSubagents?: Array<{
    id: string
    description: string
    status: 'running' | 'completed' | 'failed'
  }>
  checkpointId?: string | null
}

export interface PreparedContext {
  system: string
  contextMessages: BaseMessage[]
}

export async function prepareSessionContext(
  sessionId: string,
  agent: string,
  state: SessionContextState,
  store?: SessionStore,
  requestReplace?: boolean,
): Promise<PreparedContext> {
  const input = buildFragmentInput(state)
  const registry = createFragmentSourceRegistry(input)
  const systemContext = new SystemContext(registry.sources())
  const generation = await systemContext.initialize()

  if (!store) {
    return { system: generation.baseline, contextMessages: [] }
  }

  const epoch = new ContextEpoch(store.getDb())
  if (requestReplace) {
    epoch.requestReplacement(sessionId, 0)
  }
  const result = await ensureEpochPrepared(epoch, sessionId, agent, systemContext, state.cwd, generation)

  if (result.action === 'replace') {
    return { system: result.generation.baseline, contextMessages: [] }
  }

  if (result.action === 'updated') {
    return {
      system: generation.baseline,
      contextMessages: result.messages.map((m) => new SystemMessage(m)),
    }
  }

  return { system: generation.baseline, contextMessages: [] }
}

async function ensureEpochPrepared(
  epoch: ContextEpoch,
  sessionId: string,
  agent: string,
  systemContext: SystemContext,
  cwd: string,
  generation: Generation,
): Promise<PrepareResult> {
  let exists = false
  try {
    epoch.initialize(sessionId, agent, { cwd }, generation.baseline, generation.snapshot, 0)
  } catch (err) {
    if (err instanceof EpochAlreadyExistsError) {
      exists = true
    } else {
      throw err
    }
  }

  if (!exists) {
    return { action: 'unchanged' }
  }

  try {
    return await epoch.prepare(sessionId, agent, systemContext, { cwd })
  } catch (err) {
    if (err instanceof LocationMismatchError) {
      epoch.reset(sessionId)
      epoch.initialize(sessionId, agent, { cwd }, generation.baseline, generation.snapshot, 0)
      return { action: 'unchanged' }
    }
    throw err
  }
}

function buildFragmentInput(state: SessionContextState): FragmentSourcesInput {
  return {
    system: {
      cwd: state.cwd,
      userInstructions: state.customSystemPrompt,
      skills: state.skills,
      permissionMode: state.permissionMode,
      mcpCatalog: state.mcpCatalog,
    },
    skills: { skills: state.skills, cwd: state.cwd },
    time: {},
    tokenBudget: { tokenBudgetPercent: state.tokenBudgetPercent },
    subagents: {
      pendingSubagents: state.pendingSubagents,
      completedSubagents: state.completedSubagents,
    },
    checkpoint: { checkpointId: state.checkpointId ?? null },
    permission: { permissionMode: state.permissionMode },
  }
}
