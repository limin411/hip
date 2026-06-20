import { describe, it, expect } from 'vitest'
import type { FragmentState } from '../context-fragment.js'
import { SystemPromptFragment } from './system-prompt-fragment.js'
import { SkillsFragment } from './skills-fragment.js'
import { TokenBudgetFragment } from './token-budget-fragment.js'
import { CurrentTimeFragment } from './current-time-fragment.js'
import { SubagentNotificationFragment } from './subagent-notification-fragment.js'

// ── SystemPromptFragment ──────────────────────────────────────────────────────

describe('SystemPromptFragment', () => {
  it('isActive returns true when cwd is defined', () => {
    const f = new SystemPromptFragment()
    expect(f.isActive({})).toBe(false)
    expect(f.isActive({ cwd: '/tmp/test' })).toBe(true)
  })

  it('renders identity + cwd block when cwd provided', () => {
    const f = new SystemPromptFragment()
    const text = f.render({ cwd: '/home/user/project' })

    expect(text).toContain('hip')
    expect(text).toContain('/home/user/project')
    expect(text).toContain('Filesystem tools are sandboxed')
  })

  it('renders identity + cwd block with full permission mode', () => {
    const f = new SystemPromptFragment()
    const text = f.render({ cwd: '/tmp', permissionMode: 'full' })

    expect(text).toContain('hip')
    expect(text).toContain('/tmp')
    expect(text).toContain('NOT sandboxed')
  })

  it('estimates tokens using a fixed baseline to avoid double-rendering', () => {
    const f = new SystemPromptFragment()
    const state: FragmentState = { cwd: '/test' }
    expect(f.estimatedTokens(state)).toBe(1200)
  })
})

// ── SkillsFragment ────────────────────────────────────────────────────────────

describe('SkillsFragment', () => {
  it('isActive returns false when skills is empty or cwd missing', () => {
    const f = new SkillsFragment()
    expect(f.isActive({})).toBe(false)
    expect(f.isActive({ cwd: '/tmp' })).toBe(false)
    expect(f.isActive({ skills: [], cwd: '/tmp' })).toBe(false)
    expect(f.isActive({ skills: [{ id: 's1', name: 'Skill 1', description: 'desc', dir: '/d', hasScripts: false }], cwd: '/tmp' })).toBe(true)
  })

  it('renders skills block when skills provided and autoInvoke not false', () => {
    const f = new SkillsFragment()
    const state: FragmentState = {
      skills: [
        { id: 'test-skill', name: 'test-skill', description: 'A test skill', dir: '/skills/t1', hasScripts: false },
        { id: 'hidden', name: 'hidden', description: 'Hidden', dir: '/skills/t2', hasScripts: false, autoInvoke: false },
      ],
      cwd: '/tmp',
    }
    const text = f.render(state)

    expect(text).toContain('## Skills')
    expect(text).toContain('test-skill')
    expect(text).toContain('A test skill')
    // autoInvoke: false should be excluded
    expect(text).not.toContain('hidden')
  })

  it('renders empty string when no auto-invoke skills', () => {
    const f = new SkillsFragment()
    const state: FragmentState = {
      skills: [
        { id: 'hidden', name: 'hidden', description: 'Hidden', dir: '/skills/t2', hasScripts: false, autoInvoke: false },
      ],
      cwd: '/tmp',
    }
    expect(f.render(state)).toBe('')
  })

  it('estimates tokens based on render length / 4', () => {
    const f = new SkillsFragment()
    const state: FragmentState = {
      skills: [{ id: 's1', name: 'Skill', description: 'desc', dir: '/d', hasScripts: false }],
      cwd: '/tmp',
    }
    const text = f.render(state)
    expect(f.estimatedTokens(state)).toBe(Math.ceil(text.length / 4))
  })
})

// ── TokenBudgetFragment ───────────────────────────────────────────────────────

describe('TokenBudgetFragment', () => {
  it('isActive returns true when tokenBudgetPercent is defined and >= 0', () => {
    const f = new TokenBudgetFragment()
    expect(f.isActive({})).toBe(false)
    expect(f.isActive({ tokenBudgetPercent: 0 })).toBe(true)
    expect(f.isActive({ tokenBudgetPercent: 50 })).toBe(true)
    expect(f.isActive({ tokenBudgetPercent: 100 })).toBe(true)
  })

  it('renders warning at 5%', () => {
    const f = new TokenBudgetFragment()
    const text = f.render({ tokenBudgetPercent: 5 })
    expect(text).toContain('nearly exhausted')
  })

  it('renders warning at 10%', () => {
    const f = new TokenBudgetFragment()
    const text = f.render({ tokenBudgetPercent: 10 })
    expect(text).toContain('nearly exhausted')
  })

  it('renders normal text at 30%', () => {
    const f = new TokenBudgetFragment()
    const text = f.render({ tokenBudgetPercent: 30 })
    expect(text).toContain('approximately 30%')
    expect(text).not.toContain('nearly exhausted')
  })

  it('renders normal text at 100%', () => {
    const f = new TokenBudgetFragment()
    const text = f.render({ tokenBudgetPercent: 100 })
    expect(text).toContain('approximately 100%')
  })

  it('estimatedTokens returns 20', () => {
    const f = new TokenBudgetFragment()
    expect(f.estimatedTokens({ tokenBudgetPercent: 50 })).toBe(20)
  })
})

