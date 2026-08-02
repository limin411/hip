import { describe, it, expect } from 'vitest'
import {
  ContextInjectorRegistry,
  SystemPromptInjector,
  CurrentTimeInjector,
  SkillsListInjector,
  PermissionModeInjector,
  TokenBudgetInjector,
  SubagentStatusInjector,
  TerminalContextInjector,
  type InjectorState,
} from './context-injector.js'

const baseState: InjectorState = {
  cwd: '/tmp/project',
  permissionMode: 'edit',
  skills: [],
  tokenBudgetPercent: 100,
}

describe('ContextInjectorRegistry', () => {
  it('returns empty array when no injectors are registered', async () => {
    const registry = new ContextInjectorRegistry()
    const results = await registry.injectAll(baseState)
    expect(results).toEqual([])
  })

  it('runs injectors in registration order', async () => {
    const registry = new ContextInjectorRegistry()
    registry.register(new PermissionModeInjector())
    registry.register(new TokenBudgetInjector())

    const results = await registry.injectAll(baseState)
    expect(results).toHaveLength(2)
    expect(results[0].systemMessages[0]).toMatch(/Code|project sandbox/i)
    expect(results[0].systemMessages[0]).not.toMatch(/Current permission mode:\s*edit/)
    // tokenBudgetPercent = 100 >= 30 → no messages
    expect(results[1].systemMessages).toEqual([])
  })

  it('runs all 6 default injectors', async () => {
    const registry = new ContextInjectorRegistry()
    registry.register(new SystemPromptInjector())
    registry.register(new CurrentTimeInjector())
    registry.register(new SkillsListInjector())
    registry.register(new PermissionModeInjector())
    registry.register(new TokenBudgetInjector())
    registry.register(new SubagentStatusInjector())

    const results = await registry.injectAll(baseState)
    expect(results).toHaveLength(6)
  })
})

describe('CurrentTimeInjector', () => {
  it('always injects a local + UTC time block', async () => {
    const injector = new CurrentTimeInjector()
    const result = await injector.inject(baseState)
    expect(result.systemMessages).toHaveLength(1)
    expect(result.systemMessages[0]).toMatch(
      /^Current local time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:00 \(.+, UTC[+-].+\)\.\nUTC: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:00\.$/,
    )
  })
})

describe('SystemPromptInjector', () => {
  it('produces a system prompt containing the identity block', async () => {
    const injector = new SystemPromptInjector()
    const result = await injector.inject(baseState)

    expect(result.systemMessages).toHaveLength(1)
    expect(result.systemMessages[0]).toContain('hip')
    expect(result.systemMessages[0]).toContain('/tmp/project')
  })

  it('includes permission mode context in the prompt', async () => {
    const injector = new SystemPromptInjector()
    const full = await injector.inject({ ...baseState, permissionMode: 'full' })
    const chat = await injector.inject({ ...baseState, permissionMode: 'chat' })

    expect(full.systemMessages[0]).toContain('full filesystem access')
    expect(chat.systemMessages[0]).toContain('READ-ONLY mode')
  })

  it('includes skills block when skills are provided', async () => {
    const injector = new SystemPromptInjector()
    const state: InjectorState = {
      ...baseState,
      skills: [{ id: 's1', name: 'test-skill', description: 'A test skill', dir: '/tmp/skills/s1', hasScripts: false, autoInvoke: true }],
    }

    const result = await injector.inject(state)
    expect(result.systemMessages[0]).toContain('## Skills')
    expect(result.systemMessages[0]).toContain('test-skill')
  })
})

describe('SkillsListInjector', () => {
  it('returns empty when no skills are available', async () => {
    const injector = new SkillsListInjector()
    const result = await injector.inject(baseState)
    expect(result.systemMessages).toEqual([])
  })

  it('produces a skills block when skills are provided', async () => {
    const injector = new SkillsListInjector()
    const state: InjectorState = {
      ...baseState,
      skills: [
        { id: 's1', name: 'alpha', description: 'First skill', dir: '/tmp/skills/a', hasScripts: false, autoInvoke: true },
        { id: 's2', name: 'beta', description: 'Second skill', dir: '/tmp/skills/b', hasScripts: false, autoInvoke: true },
      ],
    }

    const result = await injector.inject(state)
    expect(result.systemMessages.length).toBeGreaterThan(0)
    expect(result.systemMessages[0]).toContain('## Skills')
    expect(result.systemMessages[0]).toContain('alpha')
    expect(result.systemMessages[0]).toContain('beta')
  })

  it('filters out skills with autoInvoke === false', async () => {
    const injector = new SkillsListInjector()
    const state: InjectorState = {
      ...baseState,
      skills: [
        { id: 's1', name: 'visible', description: 'Auto-enabled', dir: '/tmp/skills/v', hasScripts: false, autoInvoke: true },
        { id: 's2', name: 'hidden', description: 'Disabled', dir: '/tmp/skills/h', hasScripts: false, autoInvoke: false },
      ],
    }

    const result = await injector.inject(state)
    expect(result.systemMessages[0]).toContain('visible')
    expect(result.systemMessages[0]).not.toContain('hidden')
  })
})

