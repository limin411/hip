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
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  } as any
})

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
    vi.spyOn(sessionService, 'listMemories').mockResolvedValue([sampleItem])

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
  })
})
