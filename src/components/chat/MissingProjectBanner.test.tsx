// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useProjectPathStore } from '@/store/projectPathStore'

const setProjectDir = vi.fn()
const pickDirectory = vi.fn(async () => '/new/path' as string | null)

vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    sessionService: {
      setProjectDir: (...a: unknown[]) => setProjectDir(...a),
    },
  }
})

vi.mock('@/ipc/dialog', () => ({
  pickDirectory: () => pickDirectory(),
}))

import { MissingProjectBanner } from './MissingProjectBanner'

function setCodeSession(cwd?: string) {
  useDomainStore.setState({
    sessions: [
      {
        id: 's1',
        title: 'Task',
        preview: '',
        updatedAtMs: Date.now(),
        config: { ...DEFAULT_CONFIG, surface: 'code', ...(cwd ? { cwd } : {}) },
        messages: [],
        status: 'idle',
        loaded: true,
      },
    ],
    activeSessionId: 's1',
  } as never)
}

describe('MissingProjectBanner', () => {
  beforeEach(() => {
    setProjectDir.mockClear()
    pickDirectory.mockClear()
    pickDirectory.mockResolvedValue('/new/path')
    useProjectPathStore.setState({ byKey: {} })
    setCodeSession('/gone/proj')
  })

  afterEach(() => {
    cleanup()
  })

  it('hidden when path status is unknown (still probing)', () => {
    render(<MissingProjectBanner />)
    expect(screen.queryByTestId('missing-project-banner')).not.toBeInTheDocument()
  })

  it('shows when path is missing; rebind only (no unbind)', async () => {
    useProjectPathStore.setState({
      byKey: { '/gone/proj': { exists: false, checkedAt: Date.now() } },
    })
    render(<MissingProjectBanner />)
    expect(screen.getByTestId('missing-project-banner')).toHaveAttribute('data-reason', 'missing')
    expect(screen.queryByTestId('missing-project-unbind')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('missing-project-rebind'))
    await vi.waitFor(() => {
      expect(pickDirectory).toHaveBeenCalled()
      expect(setProjectDir).toHaveBeenCalledWith('s1', '/new/path')
    })
  })

  it('shows when code session has no project folder', () => {
    setCodeSession(undefined)
    render(<MissingProjectBanner />)
    expect(screen.getByTestId('missing-project-banner')).toHaveAttribute('data-reason', 'unbound')
    expect(screen.getByTestId('missing-project-rebind')).toBeInTheDocument()
  })

  it('hidden for chat surface even without cwd', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          title: 'Chat',
          preview: '',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 's1',
    } as never)
    render(<MissingProjectBanner />)
    expect(screen.queryByTestId('missing-project-banner')).not.toBeInTheDocument()
  })
})
