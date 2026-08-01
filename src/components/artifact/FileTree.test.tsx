// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { FileTree } from './FileTree'
import { useFsStore } from '@/store/fsStore'

const { lsDir, readFile } = vi.hoisted(() => ({
  lsDir: vi.fn(),
  readFile: vi.fn(),
}))
vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    sessionService: { lsDir, readFile, lsDraft: vi.fn(), readDraftFile: vi.fn(), setProjectDir: vi.fn() },
  }
})

const useFsScopeMock = vi.hoisted(() =>
  vi.fn(() => ({ scopeId: 's1', cwd: '/project' as unknown, isDraft: false, chatDraft: false })),
)
vi.mock('@/store/useFsScope', () => ({
  useFsScope: () => useFsScopeMock(),
}))

vi.mock('@/ipc/dialog', () => ({ pickDirectory: vi.fn() }))

describe('FileTree', () => {
  beforeEach(() => {
    cleanup()
    useFsStore.setState({ bySession: {} } as any)
    lsDir.mockClear()
    readFile.mockClear()
    useFsScopeMock.mockReturnValue({
      scopeId: 's1',
      cwd: '/project',
      isDraft: false,
      chatDraft: false,
    })
  })

  it('shows select-folder empty state when cwd is not a string', () => {
    useFsScopeMock.mockReturnValue({
      scopeId: 's1',
      cwd: { bad: true } as unknown as string,
      isDraft: false,
      chatDraft: false,
    })
    render(<FileTree />)
    expect(screen.getByTestId('select-folder')).toBeInTheDocument()
    expect(screen.queryByText('README.md')).not.toBeInTheDocument()
  })

  it('renders root entries and expands a directory', () => {
    useFsStore.setState({
      bySession: {
        s1: {
          cwd: '/project',
          entriesByDir: {
            '/project': [
              { path: '/project/src', name: 'src', isDir: true },
              { path: '/project/README.md', name: 'README.md', isDir: false },
            ],
            '/project/src': [{ path: '/project/src/a.ts', name: 'a.ts', isDir: false }],
          },
          expanded: { '/project/src': true },
          activePath: null,
        },
      },
    } as any)

    render(<FileTree />)
    expect(screen.getByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('a.ts')).toBeInTheDocument()
  })

  it('calls readFile when a file entry is clicked', () => {
    useFsStore.setState({
      bySession: {
        s1: {
          cwd: '/project',
          entriesByDir: {
            '/project': [{ path: '/project/README.md', name: 'README.md', isDir: false }],
          },
          expanded: {},
          activePath: null,
        },
      },
    } as any)

    render(<FileTree />)
    fireEvent.click(screen.getByText('README.md'))
    expect(readFile).toHaveBeenCalledWith('s1', '/project/README.md')
  })

  it('renders colored file-type icons by extension', () => {
    useFsStore.setState({
      bySession: {
        s1: {
          cwd: '/project',
          entriesByDir: {
            '/project': [
              { path: '/project/a.ts', name: 'a.ts', isDir: false },
              { path: '/project/b.py', name: 'b.py', isDir: false },
              { path: '/project/README.md', name: 'README.md', isDir: false },
            ],
          },
          expanded: {},
          activePath: null,
        },
      },
    } as any)

    render(<FileTree />)
    const icons = screen.getAllByTestId('file-type-icon')
    expect(icons).toHaveLength(3)
    expect(icons[0]).toHaveAttribute('data-file-name', 'a.ts')
    expect(icons[1]).toHaveAttribute('data-file-name', 'b.py')
    expect(icons[2]).toHaveAttribute('data-file-name', 'README.md')
    // Distinct color classes per family (sky / blue / slate)
    expect(icons[0].getAttribute('class')).toMatch(/sky/)
    expect(icons[1].getAttribute('class')).toMatch(/blue/)
    expect(icons[2].getAttribute('class')).toMatch(/slate/)
  })

  describe('committed session chrome', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('hides the header row (root name / refresh button) for committed sessions', () => {
      useFsStore.setState({
        bySession: {
          s1: {
            cwd: '/project',
            entriesByDir: { '/project': [{ path: '/project/README.md', name: 'README.md', isDir: false }] },
            expanded: {},
            activePath: null,
          },
        },
      } as any)

      render(<FileTree />)
      expect(screen.getByText('README.md')).toBeInTheDocument()
      expect(screen.queryByTestId('refresh-tree')).not.toBeInTheDocument()
      expect(screen.queryByTestId('tree-back-to-chat')).not.toBeInTheDocument()
    })

    it('polls the root and expanded dirs instead of a manual refresh', () => {
      useFsStore.setState({
        bySession: {
          s1: {
            cwd: '/project',
            entriesByDir: {
              '/project': [{ path: '/project/src', name: 'src', isDir: true }],
              '/project/src': [{ path: '/project/src/a.ts', name: 'a.ts', isDir: false }],
            },
            expanded: { '/project/src': true },
            activePath: null,
          },
        },
      } as any)

      render(<FileTree />)
      // Entries are already cached — mount does not list again.
      expect(lsDir).not.toHaveBeenCalled()

      act(() => { vi.advanceTimersByTime(5000) })
      expect(lsDir).toHaveBeenCalledWith('s1', '/project')
      expect(lsDir).toHaveBeenCalledWith('s1', '/project/src')
      expect(lsDir).toHaveBeenCalledTimes(2)
    })
  })
})
