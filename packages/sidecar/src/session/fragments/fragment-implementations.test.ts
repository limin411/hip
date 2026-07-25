import { describe, it, expect } from 'vitest'
import { createSystemSource, type SystemSourcePayload } from './system.js'
import { createSkillsSource, type SkillsSourcePayload } from './skills.js'
import { createTimeSource, type TimeSourcePayload } from './time.js'
import { createTokenBudgetSource, type TokenBudgetSourcePayload } from './token-budget.js'
import { createSubagentSource, type SubagentSourcePayload } from './subagent.js'
import { createCheckpointSource, type CheckpointSourcePayload } from './checkpoint.js'
import { createPermissionSource, type PermissionSourcePayload } from './permission.js'

function isUnavailable(value: unknown): boolean {
  return typeof value === 'object' && value !== null && '_tag' in value && (value as { _tag: string })._tag === 'Unavailable'
}

describe('fragment source: system', () => {
  it('returns system prompt when cwd is provided', async () => {
    const source = createSystemSource({ cwd: '/home/user/project', permissionMode: 'edit' })
    const payload = (await source.load()) as SystemSourcePayload
    expect(isUnavailable(payload)).toBe(false)
    expect(payload.systemPrompt).toContain('hip')
    expect(payload.text).toBe(payload.systemPrompt)
  })

  it('is Unavailable when cwd is undefined', async () => {
    const source = createSystemSource({})
    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(true)
  })

  it('round-trips through codec', async () => {
    const source = createSystemSource({ cwd: '/tmp', userInstructions: 'Be terse' })
    const payload = (await source.load()) as SystemSourcePayload
    const encoded = source.codec.encode(payload)
    const decoded = source.codec.decode(encoded)
    expect(decoded.systemPrompt).toBe(payload.systemPrompt)
    expect(decoded.text).toBe(payload.text)
  })
})

describe('fragment source: skills', () => {
  const skills = [
    { id: 's1', name: 's1', description: 'd1', dir: '/skills/s1', hasScripts: false },
  ]

  it('returns skills block when skills are provided', async () => {
    const source = createSkillsSource({ skills, cwd: '/tmp' })
    const payload = (await source.load()) as SkillsSourcePayload
    expect(isUnavailable(payload)).toBe(false)
    expect(payload.skills).toEqual(skills)
    expect(payload.text).toContain('s1')
  })

  it('is Unavailable when skills are undefined', async () => {
    const source = createSkillsSource({})
    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(true)
  })

  it('round-trips through codec preserving optional skill fields', async () => {
    const fullSkill = {
      id: 's2',
      name: 's2',
      description: 'd2',
      dir: '/skills/s2',
      hasScripts: true,
      scope: 'project' as const,
      pluginId: 'p1',
      autoInvoke: false,
      userInvocable: false,
      allowedTools: ['bash'],
      disallowedTools: ['delete_file'],
      context: 'fork' as const,
      paths: ['**/*.ts'],
      model: 'gpt-5',
      effort: 'high' as const,
    }
    const source = createSkillsSource({ skills: [fullSkill], cwd: '/tmp' })
    const payload = (await source.load()) as SkillsSourcePayload
    const encoded = source.codec.encode(payload)
    const decoded = source.codec.decode(encoded)
    expect(decoded.skills[0]).toEqual(fullSkill)
  })
})

describe('fragment source: time', () => {
  it('formats the provided date with local + UTC (minute precision)', async () => {
    const now = new Date('2026-06-21T12:34:56.789Z')
    const source = createTimeSource({ now })
    const payload = (await source.load()) as TimeSourcePayload
    expect(payload.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.\d{3}Z$/)
    expect(payload.text).toMatch(
      /^Current local time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:00 \(.+, UTC[+-].+\)\.\nUTC: 2026-06-21 12:34:00\.$/,
    )
  })

  it('round-trips through codec', async () => {
    const source = createTimeSource({ now: new Date('2026-01-01T00:00:00.000Z') })
    const payload = (await source.load()) as TimeSourcePayload
    const encoded = source.codec.encode(payload)
    const decoded = source.codec.decode(encoded)
    expect(decoded.now).toBe(payload.now)
  })
})

