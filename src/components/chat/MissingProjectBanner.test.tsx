// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useProjectPathStore } from '@/store/projectPathStore'

const setProjectDir = vi.fn()
const clearProjectDir = vi.fn()
const pickDirectory = vi.fn(async () => '/new/path' as string | null)

vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    sessionService: {
      setProjectDir: (...a: unknown[]) => setProjectDir(...a),
      clearProjectDir: (...a: unknown[]) => clearProjectDir(...a),
    },
  }
})

vi.mock('@/ipc/dialog', () => ({
  pickDirectory: () => pickDirectory(),
}))

import { MissingProjectBanner } from './MissingProjectBanner'

describe('MissingProjectBanner', () => {
  beforeEach(() => {
    setProjectDir.mockClear()
    clearProjectDir.mockClear()
    pickDirectory.mockClear()
    pickDirectory.mockResolvedValue('/new/path')
    useProjectPathStore.setState({ byKey: {} })
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          title: 'Task',
          preview: '',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'code', cwd: '/gone/proj' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 's1',
    } as never)
  })

  afterEach(() => {
    cleanup()
  })

  it('hidden when path status is unknown', () => {
    render(<MissingProjectBanner />)
    expect(screen.queryByTestId('missing-project-banner')).not.toBeInTheDocument()
  })

  it('shows when path is missing and rebind/unbind work', async () => {
    useProjectPathStore.setState({
      byKey: { '/gone/proj': { exists: false, checkedAt: Date.now() } },
    })
    render(<MissingProjectBanner />)
    expect(screen.getByTestId('missing-project-banner')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('missing-project-unbind'))
    expect(clearProjectDir).toHaveBeenCalledWith('s1')

    fireEvent.click(screen.getByTestId('missing-project-rebind'))
    await vi.waitFor(() => {
      expect(pickDirectory).toHaveBeenCalled()
      expect(setProjectDir).toHaveBeenCalledWith('s1', '/new/path')
    })
  })
})
