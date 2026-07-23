// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string; level?: string }) => {
      if (key === 'chat.effort.chipPrefix') return 'Effort'
      if (key === 'chat.effort.chip') return `Effort · ${opts?.level ?? ''}`
      if (key === 'chat.effort.label') return 'Reasoning effort'
      if (key === 'chat.effort.busyTitle') return 'busy'
      if (key.startsWith('chat.effort.levels.')) return key.slice('chat.effort.levels.'.length)
      if (key.startsWith('chat.effort.desc.')) return opts?.defaultValue ?? `desc-${key.split('.').pop()}`
      return key
    },
  }),
}))

vi.mock('lucide-react', () => ({
  Gauge: () => React.createElement('span', { 'data-testid': 'icon-gauge' }),
}))

vi.mock('@/components/ui/Popover', async () => {
  const R = await import('react')
  return {
    Popover: ({
      children,
      open,
    }: {
      children: React.ReactNode
      open?: boolean
      onOpenChange?: (o: boolean) => void
      modal?: boolean
    }) =>
      R.createElement(
        'div',
        { 'data-testid': 'popover', 'data-open': open ? 'true' : 'false' },
        // Always render children so content (slider) is present for unit tests.
        children,
      ),
    PopoverTrigger: ({ children }: { children: React.ReactNode }) =>
      R.createElement('div', { 'data-testid': 'popover-trigger' }, children),
    PopoverContent: ({
      children,
      ...rest
    }: {
      children: React.ReactNode
      'data-testid'?: string
      className?: string
      align?: string
      onOpenAutoFocus?: (e: Event) => void
    }) =>
      R.createElement(
        'div',
        { 'data-testid': rest['data-testid'] ?? 'popover-content' },
        children,
      ),
  }
})

const mockSetEffort = vi.fn()
const mockDraftStore = {
  draft: null as null | { tempId: string; mode: 'chat' | 'project'; text: string; modelKey?: string; effort?: string },
  setEffort: (...args: unknown[]) => mockSetEffort(...args),
}
vi.mock('@/store/draftStore', () => ({
  useDraftStore: (sel: (s: typeof mockDraftStore) => unknown) => sel(mockDraftStore),
}))

const mockProvidersStore = {
  catalog: {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      env: [],
      models: {
        'gpt-5.4': {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          reasoning: true,
          reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }],
        },
        'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' },
      },
    },
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic',
      env: [],
      models: {
        'claude-opus-4-8': {
          id: 'claude-opus-4-8',
          name: 'Claude Opus 4.8',
          reasoning: true,
          reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }],
        },
      },
    },
  },
  config: {
    providers: {},
    activeModel: { providerID: 'openai', modelID: 'gpt-5.4' },
  },
}
vi.mock('@/store/providersStore', () => ({
  useProvidersStore: (sel: (s: typeof mockProvidersStore) => unknown) => sel(mockProvidersStore),
}))

const mockSetSessionEffort = vi.fn()
let mockActiveSessionId: string | null = null
let mockSession: {
  id: string
  config: { llmProvider: string; model: string; tools: string[]; effort?: string }
} | null = null
let mockStatus: 'idle' | 'running' = 'idle'

vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockActiveSessionId,
  useActiveSession: () => mockSession,
  useActiveSessionStatus: () => mockStatus,
  sessionService: {
    setEffort: (...args: unknown[]) => mockSetSessionEffort(...args),
  },
}))

import { EffortLevelPicker, isMaxBudgetEffort } from './EffortLevelPicker'

describe('isMaxBudgetEffort', () => {
  it('marks max always, and xhigh only when it is the top of the scale', () => {
    expect(isMaxBudgetEffort('max', ['low', 'medium', 'high', 'max'])).toBe(true)
    expect(isMaxBudgetEffort('xhigh', ['low', 'medium', 'high', 'xhigh', 'max'])).toBe(false)
    expect(isMaxBudgetEffort('xhigh', ['none', 'low', 'medium', 'high', 'xhigh'])).toBe(true)
    expect(isMaxBudgetEffort('high', ['low', 'medium', 'high'])).toBe(false)
  })
})

