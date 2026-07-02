// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { PluginMeta, McpServerConfig } from '@hip/protocol'
import { useDomainStore } from '@/domain/sessionStore'
import { usePluginsStore } from '@/store/pluginsStore'
import { wsClient } from '@/ipc/ws-client'
import { listPlugins } from '@/ipc/plugins'
import { PluginConfigView, formatComponentCounts, installStatusLabel } from './PluginConfigView'
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

vi.mock('@/ipc/ws-client', () => ({
  wsClient: { send: vi.fn() },
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

describe('installStatusLabel', () => {
  it('maps each progress status to its translation key', () => {
    expect(installStatusLabel('cloning', mockT)).toBe('settings.plugins.statusCloning')
    expect(installStatusLabel('scanning', mockT)).toBe('settings.plugins.statusScanning')
    expect(installStatusLabel('generating_manifest', mockT)).toBe('settings.plugins.statusGeneratingManifest')
    expect(installStatusLabel('registering', mockT)).toBe('settings.plugins.statusRegistering')
  })

  it('maps terminal statuses', () => {
    expect(installStatusLabel('done', mockT)).toBe('settings.plugins.statusDone')
    expect(installStatusLabel('error', mockT)).toBe('settings.plugins.statusError')
  })

  it('returns empty string for null or undefined', () => {
    expect(installStatusLabel(null, mockT)).toBe('')
    expect(installStatusLabel(undefined, mockT)).toBe('')
  })
})

describe('PluginConfigView', () => {
  const baseProps = {
    plugins: [],
    pluginInstall: null,
    showForm: false,
    url: '',
    submitted: false,
    error: null,
    success: false,
    onShowForm: vi.fn(),
    onHideForm: vi.fn(),
    onUrlChange: vi.fn(),
    onSubmit: vi.fn(),
    onRetry: vi.fn(),
    onDelete: vi.fn(),
    t: mockT,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders empty state when no plugins are installed', () => {
    render(<PluginConfigView {...baseProps} />)
    expect(screen.getByText('settings.plugins.empty')).toBeInTheDocument()
    expect(screen.getByText('settings.plugins.emptyHint')).toBeInTheDocument()
  })

  it('renders plugin cards with component counts', () => {
    const plugins = [
      basePlugin({
        skills: ['s1'],
        mcpServers: [{ id: 'm1', name: 'M1', transport: 'stdio', enabled: true }],
        agents: ['a1'],
        hookCount: 2,
      }),
    ]
    render(<PluginConfigView {...baseProps} plugins={plugins} />)
    expect(screen.getByText('Test Plugin')).toBeInTheDocument()
    expect(screen.getByText('A test plugin')).toBeInTheDocument()
    expect(screen.getByText('1 skills · 1 MCP · 1 agents · 2 hooks')).toBeInTheDocument()
  })

  it('calls onDelete with the correct plugin when uninstall is clicked', () => {
    const plugins = [
      basePlugin({ id: 'plugin-a', name: 'Plugin A' }),
      basePlugin({ id: 'plugin-b', name: 'Plugin B' }),
    ]
    render(<PluginConfigView {...baseProps} plugins={plugins} />)
    const uninstallButtons = screen.getAllByRole('button', { name: 'settings.plugins.uninstall' })
    expect(uninstallButtons).toHaveLength(2)
    fireEvent.click(uninstallButtons[0])
    expect(baseProps.onDelete).toHaveBeenCalledTimes(1)
    expect(baseProps.onDelete).toHaveBeenCalledWith(plugins[0])
  })

  it('toggles install form visibility', () => {
    const { rerender } = render(<PluginConfigView {...baseProps} />)
    expect(screen.queryByPlaceholderText('settings.plugins.urlPlaceholder')).not.toBeInTheDocument()

    rerender(<PluginConfigView {...baseProps} showForm url="https://example.com/repo.git" />)
    expect(screen.getByPlaceholderText('settings.plugins.urlPlaceholder')).toBeInTheDocument()
  })

  it('shows progress message during installation', () => {
    render(
      <PluginConfigView
        {...baseProps}
        showForm
        url="https://example.com/repo.git"
        submitted
        pluginInstall={{ status: 'scanning', message: 'found 3 skills' }}
      />,
    )
    expect(screen.getByText(/settings.plugins.statusScanning/)).toBeInTheDocument()
  })

  it('shows success and error result messages', () => {
    const { rerender } = render(<PluginConfigView {...baseProps} success />)
    expect(screen.getByText('settings.plugins.installSuccess')).toBeInTheDocument()

    rerender(<PluginConfigView {...baseProps} error="install failed" />)
    expect(screen.getByText('install failed')).toBeInTheDocument()
    expect(screen.getByText('settings.plugins.retry')).toBeInTheDocument()
  })
})

describe('PluginConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDomainStore.setState({ pluginInstall: null })
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

  it('sends plugin:install:url on install submit', async () => {
    render(<PluginConfig />)

    fireEvent.click(screen.getByText('settings.plugins.install'))
    fireEvent.change(screen.getByPlaceholderText('settings.plugins.urlPlaceholder'), {
      target: { value: 'https://github.com/owner/repo.git' },
    })
    fireEvent.click(screen.getAllByText('settings.plugins.install')[1])

    await waitFor(() => {
      expect(wsClient.send).toHaveBeenCalledWith({
        type: 'plugin:install:url',
        url: 'https://github.com/owner/repo.git',
      })
    })
  })
})
