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
      if (key === 'chat.effort.label') return 'Reasoning effort for this conversation'
      if (key === 'chat.effort.title') return 'Reasoning effort'
      if (key === 'chat.effort.busyTitle') return 'busy'
      if (key.startsWith('chat.effort.levels.')) return key.slice('chat.effort.levels.'.length)
      if (key.startsWith('chat.effort.desc.')) return `desc-${key.split('.').pop()}`
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
    DropdownMenu: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode
      open?: boolean
      onOpenChange?: (o: boolean) => void
      modal?: boolean
    }) =>
      R.createElement(
        'div',
        {
          'data-testid': 'dropdown',
          'data-open': open ? 'true' : 'false',
          onClick: () => onOpenChange?.(true),
        },
        children,
      ),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) =>
      R.createElement('div', { 'data-testid': 'dropdown-trigger' }, children),
    DropdownMenuContent: R.forwardRef(function MenuContent(
      {
        children,
        ...rest
      }: {
        children: React.ReactNode
        'data-testid'?: string
        className?: string
        align?: string
      },
      ref: React.Ref<HTMLDivElement>,
    ) {
      return R.createElement(
        'div',
        { ref, 'data-testid': rest['data-testid'] ?? 'dropdown-content' },
        children,
      )
    }),
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
      title,
      ...rest
    }: {
      children: React.ReactNode
      onSelect?: () => void
      disabled?: boolean
      title?: string
      className?: string
      'data-testid'?: string
      'data-selected'?: string
      'data-max-budget'?: string
    }) =>
      R.createElement(
        'button',
        {
          type: 'button',
          title,
          'data-testid': rest['data-testid'] ?? 'dropdown-item',
          'data-selected': rest['data-selected'],
          'data-max-budget': rest['data-max-budget'],
          disabled,
          onClick: () => {
            if (!disabled) onSelect?.()
          },
        },
        children,
      ),
  }
})

const mockSetEffort = vi.fn()
const mockDraftStore = {
  draft: null as null | {
    tempId: string
    mode: 'chat' | 'project'
    text: string
    modelKey?: string
    effort?: string
  },
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
          reasoning_options: [
            { type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] },
          ],
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
          reasoning_options: [
            { type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] },
          ],
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

import {
  EffortIntensityMeter,
  EffortLevelPicker,
  isMaxBudgetEffort,
  stepEffortIndex,
} from './EffortLevelPicker'

describe('isMaxBudgetEffort', () => {
  it('marks max always, and xhigh only when it is the top of the scale', () => {
    expect(isMaxBudgetEffort('max', ['low', 'medium', 'high', 'max'])).toBe(true)
    expect(isMaxBudgetEffort('xhigh', ['low', 'medium', 'high', 'xhigh', 'max'])).toBe(false)
    expect(isMaxBudgetEffort('xhigh', ['none', 'low', 'medium', 'high', 'xhigh'])).toBe(true)
    expect(isMaxBudgetEffort('high', ['low', 'medium', 'high'])).toBe(false)
  })
})

describe('stepEffortIndex', () => {
  it('steps and clamps without wrapping', () => {
    expect(stepEffortIndex(2, 1, 5)).toBe(3)
    expect(stepEffortIndex(2, -1, 5)).toBe(1)
    expect(stepEffortIndex(0, -1, 5)).toBe(0)
    expect(stepEffortIndex(4, 1, 5)).toBe(4)
  })
})

