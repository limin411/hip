import { describe, it, expect, vi } from 'vitest'
import { SystemContext, SystemContextRegistry } from '../system-context.js'
import { FragmentRegistry, type FragmentState } from '../context-fragment.js'
import {
  SystemPromptFragment,
  SkillsFragment,
  TokenBudgetFragment,
  CurrentTimeFragment,
  SubagentNotificationFragment,
} from './index.js'
import {
  createSystemSource,
  createSkillsSource,
  createTimeSource,
  createTokenBudgetSource,
  createSubagentSource,
  createCheckpointSource,
  createPermissionSource,
  createFragmentSourceRegistry,
} from './index.js'
import type {
  SystemSourcePayload,
  SkillsSourcePayload,
  TimeSourcePayload,
  TokenBudgetSourcePayload,
  SubagentSourcePayload,
  CheckpointSourcePayload,
  PermissionSourcePayload,
} from './index.js'
import { currentTimeIsoMinute } from '../current-time.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const skillsFixture = [
  { id: 'test-skill', name: 'test-skill', description: 'A test skill', dir: '/skills/t1', hasScripts: false },
]

const fragmentState: FragmentState = {
  cwd: '/home/user/project',
  customSystemPrompt: 'Be concise.',
  skills: skillsFixture,
  permissionMode: 'edit',
  // Below 30% so token-budget is injected; 25% buckets to 20% for stable copy.
  tokenBudgetPercent: 25,
  pendingSubagents: [{ id: 'bg_1', description: 'Search', status: 'running' }],
  completedSubagents: [{ id: 'bg_2', description: 'Done', status: 'completed' }],
}

const fixedDate = new Date('2026-06-21T12:34:56.789Z')

// ── Helpers ───────────────────────────────────────────────────────────────────

function isUnavailable(value: unknown): boolean {
  return typeof value === 'object' && value !== null && '_tag' in value && value._tag === 'Unavailable'
}

// ── Existing fragment parity ──────────────────────────────────────────────────

describe('migrated sources preserve existing fragment output', () => {
  it('system source baseline matches SystemPromptFragment render', async () => {
    const fragment = new SystemPromptFragment()
    const source = createSystemSource({
      cwd: fragmentState.cwd,
      userInstructions: fragmentState.customSystemPrompt,
      skills: fragmentState.skills,
      permissionMode: fragmentState.permissionMode,
    })

    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(false)
    const typed = payload as SystemSourcePayload
    expect(typed.text).toBe(fragment.render(fragmentState))
  })

  it('skills source baseline matches SkillsFragment render', async () => {
    const fragment = new SkillsFragment()
    const source = createSkillsSource({ skills: fragmentState.skills, cwd: fragmentState.cwd })

    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(false)
    const typed = payload as SkillsSourcePayload
    expect(typed.text).toBe(fragment.render(fragmentState))
  })

  it('time source baseline matches CurrentTimeFragment render', async () => {
    vi.useFakeTimers({ now: fixedDate })
    try {
      const fragment = new CurrentTimeFragment()
      const source = createTimeSource()

      const payload = await source.load()
      expect(isUnavailable(payload)).toBe(false)
      const typed = payload as TimeSourcePayload
      expect(typed.text).toBe(fragment.render(fragmentState))
    } finally {
      vi.useRealTimers()
    }
  })

  it('token-budget source baseline matches TokenBudgetFragment render', async () => {
    const fragment = new TokenBudgetFragment()
    const source = createTokenBudgetSource({ tokenBudgetPercent: fragmentState.tokenBudgetPercent })

    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(false)
    const typed = payload as TokenBudgetSourcePayload
    expect(typed.text).toBe(fragment.render(fragmentState))
  })

  it('subagent source baseline matches SubagentNotificationFragment render', async () => {
    const fragment = new SubagentNotificationFragment()
    const source = createSubagentSource({
      pendingSubagents: fragmentState.pendingSubagents,
      completedSubagents: fragmentState.completedSubagents,
    })

    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(false)
    const typed = payload as SubagentSourcePayload
    expect(typed.text).toBe(fragment.render(fragmentState))
  })
})

// ── Registry + typed payload ──────────────────────────────────────────────────

