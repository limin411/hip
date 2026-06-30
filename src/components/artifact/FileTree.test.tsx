// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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

vi.mock('@/store/useFsScope', () => ({
  useFsScope: () => ({ scopeId: 's1', cwd: '/project', isDraft: false, chatDraft: false }),
}))

vi.mock('@/ipc/dialog', () => ({ pickDirectory: vi.fn() }))

describe('FileTree', () => {
  beforeEach(() => {
    cleanup()
    useFsStore.setState({ bySession: {} } as any)
    lsDir.mockClear()
    readFile.mockClear()
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
})
