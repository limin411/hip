import { describe, it, expect, vi } from 'vitest'
import { buildGlobalCommandGroups, type GlobalCommandLabels } from './buildGlobalCommands'

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

function makeCtx(overrides: Partial<Parameters<typeof buildGlobalCommandGroups>[0]> = {}) {
  return {
    sessions: [],
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

describe('buildGlobalCommandGroups', () => {
  it('includes navigation, actions, and theme groups', () => {
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
