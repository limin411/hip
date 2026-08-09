// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import type { MemoryFileConfig, MemoryItem } from '@hip/protocol'
import { MEMORY_FILE_CONFIG_DEFAULTS } from '@hip/protocol'
import { MemoryConfig } from './MemoryConfig'
import { sessionService } from '@/domain'

vi.mock(import('react-i18next'), async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (params && 'value' in params) return `${key}:${params.value}`
        if (params && 'title' in params) return `${key}:${params.title}`
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  } as any
})

vi.mock('@/store/providersStore', () => ({
  useProvidersStore: () => ({
    catalog: {
      openai: {
        id: 'openai',
        name: 'OpenAI',
        env: [],
        models: { 'gpt-4o-mini': { id: 'gpt-4o-mini', name: 'gpt-4o-mini' } },
      },
    },
    config: { providers: { openai: { enabled: true } } },
    load: vi.fn().mockResolvedValue(undefined),
  }),
}))

const offConfig: MemoryFileConfig = {
  ...MEMORY_FILE_CONFIG_DEFAULTS,
  useMemories: false,
  generateMemories: false,
}

const onConfig: MemoryFileConfig = {
  ...MEMORY_FILE_CONFIG_DEFAULTS,
  useMemories: true,
  generateMemories: true,
}

const sampleItem: MemoryItem = {
  id: 'm1',
  scope: 'global',
  kind: 'preference',
  title: 'Prefer yarn',
  content: 'use yarn',
  confidence: 0.9,
  status: 'active',
  source: 'user',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  useCount: 0,
  pinned: false,
}