describe('fragment sources registered in SystemContextRegistry', () => {
  it('initializes all 7 registered sources with deterministic keys', async () => {
    const registry = createFragmentSourceRegistry({
      system: { cwd: fragmentState.cwd, permissionMode: fragmentState.permissionMode },
      skills: { skills: fragmentState.skills, cwd: fragmentState.cwd },
      time: { now: fixedDate },
      tokenBudget: { tokenBudgetPercent: fragmentState.tokenBudgetPercent },
      subagents: {
        pendingSubagents: fragmentState.pendingSubagents,
        completedSubagents: fragmentState.completedSubagents,
      },
      checkpoint: { checkpointId: 'abc123' },
      permission: { permissionMode: fragmentState.permissionMode },
    })

    const ctx = new SystemContext(registry.sources())
    const gen = await ctx.initialize()

    expect(Object.keys(gen.snapshot).sort()).toEqual([
      'fragment:checkpoint',
      'fragment:permission',
      'fragment:skills',
      'fragment:subagents',
      'fragment:system',
      'fragment:time',
      'fragment:token-budget',
    ])

    const decodedSystem = ctx.getSources().find((s) => s.key === 'fragment:system')!.codec.decode(gen.snapshot['fragment:system'].value)
    expect((decodedSystem as SystemSourcePayload).systemPrompt).toContain('hip')

    const decodedSkills = ctx.getSources().find((s) => s.key === 'fragment:skills')!.codec.decode(gen.snapshot['fragment:skills'].value)
    expect((decodedSkills as SkillsSourcePayload).skills).toEqual(skillsFixture)

    const decodedTime = ctx.getSources().find((s) => s.key === 'fragment:time')!.codec.decode(gen.snapshot['fragment:time'].value)
    expect((decodedTime as TimeSourcePayload).now).toBe(currentTimeIsoMinute(fixedDate))

    const decodedBudget = ctx.getSources().find((s) => s.key === 'fragment:token-budget')!.codec.decode(gen.snapshot['fragment:token-budget'].value)
    expect((decodedBudget as TokenBudgetSourcePayload).budget).toBe(20)
    expect((decodedBudget as TokenBudgetSourcePayload).used).toBe(80)

    const decodedSubagents = ctx.getSources().find((s) => s.key === 'fragment:subagents')!.codec.decode(gen.snapshot['fragment:subagents'].value)
    expect((decodedSubagents as SubagentSourcePayload).subagentIds).toEqual(['bg_1', 'bg_2'])

    const decodedCheckpoint = ctx.getSources().find((s) => s.key === 'fragment:checkpoint')!.codec.decode(gen.snapshot['fragment:checkpoint'].value)
    expect((decodedCheckpoint as CheckpointSourcePayload).checkpointId).toBe('abc123')

    const decodedPermission = ctx.getSources().find((s) => s.key === 'fragment:permission')!.codec.decode(gen.snapshot['fragment:permission'].value)
    expect((decodedPermission as PermissionSourcePayload).mode).toBe('edit')
  })
})

// ── New sources ───────────────────────────────────────────────────────────────

describe('checkpoint source', () => {
  it('returns the checkpoint id when available', async () => {
    const source = createCheckpointSource({ checkpointId: 'ckpt-42' })
    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(false)
    const typed = payload as CheckpointSourcePayload
    expect(typed.checkpointId).toBe('ckpt-42')
    expect(typed.text).toContain('ckpt-42')
  })

  it('returns null checkpointId and a no-checkpoint message when null', async () => {
    const source = createCheckpointSource({ checkpointId: null })
    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(false)
    const typed = payload as CheckpointSourcePayload
    expect(typed.checkpointId).toBeNull()
    expect(typed.text).toContain('No checkpoint')
  })

  it('is Unavailable when checkpointId is undefined', async () => {
    const source = createCheckpointSource({})
    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(true)
  })
})

describe('permission source', () => {
  it('returns the current permission mode', async () => {
    const source = createPermissionSource({ permissionMode: 'full' })
    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(false)
    const typed = payload as PermissionSourcePayload
    expect(typed.mode).toBe('full')
    expect(typed.text).toContain('full')
  })

  it('is Unavailable when permissionMode is undefined', async () => {
    const source = createPermissionSource({})
    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(true)
  })
})

// ── FragmentRegistry assembly ─────────────────────────────────────────────────

describe('FragmentRegistry.assemble()', () => {
  it('still produces the expected combined string from fragment state', () => {
    const registry = new FragmentRegistry()
    registry.register(new SystemPromptFragment())
    registry.register(new SkillsFragment())
    registry.register(new TokenBudgetFragment())
    registry.register(new CurrentTimeFragment())
    registry.register(new SubagentNotificationFragment())

    const result = registry.assemble(fragmentState)
    const active = registry.getActiveFragments(fragmentState)

    expect(result.text).toBe(active.map((f) => f.render(fragmentState)).join('\n\n'))
    expect(result.tokens).toBe(active.reduce((sum, f) => sum + f.estimatedTokens(fragmentState), 0))
    expect(result.fragments).toHaveLength(active.length)
  })

  it('can consume Sources by resolving them from a SystemContext', async () => {
    const registry = new SystemContextRegistry()
    registry.register(createSystemSource({ cwd: fragmentState.cwd, permissionMode: fragmentState.permissionMode }))
    registry.register(createSkillsSource({ skills: fragmentState.skills, cwd: fragmentState.cwd }))
    registry.register(createTimeSource({ now: fixedDate }))
    registry.register(createTokenBudgetSource({ tokenBudgetPercent: fragmentState.tokenBudgetPercent }))
    registry.register(createSubagentSource({
      pendingSubagents: fragmentState.pendingSubagents,
      completedSubagents: fragmentState.completedSubagents,
    }))

    const ctx = new SystemContext(registry.sources())
    const fragmentRegistry = new FragmentRegistry()
    const assembled = await fragmentRegistry.assemble(ctx)
    const generation = await ctx.initialize()

    expect(assembled.text).toBe(generation.baseline)
    expect(assembled.text).toContain('hip')
    expect(assembled.text).toContain('test-skill')
    expect(assembled.text).toContain('approximately 20%')
    expect(assembled.text).toContain('Pending background tasks')
    expect(assembled.text).toMatch(/Current local time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:00/)
    expect(assembled.text).toMatch(/UTC: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:00/)
    expect(assembled.fragments.map((f) => f.id)).toEqual([
      'fragment:skills',
      'fragment:subagents',
      'fragment:system',
      'fragment:time',
      'fragment:token-budget',
    ])
  })
})
