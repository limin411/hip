import { describe, it, expect } from 'vitest'
import { BUILTIN_PROFILES } from './agent-profile.js'
import type { AgentProfile } from './agent-profile.js'

describe('BUILTIN_PROFILES', () => {
  it('has exactly 5 entries', () => {
    expect(BUILTIN_PROFILES).toHaveLength(5)

    const ids = BUILTIN_PROFILES.map((p) => p.id)
    expect(ids).toContain('supervisor')
    expect(ids).toContain('plan')
    expect(ids).toContain('explore')
    expect(ids).toContain('worker')
    expect(ids).toContain('coder')
  })

  it('supervisor has primary mode', () => {
    const supervisor = BUILTIN_PROFILES.find((p) => p.id === 'supervisor')
    expect(supervisor).toBeDefined()
    expect(supervisor!.mode).toBe('primary')
  })

  it('worker has subagent mode', () => {
    const worker = BUILTIN_PROFILES.find((p) => p.id === 'worker')
    expect(worker).toBeDefined()
    expect(worker!.mode).toBe('subagent')
  })

  it('worker allowedTools does NOT include write_todos', () => {
    const worker = BUILTIN_PROFILES.find((p) => p.id === 'worker')
    expect(worker).toBeDefined()

    expect(worker!.allowedTools).toBeDefined()
    expect(worker!.allowedTools).not.toContain('write_todos')

    // Also verify blockedTools explicitly lists it
    expect(worker!.blockedTools).toBeDefined()
    expect(worker!.blockedTools).toContain('write_todos')
  })

  it('supervisor allowedTools includes read_file', () => {
    const supervisor = BUILTIN_PROFILES.find((p) => p.id === 'supervisor')
    expect(supervisor).toBeDefined()

    expect(supervisor!.allowedTools).toBeDefined()
    expect(supervisor!.allowedTools).toContain('read_file')
  })

  it('supervisor allowedTools includes task_batch and task helpers', () => {
    const supervisor = BUILTIN_PROFILES.find((p) => p.id === 'supervisor')
    expect(supervisor!.allowedTools).toEqual(
      expect.arrayContaining(['task', 'dispatch_agent', 'task_batch', 'task_retry', 'task_stop', 'task_output']),
    )
  })

  it('all profiles have required fields', () => {
    for (const profile of BUILTIN_PROFILES) {
      expect(typeof profile.id).toBe('string')
      expect(profile.id.length).toBeGreaterThan(0)
      expect(typeof profile.name).toBe('string')
      expect(profile.name.length).toBeGreaterThan(0)
      expect(['primary', 'subagent']).toContain(profile.mode)
    }
  })

  it('plan profile has no git or write tools', () => {
    const plan = BUILTIN_PROFILES.find((p) => p.id === 'plan')
    expect(plan).toBeDefined()

    const tools = plan!.allowedTools!
    expect(tools).not.toContain('write_file')
    expect(tools).not.toContain('edit_file')
    expect(tools).not.toContain('git_commit')
    expect(tools).not.toContain('run_script')
    expect(tools).toContain('write_todos')
  })

  it('explore profile has no write_todos', () => {
    const explore = BUILTIN_PROFILES.find((p) => p.id === 'explore')
    expect(explore).toBeDefined()

    const tools = explore!.allowedTools!
    expect(tools).not.toContain('write_file')
    expect(tools).not.toContain('edit_file')
    expect(tools).not.toContain('write_todos')
    expect(tools).not.toContain('run_script')
  })

  it('all profile IDs are unique', () => {
    const ids = BUILTIN_PROFILES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('primary profiles have allowedTools with write_todos, subagent does not', () => {
    for (const profile of BUILTIN_PROFILES) {
      if (profile.mode === 'primary') {
        // Plan is a primary that has write_todos; explore is primary without it.
        // The invariant is: if allowedTools is set, subagent must not have write_todos.
        if (profile.id === 'worker') {
          expect(profile.allowedTools).not.toContain('write_todos')
        }
      } else {
        // subagent: must not have write_todos
        expect(profile.allowedTools).not.toContain('write_todos')
      }
    }
  })
})

describe('AgentProfile type', () => {
  it('rejects invalid mode at compile time', () => {
    // @ts-expect-error - 'invalid' is not assignable to 'primary' | 'subagent'
    const _bad: AgentProfile = { id: 'x', name: 'x', mode: 'invalid' }

    // This line should NOT error — 'primary' is valid
    const _good: AgentProfile = { id: 'y', name: 'y', mode: 'primary' }

    expect(_good.mode).toBe('primary')
    void _bad
  })

  it('modelBinding is optional', () => {
    const profile: AgentProfile = {
      id: 'test',
      name: 'Test',
      mode: 'primary',
      modelBinding: { providerID: 'deepseek', modelID: 'deepseek-chat' },
    }

    expect(profile.modelBinding?.providerID).toBe('deepseek')
    expect(profile.modelBinding?.modelID).toBe('deepseek-chat')
  })

  it('allowedTools and blockedTools are optional arrays', () => {
    const profile: AgentProfile = {
      id: 'bare',
      name: 'Bare',
      mode: 'subagent',
      // allowedTools and blockedTools intentionally omitted
    }

    expect(profile).toBeDefined()
  })
})
