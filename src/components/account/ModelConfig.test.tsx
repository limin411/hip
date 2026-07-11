// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { ModelConfig } from './ModelConfig'
import { MEMORY_EMBEDDING_PROVIDER_ID } from '@/lib/memoryEndpoint'

const { setMemoryConfig, saveProviderKey, isProviderKeyConfigured } = vi.hoisted(() => {
  const setMemoryConfig = vi.fn(async (partial: Record<string, unknown>) => ({
    version: 1 as const,
    useMemories: false,
    generateMemories: false,
    defaultScope: 'project' as const,
    idleMinutes: 15,
    maxCoreSummaryChars: 1500,
    maxPrefetchChars: 2500,
    exportMarkdownMirror: true,
    maxUnusedDays: 90,
    hybridSearchEnabled: false,
    ...partial,
  }))
  const saveProviderKey = vi.fn(async () => undefined)
  const isProviderKeyConfigured = vi.fn(async () => false)
  return { setMemoryConfig, saveProviderKey, isProviderKeyConfigured }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), message: vi.fn() } }))

vi.mock('@/domain', () => ({
  sessionService: {
    getMemoryConfig: vi.fn(async () => ({
      version: 1,
      useMemories: false,
      generateMemories: false,
      defaultScope: 'project',
      idleMinutes: 15,
      maxCoreSummaryChars: 1500,
      maxPrefetchChars: 2500,
      exportMarkdownMirror: true,
      maxUnusedDays: 90,
      hybridSearchEnabled: false,
    })),
    setMemoryConfig,
  },
}))

vi.mock('@/ipc/secrets', () => ({
  isProviderKeyConfigured,
  saveProviderKey,
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
  setMemoryConfig.mockClear()
  saveProviderKey.mockClear()
  isProviderKeyConfigured.mockClear()
  isProviderKeyConfigured.mockResolvedValue(false)
})

describe('ModelConfig cards + dialogs', () => {
  it('renders three purpose cards and no purpose tabs', async () => {
    render(<ModelConfig />)
    expect(screen.getByTestId('model-config-cards')).toBeInTheDocument()
    expect(screen.getByTestId('model-card-base')).toBeInTheDocument()
    expect(screen.getByTestId('model-card-embedding')).toBeInTheDocument()
    expect(screen.getByTestId('model-card-rerank')).toBeInTheDocument()
    expect(screen.queryByTestId('model-purpose-tabs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('role-models-section')).not.toBeInTheDocument()
  })

  it('opens base model dialog with provider workspace', async () => {
    render(<ModelConfig />)
    fireEvent.click(screen.getByTestId('model-card-base-edit'))
    await waitFor(() => {
      expect(screen.getByTestId('base-model-dialog')).toBeInTheDocument()
    })
    expect(screen.getAllByText('gpt-4o').length).toBeGreaterThan(0)
  })

  it('saves embedding endpoint to virtual provider with independent key', async () => {
    render(<ModelConfig />)
    fireEvent.click(screen.getByTestId('model-card-embedding-edit'))
    await waitFor(() => {
      expect(screen.getByTestId('endpoint-dialog-embedding')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('endpoint-embedding-base-url'), {
      target: { value: 'https://api.openai.com/v1' },
    })
    fireEvent.change(screen.getByTestId('endpoint-embedding-model-id'), {
      target: { value: 'text-embedding-3-small' },
    })
    fireEvent.change(screen.getByTestId('endpoint-embedding-api-key'), {
      target: { value: 'sk-embed-only' },
    })
    fireEvent.click(screen.getByTestId('endpoint-embedding-save'))
    await waitFor(() => {
      expect(saveProviderKey).toHaveBeenCalledWith(MEMORY_EMBEDDING_PROVIDER_ID, 'sk-embed-only')
      expect(setMemoryConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          embeddingModel: expect.objectContaining({
            providerID: MEMORY_EMBEDDING_PROVIDER_ID,
            modelID: 'text-embedding-3-small',
            baseURL: 'https://api.openai.com/v1',
          }),
        }),
      )
    })
  })
})
