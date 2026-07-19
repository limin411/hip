// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { PluginMeta, McpServerConfig } from '@hip/protocol'
import { usePluginsStore } from '@/store/pluginsStore'
import { listPlugins, setPluginEnabled } from '@/ipc/plugins'
import { PluginConfigView, formatComponentCounts } from './PluginConfigView'
import { PluginConfig } from './PluginConfig'

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

const mockT = (key: string, options?: Record<string, unknown>) => {
  if (key === 'settings.plugins.componentCounts') {
    return `${options?.skills} skills · ${options?.mcpServers} MCP · ${options?.agents} agents · ${options?.hooks} hooks`
  }
  if (key === 'settings.plugins.viewTitle') return `Plugin: ${options?.name}`
  if (key === 'settings.plugins.hookCountOnly') return `${options?.count} hooks`
  return key
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

describe('PluginConfigView', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders empty marketplace with no install control', () => {
    render(
      <PluginConfigView
        plugins={[]}
        error={null}
        onDelete={vi.fn()}
        onToggle={vi.fn()}
        onView={vi.fn()}
        t={mockT}
      />,
    )
    expect(screen.getByTestId('plugin-market-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-install-open')).not.toBeInTheDocument()
  })

  it('renders view button, enable switch, and uninstall', () => {
    const onToggle = vi.fn()
    const onView = vi.fn()
    render(
      <PluginConfigView
        plugins={[
          basePlugin({
            skills: ['s1'],
            enabled: true,
            keywords: ['git'],
          }),
        ]}
        error={null}
        onDelete={vi.fn()}
        onToggle={onToggle}
        onView={onView}
        t={mockT}
      />,
    )
    expect(screen.getByTestId('plugin-view')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-uninstall')).toBeInTheDocument()
    const sw = screen.getByTestId('plugin-enable-test-plugin')
    expect(sw).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sw)
    expect(onToggle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-plugin' }),
      false,
    )
    fireEvent.click(screen.getByTestId('plugin-view'))
    expect(onView).toHaveBeenCalled()
  })

  it('opens source URL via shell when 来源 is clicked', async () => {
    shellOpen.mockClear()
    render(
      <PluginConfigView
        plugins={[
          basePlugin({
            sourceUrl: 'https://github.com/obra/superpowers',
          }),
        ]}
        error={null}
        onDelete={vi.fn()}
        onToggle={vi.fn()}
        onView={vi.fn()}
        t={mockT}
      />,
    )
    const link = screen.getByTestId('plugin-source-link')
    expect(link).toHaveAttribute('href', 'https://github.com/obra/superpowers')
    fireEvent.click(link)
    await waitFor(() => {
      expect(shellOpen).toHaveBeenCalledWith('https://github.com/obra/superpowers')
    })
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

  it('toggles plugin enabled via store', async () => {
    const plugin = basePlugin({ enabled: true })
    usePluginsStore.setState({ plugins: [plugin], loaded: true })
    vi.mocked(listPlugins).mockResolvedValue([{ ...plugin, enabled: false }])

    render(<PluginConfig />)

    fireEvent.click(screen.getByTestId('plugin-enable-test-plugin'))

    await waitFor(() => {
      expect(setPluginEnabled).toHaveBeenCalledWith('test-plugin', false)
    })
  })

  it('opens view modal', async () => {
    const plugin = basePlugin({ hasPluginMd: true, skills: ['a'] })
    usePluginsStore.setState({ plugins: [plugin], loaded: true })

    render(<PluginConfig />)

    fireEvent.click(screen.getByTestId('plugin-view'))
    await waitFor(() => {
      expect(screen.getByTestId('plugin-view-modal')).toBeInTheDocument()
    })
    expect(screen.getByText('settings.plugins.skillsSection')).toBeInTheDocument()
  })
})
