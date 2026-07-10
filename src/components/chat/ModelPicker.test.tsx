// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'

// ── Mocks ──

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'chat.modelHint': 'Choose a model',
        'chat.noModelSelected': 'No model',
      }
      return map[key] ?? key
    },
  }),
}))

vi.mock('lucide-react', () => ({
  Cpu: () => React.createElement('span', { 'data-testid': 'icon-cpu' }),
  Check: () => React.createElement('span', { 'data-testid': 'icon-check' }),
}))

// Mock UI components to render their children directly
vi.mock('@/components/ui/DropdownMenu', async () => {
  const React = await import('react')
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dropdown-menu' }, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dropdown-trigger' }, children),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dropdown-content' }, children),
    DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) =>
      React.createElement('div', { 'data-testid': 'dropdown-item', onClick: onSelect }, children),
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dropdown-label' }, children),
    DropdownMenuGroup: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'dropdown-group' }, children),
  }
})

vi.mock('./ComposerChip', () => ({
  ComposerChip: ({ children, title }: { children: React.ReactNode; title?: string }) =>
    React.createElement('div', { 'data-testid': 'composer-chip', title }, children),
}))

// Mock stores
const mockDraftStore = { draft: null, setModelKey: vi.fn() }
vi.mock('@/store/draftStore', () => ({
  useDraftStore: (sel: (s: typeof mockDraftStore) => unknown) => sel(mockDraftStore),
}))

const mockProvidersStore = {
  catalog: { openai: { id: 'openai', name: 'OpenAI', env: [], api: 'x', models: { 'gpt-4o': {} } } },
  config: {
    providers: { openai: { enabled: true } },
    activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
  },
}
vi.mock('@/store/providersStore', () => ({
  useProvidersStore: (sel: (s: typeof mockProvidersStore) => unknown) => sel(mockProvidersStore),
}))

// Mock domain hooks
let mockActiveSessionId: string | null = 'sess-1'
let mockSession: { config: { model?: string; llmProvider?: string } } | null = null
let mockActiveSessionStatus: 'idle' | 'running' = 'idle'
vi.mock('@/domain', () => ({
  useActiveSessionId: () => mockActiveSessionId,
  useActiveSession: () => mockSession,
  useActiveSessionStatus: () => mockActiveSessionStatus,
  sessionService: {
    setSessionModel: vi.fn(),
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

vi.mock('@/lib/agentModelOptions', () => ({
  groupModelOptions: () => [
    {
      providerID: 'openai',
      providerName: 'OpenAI',
      models: [{ key: 'openai/gpt-4o', modelID: 'gpt-4o' }],
    },
  ],
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
    mockActiveSessionStatus = 'idle'
    mockDraftStore.draft = null
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
    // Both the chip label and dropdown item contain 'gpt-4o'
    expect(screen.getAllByText('gpt-4o').length).toBeGreaterThanOrEqual(1)
  })

  it('renders dropdown with model groups and items', () => {
    render(<ModelPicker />)
    expect(screen.getByTestId('dropdown-content')).toBeInTheDocument()
    expect(screen.getByTestId('dropdown-group')).toBeInTheDocument()
    expect(screen.getByTestId('dropdown-item')).toBeInTheDocument()
  })

  it('does not show orchMode toggle (agent-driven orchestration)', () => {
    render(<ModelPicker />)
    // Product path has no fast/dag switch; only model picker remains.
    expect(screen.queryByText(/Orchestration|Single Instance|Cluster Mode/i)).toBeNull()
    expect(screen.queryByTestId('orch-mode-toggle')).toBeNull()
  })

  it('has tooltip attributes for accessibility', () => {
    render(<ModelPicker />)
    const chip = screen.getByTestId('composer-chip')
    expect(chip.getAttribute('title')).toBe('Choose a model')
  })
})