// ── CurrentTimeFragment ───────────────────────────────────────────────────────

describe('CurrentTimeFragment', () => {
  it('isActive always returns true', () => {
    const f = new CurrentTimeFragment()
    expect(f.isActive({})).toBe(true)
    expect(f.isActive({ cwd: '/tmp' })).toBe(true)
  })

  it('renders ISO-like timestamp with UTC label', () => {
    const f = new CurrentTimeFragment()
    const text = f.render({})

    // Should match pattern: "It is YYYY-MM-DD HH:MM:SS UTC."
    expect(text).toMatch(/^It is \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\.$/)
  })

  it('estimatedTokens returns 15', () => {
    const f = new CurrentTimeFragment()
    expect(f.estimatedTokens({})).toBe(15)
  })
})

// ── SubagentNotificationFragment ──────────────────────────────────────────────

describe('SubagentNotificationFragment', () => {
  it('isActive returns true when pendingSubagents has entries', () => {
    const f = new SubagentNotificationFragment()
    expect(f.isActive({})).toBe(false)
    expect(f.isActive({ pendingSubagents: [], completedSubagents: [] })).toBe(false)
    expect(f.isActive({ pendingSubagents: [{ id: 'bg_1', description: 'Test', status: 'running' }] })).toBe(true)
  })

  it('isActive returns true when completedSubagents has entries', () => {
    const f = new SubagentNotificationFragment()
    expect(f.isActive({ completedSubagents: [{ id: 'bg_1', description: 'Done', status: 'completed' }] })).toBe(true)
  })

  it('renders pending section with description and id', () => {
    const f = new SubagentNotificationFragment()
    const text = f.render({
      pendingSubagents: [
        { id: 'bg_1', description: 'Search the web', status: 'running' },
        { id: 'bg_2', description: 'Fetch docs', status: 'running' },
      ],
    })

    expect(text).toContain('Pending background tasks:')
    expect(text).toContain('Search the web (bg_1)')
    expect(text).toContain('Fetch docs (bg_2)')
  })

  it('renders completed section with description, id, and status', () => {
    const f = new SubagentNotificationFragment()
    const text = f.render({
      completedSubagents: [
        { id: 'bg_3', description: 'Write tests', status: 'completed' },
        { id: 'bg_4', description: 'Lint code', status: 'failed' },
      ],
    })

    expect(text).toContain('Completed background tasks:')
    expect(text).toContain('Write tests (bg_3) — completed')
    expect(text).toContain('Lint code (bg_4) — failed')
  })

  it('renders both pending and completed sections separated by double newline', () => {
    const f = new SubagentNotificationFragment()
    const text = f.render({
      pendingSubagents: [{ id: 'bg_1', description: 'Search', status: 'running' }],
      completedSubagents: [{ id: 'bg_2', description: 'Done', status: 'completed' }],
    })

    expect(text).toContain('Pending background tasks:')
    expect(text).toContain('Completed background tasks:')
    expect(text).toContain('\n\n')
    // Order: pending first, then completed
    const pendingIdx = text.indexOf('Pending')
    const completedIdx = text.indexOf('Completed')
    expect(pendingIdx).toBeLessThan(completedIdx)
  })

  it('renders only pending when no completed', () => {
    const f = new SubagentNotificationFragment()
    const text = f.render({
      pendingSubagents: [{ id: 'bg_1', description: 'Search', status: 'running' }],
    })

    expect(text).toContain('Pending')
    expect(text).not.toContain('Completed')
  })

  it('estimatedTokens returns ceil of render length / 4', () => {
    const f = new SubagentNotificationFragment()
    const state: FragmentState = {
      pendingSubagents: [{ id: 'bg_1', description: 'Search', status: 'running' }],
    }
    const text = f.render(state)
    expect(f.estimatedTokens(state)).toBe(Math.ceil(text.length / 4))
  })
})