describe('fragment source: token-budget', () => {
  it('renders budget text when percent is provided', async () => {
    const source = createTokenBudgetSource({ tokenBudgetPercent: 30 })
    const payload = (await source.load()) as TokenBudgetSourcePayload
    expect(payload.budget).toBe(30)
    expect(payload.used).toBe(70)
    expect(payload.text).toContain('30%')
  })

  it('warns when budget is low', async () => {
    const source = createTokenBudgetSource({ tokenBudgetPercent: 5 })
    const payload = (await source.load()) as TokenBudgetSourcePayload
    expect(payload.text).toContain('nearly exhausted')
  })

  it('is Unavailable when percent is undefined', async () => {
    const source = createTokenBudgetSource({})
    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(true)
  })

  it('round-trips through codec', async () => {
    const source = createTokenBudgetSource({ tokenBudgetPercent: 42 })
    const payload = (await source.load()) as TokenBudgetSourcePayload
    const encoded = source.codec.encode(payload)
    const decoded = source.codec.decode(encoded)
    expect(decoded.budget).toBe(42)
    expect(decoded.used).toBe(58)
  })
})

describe('fragment source: subagent', () => {
  const pending = [{ id: 'bg-1', description: 'Search', status: 'running' as const }]
  const completed = [{ id: 'bg-2', description: 'Done', status: 'completed' as const }]

  it('renders pending and completed tasks', async () => {
    const source = createSubagentSource({ pendingSubagents: pending, completedSubagents: completed })
    const payload = (await source.load()) as SubagentSourcePayload
    expect(payload.subagentIds).toEqual(['bg-1', 'bg-2'])
    expect(payload.text).toContain('Pending background tasks')
    expect(payload.text).toContain('Completed background tasks')
  })

  it('is Unavailable when no tasks are provided', async () => {
    const source = createSubagentSource({})
    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(true)
  })

  it('round-trips through codec', async () => {
    const source = createSubagentSource({ pendingSubagents: pending })
    const payload = (await source.load()) as SubagentSourcePayload
    const encoded = source.codec.encode(payload)
    const decoded = source.codec.decode(encoded)
    expect(decoded.subagentIds).toEqual(['bg-1'])
  })
})

describe('fragment source: checkpoint', () => {
  it('renders checkpoint id when available', async () => {
    const source = createCheckpointSource({ checkpointId: 'ckpt-1' })
    const payload = (await source.load()) as CheckpointSourcePayload
    expect(payload.checkpointId).toBe('ckpt-1')
    expect(payload.text).toContain('ckpt-1')
  })

  it('renders no-checkpoint message when null', async () => {
    const source = createCheckpointSource({ checkpointId: null })
    const payload = (await source.load()) as CheckpointSourcePayload
    expect(payload.checkpointId).toBeNull()
    expect(payload.text).toContain('No checkpoint')
  })

  it('is Unavailable when checkpointId is undefined', async () => {
    const source = createCheckpointSource({})
    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(true)
  })

  it('round-trips through codec', async () => {
    const source = createCheckpointSource({ checkpointId: 'ckpt-2' })
    const payload = (await source.load()) as CheckpointSourcePayload
    const encoded = source.codec.encode(payload)
    const decoded = source.codec.decode(encoded)
    expect(decoded.checkpointId).toBe('ckpt-2')
  })
})

describe('fragment source: permission', () => {
  it('renders the permission mode', async () => {
    const source = createPermissionSource({ permissionMode: 'full' })
    const payload = (await source.load()) as PermissionSourcePayload
    expect(payload.mode).toBe('full')
    expect(payload.text).toContain('full')
  })

  it('is Unavailable when permissionMode is undefined', async () => {
    const source = createPermissionSource({})
    const payload = await source.load()
    expect(isUnavailable(payload)).toBe(true)
  })

  it('round-trips through codec', async () => {
    const source = createPermissionSource({ permissionMode: 'chat' })
    const payload = (await source.load()) as PermissionSourcePayload
    const encoded = source.codec.encode(payload)
    const decoded = source.codec.decode(encoded)
    expect(decoded.mode).toBe('chat')
  })

  it('codec defaults invalid mode to edit', async () => {
    const source = createPermissionSource({ permissionMode: 'full' })
    const decoded = source.codec.decode({ text: '', mode: 'invalid' })
    expect(decoded.mode).toBe('edit')
  })
})