describe('PermissionModeInjector', () => {
  it('produces project-sandbox narrative for Code+edit (never bare edit token)', async () => {
    const injector = new PermissionModeInjector()
    const result = await injector.inject({ ...baseState, surface: 'code', permissionMode: 'edit' })
    expect(result.systemMessages).toHaveLength(1)
    expect(result.systemMessages[0]).toMatch(/project sandbox/i)
    expect(result.systemMessages[0]).not.toMatch(/Current permission mode:\s*edit/)
  })

  it('produces Chat narrative that denies Code edit mode', async () => {
    const injector = new PermissionModeInjector()
    const result = await injector.inject({ ...baseState, surface: 'chat', permissionMode: 'edit' })
    expect(result.systemMessages[0]).toMatch(/Chat/i)
    expect(result.systemMessages[0]).toMatch(/not.*Code edit mode/i)
    expect(result.systemMessages[0]).not.toMatch(/Current permission mode/i)
  })

  it('produces read-only narrative for Code+chat permission', async () => {
    const injector = new PermissionModeInjector()
    const result = await injector.inject({ ...baseState, surface: 'code', permissionMode: 'chat' })
    expect(result.systemMessages[0]).toMatch(/read-only/i)
  })

  it('produces full filesystem narrative for Code+full', async () => {
    const injector = new PermissionModeInjector()
    const result = await injector.inject({ ...baseState, surface: 'code', permissionMode: 'full' })
    expect(result.systemMessages[0]).toMatch(/full filesystem/i)
  })
})

describe('TokenBudgetInjector', () => {
  it('returns empty when budget is 30% or above', async () => {
    const injector = new TokenBudgetInjector()
    const result = await injector.inject({ ...baseState, tokenBudgetPercent: 30 })
    expect(result.systemMessages).toEqual([])
  })

  it('returns empty when budget is 100%', async () => {
    const injector = new TokenBudgetInjector()
    const result = await injector.inject({ ...baseState, tokenBudgetPercent: 100 })
    expect(result.systemMessages).toEqual([])
  })

  it('produces a warning when budget is between 11% and 29%', async () => {
    const injector = new TokenBudgetInjector()
    const result = await injector.inject({ ...baseState, tokenBudgetPercent: 25 })
    expect(result.systemMessages).toEqual([
      'You have approximately 25% of your token budget remaining.',
    ])
  })

  it('produces an emergency warning when budget is 10% or below', async () => {
    const injector = new TokenBudgetInjector()
    const result = await injector.inject({ ...baseState, tokenBudgetPercent: 5 })
    expect(result.systemMessages).toEqual([
      'Your token budget is nearly exhausted. Finish quickly or compact the conversation.',
    ])
  })

  it('produces emergency warning at exactly 10%', async () => {
    const injector = new TokenBudgetInjector()
    const result = await injector.inject({ ...baseState, tokenBudgetPercent: 10 })
    expect(result.systemMessages).toEqual([
      'Your token budget is nearly exhausted. Finish quickly or compact the conversation.',
    ])
  })
})

describe('SubagentStatusInjector', () => {
  it('returns empty when no subagents are present', async () => {
    const injector = new SubagentStatusInjector()
    const result = await injector.inject(baseState)
    expect(result.systemMessages).toEqual([])
  })

  it('lists pending subagents', async () => {
    const injector = new SubagentStatusInjector()
    const state: InjectorState = {
      ...baseState,
      pendingSubagents: [
        { id: 'sub-1', description: 'Searching codebase', status: 'running' },
      ],
    }
    const result = await injector.inject(state)
    expect(result.systemMessages).toHaveLength(1)
    expect(result.systemMessages[0]).toContain('Pending background tasks')
    expect(result.systemMessages[0]).toContain('Searching codebase')
    expect(result.systemMessages[0]).toContain('sub-1')
  })

  it('lists completed subagents', async () => {
    const injector = new SubagentStatusInjector()
    const state: InjectorState = {
      ...baseState,
      completedSubagents: [
        { id: 'sub-2', description: 'Linting files', status: 'completed' },
      ],
    }
    const result = await injector.inject(state)
    expect(result.systemMessages).toHaveLength(1)
    expect(result.systemMessages[0]).toContain('Completed background tasks')
    expect(result.systemMessages[0]).toContain('Linting files')
    expect(result.systemMessages[0]).toContain('sub-2')
    expect(result.systemMessages[0]).toContain('completed')
  })

  it('shows both pending and completed subagents as separate sections', async () => {
    const injector = new SubagentStatusInjector()
    const state: InjectorState = {
      ...baseState,
      pendingSubagents: [
        { id: 'sub-1', description: 'Searching codebase', status: 'running' },
      ],
      completedSubagents: [
        { id: 'sub-2', description: 'Linting files', status: 'completed' },
        { id: 'sub-3', description: 'Running tests', status: 'failed' },
      ],
    }
    const result = await injector.inject(state)
    expect(result.systemMessages).toHaveLength(2)
    expect(result.systemMessages[0]).toContain('Pending background tasks')
    expect(result.systemMessages[1]).toContain('Completed background tasks')
    expect(result.systemMessages[1]).toContain('failed')
  })

  it('TerminalContextInjector injects ring tail + D11 note only on terminal surface', async () => {
    const injector = new TerminalContextInjector()
    const nonTerminal = await injector.inject({ ...baseState, surface: 'code' })
    expect(nonTerminal.systemMessages).toHaveLength(0)
    const result = await injector.inject({
      ...baseState,
      surface: 'terminal',
      terminalMeta: { managedTerminalId: 'tm_1', hostId: 'hst_1', remotePathHint: '/var/www' },
      terminalContext: {
        note: 'state may have changed',
        ringTail: '$ whoami\nroot\n$ ',
      },
    })
    expect(result.systemMessages).toHaveLength(1)
    expect(result.systemMessages[0]).toContain('tm_1')
    expect(result.systemMessages[0]).toContain('hst_1')
    expect(result.systemMessages[0]).toContain('/var/www')
    expect(result.systemMessages[0]).toContain('state may have changed')
    expect(result.systemMessages[0]).toContain('whoami')
  })
})
