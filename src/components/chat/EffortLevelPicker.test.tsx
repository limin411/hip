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
      if (key.startsWith('chat.effort.levels.')) return key.slice('chat.effort.levels.'.length)
      if (key.startsWith('chat.effort.desc.')) return opts?.defaultValue ?? ''
      return key
    },
  }),
}))

vi.mock('lucide-react', () => ({
  Gauge: () => React.createElement('span', { 'data-testid': 'icon-gauge' }),
  Check: () => React.createElement('span', { 'data-testid': 'icon-check' }),
}))

vi.mock('@/components/ui/DropdownMenu', async () => {
  const R = await import('react')
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) =>
      R.createElement('div', { 'data-testid': 'dropdown-menu' }, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) =>
      R.createElement('div', { 'data-testid': 'dropdown-trigger' }, children),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) =>
      R.createElement('div', { 'data-testid': 'dropdown-content' }, children),
    DropdownMenuItem: ({
      children,
      onSelect,
      ...rest
    }: {
      children: React.ReactNode
      onSelect?: () => void
      'data-testid'?: string
      disabled?: boolean
    }) =>
      R.createElement(
        'button',
        {
          type: 'button',
          'data-testid': rest['data-testid'],
          disabled: rest.disabled,
          onClick: () => onSelect?.(),
        },
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

import { EffortLevelPicker } from './EffortLevelPicker'

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

  it('renders chip with effort prefix + level text, and dynamic levels', () => {
    render(<EffortLevelPicker />)
    expect(screen.getByTestId('effort-chip')).toBeInTheDocument()
    // Not icon-only: category + current level are visible on the chip.
    expect(screen.getByTestId('effort-chip-label')).toHaveTextContent(/Effort/)
    expect(screen.getByTestId('effort-chip-label')).toHaveTextContent(/medium/i)
    expect(screen.getByTestId('effort-chip')).toHaveAttribute('aria-label', expect.stringContaining('Effort'))
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

  it('writes draft effort when no active session', () => {
    render(<EffortLevelPicker />)
    fireEvent.click(screen.getByTestId('effort-level-high'))
    expect(mockSetEffort).toHaveBeenCalledWith('high')
    expect(mockSetSessionEffort).not.toHaveBeenCalled()
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
    expect(mockSetEffort).not.toHaveBeenCalled()
    expect(mockSetSessionEffort).not.toHaveBeenCalled()
  })
})
