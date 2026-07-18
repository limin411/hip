import type { ContextInjector, InjectorState, InjectResult } from '../session/context-injector.js'
import type { MemoryInjectBlock, MemoryService } from './service.js'

const MEMORY_HEADER =
  '## Cross-session memory (auxiliary recall; project AGENTS.md / user instructions take priority over memory)'

export type RefreshMemoryCoreSnapshotArgs = {
  useMemories: boolean
  cwd?: string
  hostSnapshot?: string
  hostCoreIds?: string[]
  hostProjectKey?: string
  /** Generation last baked into host snapshot. */
  hostGeneration?: number
  /** Current store generation from MemoryService.getCoreGeneration(). */
  storeGeneration?: number
  load: (projectKeyHash: string) => MemoryInjectBlock
  resolveKey: (cwd: string) => { projectKeyHash: string }
}

export type RefreshMemoryCoreSnapshotResult = {
  snapshot?: string
  coreIds?: string[]
  projectKey?: string
  generation?: number
  /** True when useMemories is false and host cache should be cleared. */
  cleared?: boolean
}

/**
 * Freeze / refresh host-cached core memory.
 * Reload when project key changes, generation advances, or empty freeze after extract.
 */
export function refreshMemoryCoreSnapshot(
  args: RefreshMemoryCoreSnapshotArgs,
): RefreshMemoryCoreSnapshotResult {
  if (!args.useMemories) {
    return {
      snapshot: undefined,
      coreIds: undefined,
      projectKey: undefined,
      generation: undefined,
      cleared: true,
    }
  }
  if (!args.cwd) {
    return {
      snapshot: args.hostSnapshot,
      coreIds: args.hostCoreIds,
      projectKey: args.hostProjectKey,
      generation: args.hostGeneration,
    }
  }

  let projectKeyHash: string
  try {
    projectKeyHash = args.resolveKey(args.cwd).projectKeyHash
  } catch {
    return {
      snapshot: args.hostSnapshot,
      coreIds: args.hostCoreIds,
      projectKey: args.hostProjectKey,
      generation: args.hostGeneration,
    }
  }

  const storeGen = args.storeGeneration ?? 0
  const projectChanged = args.hostProjectKey !== projectKeyHash
  // First load (no project key yet): treat host gen as -1 so we always load.
  // Cached host without generation field: assume current storeGen (legacy freeze).
  const effectiveHostGen =
    args.hostGeneration !== undefined
      ? args.hostGeneration
      : args.hostProjectKey !== undefined
        ? storeGen
        : -1
  const genChanged = effectiveHostGen !== storeGen
  // Empty freeze is valid; recover only when store generation advanced past host.
  const emptyRecover =
    (args.hostSnapshot === '' || args.hostSnapshot === undefined) &&
    storeGen > effectiveHostGen

  if (projectChanged || genChanged || emptyRecover) {
    const loaded = args.load(projectKeyHash)
    return {
      snapshot: loaded.text,
      coreIds: loaded.ids,
      projectKey: projectKeyHash,
      generation: storeGen,
    }
  }

  return {
    snapshot: args.hostSnapshot,
    coreIds: args.hostCoreIds,
    projectKey: args.hostProjectKey,
    generation: effectiveHostGen,
  }
}

/**
 * Last-registered context injector (Option A): appends frozen core snapshot
 * and optional prefetch as auxiliary recall. Project AGENTS.md wins on conflict.
 */
export class MemoryInjector implements ContextInjector {
  readonly id = 'memory'

  constructor(private readonly svc: MemoryService) {}

  async inject(state: InjectorState): Promise<InjectResult> {
    if (!state.useMemories) return { systemMessages: [] }

    const injected = state.memoryIdsInjected
    if (injected) {
      for (const id of state.memoryCoreIds ?? []) {
        injected.add(id)
      }
    }

    const parts: string[] = []
    if (state.memoryCoreSnapshot) parts.push(state.memoryCoreSnapshot)

    if (state.prefetchQuery) {
      const block = await this.svc.formatPrefetch(
        state.prefetchQuery,
        state.cwd,
        state.sessionId,
      )
      if (block.text) parts.push(block.text)
      if (injected) {
        for (const id of block.ids) {
          injected.add(id)
        }
      }
    }

    if (parts.length === 0) return { systemMessages: [] }

    return {
      systemMessages: [`${MEMORY_HEADER}\n\n${parts.join('\n\n')}`],
    }
  }
}
