// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { ModelConfig } from './ModelConfig'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), message: vi.fn() } }))

vi.mock('@/domain/sessionService', () => ({
  sessionService: {
    testProvider: vi.fn(async () => ({
      ok: true,
      code: 'OK',
      message: 'ok',
      checkedAt: Date.now(),
    })),
  },
}))

vi.mock('@/domain/sessionStore', () => ({
  useDomainStore: (sel: (s: { connection: string }) => unknown) =>
    sel({ connection: 'connected' }),
}))

vi.mock('@/ipc/secrets', () => ({
  isProviderKeyConfigured: vi.fn(async () => false),
  saveProviderKey: vi.fn(async () => undefined),
  clearProviderKey: vi.fn(async () => undefined),
  restartSidecar: vi.fn(async () => 0),
}))

vi.mock('@/store/providersStore', () => ({
  useProvidersStore: () => ({
    catalog: {
      openai: {
        id: 'openai',
        name: 'OpenAI',
        env: ['OPENAI_API_KEY'],
        npm: '@ai-sdk/openai',
        models: {
          'gpt-4o': { id: 'gpt-4o', name: 'gpt-4o' },
          'gpt-4o-mini': { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
        },
        api: 'https://api.openai.com/v1',
      },
      anthropic: {
        id: 'anthropic',
        name: 'Anthropic',
        env: ['ANTHROPIC_API_KEY'],
        npm: '@ai-sdk/anthropic',
        models: {
          'claude-sonnet-4': { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
        },
        api: 'https://api.anthropic.com',
      },
    },
    config: {
      providers: { openai: { enabled: true } },
      activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
    },
    keyConfigured: { openai: true },
    loaded: true,
    load: vi.fn(),
    saveKey: vi.fn(),
    clearKey: vi.fn(),
    setBaseURL: vi.fn(),
    setEnabled: vi.fn(),
    setApiKind: vi.fn(),
    setActiveModel: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
})

describe('ModelConfig page', () => {
  it('renders the current-model summary and provider workspace inline', async () => {
    render(<ModelConfig />)
    expect(screen.getByTestId('model-config-cards')).toBeInTheDocument()
    expect(screen.getByTestId('model-current-summary')).toBeInTheDocument()
    expect(screen.getAllByText('gpt-4o').length).toBeGreaterThan(0)
    // Provider list + detail are on the page body, not inside a dialog
    expect(screen.getAllByText('OpenAI').length).toBeGreaterThan(0)
    expect(screen.getByTestId('provider-verify-config')).toBeInTheDocument()
    expect(screen.queryByTestId('model-card-base')).not.toBeInTheDocument()
    expect(screen.queryByTestId('base-model-dialog')).not.toBeInTheDocument()
  })

  it('switches the detail pane when a provider is selected', async () => {
    render(<ModelConfig />)
    fireEvent.click(screen.getByText('Anthropic'))
    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4')).toBeInTheDocument()
    })
    expect(screen.getByTestId('provider-verify-config')).toBeInTheDocument()
  })
})
