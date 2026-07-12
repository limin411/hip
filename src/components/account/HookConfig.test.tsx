// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import type { PluginMeta } from '@hip/protocol'
import {
  HOOK_EVENT_CATALOG,
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
        return `${options?.sources} sources · ${options?.count} hooks`
      }
      if (key === 'settings.hooks.diagram.expandSources') {
        return `${options?.count} plugin source(s)`
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
  Badge: ({
    children,
    ...rest
  }: { children: React.ReactNode } & Record<string, unknown>) => (
    <span {...rest}>{children}</span>
  ),
}))

// React Flow canvas → simple DOM so we can click nodes and assert expand panel.
vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'rf-provider' }, children),
  ReactFlow: ({
    nodes,
    onNodeClick,
    nodeTypes,
    children,
  }: {
    nodes: Array<{ id: string; data: Record<string, unknown>; type: string }>
    onNodeClick?: (_e: unknown, node: { id: string; data: Record<string, unknown> }) => void
    nodeTypes?: Record<string, React.ComponentType<{ data: Record<string, unknown> }>>
    children?: React.ReactNode
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'react-flow' },
      ...nodes.map((node) => {
        const Comp = nodeTypes?.[node.type]
        return React.createElement(
          'div',
          {
            key: node.id,
            'data-testid': `rf-node-${node.id}`,
            onClick: () => onNodeClick?.(null, { id: node.id, data: node.data }),
          },
          Comp
            ? React.createElement(Comp, { data: node.data })
            : node.id,
        )
      }),
      children,
    ),
  Background: () => React.createElement('div', { 'data-testid': 'rf-background' }),
  Controls: () => React.createElement('div', { 'data-testid': 'rf-controls' }),
  Handle: () => React.createElement('div', { 'data-testid': 'rf-handle' }),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}))

vi.mock('./HookLifecycleDiagram.css', () => ({ default: {} }))

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
    ...partial,
  }
}

describe('hookCatalog helpers', () => {
  it('lists every supported HookEvent', () => {
    expect(HOOK_EVENT_CATALOG).toContain('PreToolUse')
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

  it('aggregates unique configured events and sources', () => {
    const list = [
      plugin({ id: 'a', name: 'A', hookCount: 1, hookEvents: ['PreToolUse', 'Stop'] }),
      plugin({ id: 'b', name: 'B', hookCount: 1, hookEvents: ['PreToolUse', 'SessionStart'] }),
    ]
    expect([...configuredHookEvents(list)].sort()).toEqual(['PreToolUse', 'SessionStart', 'Stop'])
    const by = sourcesByHookEvent(list)
    expect(by.get('PreToolUse')?.map((s) => s.pluginId)).toEqual(['a', 'b'])
  })
})

describe('HookConfig fishbone diagram', () => {
  beforeEach(() => {
    mockPlugins = []
    mockLoaded = true
    load.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders fishbone diagram with all event nodes', () => {
    render(<HookConfig />)
    expect(screen.getByTestId('settings-hooks-page')).toBeInTheDocument()
    expect(screen.getByTestId('hook-lifecycle-diagram')).toBeInTheDocument()
    expect(screen.getByTestId('react-flow')).toBeInTheDocument()
    for (const event of HOOK_EVENT_CATALOG) {
      expect(screen.getByTestId(`hook-event-${event}`)).toBeInTheDocument()
      expect(screen.getByTestId(`hook-diagram-node-${event}`)).toBeInTheDocument()
      expect(screen.getByTestId(`hook-diagram-node-${event}`)).toHaveAttribute('data-configured', 'false')
    }
  })

  it('shows empty configured state when no plugin declares hooks', () => {
    mockPlugins = [plugin({ id: 'plain', name: 'Plain', hookCount: 0 })]
    render(<HookConfig />)
    expect(screen.getByTestId('hooks-configured-empty')).toBeInTheDocument()
  })

  it('highlights configured nodes and expands sources on click', () => {
    mockPlugins = [
      plugin({ id: 'plain', name: 'Plain', hookCount: 0 }),
      plugin({
        id: 'guard',
        name: 'Guard Plugin',
        hookCount: 3,
        dir: '/tmp/guard',
        hookEvents: ['PreToolUse', 'PermissionRequest'],
      }),
    ]
    render(<HookConfig />)

    expect(screen.getByTestId('hook-diagram-node-PreToolUse')).toHaveAttribute('data-configured', 'true')
    expect(screen.getByTestId('hook-diagram-node-SessionStart')).toHaveAttribute('data-configured', 'false')
    expect(screen.getByTestId('hook-event-configured-PreToolUse')).toBeInTheDocument()

    // Expand PreToolUse
    fireEvent.click(screen.getByTestId('rf-node-event-PreToolUse'))
    const panel = screen.getByTestId('hook-diagram-expand-panel')
    expect(panel).toBeInTheDocument()
    expect(screen.getByTestId('hook-diagram-source-guard')).toBeInTheDocument()
    expect(panel).toHaveTextContent('Guard Plugin')

    // Collapse via second click (accordion toggle)
    fireEvent.click(screen.getByTestId('rf-node-event-PreToolUse'))
    expect(screen.queryByTestId('hook-diagram-expand-panel')).not.toBeInTheDocument()
  })

  it('loads plugins when store is not yet loaded', () => {
    mockLoaded = false
    render(<HookConfig />)
    expect(load).toHaveBeenCalled()
  })
})
