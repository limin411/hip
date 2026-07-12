// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { PluginMeta } from '@hip/protocol'
import { HookConfig } from './HookConfig'
import { HOOK_EVENT_CATALOG, pluginsWithHooks, totalConfiguredHookCount } from './hookCatalog'

const load = vi.fn(async () => {})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'settings.hooks.hookCount') return `${options?.count ?? 0} hooks`
      if (key === 'settings.hooks.configuredSummary') {
        return `${options?.sources} sources · ${options?.count} hooks`
      }
      return key
    },
  }),
}))

vi.mock('@/store/pluginsStore', () => ({
  usePluginsStore: () => ({
    plugins: mockPlugins,
    loaded: mockLoaded,
    load,
  }),
}))

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

let mockPlugins: PluginMeta[] = []
let mockLoaded = true

function plugin(partial: Partial<PluginMeta> & Pick<PluginMeta, 'id' | 'name' | 'hookCount'>): PluginMeta {
  return {
    version: '1.0.0',
    description: '',
    dir: `/plugins/${partial.id}`,
    skills: [],
    mcpServers: [],
    agents: [],
    ...partial,
  }
}

describe('hookCatalog helpers', () => {
  it('lists every supported HookEvent', () => {
    expect(HOOK_EVENT_CATALOG).toContain('PreToolUse')
    expect(HOOK_EVENT_CATALOG).toContain('PermissionRequest')
    expect(HOOK_EVENT_CATALOG).toHaveLength(12)
  })

  it('filters plugins that declare hooks', () => {
    const list = [
      plugin({ id: 'a', name: 'A', hookCount: 0 }),
      plugin({ id: 'b', name: 'B', hookCount: 2 }),
    ]
    expect(pluginsWithHooks(list).map((p) => p.id)).toEqual(['b'])
    expect(totalConfiguredHookCount(list)).toBe(2)
  })
})

describe('HookConfig', () => {
  beforeEach(() => {
    mockPlugins = []
    mockLoaded = true
    load.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders catalog of configurable hook events', () => {
    render(<HookConfig />)
    expect(screen.getByTestId('settings-hooks-page')).toBeInTheDocument()
    for (const event of HOOK_EVENT_CATALOG) {
      expect(screen.getByTestId(`hook-event-${event}`)).toBeInTheDocument()
      expect(screen.getByText(event)).toBeInTheDocument()
    }
  })

  it('shows empty configured state when no plugin declares hooks', () => {
    mockPlugins = [plugin({ id: 'plain', name: 'Plain', hookCount: 0 })]
    render(<HookConfig />)
    expect(screen.getByTestId('hooks-configured-empty')).toBeInTheDocument()
  })

  it('lists plugins that contribute hooks', () => {
    mockPlugins = [
      plugin({ id: 'plain', name: 'Plain', hookCount: 0 }),
      plugin({ id: 'guard', name: 'Guard Plugin', hookCount: 3, dir: '/tmp/guard' }),
    ]
    render(<HookConfig />)
    expect(screen.getByTestId('hook-source-guard')).toBeInTheDocument()
    expect(screen.getByText('Guard Plugin')).toBeInTheDocument()
    expect(screen.getByText('3 hooks')).toBeInTheDocument()
    expect(screen.getByText('/tmp/guard')).toBeInTheDocument()
    expect(screen.queryByTestId('hook-source-plain')).not.toBeInTheDocument()
  })

  it('loads plugins when store is not yet loaded', () => {
    mockLoaded = false
    render(<HookConfig />)
    expect(load).toHaveBeenCalled()
  })
})
