// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { ModelConfig } from './ModelConfig'

const { setMemoryConfig } = vi.hoisted(() => {
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
  return { setMemoryConfig }
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
          'text-embedding-3-small': {
            id: 'text-embedding-3-small',
            name: 'text-embedding-3-small',
          },
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
})

describe('ModelConfig layout', () => {
  it('renders purpose tabs and does not render role-models section', async () => {
    render(<ModelConfig />)
    expect(screen.getByTestId('model-purpose-tabs')).toBeInTheDocument()
    expect(screen.queryByTestId('role-models-section')).not.toBeInTheDocument()
    expect(screen.queryByTestId('role-extract-model')).not.toBeInTheDocument()
  })

  it('switches to embedding tab', async () => {
    render(<ModelConfig />)
    fireEvent.click(screen.getByRole('tab', { name: 'settings.modelConfig.tabs.embedding' }))
    await waitFor(() => {
      expect(screen.getByTestId('model-purpose-embedding')).toBeInTheDocument()
    })
  })

  it('sets embedding model via setMemoryConfig when choosing a model on embedding tab', async () => {
    render(<ModelConfig />)
    fireEvent.click(screen.getByRole('tab', { name: 'settings.modelConfig.tabs.embedding' }))
    const row = await screen.findByText('text-embedding-3-small')
    fireEvent.click(row.closest('button') ?? row)
    await waitFor(() => {
      expect(setMemoryConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          embeddingModel: expect.objectContaining({
            providerID: 'openai',
            modelID: 'text-embedding-3-small',
          }),
        }),
      )
    })
  })

  it('sets rerank model via setMemoryConfig when choosing a model on rerank tab', async () => {
    render(<ModelConfig />)
    fireEvent.click(screen.getByRole('tab', { name: 'settings.modelConfig.tabs.rerank' }))
    const row = await screen.findByText('gpt-4o')
    fireEvent.click(row.closest('button') ?? row)
    await waitFor(() => {
      expect(setMemoryConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          rerankModel: expect.objectContaining({
            providerID: 'openai',
            modelID: 'gpt-4o',
          }),
        }),
      )
    })
  })
})
