import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { SystemContext } from './system-context.js'
import { prepareSessionContext, assembleFromInjectors } from './session-context.js'
import {
  ContextInjectorRegistry,
  type ContextInjector,
  type InjectResult,
  type InjectorState,
} from './context-injector.js'

function freshStore(): SessionStore {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
}

const baseState = {
  cwd: '/tmp/project',
  customSystemPrompt: undefined,
  skills: [],
  permissionMode: 'edit' as const,
  mcpCatalog: undefined,
  tokenBudgetPercent: 100,
  pendingSubagents: undefined,
  completedSubagents: undefined,
  checkpointId: undefined,
}

describe('prepareSessionContext', () => {
  it('returns baseline and no context messages when no store is provided', async () => {
    const prepared = await prepareSessionContext('s1', 'supervisor', baseState, undefined)

    expect(prepared.system.length).toBeGreaterThan(0)
    expect(prepared.contextMessages).toHaveLength(0)
  })

  it('initializes an epoch on first call with a store', async () => {
    const store = freshStore()

    const first = await prepareSessionContext('s1', 'supervisor', baseState, store)

    expect(first.system.length).toBeGreaterThan(0)
    expect(first.contextMessages).toHaveLength(0)

    const row = store.getDb()
      .prepare('SELECT agent, location FROM session_context_epoch WHERE session_id = ?')
      .get('s1') as { agent: string; location: string }
    expect(row.agent).toBe('supervisor')
    expect(row.location).toBe('/tmp/project')
  })

  it('returns updated context messages when sources change between turns', async () => {
    const store = freshStore()

    await prepareSessionContext('s1', 'supervisor', baseState, store)

    // Advance time by changing the token budget; the time fragment will also
    // have moved forward, so the epoch should detect a source change.
    const second = await prepareSessionContext('s1', 'supervisor', {
      ...baseState,
      tokenBudgetPercent: 50,
    }, store)

    expect(second.contextMessages.length).toBeGreaterThan(0)
  })

  it('replaces the epoch when requestReplace is true', async () => {
    const store = freshStore()

    await prepareSessionContext('s1', 'supervisor', baseState, store)

    const replaced = await prepareSessionContext('s1', 'supervisor', baseState, store, true)

    expect(replaced.contextMessages).toHaveLength(0)
  })

  it('resets the epoch when the cwd (location) changes', async () => {
    const store = freshStore()

    await prepareSessionContext('s1', 'supervisor', baseState, store)

    const moved = await prepareSessionContext('s1', 'supervisor', {
      ...baseState,
      cwd: '/tmp/other',
    }, store)

    expect(moved.system.length).toBeGreaterThan(0)

    const row = store.getDb()
      .prepare('SELECT location FROM session_context_epoch WHERE session_id = ?')
      .get('s1') as { location: string }
    expect(row.location).toBe('/tmp/other')
  })

  it('returns safe fallback when SystemContext.initialize() throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const initSpy = vi.spyOn(SystemContext.prototype, 'initialize').mockRejectedValue(new Error('init failed'))

    const prepared = await prepareSessionContext('s1', 'supervisor', baseState)

    expect(prepared).toEqual({ system: '', contextMessages: [] })
    expect(errorSpy).toHaveBeenCalledWith(
      '[session-context] failed to prepare context:',
      expect.objectContaining({ message: 'init failed' }),
    )

    initSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

describe('assembleFromInjectors', () => {
  it('maps memory fields into InjectorState', async () => {
    let seen: InjectorState | undefined
    const capture: ContextInjector = {
      id: 'capture',
      async inject(state) {
        seen = state
        return { systemMessages: [] }
      },
    }
    const registry = new ContextInjectorRegistry()
    registry.register(capture)

    await assembleFromInjectors(registry, {
      ...baseState,
      sessionId: 'sess-1',
      useMemories: true,
      memoryCoreSnapshot: '## Memory (core)\ncore-body',
      prefetchQuery: 'how do I build',
    })

    expect(seen?.sessionId).toBe('sess-1')
    expect(seen?.useMemories).toBe(true)
    expect(seen?.memoryCoreSnapshot).toBe('## Memory (core)\ncore-body')
    expect(seen?.prefetchQuery).toBe('how do I build')
  })

  it('ProjectAgents content before Memory; assembled system ends with memory block', async () => {
    const agents: ContextInjector = {
      id: 'project-agents-md',
      async inject(): Promise<InjectResult> {
        return { systemMessages: ['# Project instructions (AGENTS.md)\n\nUse pnpm.'] }
      },
    }
    const memory: ContextInjector = {
      id: 'memory',
      async inject(state): Promise<InjectResult> {
        if (!state.useMemories || !state.memoryCoreSnapshot) return { systemMessages: [] }
        return {
          systemMessages: [
            `## Cross-session memory (auxiliary recall; project AGENTS.md / user instructions take priority over memory)\n\n${state.memoryCoreSnapshot}`,
          ],
        }
      },
    }
    const registry = new ContextInjectorRegistry()
    registry.register(agents)
    registry.register(memory)

    const system = await assembleFromInjectors(registry, {
      ...baseState,
      useMemories: true,
      memoryCoreSnapshot: '## Memory (core)\n### Global\nPrefer yarn',
    })

    const agentsIdx = system.indexOf('Project instructions')
    const memoryIdx = system.indexOf('Cross-session memory')
    expect(agentsIdx).toBeGreaterThanOrEqual(0)
    expect(memoryIdx).toBeGreaterThan(agentsIdx)
    expect(system.trimEnd().endsWith('Prefer yarn')).toBe(true)
  })

  it('useMemories=false yields no memory text', async () => {
    const memory: ContextInjector = {
      id: 'memory',
      async inject(state): Promise<InjectResult> {
        if (!state.useMemories) return { systemMessages: [] }
        return { systemMessages: ['MEMORY_LEAK'] }
      },
    }
    const registry = new ContextInjectorRegistry()
    registry.register(memory)

    const system = await assembleFromInjectors(registry, {
      ...baseState,
      useMemories: false,
      memoryCoreSnapshot: 'should-not-appear',
    })
    expect(system).not.toContain('MEMORY_LEAK')
    expect(system).not.toContain('should-not-appear')
  })
})
