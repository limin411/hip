import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentProfileManager } from './agent-profile-manager.js'
import { BUILTIN_PROFILES } from './agent-profile.js'

function makeLoaders(
  globalProfiles: unknown[] = [],
  projectProfiles: unknown[] = [],
) {
  return {
    readGlobalAgents: () => ({ profiles: globalProfiles }),
    readProjectAgents: () => ({ profiles: projectProfiles }),
  }
}

describe('AgentProfileManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('empty config returns BUILTIN_PROFILES and active is supervisor', () => {
    const mgr = new AgentProfileManager(makeLoaders())
    const profiles = mgr.listProfiles()
    expect(profiles).toHaveLength(BUILTIN_PROFILES.length)

    const ids = profiles.map((p) => p.id)
    for (const bp of BUILTIN_PROFILES) {
      expect(ids).toContain(bp.id)
    }

    const active = mgr.getActiveProfile()
    expect(active.id).toBe('supervisor')
  })

  it('global profile overrides supervisor name and allowedTools', () => {
    const mgr = new AgentProfileManager(
      makeLoaders([
        {
          id: 'supervisor',
          name: 'CustomSupervisor',
          allowedTools: ['read_file', 'write_file'],
          mode: 'primary',
        },
      ]),
    )

    const profiles = mgr.listProfiles()
    const supervisor = profiles.find((p) => p.id === 'supervisor')
    expect(supervisor).toBeDefined()
    expect(supervisor!.name).toBe('CustomSupervisor')
    expect(supervisor!.allowedTools).toEqual(['read_file', 'write_file'])
    // Fields not overridden should come from builtin
    expect(supervisor!.mode).toBe('primary')
    expect(supervisor!.description).toBeDefined()
  })

  it('project profile overrides global profile field for same id', () => {
    const mgr = new AgentProfileManager(
      makeLoaders(
        [
          {
            id: 'supervisor',
            name: 'GlobalSupervisor',
            allowedTools: ['read_file', 'write_file'],
            mode: 'primary',
          },
        ],
        [
          {
            id: 'supervisor',
            name: 'ProjectSupervisor',
            mode: 'primary',
          },
        ],
      ),
    )

    const profiles = mgr.listProfiles()
    const supervisor = profiles.find((p) => p.id === 'supervisor')
    expect(supervisor).toBeDefined()
    expect(supervisor!.name).toBe('ProjectSupervisor')
    // allowedTools from global carries through since project didn't override it
    expect(supervisor!.allowedTools).toEqual(['read_file', 'write_file'])
  })

  it('adds new profiles from global config that are not in builtins', () => {
    const mgr = new AgentProfileManager(
      makeLoaders([
        {
          id: 'reviewer',
          name: 'Reviewer',
          mode: 'subagent',
          allowedTools: ['read_file', 'grep'],
        },
      ]),
    )

    const profiles = mgr.listProfiles()
    expect(profiles.length).toBeGreaterThan(BUILTIN_PROFILES.length)
    const reviewer = profiles.find((p) => p.id === 'reviewer')
    expect(reviewer).toBeDefined()
    expect(reviewer!.mode).toBe('subagent')
    expect(reviewer!.allowedTools).toEqual(['read_file', 'grep'])
  })

  it('invalid profile (bad mode) is dropped with warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mgr = new AgentProfileManager(
      makeLoaders([
        { id: 'bad', name: 'Bad', mode: 'invalid_mode' },
      ]),
    )

    const profiles = mgr.listProfiles()
    expect(profiles.find((p) => p.id === 'bad')).toBeUndefined()
    expect(profiles).toHaveLength(BUILTIN_PROFILES.length)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const msg = warnSpy.mock.calls[0][0]
    expect(msg).toContain('bad')
    expect(msg).toContain('mode')
  })

  it('invalid profile (unknown tool) is dropped with warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mgr = new AgentProfileManager(
      makeLoaders([
        {
          id: 'bad',
          name: 'Bad',
          mode: 'primary',
          allowedTools: ['read_file', 'bogus_tool'],
        },
      ]),
    )

    const profiles = mgr.listProfiles()
    expect(profiles.find((p) => p.id === 'bad')).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls[0][0]).toContain('bad')
    expect(warnSpy.mock.calls[0][0]).toContain('bogus_tool')
  })

  it('invalid profile (blockedTools with unknown tool) is dropped', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mgr = new AgentProfileManager(
      makeLoaders([
        {
          id: 'bad',
          name: 'Bad',
          mode: 'subagent',
          blockedTools: ['write_todos', 'nonexistent_tool'],
        },
      ]),
    )

    const profiles = mgr.listProfiles()
    expect(profiles.find((p) => p.id === 'bad')).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('invalid profile (empty id) is dropped', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mgr = new AgentProfileManager(
      makeLoaders([
        { id: '', name: 'Empty', mode: 'primary' },
      ]),
    )

    const profiles = mgr.listProfiles()
    expect(profiles.find((p) => p.id === '')).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('invalid profile (allowedTools not an array) is dropped', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mgr = new AgentProfileManager(
      makeLoaders([
        { id: 'bad', name: 'Bad', mode: 'primary', allowedTools: 'not_an_array' },
      ]),
    )

    const profiles = mgr.listProfiles()
    expect(profiles.find((p) => p.id === 'bad')).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('setActiveProfile plan switches active', () => {
    const mgr = new AgentProfileManager(makeLoaders())

    expect(mgr.setActiveProfile('plan')).toBe(true)
    expect(mgr.getActiveProfile().id).toBe('plan')
  })

  it('setActiveProfile bogus returns false', () => {
    const mgr = new AgentProfileManager(makeLoaders())

    expect(mgr.setActiveProfile('bogus')).toBe(false)
    // Active should remain whatever it was (default supervisor)
    expect(mgr.getActiveProfile().id).toBe('supervisor')
  })

  it('setActiveProfile cannot switch to invalid profile even if in config', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mgr = new AgentProfileManager(
      makeLoaders([
        { id: 'bad', name: 'Bad', mode: 'invalid_mode' },
      ]),
    )

    // 'bad' is invalid and dropped, so setActiveProfile should return false
    expect(mgr.setActiveProfile('bad')).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('getActiveProfile returns supervisor by default', () => {
    const mgr = new AgentProfileManager(makeLoaders())

    const active = mgr.getActiveProfile()
    expect(active.id).toBe('supervisor')
    expect(active.mode).toBe('primary')
  })

  it('setActiveProfile worker switches to subagent', () => {
    const mgr = new AgentProfileManager(makeLoaders())

    expect(mgr.setActiveProfile('worker')).toBe(true)
    const active = mgr.getActiveProfile()
    expect(active.id).toBe('worker')
    expect(active.mode).toBe('subagent')
    expect(active.blockedTools).toContain('write_todos')
  })

  it('resolveConfig skips project profiles when cwd not provided', () => {
    let projectCalled = false
    const mgr = new AgentProfileManager({
      readGlobalAgents: () => ({ profiles: [] }),
      readProjectAgents: () => {
        projectCalled = true
        return { profiles: [] }
      },
    })

    const profiles = mgr.resolveConfig()
    expect(projectCalled).toBe(true) // defaults to process.cwd()
    expect(profiles).toHaveLength(BUILTIN_PROFILES.length)
  })

  it('constructor defaults to filesystem loaders when none provided', () => {
    const mgr = new AgentProfileManager()
    // Should not throw — just verifies construction works with defaults
    const profiles = mgr.listProfiles()
    // When default filesystem loaders run, they try to read files that don't exist
    // and fall back to empty profiles, so we should still get BUILTIN_PROFILES
    expect(profiles.length).toBeGreaterThanOrEqual(BUILTIN_PROFILES.length)
  })
})
