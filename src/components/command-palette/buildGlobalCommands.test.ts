import { describe, it, expect, vi } from 'vitest'
import type { SessionVM } from '@/domain'
import {
  buildGlobalCommandGroups,
  buildThemePageGroups,
  pickRecentSessions,
  RECENT_SESSION_LIMIT,
  type GlobalCommandLabels,
} from './buildGlobalCommands'

const labels: GlobalCommandLabels = {
  groupNavigation: 'Navigation',
  groupActions: 'Actions',
  groupTheme: 'Theme',
  groupSessions: 'Sessions',
  groupContext: 'Suggested',
  groupWorkspace: 'Workspace',
  groupAppearance: 'Appearance',
  navChat: 'Work',
  navCode: 'Coding',
  navHistory: 'History',
  navSettings: 'Settings',
  actionNewConversation: 'New conversation',
  actionKeyboardShortcuts: 'Keyboard shortcuts',
  actionChangeTheme: 'Change theme…',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'System',
  current: 'Current',
  settings: {
    general: 'Settings: General',
    model: 'Settings: Model',
    agents: 'Settings: Agents',
    mcp: 'Settings: MCP',
    skill: 'Settings: Skills',
    plugins: 'Settings: Plugins',
    memory: 'Settings: Memory',
  },
  context: {
    diff: 'Show workspace changes',
    compact: 'Compact conversation',
    init: 'Initialize project',
    memoryOn: 'Enable memories',
    memoryOff: 'Disable memories',
    memoryIncognito: 'Incognito memory',
    memoryStatus: 'Memory status',
  },
}

function stubSession(partial: Partial<SessionVM> & { id: string }): SessionVM {
  return {
    config: { llmProvider: 'openai', model: 'gpt-4o', tools: [], surface: 'chat' },
    title: '',
    preview: '',
    updatedAtMs: 0,
    loaded: true,
    messages: [],
    status: 'idle',
    error: null,
    ...partial,
  }
}

function makeCtx(overrides: Partial<Parameters<typeof buildGlobalCommandGroups>[0]> = {}) {
  return {
    sessions: [] as SessionVM[],
    activeView: 'chat' as const,
    theme: 'system' as const,
    labels,
    sessionId: null as string | null,
    setActiveView: vi.fn(),
    setTheme: vi.fn(),
    setSettingsPage: vi.fn(),
    newConversation: vi.fn(),
    selectSession: vi.fn(),
    openShortcutsHelp: vi.fn(),
    memoryStatusCopy: (flags: { use: string; generate: string; incognito: string }) => ({
      title: 'Memory status',
      body: `${flags.use}/${flags.generate}/${flags.incognito}`,
    }),
    isMac: true,
    ...overrides,
  }
}

describe('pickRecentSessions', () => {
  it('sorts by updatedAtMs desc and caps at RECENT_SESSION_LIMIT', () => {
    const sessions = Array.from({ length: RECENT_SESSION_LIMIT + 5 }, (_, i) =>
      stubSession({ id: `s${i}`, updatedAtMs: i * 1000, title: `T${i}` }),
    )
    const recent = pickRecentSessions(sessions)
    expect(recent).toHaveLength(RECENT_SESSION_LIMIT)
    expect(recent[0].id).toBe(`s${RECENT_SESSION_LIMIT + 4}`)
  })
})

