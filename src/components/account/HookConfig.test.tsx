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
          Comp ? React.createElement(Comp, { data: node.data }) : node.id,
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
    expect(HOOK_EVENT_CATALOG).toHaveLength(12)
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
})

describe('HookConfig (compact page)', () => {
  beforeEach(() => {
    mockPlugins = []
    mockLoaded = true
    load.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders title + fishbone only (no catalog / how-to clutter)', () => {
    render(<HookConfig />)
    expect(screen.getByTestId('settings-hooks-page')).toBeInTheDocument()
    expect(screen.getByTestId('hook-lifecycle-diagram')).toBeInTheDocument()
    expect(screen.getByTestId('react-flow')).toBeInTheDocument()
    expect(screen.queryByTestId('hooks-howto-heading')).not.toBeInTheDocument()
    for (const event of HOOK_EVENT_CATALOG) {
      expect(screen.getByTestId(`hook-diagram-node-${event}`)).toBeInTheDocument()
    }
  })

  it('shows empty hint when no hooks; no separate plugin list', () => {
    mockPlugins = [plugin({ id: 'plain', name: 'Plain', hookCount: 0 })]
    render(<HookConfig />)
    expect(screen.getByTestId('hooks-configured-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('hook-source-plain')).not.toBeInTheDocument()
  })

  it('shows summary and expand panel on node click', () => {
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
    expect(screen.getByTestId('hook-diagram-node-PreToolUse')).toHaveAttribute('data-configured', 'true')

    fireEvent.click(screen.getByTestId('rf-node-event-PreToolUse'))
    expect(screen.getByTestId('hook-diagram-expand-panel')).toHaveTextContent('Guard Plugin')

    fireEvent.click(screen.getByTestId('rf-node-event-PreToolUse'))
    expect(screen.queryByTestId('hook-diagram-expand-panel')).not.toBeInTheDocument()
  })

  it('loads plugins when store is not yet loaded', () => {
    mockLoaded = false
    render(<HookConfig />)
    expect(load).toHaveBeenCalled()
  })
})
