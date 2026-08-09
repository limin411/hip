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

vi.mock('@/domain', () => ({
  sessionService: {
    testProvider: vi.fn(async () => ({
      ok: true,
      code: 'OK',
      message: 'ok',
      checkedAt: Date.now(),
    })),
  },
}))

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
        },
        api: 'https://api.openai.com/v1',
      },
    },
    config: {
      providers: { openai: { enabled: true, baseURL: 'https://api.openai.com/v1' } },
      activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
    },
    keyConfigured: { openai: true },
    loaded: true,
    load: vi.fn(),
    saveKey: vi.fn(),
    clearKey: vi.fn(),
    setBaseURL: vi.fn(),
    setEnabled: vi.fn(),
    setActiveModel: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
})

describe('ModelConfig cards + dialogs', () => {
  it('renders the base model card and no embedding/rerank cards', async () => {
    render(<ModelConfig />)
    expect(screen.getByTestId('model-config-cards')).toBeInTheDocument()
    expect(screen.getByTestId('model-card-base')).toBeInTheDocument()
    expect(screen.queryByTestId('model-card-embedding')).not.toBeInTheDocument()
    expect(screen.queryByTestId('model-card-rerank')).not.toBeInTheDocument()
  })

  it('opens base model dialog with provider workspace', async () => {
    render(<ModelConfig />)
    fireEvent.click(screen.getByTestId('model-card-base-edit'))
    await waitFor(() => {
      expect(screen.getByTestId('base-model-dialog')).toBeInTheDocument()
    })
    expect(screen.getAllByText('gpt-4o').length).toBeGreaterThan(0)
  })
})
