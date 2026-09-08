import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildAllGroups,
  buildKnowledgeRecentDocsGroup,
  clearCommandProviders,
  knowledgeCommandProvider,
  registerCommandProvider,
  skillsCommandProvider,
} from './registry'
import type { GlobalCommandContext, GlobalCommandLabels, KnowledgeDocHit } from './buildGlobalCommands'
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
    updates: 'Settings: Update check',
    voice: 'Settings: Voice',
    window: 'Settings: Window',
    model: 'Settings: Model',
    agents: 'Settings: Agents',
    mcp: 'Settings: MCP',
    keyManagement: 'Settings: Key Management',
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

describe('knowledge ⌘K providers (V2-S1)', () => {
  const docs = (): KnowledgeDocHit[] => [
    {
      spaceId: 'sp',
      docId: 'd1',
      title: 'Alpha report',
      spaceName: 'Manual',
      path: '/guide',
      score: 2,
      snippet: 'harness core ability here',
    },
    {
      spaceId: 'sp',
      docId: 'd2',
      title: 'Beta roadmap',
      spaceName: 'Manual',
      path: '/plan',
      score: 1,
      snippet: '阶段 0–3、风险对策',
    },
  ]
  const recent = [
    { spaceId: 'sp', docId: 'r1', title: '版本发布说明', spaceName: 'Manual', at: 1_700_000_000_000 },
    { spaceId: 'sp', docId: 'r2', title: '用户指南', spaceName: 'Manual', at: 1_700_000_000_000 },
  ]

  it('emits nothing on empty query (docs hidden)', () => {
    expect(knowledgeCommandProvider(makeCtx({ search: '' }))).toEqual([])
  })

  it('emits recent docs group (search-time) then docs group with count', () => {
    const ctx = makeCtx({
      search: 'harness',
      recentDocs: recent,
      searchKnowledgeDocs: docs,
      knowledgeIndexReady: true,
      labels: { ...labels, groupDocs: 'Docs', groupRecentDocs: 'Recent docs' },
    })
    const groups = knowledgeCommandProvider(ctx)
    expect(groups[0]?.id).toBe('knowledge-recent')
    expect(groups[0]?.heading).toBe('Recent docs')
    expect(groups[0]?.items).toHaveLength(2)
    expect(groups[0]?.items[0]?.run).toBeTypeOf('function')
    expect(groups[1]?.id).toBe('knowledge')
    // Count badge: `Docs (2)` — i18n count key interpolates group + count.
    expect(groups[1]?.heading).toContain('2')
    expect(groups[1]?.items).toHaveLength(2)
    expect(groups[1]?.items[0]?.id).toBe('knowledge-doc-sp-d1')
  })

  it('doc row description is breadcrumb + snippet without newline leak', () => {
    const ctx = makeCtx({
      search: 'harness',
      searchKnowledgeDocs: () => [
        {
          spaceId: 'sp',
          docId: 'd9',
          title: 'Long doc',
          spaceName: 'Manual',
          path: '/deep/nested',
          score: 1,
          snippet: 'first line\nsecond\tline  ',
        },
      ],
      knowledgeIndexReady: true,
      labels: { ...labels, groupDocs: 'Docs' },
    })
    const groups = knowledgeCommandProvider(ctx)
    const desc = groups[0]?.items[0]?.description ?? ''
    expect(desc).toContain('/deep/nested')
    expect(desc).not.toMatch(/[\n\r]/)
  })

  it('doc row run carries the search query for reveal', () => {
    const open = vi.fn()
    const ctx = makeCtx({
      search: 'harness',
      searchKnowledgeDocs: docs,
      knowledgeIndexReady: true,
      openKnowledgeDoc: open,
      labels: { ...labels, groupDocs: 'Docs' },
    })
    const groups = knowledgeCommandProvider(ctx)
    groups[0]?.items[0]?.run?.()
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'sp', docId: 'd1', query: 'harness' }),
    )
  })

  it('recent-docs group caps at limit; null when empty', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      spaceId: 'sp',
      docId: `d${i}`,
      title: `T${i}`,
      spaceName: 'S',
      at: 1_700_000_000_000 + i,
    }))
    const g = buildKnowledgeRecentDocsGroup(
      makeCtx({ recentDocs: many, labels: { ...labels, groupRecentDocs: 'Recent docs' } }),
      3,
    )
    expect(g?.items).toHaveLength(3)
    expect(buildKnowledgeRecentDocsGroup(makeCtx({ recentDocs: [] }))).toBeNull()
  })

  it('shows indexing placeholder when index not ready', () => {
    const groups = knowledgeCommandProvider(
      makeCtx({
        search: 'x',
        searchKnowledgeDocs: docs,
        knowledgeIndexReady: false,
      }),
    )
    expect(groups[0]?.items[0]?.id).toBe('knowledge-indexing')
  })

  it('buildAllGroups includes docs + recent groups when searching', () => {
    const ctx = makeCtx({
      search: 'harness',
      recentDocs: recent,
      searchKnowledgeDocs: docs,
      knowledgeIndexReady: true,
      labels: { ...labels, groupDocs: 'Docs', groupRecentDocs: 'Recent docs' },
    })
    const groups = buildAllGroups(ctx, { search: 'harness' })
    const ids = groups.map((g) => g.id)
    expect(ids).toContain('knowledge')
    expect(ids).toContain('knowledge-recent')
  })
})
