// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { PluginMeta, McpServerConfig } from '@hip/protocol'
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

  it('renders empty marketplace when catalog is empty', () => {
    render(<PluginConfigView plugins={[]} t={mockT} />)
    expect(screen.getByTestId('plugin-market-empty')).toBeInTheDocument()
    expect(screen.getByText('settings.plugins.empty')).toBeInTheDocument()
    expect(screen.getByText('settings.plugins.emptyHint')).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-install-open')).not.toBeInTheDocument()
  })

  it('does not offer install or uninstall actions', () => {
    render(
      <PluginConfigView
        plugins={[basePlugin()]}
        t={mockT}
      />,
    )
    expect(screen.queryByText('settings.plugins.install')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.plugins.uninstall')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plugin-install-form')).not.toBeInTheDocument()
  })

  it('renders read-only plugin cards with component counts', () => {
    const plugins = [
      basePlugin({
        skills: ['s1'],
        mcpServers: [{ id: 'm1', name: 'M1', transport: 'stdio', enabled: true }],
        agents: ['a1'],
        hookCount: 2,
      }),
    ]
    render(<PluginConfigView plugins={plugins} t={mockT} />)
    expect(screen.getByText('Test Plugin')).toBeInTheDocument()
    expect(screen.getByText('A test plugin')).toBeInTheDocument()
    expect(screen.getByText('1 skills · 1 MCP · 1 agents · 2 hooks')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-card')).toBeInTheDocument()
  })
})

describe('PluginConfig', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the empty built-in marketplace catalog', () => {
    render(<PluginConfig />)
    expect(screen.getByTestId('plugin-market')).toBeInTheDocument()
    expect(screen.getByTestId('plugin-market-empty')).toBeInTheDocument()
    expect(screen.getByText('settings.plugins.title')).toBeInTheDocument()
    expect(screen.queryByTestId('plugin-install-open')).not.toBeInTheDocument()
  })
})
