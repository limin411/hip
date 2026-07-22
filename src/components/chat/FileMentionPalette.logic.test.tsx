// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { FileMentionPalette } from './FileMentionPalette'

const search = vi.fn()
vi.mock('@/ipc/workspaceFileSearch', () => ({
  workspaceFileSearch: (...args: unknown[]) => search(...args),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('FileMentionPalette', () => {
  beforeEach(() => {
    search.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows hint for empty query and does not search', async () => {
    render(
      <FileMentionPalette query="" searchRoot="/proj" onSelect={vi.fn()} />,
    )
    expect(screen.getByTestId('file-mention-hint')).toBeInTheDocument()
    expect(search).not.toHaveBeenCalled()
  })

  it('searches after debounce and lists hits', async () => {
    search.mockResolvedValue({
      root: '/proj',
      query: 'a',
      hits: [
        {
          relativePath: 'src/a.ts',
          absolutePath: '/proj/src/a.ts',
          name: 'a.ts',
          isDir: false,
          score: 0,
        },
      ],
      truncated: false,
    })
    render(
      <FileMentionPalette query="a" searchRoot="/proj" onSelect={vi.fn()} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(search).toHaveBeenCalled()
    expect(screen.getByTestId('file-mention-hit-0')).toHaveAttribute(
      'data-path',
      'src/a.ts',
    )
  })

  it('Enter with zero hits does not call onSelect (still captures key)', async () => {
    search.mockResolvedValue({ root: '/proj', query: 'zzz', hits: [], truncated: false })
    const onSelect = vi.fn()
    render(
      <FileMentionPalette query="zzz" searchRoot="/proj" onSelect={onSelect} />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('Escape calls onDismiss', () => {
    const onDismiss = vi.fn()
    render(
      <FileMentionPalette
        query=""
        searchRoot="/proj"
        onSelect={vi.fn()}
        onDismiss={onDismiss}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalled()
  })
})
