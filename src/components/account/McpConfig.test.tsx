// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, screen } from '@testing-library/react'
import { derivePluginMcpServers, McpConfig } from './McpConfig'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { usePluginsStore } from '@/store/pluginsStore'
import { wsClient } from '@/ipc/ws-client'
import type { McpServerConfig, PluginMeta } from '@hip/protocol'

vi.mock(import('react-i18next'), async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  } as any
})

type McpMenuProps = {
  kind: string
  payload: { serverId: string; onEdit: () => void; onDelete: () => void }
  children: React.ReactNode
}

let lastMcpMenuProps: McpMenuProps | null = null

vi.mock('@/components/context-menu', () => ({
  DeclarativeContextMenu: (props: McpMenuProps) => {
    lastMcpMenuProps = props
    return <>{props.children}</>
  },
}))

vi.mock('@/ipc/ws-client', () => ({
  wsClient: {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    onStatus: vi.fn(() => () => {}),
    start: vi.fn(),
    disconnect: vi.fn(),
  },
}))

function makeServer(id: string, overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    id,
    name: `Server ${id}`,
    transport: 'stdio',
    command: 'npx',
    enabled: true,
    ...overrides,
  }
}

function makePlugin(id: string, name: string, servers: McpServerConfig[]): PluginMeta {
  return {
    id,
    name,
    version: '1.0.0',
    description: '',
    dir: `/tmp/plugins/${id}`,
    skills: [],
    mcpServers: servers,
    agents: [],
    hookCount: 0,
  }
}

describe('derivePluginMcpServers', () => {
  it('includes plugin MCP servers that are not standalone', () => {
    const standalone = new Set(['standalone-1'])
    const plugin = makePlugin('plugin-a', 'Plugin A', [makeServer('plugin-mcp-1')])

    const result = derivePluginMcpServers([plugin], standalone)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('plugin-mcp-1')
    expect(result[0].pluginId).toBe('plugin-a')
    expect(result[0].pluginName).toBe('Plugin A')
  })

  it('hides plugin MCP server when its id collides with a standalone server', () => {
    const standalone = new Set<string>(['shared-id'])
    const plugin = makePlugin('plugin-a', 'Plugin A', [makeServer('shared-id')])

    const result = derivePluginMcpServers([plugin], standalone)

    expect(result).toHaveLength(0)
  })

  it('keeps the first plugin server when two plugins export the same id', () => {
    const standalone = new Set<string>()
    const pluginA = makePlugin('plugin-a', 'Plugin A', [makeServer('dup-id', { name: 'A Server' })])
    const pluginB = makePlugin('plugin-b', 'Plugin B', [makeServer('dup-id', { name: 'B Server' })])

    const result = derivePluginMcpServers([pluginA, pluginB], standalone)

    expect(result).toHaveLength(1)
    expect(result[0].pluginId).toBe('plugin-a')
    expect(result[0].pluginName).toBe('Plugin A')
    expect(result[0].name).toBe('A Server')
  })

  it('returns multiple distinct plugin servers across plugins', () => {
    const standalone = new Set<string>()
    const pluginA = makePlugin('plugin-a', 'Plugin A', [makeServer('a-1')])
    const pluginB = makePlugin('plugin-b', 'Plugin B', [makeServer('b-1')])

    const result = derivePluginMcpServers([pluginA, pluginB], standalone)

    expect(result).toHaveLength(2)
    expect(result.map((s) => s.id)).toEqual(['a-1', 'b-1'])
  })

  it('preserves server config fields on derived entries', () => {
    const standalone = new Set<string>()
    const server = makeServer('s-1', {
      transport: 'sse',
      url: 'https://example.com/mcp',
      enabled: false,
    })
    const plugin = makePlugin('plugin-a', 'Plugin A', [server])

    const result = derivePluginMcpServers([plugin], standalone)

    expect(result[0]).toMatchObject({
      id: 's-1',
      name: 'Server s-1',
      transport: 'sse',
      url: 'https://example.com/mcp',
      enabled: false,
      pluginId: 'plugin-a',
      pluginName: 'Plugin A',
    })
  })
})

describe('McpConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastMcpMenuProps = null
    useHipConfigStore.setState({
      config: { version: 1, mcpServers: [] },
      loaded: true,
      error: null,
    })
    usePluginsStore.setState({ plugins: [], loaded: true })
  })

  afterEach(() => {
    cleanup()
  })

  it('wires DeclarativeContextMenu on standalone server cards', async () => {
    useHipConfigStore.setState({
      config: {
        version: 1,
        mcpServers: [
          {
            id: 'standalone-1',
            name: 'Standalone Server',
            transport: 'stdio',
            command: 'npx',
            enabled: true,
          },
        ],
      },
      loaded: true,
    })

    render(<McpConfig />)

    await waitFor(() => {
      expect(screen.getByTestId('mcp-server-card')).toBeInTheDocument()
    })
    expect(lastMcpMenuProps?.kind).toBe('mcpServer')
    expect(lastMcpMenuProps?.payload.serverId).toBe('standalone-1')
    expect(typeof lastMcpMenuProps?.payload.onEdit).toBe('function')
    expect(typeof lastMcpMenuProps?.payload.onDelete).toBe('function')
  })

  it('sends mcp:reconnect automatically after config and plugins are loaded', async () => {
    useHipConfigStore.setState({
      config: {
        version: 1,
        mcpServers: [
          {
            id: 'standalone-1',
            name: 'Standalone Server',
            transport: 'stdio',
            command: 'npx',
            enabled: true,
          },
        ],
      },
      loaded: true,
    })

    render(<McpConfig />)

    await waitFor(() => {
      expect(wsClient.send).toHaveBeenCalledWith({
        type: 'mcp:reconnect',
        servers: expect.arrayContaining([
          expect.objectContaining({ id: 'standalone-1', name: 'Standalone Server' }),
        ]),
      })
    })
  })

  it('includes plugin-provided MCP servers in the auto reconnect', async () => {
    useHipConfigStore.setState({ config: { version: 1, mcpServers: [] }, loaded: true })
    usePluginsStore.setState({
      plugins: [
        makePlugin('plugin-a', 'Plugin A', [
          makeServer('plugin-mcp-1', { name: 'Plugin MCP Server' }),
        ]),
      ],
      loaded: true,
    })

    render(<McpConfig />)

    await waitFor(() => {
      expect(wsClient.send).toHaveBeenCalledWith({
        type: 'mcp:reconnect',
        servers: expect.arrayContaining([
          expect.objectContaining({ id: 'plugin-mcp-1', name: 'Plugin MCP Server' }),
        ]),
      })
    })
  })
})
