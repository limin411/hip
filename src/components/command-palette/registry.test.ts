import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildAllGroups,
  clearCommandProviders,
  registerCommandProvider,
  skillsCommandProvider,
} from './registry'
import type { GlobalCommandContext, GlobalCommandLabels } from './buildGlobalCommands'
import { registerComposerInserter } from './composerBridge'

const labels: GlobalCommandLabels = {
  groupNavigation: 'Navigation',
  groupActions: 'Actions',
  groupTheme: 'Theme',
  groupSessions: 'Sessions',
  groupContext: 'Suggested',
  groupWorkspace: 'Workspace',
  groupAppearance: 'Appearance',
  groupSkills: 'Skills',
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

function makeCtx(overrides: Partial<GlobalCommandContext> = {}): GlobalCommandContext {
  return {
    sessions: [],
    activeView: 'chat',
    theme: 'system',
    labels,
    sessionId: null,
    setActiveView: vi.fn(),
    setTheme: vi.fn(),
    setSettingsPage: vi.fn(),
    newConversation: vi.fn(),
    selectSession: vi.fn(),
    openShortcutsHelp: vi.fn(),
    memoryStatusCopy: () => ({ title: 't', body: 'b' }),
    isMac: true,
    search: '',
    skills: [],
    ...overrides,
  }
}

describe('registry', () => {
  beforeEach(() => {
    clearCommandProviders()
    registerComposerInserter(null)
  })

  it('buildAllGroups includes core navigation', () => {
    const groups = buildAllGroups(makeCtx())
    const ids = groups.flatMap((g) => g.items.map((i) => i.id))
    expect(ids).toContain('nav-settings')
  })

  it('extra provider injects items', () => {
    registerCommandProvider(() => [
      {
        id: 'extra',
        heading: 'Extra',
        items: [
          {
            id: 'extra-1',
            label: 'Extra command',
            group: 'commands-extra',
            run: () => {},
          },
        ],
      },
    ])
    const groups = buildAllGroups(makeCtx())
    expect(groups.flatMap((g) => g.items).some((i) => i.id === 'extra-1')).toBe(true)
  })

  it('skills provider is empty without search', () => {
    const groups = skillsCommandProvider(
      makeCtx({
        skills: [{ id: 'pdf', name: 'pdf', description: 'PDF tools', dir: '/tmp/pdf', hasScripts: false }],
      }),
    )
    expect(groups).toEqual([])
  })

  it('skills provider lists skills when searching', () => {
    const insert = vi.fn()
    registerComposerInserter(insert)
    const groups = skillsCommandProvider(
      makeCtx({
        search: 'pdf',
        skills: [{ id: 'pdf', name: 'pdf', description: 'PDF tools', dir: '/tmp/pdf', hasScripts: false }],
      }),
    )
    expect(groups[0]?.items[0]?.id).toBe('skill-pdf')
    groups[0]?.items[0]?.run?.()
    expect(insert).toHaveBeenCalledWith('/pdf ')
  })
})
