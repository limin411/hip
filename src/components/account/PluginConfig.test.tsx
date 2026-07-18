// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import type { PluginMeta, McpServerConfig } from '@hip/protocol'
import { usePluginsStore } from '@/store/pluginsStore'
import { listPlugins } from '@/ipc/plugins'
import { PluginConfigView, formatComponentCounts } from './PluginConfigView'
import { PluginConfig } from './PluginConfig'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'settings.plugins.componentCounts') {
        return `${options?.skills} skills · ${options?.mcpServers} MCP · ${options?.agents} agents · ${options?.hooks} hooks`
      }
      return key
    },
  }),
}))

vi.mock('@/ipc/plugins', () => ({
  listPlugins: vi.fn().mockResolvedValue([]),
  installPluginZip: vi.fn().mockResolvedValue(''),
  deletePlugin: vi.fn().mockResolvedValue(undefined),
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
    ...overrides,
  }
}

const mockT = (key: string, options?: Record<string, unknown>) => {
  if (key === 'settings.plugins.componentCounts') {
    return `${options?.skills} skills · ${options?.mcpServers} MCP · ${options?.agents} agents · ${options?.hooks} hooks`
  }
  return key
}

describe('formatComponentCounts', () => {
  it('formats zero counts', () => {
    const result = formatComponentCounts(basePlugin(), mockT)
    expect(result).toBe('0 skills · 0 MCP · 0 agents · 0 hooks')
  })

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

describe('PluginConfigView', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders empty marketplace with no install control', () => {
    render(<PluginConfigView plugins={[]} error={null} onDelete={vi.fn()} t={mockT} />)
    expect(screen.getByTestId('plugin-market-empty')).toBeInTheDocument()
    expect(screen.getByText('settings.plugins.empty')).toBeInTheDocument()
    expect(screen.getByText('settings.plugins.emptyHint')).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-install-open')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plugin-install-form')).not.toBeInTheDocument()
  })

  it('renders plugin cards with component counts and uninstall', () => {
    const plugins = [
      basePlugin({
        skills: ['s1'],
        mcpServers: [{ id: 'm1', name: 'M1', transport: 'stdio', enabled: true }],
        agents: ['a1'],
        hookCount: 2,
        sourceUrl: 'https://github.com/org/repo',
        keywords: ['git'],
      }),
    ]
    render(<PluginConfigView plugins={plugins} error={null} onDelete={vi.fn()} t={mockT} />)
    expect(screen.getByText('Test Plugin')).toBeInTheDocument()
    expect(screen.getByText('A test plugin')).toBeInTheDocument()
    expect(screen.getByText('1 skills · 1 MCP · 1 agents · 2 hooks')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-card')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-uninstall')).toBeInTheDocument()
    expect(screen.getByText('git')).toBeInTheDocument()
    expect(screen.getByText('settings.plugins.source')).toBeInTheDocument()
  })

  it('shows uninstall error banner', () => {
    render(
      <PluginConfigView plugins={[]} error="remove failed" onDelete={vi.fn()} t={mockT} />,
    )
    expect(screen.getByText('remove failed')).toBeInTheDocument()
  })
})

describe('PluginConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePluginsStore.setState({ plugins: [], loaded: true })
  })

  afterEach(() => {
    cleanup()
  })

  it('loads plugins on mount', async () => {
    const plugin = basePlugin()
    vi.mocked(listPlugins).mockResolvedValueOnce([plugin])
    usePluginsStore.setState({ loaded: false })

    render(<PluginConfig />)

    await waitFor(() => {
      expect(screen.getByText('Test Plugin')).toBeInTheDocument()
    })
  })

  it('does not offer install affordances', () => {
    render(<PluginConfig />)
    expect(screen.queryByTestId('plugin-install-open')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plugin-install-form')).not.toBeInTheDocument()
  })
})
