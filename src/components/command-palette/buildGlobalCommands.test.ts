import { describe, it, expect, vi } from 'vitest'
import type { SessionVM } from '@/domain'
import {
  buildGlobalCommandGroups,
  pickRecentSessions,
  RECENT_SESSION_LIMIT,
  type GlobalCommandLabels,
} from './buildGlobalCommands'

const labels: GlobalCommandLabels = {
  groupNavigation: 'Navigation',
  groupActions: 'Actions',
  groupTheme: 'Theme',
  groupSessions: 'Recent sessions',
  navChat: 'Work',
  navCode: 'Coding',
  navHistory: 'History',
  navSettings: 'Settings',
  actionNewConversation: 'New conversation',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'System',
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
    setActiveView: vi.fn(),
    setTheme: vi.fn(),
    newConversation: vi.fn(),
    selectSession: vi.fn(),
    ...overrides,
  }
}

describe('pickRecentSessions', () => {
  it('sorts by updatedAtMs desc and caps at RECENT_SESSION_LIMIT', () => {
    const sessions = Array.from({ length: 15 }, (_, i) =>
      stubSession({ id: `s${i}`, updatedAtMs: i * 1000, title: `T${i}` }),
    )
    const recent = pickRecentSessions(sessions)
    expect(recent).toHaveLength(RECENT_SESSION_LIMIT)
    expect(recent[0].id).toBe('s14')
    expect(recent[9].id).toBe('s5')
  })
})

describe('buildGlobalCommandGroups', () => {
  it('includes navigation, actions, and theme groups without sessions group when empty', () => {
    const groups = buildGlobalCommandGroups(makeCtx())
    expect(groups.map((g) => g.heading)).toEqual(['Navigation', 'Actions', 'Theme'])
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).toEqual([
      'nav-chat',
      'nav-code',
      'nav-history',
      'nav-settings',
      'action-new-conversation',
      'theme-light',
      'theme-dark',
      'theme-system',
    ])
  })

  it('adds recent sessions group sorted by recency with title labels', () => {
    const ctx = makeCtx({
      sessions: [
        stubSession({ id: 'old', title: 'Old chat', updatedAtMs: 1 }),
        stubSession({ id: 'new', title: 'New chat', updatedAtMs: 99 }),
        stubSession({ id: 'mid', title: '', preview: 'hello preview', updatedAtMs: 50 }),
      ],
    })
    const groups = buildGlobalCommandGroups(ctx)
    expect(groups.map((g) => g.heading)).toContain('Recent sessions')
    const sessionGroup = groups.find((g) => g.heading === 'Recent sessions')!
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
    const groups = buildGlobalCommandGroups(ctx)
    const item = groups.flatMap((g) => g.items).find((i) => i.id === 'session-abc')!
    item.run()
    expect(ctx.selectSession).toHaveBeenCalledWith('abc')
  })

  it('runs setActiveView for navigation items', () => {
    const ctx = makeCtx()
    const groups = buildGlobalCommandGroups(ctx)
    const settings = groups[0].items.find((i) => i.id === 'nav-settings')!
    settings.run()
    expect(ctx.setActiveView).toHaveBeenCalledWith('settings')
  })

  it('runs setTheme for theme items', () => {
    const ctx = makeCtx()
    const groups = buildGlobalCommandGroups(ctx)
    const dark = groups[2].items.find((i) => i.id === 'theme-dark')!
    dark.run()
    expect(ctx.setTheme).toHaveBeenCalledWith('dark')
  })

  it('new conversation uses code surface when activeView is code', () => {
    const ctx = makeCtx({ activeView: 'code' })
    const groups = buildGlobalCommandGroups(ctx)
    groups[1].items[0].run()
    expect(ctx.newConversation).toHaveBeenCalledWith('code')
  })

  it('new conversation defaults to chat for settings/history views', () => {
    const ctx = makeCtx({ activeView: 'settings' })
    const groups = buildGlobalCommandGroups(ctx)
    groups[1].items[0].run()
    expect(ctx.newConversation).toHaveBeenCalledWith('chat')
  })
})
