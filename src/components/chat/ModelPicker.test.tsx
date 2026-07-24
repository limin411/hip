// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'

// ── Mocks ──

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'chat.modelHint': 'Choose a model',
        'chat.noModelSelected': 'No model',
        'chat.searchModels': 'Search models…',
        'chat.noModelsMatch': 'No models match',
        'chat.noModelsAvailable': 'No models available',
      }
      return map[key] ?? key
    },
  }),
}))

vi.mock('lucide-react', () => ({
  Cpu: () => React.createElement('span', { 'data-testid': 'icon-cpu' }),
  Check: () => React.createElement('span', { 'data-testid': 'icon-check' }),
  Search: () => React.createElement('span', { 'data-testid': 'icon-search' }),
}))

vi.mock('@/components/ui/Popover', async () => {
  const React = await import('react')
  return {
    Popover: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) =>
      React.createElement(
        'div',
        {
          'data-testid': 'popover',
          'data-open': open ? 'true' : 'false',
          onClick: () => onOpenChange?.(true),
        },
        children,
      ),
    PopoverTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'popover-trigger' }, children),
    PopoverContent: ({
      children,
      ...rest
    }: {
      children: React.ReactNode
      [key: string]: unknown
    }) => {
      const { onOpenAutoFocus: _a, onKeyDown, className: _c, align: _align, ...dom } = rest
      return React.createElement(
        'div',
        { 'data-testid': 'popover-content', onKeyDown: onKeyDown as React.KeyboardEventHandler, ...dom },
        children,
      )
    },
  }
})

vi.mock('./ComposerChip', () => ({
  ComposerChip: ({ children, title }: { children: React.ReactNode; title?: string }) =>
    React.createElement('div', { 'data-testid': 'composer-chip', title }, children),
}))

// Mock stores
const mockDraftStore = { draft: null as null | { modelKey?: string }, setModelKey: vi.fn() }
vi.mock('@/store/draftStore', () => ({
  useDraftStore: (sel: (s: typeof mockDraftStore) => unknown) => sel(mockDraftStore),
}))

const mockProvidersStore = {
  catalog: { openai: { id: 'openai', name: 'OpenAI', env: [], api: 'x', models: { 'gpt-4o': {} } } },
  config: {
    providers: { openai: { enabled: true } },
    activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
  },
  keyConfigured: { openai: true },
}
vi.mock('@/store/providersStore', () => ({
  useProvidersStore: (sel: (s: typeof mockProvidersStore) => unknown) => sel(mockProvidersStore),
}))

// Mock domain hooks
let mockActiveSessionId: string | null = 'sess-1'
let mockSession: { config: { model?: string; llmProvider?: string } } | null = null
const setSessionModel = vi.fn()
vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockActiveSessionId,
  useActiveSession: () => mockSession,
  sessionService: {
    setSessionModel: (...args: unknown[]) => setSessionModel(...args),
  },
}))

// Mock lib utilities
vi.mock('@/lib/modelKey', () => ({
  parseModelKey: (key: string) => {
    const [provider, model] = key.split('/')
    return { providerID: provider, modelID: model }
  },
  activeModelKey: () => 'openai/gpt-4o',
}))

const mockGroups = [
  {
    providerID: 'openai',
    providerName: 'OpenAI',
    models: [
      { key: 'openai/gpt-4o', modelID: 'gpt-4o' },
      { key: 'openai/gpt-4o-mini', modelID: 'gpt-4o-mini' },
    ],
  },
]
vi.mock('@/lib/agentModelOptions', () => ({
  groupModelOptions: () => mockGroups,
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

import { ModelPicker } from './ModelPicker'

describe('ModelPicker', () => {
  beforeEach(() => {
    cleanup()
    mockActiveSessionId = 'sess-1'
    mockSession = { config: { model: 'deepseek-chat', llmProvider: 'deepseek' } }
    mockDraftStore.draft = null
    mockDraftStore.setModelKey.mockReset()
    setSessionModel.mockReset()
    mockGroups.length = 0
    mockGroups.push({
      providerID: 'openai',
      providerName: 'OpenAI',
      models: [
        { key: 'openai/gpt-4o', modelID: 'gpt-4o' },
        { key: 'openai/gpt-4o-mini', modelID: 'gpt-4o-mini' },
      ],
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the model chip with current model label', () => {
    render(<ModelPicker />)
    expect(screen.getByTestId('composer-chip')).toBeInTheDocument()
    expect(screen.getByText('deepseek-chat')).toBeInTheDocument()
  })

  it('shows model label when session has a model', () => {
    mockSession = { config: { model: 'gpt-4o', llmProvider: 'openai' } }
    mockActiveSessionId = 'sess-1'
    render(<ModelPicker />)
    expect(screen.getAllByText('gpt-4o').length).toBeGreaterThanOrEqual(1)
  })

  it('renders popover list with model groups and items', () => {
    render(<ModelPicker />)
    expect(screen.getByTestId('model-picker-popover')).toBeInTheDocument()
    expect(screen.getByTestId('model-picker-group')).toBeInTheDocument()
    expect(screen.getAllByTestId('model-picker-item').length).toBe(2)
  })

  it('hides search when the catalog is small', () => {
    render(<ModelPicker />)
    expect(screen.queryByTestId('model-picker-search')).toBeNull()
  })

  it('shows search and filters models when the catalog is large', () => {
    mockGroups[0]!.models = Array.from({ length: 10 }, (_, i) => ({
      key: `openai/model-${i}`,
      modelID: i === 3 ? 'special-alpha' : `model-${i}`,
    }))
    render(<ModelPicker />)
    const search = screen.getByTestId('model-picker-search')
    expect(search).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'alpha' } })
    expect(screen.getAllByTestId('model-picker-item')).toHaveLength(1)
    expect(screen.getByText('special-alpha')).toBeInTheDocument()
  })

  it('shows empty state when search matches nothing', () => {
    mockGroups[0]!.models = Array.from({ length: 10 }, (_, i) => ({
      key: `openai/model-${i}`,
      modelID: `model-${i}`,
    }))
    render(<ModelPicker />)
    fireEvent.change(screen.getByTestId('model-picker-search'), { target: { value: 'zzz' } })
    expect(screen.getByTestId('model-picker-empty')).toHaveTextContent('No models match')
  })

  it('selects a model for the active session', () => {
    render(<ModelPicker />)
    fireEvent.click(screen.getByText('gpt-4o-mini'))
    expect(setSessionModel).toHaveBeenCalledWith('openai/gpt-4o-mini')
  })

  it('selects a model on the draft when no session', () => {
    mockActiveSessionId = null
    mockSession = null
    render(<ModelPicker />)
    fireEvent.click(screen.getByText('gpt-4o-mini'))
    expect(mockDraftStore.setModelKey).toHaveBeenCalledWith('openai/gpt-4o-mini')
  })

  it('does not show orchMode toggle (agent-driven orchestration)', () => {
    render(<ModelPicker />)
    expect(screen.queryByText(/Orchestration|Single Instance|Cluster Mode/i)).toBeNull()
    expect(screen.queryByTestId('orch-mode-toggle')).toBeNull()
  })

  it('has tooltip attributes for accessibility', () => {
    render(<ModelPicker />)
    const chip = screen.getByTestId('composer-chip')
    expect(chip.getAttribute('title')).toBe('Choose a model')
  })
})
