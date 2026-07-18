import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ContextInjectorRegistry,
  type InjectorState,
  type ContextInjector,
  type InjectResult,
} from '../session/context-injector.js'
import { openDatabase } from '../persistence/open.js'
import { MemoryStore } from './store.js'
import { MemoryService } from './service.js'
import { MemoryInjector, refreshMemoryCoreSnapshot } from './inject.js'

function freshService(configPath?: string) {
  const { db, memoriesFtsEnabled } = openDatabase(':memory:')
  const store = new MemoryStore(db, memoriesFtsEnabled)
  const svc = new MemoryService(store, configPath ? { configPath } : undefined)
  return { store, svc }
}

const baseState: InjectorState = {
  cwd: '/tmp/project',
  permissionMode: 'edit',
  skills: [],
  tokenBudgetPercent: 100,
}

describe('MemoryInjector', () => {
  let dir: string
  let configPath: string
  let svc: MemoryService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-mem-inject-'))
    configPath = join(dir, 'memory.json')
    ;({ svc } = freshService(configPath))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns empty when useMemories is false', async () => {
    const injector = new MemoryInjector(svc)
    const result = await injector.inject({
      ...baseState,
      useMemories: false,
      memoryCoreSnapshot: '## Memory (core)\nsecret',
    })
    expect(result.systemMessages).toEqual([])
  })

  it('returns empty when useMemories is undefined', async () => {
    const injector = new MemoryInjector(svc)
    const result = await injector.inject({
      ...baseState,
      memoryCoreSnapshot: '## Memory (core)\nsecret',
    })
    expect(result.systemMessages).toEqual([])
  })

  it('includes snapshot text and AGENTS priority header when use=true', async () => {
    const injector = new MemoryInjector(svc)
    const snap = '## Memory (core)\n### Global\nPrefer yarn'
    const result = await injector.inject({
      ...baseState,
      useMemories: true,
      memoryCoreSnapshot: snap,
    })
    expect(result.systemMessages).toHaveLength(1)
    const msg = result.systemMessages[0]
    expect(msg).toContain('AGENTS.md')
    expect(msg).toContain('priority')
    expect(msg).toContain(snap)
    expect(msg).toContain('Cross-session memory')
  })

  it('returns empty when use=true but no snapshot and no prefetch', async () => {
    const injector = new MemoryInjector(svc)
    const result = await injector.inject({
      ...baseState,
      useMemories: true,
    })
    expect(result.systemMessages).toEqual([])
  })

  it('includes prefetch block when formatPrefetch returns content', async () => {
    const formatPrefetch = vi.spyOn(svc, 'formatPrefetch').mockReturnValue({
      text: '## Memory (prefetch)\n- **hit**: body',
      ids: ['hit-id'],
    })
    const injector = new MemoryInjector(svc)
    const injected = new Set<string>()
    const result = await injector.inject({
      ...baseState,
      useMemories: true,
      sessionId: 's1',
      prefetchQuery: 'package management',
      memoryCoreIds: ['core-id'],
      memoryIdsInjected: injected,
    })
    expect(formatPrefetch).toHaveBeenCalledWith('package management', '/tmp/project', 's1')
    expect(result.systemMessages).toHaveLength(1)
    expect(result.systemMessages[0]).toContain('## Memory (prefetch)')
    expect(result.systemMessages[0]).toContain('hit')
    expect([...injected].sort()).toEqual(['core-id', 'hit-id'])
  })

  it('two injects with frozen snapshot yield identical core text', async () => {
    const injector = new MemoryInjector(svc)
    const snap = '## Memory (core)\n### Pinned\n- fixed-title'
    const state: InjectorState = {
      ...baseState,
      useMemories: true,
      memoryCoreSnapshot: snap,
    }
    const a = await injector.inject(state)
    const b = await injector.inject(state)
    expect(a.systemMessages).toEqual(b.systemMessages)
    expect(a.systemMessages[0]).toContain(snap)
  })
})

