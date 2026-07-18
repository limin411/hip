// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { PluginMeta } from '@hip/protocol'
import {
  HOOK_EVENT_CATALOG,
  HOOK_EVENT_PATH_NOTE_KEYS,
  HOOK_EVENT_PHASES,
  configuredHookEvents,
  pluginsWithHooks,
  sourcesByHookEvent,
  totalConfiguredHookCount,
} from './hookCatalog'

const load = vi.fn(async () => {})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'settings.hooks.hookCount') return `${options?.count ?? 0} hooks`
      if (key === 'settings.hooks.configuredSummary') {
        return `${options?.sources} plugins · ${options?.count} hooks`
      }
      if (key === 'settings.hooks.eventsOn') return `${options?.count} events`
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

import { HookConfig } from './HookConfig'

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
    hookEvents: [],
    enabled: true,
    ...partial,
  }
}

describe('hookCatalog helpers', () => {
  it('lists every supported HookEvent', () => {
    expect(HOOK_EVENT_CATALOG).toHaveLength(12)
  })

  it('has path-note keys for every catalog event', () => {
    expect(Object.keys(HOOK_EVENT_PATH_NOTE_KEYS)).toHaveLength(HOOK_EVENT_CATALOG.length)
    for (const event of HOOK_EVENT_CATALOG) {
      expect(HOOK_EVENT_PATH_NOTE_KEYS[event]).toBe(
        `settings.hooks.events.pathNotes.${event}`,
      )
    }
  })

  it('groups all catalog events into phases without duplicates', () => {
    const flat = HOOK_EVENT_PHASES.flatMap((p) => [...p.events])
    expect(flat).toHaveLength(HOOK_EVENT_CATALOG.length)
    expect(new Set(flat).size).toBe(HOOK_EVENT_CATALOG.length)
    for (const event of HOOK_EVENT_CATALOG) {
      expect(flat).toContain(event)
    }
  })

  it('filters plugins and aggregates sources', () => {
    const list = [
      plugin({ id: 'a', name: 'A', hookCount: 0 }),
      plugin({ id: 'b', name: 'B', hookCount: 2, hookEvents: ['PreToolUse'] }),
    ]
    expect(pluginsWithHooks(list).map((p) => p.id)).toEqual(['b'])
    expect(totalConfiguredHookCount(list)).toBe(2)
    expect([...configuredHookEvents(list)]).toEqual(['PreToolUse'])
    expect(sourcesByHookEvent(list).get('PreToolUse')?.[0].pluginId).toBe('b')
  })

  it('ignores hooks from disabled plugins', () => {
    const list = [
      plugin({ id: 'off', name: 'Off', hookCount: 3, hookEvents: ['PreToolUse'], enabled: false }),
      plugin({ id: 'on', name: 'On', hookCount: 1, hookEvents: ['Stop'], enabled: true }),
    ]
    expect(pluginsWithHooks(list).map((p) => p.id)).toEqual(['on'])
    expect(totalConfiguredHookCount(list)).toBe(1)
    expect([...configuredHookEvents(list)]).toEqual(['Stop'])
    expect(sourcesByHookEvent(list).has('PreToolUse')).toBe(false)
  })
})

describe('HookConfig (list page)', () => {
  beforeEach(() => {
    mockPlugins = []
    mockLoaded = true
    load.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders title + phased list only (no catalog / how-to clutter)', () => {
    render(<HookConfig />)
    expect(screen.getByTestId('settings-hooks-page')).toBeInTheDocument()
    expect(screen.getByTestId('hook-event-list')).toBeInTheDocument()
    expect(screen.getByTestId('hook-list-path-chips')).toBeInTheDocument()
    expect(screen.getByTestId('hook-list-scan-hint')).toBeInTheDocument()
    expect(screen.queryByTestId('hooks-howto-heading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hook-lifecycle-diagram')).not.toBeInTheDocument()
    for (const event of HOOK_EVENT_CATALOG) {
      expect(screen.getByTestId(`hook-list-row-${event}`)).toBeInTheDocument()
    }
    for (const phase of HOOK_EVENT_PHASES) {
      expect(screen.getByTestId(`hook-phase-${phase.id}`)).toBeInTheDocument()
    }
  })

  it('shows empty hint when no hooks; no separate plugin list', () => {
    mockPlugins = [plugin({ id: 'plain', name: 'Plain', hookCount: 0 })]
    render(<HookConfig />)
    expect(screen.getByTestId('hooks-configured-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('hook-source-plain')).not.toBeInTheDocument()
  })

  it('shows summary and expand panel with path note on row click', () => {
    mockPlugins = [
      plugin({
        id: 'guard',
        name: 'Guard Plugin',
        hookCount: 3,
        dir: '/tmp/guard',
        hookEvents: ['PreToolUse', 'PermissionRequest'],
      }),
    ]
    render(<HookConfig />)
    expect(screen.getByTestId('hooks-summary')).toBeInTheDocument()
    expect(screen.getByTestId('hook-list-row-PreToolUse')).toHaveAttribute('data-configured', 'true')

    fireEvent.click(screen.getByTestId('hook-list-toggle-PreToolUse'))
    expect(screen.getByTestId('hook-list-expand-panel')).toHaveTextContent('Guard Plugin')
    expect(screen.getByTestId('hook-list-path-note')).toHaveTextContent(
      'settings.hooks.events.pathNotes.PreToolUse',
    )
    expect(screen.getByTestId('hook-list-source-guard')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('hook-list-toggle-PreToolUse'))
    expect(screen.queryByTestId('hook-list-expand-panel')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('hook-list-toggle-PermissionRequest'))
    expect(screen.getByTestId('hook-list-path-note')).toHaveTextContent(
      'settings.hooks.events.pathNotes.PermissionRequest',
    )
  })

  it('loads plugins when store is not yet loaded', () => {
    mockLoaded = false
    render(<HookConfig />)
    expect(load).toHaveBeenCalled()
  })
})