describe('buildGlobalCommandGroups', () => {
  it('omits sessions and flat theme modes on empty search', () => {
    const groups = buildGlobalCommandGroups(
      makeCtx({
        sessions: [stubSession({ id: 'abc', title: 'Hello', updatedAtMs: 10 })],
      }),
      { search: '' },
    )
    const ids = groups.flatMap((g) => g.items.map((i) => i.id))
    expect(ids).not.toContain('session-abc')
    expect(ids).not.toContain('theme-dark')
    expect(ids).toContain('appearance-theme')
    expect(ids).toContain('action-new-conversation')
    expect(ids).toContain('settings-model')
    expect(ids).toContain('nav-settings')
  })

  it('includes sessions when search is non-empty', () => {
    const ctx = makeCtx({
      sessions: [
        stubSession({ id: 'old', title: 'Old chat', updatedAtMs: 1 }),
        stubSession({ id: 'new', title: 'New chat', updatedAtMs: 99 }),
        stubSession({ id: 'mid', title: '', preview: 'hello preview', updatedAtMs: 50 }),
      ],
    })
    const groups = buildGlobalCommandGroups(ctx, { search: 'chat' })
    expect(groups.map((g) => g.heading)).toContain('Sessions')
    const sessionGroup = groups.find((g) => g.heading === 'Sessions')!
    expect(sessionGroup.items.map((i) => i.id)).toEqual([
      'session-new',
      'session-mid',
      'session-old',
    ])
    expect(sessionGroup.items[0].label).toBe('New chat')
    expect(sessionGroup.items[1].label).toBe('hello preview')
  })

  it('session item run calls selectSession with session id', () => {
    const ctx = makeCtx({
      sessions: [stubSession({ id: 'abc', title: 'Hello', updatedAtMs: 10 })],
    })
    const groups = buildGlobalCommandGroups(ctx, { search: 'Hello' })
    const item = groups.flatMap((g) => g.items).find((i) => i.id === 'session-abc')!
    item.run?.()
    expect(ctx.selectSession).toHaveBeenCalledWith('abc')
  })

  it('runs setActiveView for navigation items', () => {
    const ctx = makeCtx()
    const groups = buildGlobalCommandGroups(ctx)
    const settings = groups.flatMap((g) => g.items).find((i) => i.id === 'nav-settings')!
    settings.run?.()
    expect(ctx.setActiveView).toHaveBeenCalledWith('settings')
  })

  it('settings deep-link sets page and view', () => {
    const ctx = makeCtx()
    const groups = buildGlobalCommandGroups(ctx)
    const memory = groups.flatMap((g) => g.items).find((i) => i.id === 'settings-model')!
    memory.run?.()
    expect(ctx.setSettingsPage).toHaveBeenCalledWith('model')
    expect(ctx.setActiveView).toHaveBeenCalledWith('settings')
  })

  it('includes all settings pages when searching', () => {
    const groups = buildGlobalCommandGroups(makeCtx(), { search: 'settings' })
    const ids = groups.flatMap((g) => g.items.map((i) => i.id))
    expect(ids).toContain('settings-general')
    expect(ids).toContain('settings-plugins')
    expect(ids).toContain('settings-agents')
  })

  it('new conversation uses code surface when activeView is code', () => {
    const ctx = makeCtx({ activeView: 'code' })
    const groups = buildGlobalCommandGroups(ctx)
    const item = groups.flatMap((g) => g.items).find((i) => i.id === 'action-new-conversation')!
    item.run?.()
    expect(ctx.newConversation).toHaveBeenCalledWith('code')
  })

  it('new conversation defaults to chat for settings/history views', () => {
    const ctx = makeCtx({ activeView: 'settings' })
    const groups = buildGlobalCommandGroups(ctx)
    const item = groups.flatMap((g) => g.items).find((i) => i.id === 'action-new-conversation')!
    item.run?.()
    expect(ctx.newConversation).toHaveBeenCalledWith('chat')
  })

  it('includes ctx-diff only for code + session', () => {
    const no = buildGlobalCommandGroups(makeCtx({ activeView: 'code', sessionId: null }))
    expect(no.flatMap((g) => g.items).some((i) => i.id === 'ctx-diff')).toBe(false)

    const yes = buildGlobalCommandGroups(makeCtx({ activeView: 'code', sessionId: 's1' }))
    expect(yes.flatMap((g) => g.items).some((i) => i.id === 'ctx-diff')).toBe(true)
  })

  it('includes memory-on when sessionId set', () => {
    const groups = buildGlobalCommandGroups(makeCtx({ sessionId: 's1' }))
    expect(groups.flatMap((g) => g.items).some((i) => i.id === 'ctx-memory-on')).toBe(true)
  })

  it('omits session-gated memory commands without session', () => {
    const groups = buildGlobalCommandGroups(makeCtx({ sessionId: null }))
    const ids = groups.flatMap((g) => g.items).map((i) => i.id)
    expect(ids).not.toContain('ctx-memory-on')
    expect(ids).toContain('ctx-memory-settings')
  })

  it('appearance-theme has to: theme', () => {
    const groups = buildGlobalCommandGroups(makeCtx())
    const item = groups.flatMap((g) => g.items).find((i) => i.id === 'appearance-theme')!
    expect(item.to).toBe('theme')
  })

  it('keyboard shortcuts command opens help', () => {
    const ctx = makeCtx()
    const groups = buildGlobalCommandGroups(ctx)
    const item = groups.flatMap((g) => g.items).find((i) => i.id === 'action-keyboard-shortcuts')!
    item.run?.()
    expect(ctx.openShortcutsHelp).toHaveBeenCalled()
  })
})

describe('buildThemePageGroups', () => {
  it('lists theme modes with keepOpen and active marker', () => {
    const ctx = makeCtx({ theme: 'dark' })
    const groups = buildThemePageGroups(ctx)
    const dark = groups[0].items.find((i) => i.id === 'theme-dark')!
    expect(dark.keepOpen).toBe(true)
    expect(dark.active).toBe(true)
    dark.run?.()
    expect(ctx.setTheme).toHaveBeenCalledWith('dark')
  })
})
