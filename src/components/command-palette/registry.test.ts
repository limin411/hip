import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildAllGroups,
  clearCommandProviders,
  registerCommandProvider,
  skillsCommandProvider,
} from './registry'
import type { GlobalCommandContext, GlobalCommandLabels } from './buildGlobalCommands'
import { registerComposerHandlers, registerComposerInserter } from './composerBridge'

const labels: GlobalCommandLabels = {
  groupNavigation: 'Navigation',
  groupActions: 'Actions',
  groupTheme: 'Theme',
  groupSessions: 'Sessions',
  groupContext: 'Suggested',
  groupWorkspace: 'Workspace',
  groupAppearance: 'Appearance',
  groupSkills: 'Skills',
  groupFavorites: 'Favorites',
  groupKnowledge: 'Knowledge',
  navChat: 'Work',
  navCode: 'Coding',
  navHistory: 'History',
  navTrash: 'Recycle bin',
  navSettings: 'Settings',
  navKnowledge: 'Knowledge base',
  knowledgeHome: 'Knowledge home',
  knowledgeNewDoc: 'New knowledge document',
  knowledgeIndexing: 'Search index is building…',
  knowledgeNeedSpace: 'Open a knowledge space first',
  actionNewConversation: 'New conversation',
  actionKeyboardShortcuts: 'Keyboard shortcuts',
  actionChangeTheme: 'Change theme…',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'System',
  current: 'Current',
  settings: {
    general: 'Settings: General',
    voice: 'Settings: Voice',
    window: 'Settings: Window',
    model: 'Settings: Model',
    agents: 'Settings: Agents',
    mcp: 'Settings: MCP',
    connectors: 'Settings: Connectors',
    skill: 'Settings: Skills',
    plugins: 'Settings: Plugins',
    hooks: 'Settings: Hooks',
    memory: 'Settings: Memory',
  },
  context: {
    diff: 'Show workspace changes',
    compact: 'Compact conversation',
    init: 'Create or update AGENTS.md',
    plan: 'Force plan mode',
    planOff: 'Exit plan mode',
    memoryOn: 'Enable memories',
    memoryOff: 'Disable memories',
    memoryIncognito: 'Incognito memory',
    memoryIncognitoOff: 'Exit incognito',
    memoryStatus: 'Memory status',
    needSession: 'Open a conversation…',
    needSessionHint: 'Session actions need an active session',
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
    const replace = vi.fn()
    registerComposerHandlers({ insert, replace })
    const groups = skillsCommandProvider(
      makeCtx({
        search: 'pdf',
        skills: [{ id: 'pdf', name: 'pdf', description: 'PDF tools', dir: '/tmp/pdf', hasScripts: false }],
      }),
    )
    expect(groups[0]?.items[0]?.id).toBe('skill-pdf')
    groups[0]?.items[0]?.run?.()
    expect(insert).toHaveBeenCalledWith('/pdf ')
    expect(replace).not.toHaveBeenCalled()
  })

  it('skills provider excludes disabled skills', () => {
    const groups = skillsCommandProvider(
      makeCtx({
        search: 'pdf',
        skills: [
          { id: 'pdf', name: 'pdf', description: 'PDF', dir: '/tmp/pdf', hasScripts: false },
          { id: 'off', name: 'off', description: 'Off', dir: '/tmp/off', hasScripts: false },
        ],
        skillsEnabled: { off: false },
      }),
    )
    const ids = groups[0]?.items.map((i) => i.id) ?? []
    expect(ids).toContain('skill-pdf')
    expect(ids).not.toContain('skill-off')
  })

  it('runSkillHandoff selects session when composer is missing then replaces', async () => {
    const { runSkillHandoff } = await import('./registry')
    const selectSession = vi.fn()
    // No inserter initially
    registerComposerInserter(null)
    const p = runSkillHandoff('pdf', { sessionId: 's1', selectSession })
    // After selectSession, register inserter (simulates InputBar mount)
    expect(selectSession).toHaveBeenCalledWith('s1')
    const insert = vi.fn()
    registerComposerInserter(insert)
    await p
    expect(insert).toHaveBeenCalledWith('/pdf ')
  })
})
