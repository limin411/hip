// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { PluginMeta, McpServerConfig, MarketPluginEntry } from '@hip/protocol'
import {
  PluginConfigView,
  formatComponentCounts,
  filterLocalPlugins,
} from './PluginConfigView'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'settings.plugins.componentCounts') {
        return `${options?.skills} skills · ${options?.mcpServers} MCP · ${options?.agents} agents · ${options?.hooks} hooks`
      }
      if (key === 'settings.plugins.viewTitle') return `Plugin: ${options?.name}`
      return key
    },
  }),
}))

vi.mock('@/ipc/plugins', () => ({
  listPlugins: vi.fn().mockResolvedValue([]),
  installPluginZip: vi.fn().mockResolvedValue(''),
  deletePlugin: vi.fn().mockResolvedValue(undefined),
  setPluginEnabled: vi.fn().mockResolvedValue(undefined),
  readPluginFile: vi.fn().mockResolvedValue('---\nname: x\n---\n# Hello'),
}))

vi.mock('@/components/chat/MarkdownBody', () => ({
  MarkdownBody: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}))

const shellOpen = vi.fn(async (_path?: string) => {})
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: (path?: string) => shellOpen(path),
}))

function basePlugin(overrides: Partial<PluginMeta> = {}): PluginMeta {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    dir: '/tmp/plugins/test',
    skills: [] as string[],
    mcpServers: [] as McpServerConfig[],
    agents: [] as string[],
    hookCount: 0,
    hookEvents: [],
    enabled: true,
    ...overrides,
  }
}

function marketEntry(overrides: Partial<MarketPluginEntry> = {}): MarketPluginEntry {
  return {
    key: 'grok-official::demo',
    marketSourceId: 'grok-official',
    marketKind: 'grok',
    name: 'demo',
    description: 'Demo plugin',
    install: {
      kind: 'git',
      url: 'https://github.com/example/demo.git',
    },
    downloadState: 'not_downloaded',
    enabled: false,
    ...overrides,
  }
}

const mockT = (key: string, options?: Record<string, unknown>) => {
  if (key === 'settings.plugins.componentCounts') {
    return `${options?.skills} skills · ${options?.mcpServers} MCP · ${options?.agents} agents · ${options?.hooks} hooks`
  }
  if (key === 'settings.plugins.viewTitle') return `Plugin: ${options?.name}`
  if (key === 'settings.plugins.hookCountOnly') return `${options?.count} hooks`
  return key
}

const baseViewProps = {
  plugins: [] as PluginMeta[],
  marketEntries: [] as MarketPluginEntry[],
  sources: [
    {
      id: 'grok-official' as const,
      kind: 'grok' as const,
      name: 'Grok',
      description: '',
      catalogRepo: '',
      catalogUrl: '',
      enabled: true,
    },
    {
      id: 'claude-official' as const,
      kind: 'claude' as const,
      name: 'Claude',
      description: '',
      catalogRepo: '',
      catalogUrl: '',
      enabled: true,
    },
  ],
  tab: 'custom' as const,
  query: '',
  error: null as string | null,
  onTabChange: vi.fn(),
  onQueryChange: vi.fn(),
  onDelete: vi.fn(),
  onToggle: vi.fn(),
  onView: vi.fn(),
  onDownload: vi.fn(),
  onMarketToggle: vi.fn(),
  onMarketUninstall: vi.fn(),
  onOpenSources: vi.fn(),
  onRefreshCatalog: vi.fn(),
  t: mockT,
}

describe('formatComponentCounts', () => {
  it('formats mixed counts', () => {
    const result = formatComponentCounts(
      basePlugin({
        skills: ['a', 'b', 'c'],
        mcpServers: [{ id: 'm1', name: 'M1', transport: 'stdio', enabled: true }],
        agents: [],
        hookCount: 2,
      }),
      mockT,
    )
    expect(result).toBe('3 skills · 1 MCP · 0 agents · 2 hooks')
  })
})

describe('filterLocalPlugins', () => {
  it('excludes official market provenance and filters by query', () => {
    const list = [
      basePlugin({ id: 'local', name: 'Local One' }),
      basePlugin({
        id: 'from-grok',
        name: 'Grok P',
        marketSourceId: 'grok-official',
      }),
    ]
    expect(filterLocalPlugins(list, '').map((p) => p.id)).toEqual(['local'])
    expect(filterLocalPlugins(list, 'local').map((p) => p.id)).toEqual(['local'])
    expect(filterLocalPlugins(list, 'missing')).toEqual([])
  })
})

describe('PluginConfigView', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders search, tabs, and empty custom market', () => {
    render(<PluginConfigView {...baseViewProps} />)
    expect(screen.getByTestId('plugin-market-search')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-market-tabs')).toBeInTheDocument()
    expect(screen.getByTestId('marketplace-sources-open')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-market-empty')).toBeInTheDocument()
  })

  it('renders local plugin card with enable and uninstall', () => {
    const onToggle = vi.fn()
    const onView = vi.fn()
    render(
      <PluginConfigView
        {...baseViewProps}
        plugins={[
          basePlugin({
            skills: ['s1'],
            enabled: true,
            keywords: ['git'],
          }),
        ]}
        onToggle={onToggle}
        onView={onView}
      />,
    )
    expect(screen.getByTestId('plugin-view')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-uninstall')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('plugin-view'))
    expect(onView).toHaveBeenCalled()
  })

  it('renders market download card on grok tab entries', () => {
    const onDownload = vi.fn()
    render(
      <PluginConfigView
        {...baseViewProps}
        tab="grok"
        marketEntries={[marketEntry()]}
        onDownload={onDownload}
      />,
    )
    expect(screen.getByTestId('market-plugin-card')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('market-plugin-download'))
    expect(onDownload).toHaveBeenCalled()
  })

  it('shows dual-state badge for downloaded disabled entry', () => {
    render(
      <PluginConfigView
        {...baseViewProps}
        tab="claude"
        marketEntries={[
          marketEntry({
            key: 'claude-official::x',
            marketSourceId: 'claude-official',
            marketKind: 'claude',
            downloadState: 'downloaded',
            enabled: false,
            localPluginId: 'x',
          }),
        ]}
      />,
    )
    expect(screen.getByText('settings.plugins.stateDownloadedDisabled')).toBeInTheDocument()
    expect(screen.getByTestId('market-plugin-uninstall')).toBeInTheDocument()
  })
})