describe('refreshMemoryCoreSnapshot', () => {
  const resolveKey = (cwd: string) => ({ projectKeyHash: `hash:${cwd}` })

  it('use=false clears snapshot and project key', () => {
    const load = vi.fn(() => ({ text: 'should-not-load', ids: ['x'] }))
    const result = refreshMemoryCoreSnapshot({
      useMemories: false,
      cwd: '/proj',
      hostSnapshot: '## Memory (core)\nold',
      hostCoreIds: ['old'],
      hostProjectKey: 'hash:/proj',
      load,
      resolveKey,
    })
    expect(result).toEqual({
      snapshot: undefined,
      coreIds: undefined,
      projectKey: undefined,
      generation: undefined,
      cleared: true,
    })
    expect(load).not.toHaveBeenCalled()
  })

  it('empty load freezes: second call with same key skips load', () => {
    const load = vi.fn(() => ({ text: '', ids: [] as string[] }))
    const first = refreshMemoryCoreSnapshot({
      useMemories: true,
      cwd: '/proj',
      hostSnapshot: undefined,
      hostProjectKey: undefined,
      load,
      resolveKey,
    })
    expect(first).toEqual({
      snapshot: '',
      coreIds: [],
      projectKey: 'hash:/proj',
      generation: 0,
    })
    expect(load).toHaveBeenCalledTimes(1)

    const second = refreshMemoryCoreSnapshot({
      useMemories: true,
      cwd: '/proj',
      hostSnapshot: first.snapshot,
      hostCoreIds: first.coreIds,
      hostProjectKey: first.projectKey,
      hostGeneration: first.generation,
      storeGeneration: 0,
      load,
      resolveKey,
    })
    expect(second).toEqual({
      snapshot: '',
      coreIds: [],
      projectKey: 'hash:/proj',
      generation: 0,
    })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('key change reloads even when previous snapshot was empty', () => {
    const load = vi.fn((pk: string) =>
      pk === 'hash:/other'
        ? { text: '## Memory (core)\nnew', ids: ['n1'] }
        : { text: '', ids: [] as string[] },
    )
    const afterEmpty = refreshMemoryCoreSnapshot({
      useMemories: true,
      cwd: '/proj',
      load,
      resolveKey,
    })
    expect(afterEmpty.snapshot).toBe('')
    expect(afterEmpty.coreIds).toEqual([])
    expect(load).toHaveBeenCalledTimes(1)

    const afterMove = refreshMemoryCoreSnapshot({
      useMemories: true,
      cwd: '/other',
      hostSnapshot: afterEmpty.snapshot,
      hostCoreIds: afterEmpty.coreIds,
      hostProjectKey: afterEmpty.projectKey,
      load,
      resolveKey,
    })
    expect(afterMove).toEqual({
      snapshot: '## Memory (core)\nnew',
      coreIds: ['n1'],
      projectKey: 'hash:/other',
      generation: 0,
    })
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith('hash:/other')
  })

  it('does not reload solely because hostSnapshot is empty string', () => {
    const load = vi.fn(() => ({ text: 'reloaded-leak', ids: ['leak'] }))
    const result = refreshMemoryCoreSnapshot({
      useMemories: true,
      cwd: '/proj',
      hostSnapshot: '',
      hostCoreIds: [],
      hostProjectKey: 'hash:/proj',
      hostGeneration: 0,
      storeGeneration: 0,
      load,
      resolveKey,
    })
    expect(result.snapshot).toBe('')
    expect(result.coreIds).toEqual([])
    expect(result.projectKey).toBe('hash:/proj')
    expect(load).not.toHaveBeenCalled()
  })

  it('reloads empty freeze when store generation advances', () => {
    const load = vi.fn(() => ({ text: '## Memory (core)\nbody', ids: ['x'] }))
    const result = refreshMemoryCoreSnapshot({
      useMemories: true,
      cwd: '/proj',
      hostSnapshot: '',
      hostCoreIds: [],
      hostProjectKey: 'hash:/proj',
      hostGeneration: 0,
      storeGeneration: 2,
      load,
      resolveKey,
    })
    expect(result.snapshot).toContain('body')
    expect(result.generation).toBe(2)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('resolveKey failure keeps host cache', () => {
    const load = vi.fn(() => ({ text: 'x', ids: ['x'] }))
    const result = refreshMemoryCoreSnapshot({
      useMemories: true,
      cwd: '/bad',
      hostSnapshot: 'kept',
      hostCoreIds: ['kept-id'],
      hostProjectKey: 'old-key',
      load,
      resolveKey: () => {
        throw new Error('bad cwd')
      },
    })
    expect(result).toEqual({
      snapshot: 'kept',
      coreIds: ['kept-id'],
      projectKey: 'old-key',
    })
    expect(load).not.toHaveBeenCalled()
  })
})

describe('MemoryInjector registration order (Option A)', () => {
  it('ProjectAgents content appears before Memory; system ends with memory block', async () => {
    class FakeProjectAgents implements ContextInjector {
      readonly id = 'project-agents-md'
      async inject(): Promise<InjectResult> {
        return {
          systemMessages: [
            '# Project instructions (AGENTS.md)\n\nAlways use pnpm.',
          ],
        }
      }
    }

    const { svc } = freshService()
    const registry = new ContextInjectorRegistry()
    registry.register(new FakeProjectAgents())
    registry.register(
      new MemoryInjector(svc),
    )

    const results = await registry.injectAll({
      ...baseState,
      useMemories: true,
      memoryCoreSnapshot: '## Memory (core)\n### Global\nUse yarn',
    })
    const system = results.flatMap((r) => r.systemMessages).join('\n\n')

    const agentsIdx = system.indexOf('Project instructions')
    const memoryIdx = system.indexOf('Cross-session memory')
    expect(agentsIdx).toBeGreaterThanOrEqual(0)
    expect(memoryIdx).toBeGreaterThan(agentsIdx)
    expect(system.trimEnd().endsWith('Use yarn') || system.endsWith('Use yarn')).toBe(true)
    // Memory block is last segment
    const lastSegment = results[results.length - 1].systemMessages.join('')
    expect(lastSegment).toContain('Cross-session memory')
    expect(lastSegment).toContain('## Memory (core)')
  })
})
