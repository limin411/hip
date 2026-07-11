import type { ContextInjector, InjectorState, InjectResult } from '../session/context-injector.js'
import type { MemoryService } from './service.js'

const MEMORY_HEADER =
  '## Cross-session memory (auxiliary recall; project AGENTS.md / user instructions take priority over memory)'

/**
 * Last-registered context injector (Option A): appends frozen core snapshot
 * and optional prefetch as auxiliary recall. Project AGENTS.md wins on conflict.
 */
export class MemoryInjector implements ContextInjector {
  readonly id = 'memory'

  constructor(private readonly svc: MemoryService) {}

  async inject(state: InjectorState): Promise<InjectResult> {
    if (!state.useMemories) return { systemMessages: [] }

    const parts: string[] = []
    if (state.memoryCoreSnapshot) parts.push(state.memoryCoreSnapshot)

    if (state.prefetchQuery) {
      const block = this.svc.formatPrefetch(
        state.prefetchQuery,
        state.cwd,
        state.sessionId,
      )
      if (block) parts.push(block)
    }

    if (parts.length === 0) return { systemMessages: [] }

    return {
      systemMessages: [`${MEMORY_HEADER}\n\n${parts.join('\n\n')}`],
    }
  }
}