describe('MemoryConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(sessionService, 'getMemoryStatus').mockResolvedValue({
      extractsToday: 0,
      maxExtractsPerDay: 20,
      llmAvailable: true,
      itemCounts: { active: 0, deleted: 0, archived: 0 },
      summaryCounts: { global: 0, project: 0 },
      stage1Pending: 0,
      coreGeneration: 0,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('empty-state CTA enables use + generate via setMemoryConfig', async () => {
    const getSpy = vi.spyOn(sessionService, 'getMemoryConfig').mockResolvedValue(offConfig)
    const setSpy = vi
      .spyOn(sessionService, 'setMemoryConfig')
      .mockResolvedValue({ ...offConfig, useMemories: true, generateMemories: true })
    vi.spyOn(sessionService, 'listMemories').mockResolvedValue([])

    render(<MemoryConfig />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-config-empty')).toBeInTheDocument()
    })
    expect(getSpy).toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('memory-enable-both'))

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith({ useMemories: true, generateMemories: true })
    })
  })

  it('empty-state secondary CTA enables use only', async () => {
    vi.spyOn(sessionService, 'getMemoryConfig').mockResolvedValue(offConfig)
    const setSpy = vi
      .spyOn(sessionService, 'setMemoryConfig')
      .mockResolvedValue({ ...offConfig, useMemories: true, generateMemories: false })
    vi.spyOn(sessionService, 'listMemories').mockResolvedValue([])

    render(<MemoryConfig />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-enable-use-only')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('memory-enable-use-only'))

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith({ useMemories: true, generateMemories: false })
    })
  })

  it('renders switches and list when config is enabled', async () => {
    vi.spyOn(sessionService, 'getMemoryConfig').mockResolvedValue(onConfig)
    const listSpy = vi.spyOn(sessionService, 'listMemories').mockResolvedValue([sampleItem])

    render(<MemoryConfig />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-config')).toBeInTheDocument()
    })

    const useSwitch = screen.getByTestId('memory-switch-use')
    const genSwitch = screen.getByTestId('memory-switch-generate')
    expect(useSwitch).toHaveAttribute('aria-checked', 'true')
    expect(genSwitch).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Prefer yarn')).toBeInTheDocument()
    expect(screen.getByTestId('memory-item-m1')).toBeInTheDocument()
    expect(listSpy).toHaveBeenCalledWith({ limit: 200, status: 'active' })
    expect(screen.getByTestId('memory-filter-active')).toHaveAttribute('aria-pressed', 'true')
    // Advanced section is collapsed; expand to reach the external-ACP toggle
    fireEvent.click(screen.getByTestId('memory-advanced-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('memory-switch-use-external')).toBeInTheDocument()
    })
    expect(screen.getByTestId('memory-switch-use-external')).toHaveAttribute('aria-checked', 'false')
  })

  it('toggles useMemoriesWithExternal when use memories is on', async () => {
    vi.spyOn(sessionService, 'getMemoryConfig').mockResolvedValue({
      ...onConfig,
      useMemoriesWithExternal: false,
    })
    vi.spyOn(sessionService, 'listMemories').mockResolvedValue([])
    const setSpy = vi.spyOn(sessionService, 'setMemoryConfig').mockResolvedValue({
      ...onConfig,
      useMemoriesWithExternal: true,
    })

    render(<MemoryConfig />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-advanced-toggle')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('memory-advanced-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('memory-switch-use-external')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('memory-switch-use-external'))
    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith({ useMemoriesWithExternal: true })
    })
  })

  it('hides useMemoriesWithExternal toggle when use memories is off', async () => {
    vi.spyOn(sessionService, 'getMemoryConfig').mockResolvedValue({
      ...offConfig,
      useMemories: false,
      generateMemories: true,
    })
    vi.spyOn(sessionService, 'listMemories').mockResolvedValue([])

    render(<MemoryConfig />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-advanced-toggle')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('memory-advanced-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('memory-extract-model')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('memory-switch-use-external')).not.toBeInTheDocument()
  })

  it('calls upsert when pin toggled', async () => {
    vi.spyOn(sessionService, 'getMemoryConfig').mockResolvedValue(onConfig)
    vi.spyOn(sessionService, 'listMemories').mockResolvedValue([sampleItem])
    const upsertSpy = vi.spyOn(sessionService, 'upsertMemory').mockResolvedValue({
      ...sampleItem,
      pinned: true,
    })

    render(<MemoryConfig />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-pin-m1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('memory-pin-m1'))

    await waitFor(() => {
      expect(upsertSpy).toHaveBeenCalledWith({
        id: 'm1',
        title: 'Prefer yarn',
        content: 'use yarn',
        kind: 'preference',
        scope: 'global',
        pinned: true,
      })
    })
  })

  it('calls upsert with title/content when edit is saved', async () => {
    vi.spyOn(sessionService, 'getMemoryConfig').mockResolvedValue(onConfig)
    vi.spyOn(sessionService, 'listMemories').mockResolvedValue([sampleItem])
    const upsertSpy = vi.spyOn(sessionService, 'upsertMemory').mockResolvedValue({
      ...sampleItem,
      title: 'Prefer pnpm',
      content: 'use pnpm',
    })

    render(<MemoryConfig />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-edit-m1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('memory-edit-m1'))

    await waitFor(() => {
      expect(screen.getByTestId('memory-edit-title')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('memory-edit-title'), { target: { value: 'Prefer pnpm' } })
    fireEvent.change(screen.getByTestId('memory-edit-content'), { target: { value: 'use pnpm' } })
    fireEvent.click(screen.getByTestId('memory-edit-save'))

    await waitFor(() => {
      expect(upsertSpy).toHaveBeenCalledWith({
        id: 'm1',
        title: 'Prefer pnpm',
        content: 'use pnpm',
        kind: 'preference',
        scope: 'global',
        pinned: false,
      })
    })
  })

  it('calls deleteMemory without hard by default after confirm', async () => {
    vi.spyOn(sessionService, 'getMemoryConfig').mockResolvedValue(onConfig)
    vi.spyOn(sessionService, 'listMemories').mockResolvedValue([sampleItem])
    const deleteSpy = vi.spyOn(sessionService, 'deleteMemory').mockResolvedValue(true)

    render(<MemoryConfig />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-delete-m1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('memory-delete-m1'))

    await waitFor(() => {
      expect(screen.getByTestId('memory-delete-confirm')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('memory-delete-confirm'))

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith('m1')
    })
    expect(deleteSpy.mock.calls[0]).toHaveLength(1)
  })

  it('trash tab lists deleted items and restore / empty trash', async () => {
    const deletedItem: MemoryItem = { ...sampleItem, id: 'd1', title: 'Trashed', status: 'deleted' }
    vi.spyOn(sessionService, 'getMemoryConfig').mockResolvedValue(onConfig)
    const listSpy = vi
      .spyOn(sessionService, 'listMemories')
      .mockImplementation(async (filter) => {
        if (filter?.status === 'deleted') return [deletedItem]
        return [sampleItem]
      })
    const restoreSpy = vi.spyOn(sessionService, 'restoreMemory').mockResolvedValue({
      ...deletedItem,
      status: 'active',
    })
    const emptySpy = vi.spyOn(sessionService, 'emptyMemoryTrash').mockResolvedValue(1)

    render(<MemoryConfig />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-filter-trash')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('memory-filter-trash'))

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalledWith({ limit: 200, status: 'deleted' })
      expect(screen.getByTestId('memory-item-d1')).toBeInTheDocument()
      expect(screen.getByTestId('memory-restore-d1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('memory-restore-d1'))

    await waitFor(() => {
      expect(restoreSpy).toHaveBeenCalledWith('d1')
    })

    // Re-enter trash with an item so Empty trash is available again.
    listSpy.mockImplementation(async (filter) => {
      if (filter?.status === 'deleted') return [deletedItem]
      return []
    })
    fireEvent.click(screen.getByTestId('memory-filter-active'))
    await waitFor(() => {
      expect(screen.getByTestId('memory-filter-active')).toHaveAttribute('aria-pressed', 'true')
    })
    fireEvent.click(screen.getByTestId('memory-filter-trash'))
    await waitFor(() => {
      expect(screen.getByTestId('memory-empty-trash')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('memory-empty-trash'))
    await waitFor(() => {
      expect(screen.getByTestId('memory-empty-trash-confirm')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('memory-empty-trash-confirm'))
    await waitFor(() => {
      expect(emptySpy).toHaveBeenCalled()
    })
  })

  it('extract model catalog picker persists MemoryModelRef and clears with empty', async () => {
    vi.spyOn(sessionService, 'getMemoryConfig').mockResolvedValue(onConfig)
    vi.spyOn(sessionService, 'listMemories').mockResolvedValue([])
    const setSpy = vi.spyOn(sessionService, 'setMemoryConfig').mockImplementation(async (partial) => ({
      ...onConfig,
      ...partial,
      extractModel: (partial as { extractModel?: unknown }).extractModel === null
        ? undefined
        : ((partial as { extractModel?: MemoryFileConfig['extractModel'] }).extractModel ??
          onConfig.extractModel),
    }))

    render(<MemoryConfig />)

    await waitFor(() => {
      expect(screen.getByTestId('memory-advanced-toggle')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('memory-advanced-toggle'))

    await waitFor(() => {
      expect(screen.getByTestId('memory-extract-model')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('memory-extract-model'), {
      target: { value: 'openai/gpt-4o-mini' },
    })

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith({
        extractModel: { providerID: 'openai', modelID: 'gpt-4o-mini' },
      })
    })

    fireEvent.change(screen.getByTestId('memory-extract-model'), {
      target: { value: '' },
    })

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith({ extractModel: null })
    })
  })
})
