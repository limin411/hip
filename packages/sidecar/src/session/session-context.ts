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
import type { ContextInjectorRegistry, InjectorState } from './context-injector.js'

export interface SessionContextState {
  cwd: string
  customSystemPrompt?: string
  skills: SkillMeta[]
  permissionMode: PermissionMode
  mcpCatalog?: string
  tokenBudgetPercent: number
  /** Session surface — chat prompts are shorter (Sprint B). */
  surface?: 'chat' | 'code'
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
  /** Session id for memory prefetch scoping. */
  sessionId?: string
  /** When true, MemoryInjector may inject core snapshot + prefetch. */
  useMemories?: boolean
  /** Frozen core memory block for this project (host-cached). */
  memoryCoreSnapshot?: string
  /** Pinned/core item ids paired with memoryCoreSnapshot. */
  memoryCoreIds?: string[]
  /** Mutable accumulator of memory ids injected this turn (core + prefetch). */
  memoryIdsInjected?: Set<string>
  /** Last user text used as memory prefetch query. */
  prefetchQuery?: string
}

export interface PreparedContext {
  system: string
  contextMessages: BaseMessage[]
}

const INITIAL_SEQ = 0

export async function prepareSessionContext(
  sessionId: string,
  agent: string,
  state: SessionContextState,
  store?: SessionStore,
  requestReplace?: boolean,
  injectorRegistry?: ContextInjectorRegistry,
): Promise<PreparedContext> {
  try {
    const input = buildFragmentInput(state)
    const registry = createFragmentSourceRegistry(input)
    const systemContext = new SystemContext(registry.sources())
    const generation = await systemContext.initialize()

    const system = injectorRegistry
      ? await assembleFromInjectors(injectorRegistry, state)
      : generation.baseline

    if (!store) {
      return { system, contextMessages: [] }
    }

    const epoch = new ContextEpoch(store.getDb())
    if (requestReplace) {
      epoch.requestReplacement(sessionId, INITIAL_SEQ)
    }
    const result = await ensureEpochPrepared(epoch, sessionId, agent, systemContext, state.cwd, generation)

    if (result.action === 'replace') {
      return { system, contextMessages: [] }
    }

    if (result.action === 'updated') {
      return {
        system,
        contextMessages: result.messages.map((m) => new SystemMessage(m)),
      }
    }

    return { system, contextMessages: [] }
  } catch (err) {
    console.error('[session-context] failed to prepare context:', err)
    return { system: '', contextMessages: [] }
  }
}

/** Map SessionContextState → InjectorState and join injector system messages. Exported for tests. */
export async function assembleFromInjectors(
  injectorRegistry: ContextInjectorRegistry,
  state: SessionContextState,
): Promise<string> {
  const injectorState: InjectorState = {
    cwd: state.cwd,
    permissionMode: state.permissionMode,
    skills: state.skills,
    tokenBudgetPercent: state.tokenBudgetPercent,
    surface: state.surface,
    pendingSubagents: state.pendingSubagents?.map((s) => ({
      id: s.id,
      description: s.description,
      status: s.status,
    })),
    completedSubagents: state.completedSubagents?.map((s) => ({
      id: s.id,
      description: s.description,
      status: s.status,
    })),
    sessionId: state.sessionId,
    useMemories: state.useMemories,
    memoryCoreSnapshot: state.memoryCoreSnapshot,
    memoryCoreIds: state.memoryCoreIds,
    memoryIdsInjected: state.memoryIdsInjected,
    prefetchQuery: state.prefetchQuery,
  }
  const results = await injectorRegistry.injectAll(injectorState)
  const messages = results.flatMap((r) => r.systemMessages)
  return messages.join('\n\n')
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
    epoch.initialize(sessionId, agent, { cwd }, generation.baseline, generation.snapshot, INITIAL_SEQ)
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
      epoch.initialize(sessionId, agent, { cwd }, generation.baseline, generation.snapshot, INITIAL_SEQ)
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
      surface: state.surface,
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