describe('EffortIntensityMeter', () => {
  afterEach(() => cleanup())

  it('renders rising ticks with filled count = index + 1', () => {
    const { container } = render(
      <EffortIntensityMeter index={2} total={5} />,
    )
    const meter = screen.getByTestId('effort-intensity-meter')
    expect(meter).toHaveAttribute('data-filled', '3')
    expect(meter).toHaveAttribute('data-total', '5')
    expect(container.querySelectorAll('[data-testid="effort-intensity-meter"] > span')).toHaveLength(5)
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

  it('renders compact single-line menu rows with meters (desc in title only)', () => {
    render(<EffortLevelPicker />)
    expect(screen.getByTestId('effort-chip')).toBeInTheDocument()
    expect(screen.getByTestId('effort-chip-label')).toHaveTextContent(/Effort/)
    expect(screen.getByTestId('effort-chip-label')).toHaveTextContent(/medium/i)
    expect(screen.getByTestId('effort-chip')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Effort'),
    )

    expect(screen.getByTestId('effort-menu')).toBeInTheDocument()
    expect(screen.getByText('Reasoning effort')).toBeInTheDocument()
    // Current level desc sits to the right of the menu title
    expect(screen.getByTestId('effort-current-desc')).toHaveTextContent('desc-medium')

    for (const level of ['none', 'low', 'medium', 'high', 'xhigh']) {
      const row = screen.getByTestId(`effort-level-${level}`)
      expect(row).toBeInTheDocument()
      expect(row).toHaveTextContent(level)
      // Per-row description is hover-only (title), not an extra menu line
      expect(row).not.toHaveTextContent(`desc-${level}`)
      expect(row).toHaveAttribute('title', `desc-${level}`)
    }
    expect(screen.queryByTestId('effort-level-max')).not.toBeInTheDocument()
    expect(screen.getByTestId('effort-level-medium')).toHaveAttribute('data-selected', 'true')
    expect(screen.getAllByTestId('effort-intensity-meter')).toHaveLength(5)
  })

  it('steps effort with wheel on the chip (down = higher)', () => {
    render(<EffortLevelPicker />)
    const chip = screen.getByTestId('effort-chip')
    fireEvent.wheel(chip, { deltaY: 40 })
    expect(mockSetEffort).toHaveBeenCalledWith('high')
    mockSetEffort.mockClear()
    // draft still medium in store (mock does not apply setEffort) — re-render with high
    mockDraftStore.draft = { tempId: 't', mode: 'chat', text: '', effort: 'high' }
    cleanup()
    render(<EffortLevelPicker />)
    fireEvent.wheel(screen.getByTestId('effort-chip'), { deltaY: -40 })
    expect(mockSetEffort).toHaveBeenCalledWith('medium')
  })

  it('steps effort with wheel over the open menu panel', () => {
    render(<EffortLevelPicker />)
    // Open menu so document capture-phase wheel listener attaches
    fireEvent.click(screen.getByTestId('dropdown'))
    expect(screen.getByTestId('dropdown')).toHaveAttribute('data-open', 'true')
    fireEvent.wheel(screen.getByTestId('effort-menu'), { deltaY: 40 })
    expect(mockSetEffort).toHaveBeenCalledWith('high')
  })

  it('hides when the current model has no effort options', () => {
    mockProvidersStore.config.activeModel = { providerID: 'openai', modelID: 'gpt-4o' }
    const { container } = render(<EffortLevelPicker />)
    expect(container).toBeEmptyDOMElement()
  })

  it('writes draft effort when clicking a menu item', () => {
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

  it('applies max-budget chrome when at xhigh (top of openai scale)', () => {
    mockDraftStore.draft = { tempId: 't', mode: 'chat', text: '', effort: 'xhigh' }
    render(<EffortLevelPicker />)
    expect(screen.getByTestId('effort-chip')).toHaveClass('effort-max-chip')
    expect(screen.getByTestId('effort-level-xhigh')).toHaveAttribute('data-max-budget', 'true')
    expect(screen.getByTestId('effort-level-xhigh')).toHaveAttribute('data-selected', 'true')
  })

  it('marks anthropic max as max-budget, not xhigh when max exists', () => {
    mockProvidersStore.config.activeModel = {
      providerID: 'anthropic',
      modelID: 'claude-opus-4-8',
    }
    mockDraftStore.draft = { tempId: 't', mode: 'chat', text: '', effort: 'xhigh' }
    const { rerender } = render(<EffortLevelPicker />)
    expect(screen.getByTestId('effort-level-xhigh')).toHaveAttribute('data-max-budget', 'false')
    expect(screen.getByTestId('effort-level-max')).toHaveAttribute('data-max-budget', 'true')

    mockDraftStore.draft = { tempId: 't', mode: 'chat', text: '', effort: 'max' }
    rerender(<EffortLevelPicker />)
    expect(screen.getByTestId('effort-level-max')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('effort-chip')).toHaveClass('effort-max-chip')
  })
})