describe('EffortLevelPicker', () => {
  beforeEach(() => {
    mockSetEffort.mockClear()
    mockSetSessionEffort.mockClear()
    mockDraftStore.draft = null
    mockActiveSessionId = null
    mockSession = null
    mockStatus = 'idle'
    mockProvidersStore.config.activeModel = { providerID: 'openai', modelID: 'gpt-5.4' }
  })

  afterEach(() => cleanup())

  it('renders chip with effort prefix + level text, slider, and dynamic levels', () => {
    render(<EffortLevelPicker />)
    expect(screen.getByTestId('effort-chip')).toBeInTheDocument()
    expect(screen.getByTestId('effort-chip-label')).toHaveTextContent(/Effort/)
    expect(screen.getByTestId('effort-chip-label')).toHaveTextContent(/medium/i)
    expect(screen.getByTestId('effort-chip')).toHaveAttribute('aria-label', expect.stringContaining('Effort'))
    expect(screen.getByTestId('effort-slider')).toBeInTheDocument()
    expect(screen.getByTestId('effort-level-none')).toBeInTheDocument()
    expect(screen.getByTestId('effort-level-high')).toBeInTheDocument()
    expect(screen.getByTestId('effort-level-xhigh')).toBeInTheDocument()
    expect(screen.queryByTestId('effort-level-max')).not.toBeInTheDocument()
  })

  it('hides when the current model has no effort options', () => {
    mockProvidersStore.config.activeModel = { providerID: 'openai', modelID: 'gpt-4o' }
    const { container } = render(<EffortLevelPicker />)
    expect(container).toBeEmptyDOMElement()
  })

  it('writes draft effort when no active session (tick)', () => {
    render(<EffortLevelPicker />)
    fireEvent.click(screen.getByTestId('effort-level-high'))
    expect(mockSetEffort).toHaveBeenCalledWith('high')
    expect(mockSetSessionEffort).not.toHaveBeenCalled()
  })

  it('writes draft effort via slider change', () => {
    render(<EffortLevelPicker />)
    const slider = screen.getByTestId('effort-slider')
    // levels: none, low, medium, high, xhigh → high is index 3
    fireEvent.change(slider, { target: { value: '3' } })
    expect(mockSetEffort).toHaveBeenCalledWith('high')
  })

  it('calls sessionService.setEffort for an active session', () => {
    mockActiveSessionId = 's1'
    mockSession = {
      id: 's1',
      config: { llmProvider: 'openai', model: 'gpt-5.4', tools: [], effort: 'medium' },
    }
    render(<EffortLevelPicker />)
    fireEvent.click(screen.getByTestId('effort-level-high'))
    expect(mockSetSessionEffort).toHaveBeenCalledWith('s1', 'high')
  })

  it('does not change effort while a turn is running', () => {
    mockStatus = 'running'
    mockDraftStore.draft = { tempId: 't', mode: 'chat', text: '' }
    render(<EffortLevelPicker />)
    fireEvent.click(screen.getByTestId('effort-level-high'))
    fireEvent.change(screen.getByTestId('effort-slider'), { target: { value: '4' } })
    expect(mockSetEffort).not.toHaveBeenCalled()
    expect(mockSetSessionEffort).not.toHaveBeenCalled()
  })

  it('applies max-budget fill when at xhigh (top of openai scale)', () => {
    mockDraftStore.draft = { tempId: 't', mode: 'chat', text: '', effort: 'xhigh' }
    render(<EffortLevelPicker />)
    expect(screen.getByTestId('effort-slider-fill')).toHaveAttribute('data-max-budget', 'true')
  })

  it('applies max-budget fill for anthropic max, not for xhigh when max exists', () => {
    mockProvidersStore.config.activeModel = { providerID: 'anthropic', modelID: 'claude-opus-4-8' }
    mockDraftStore.draft = { tempId: 't', mode: 'chat', text: '', effort: 'xhigh' }
    const { rerender } = render(<EffortLevelPicker />)
    expect(screen.getByTestId('effort-slider-fill')).toHaveAttribute('data-max-budget', 'false')

    mockDraftStore.draft = { tempId: 't', mode: 'chat', text: '', effort: 'max' }
    rerender(<EffortLevelPicker />)
    expect(screen.getByTestId('effort-slider-fill')).toHaveAttribute('data-max-budget', 'true')
  })
})
