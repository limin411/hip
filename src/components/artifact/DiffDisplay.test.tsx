// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { DiffFile } from '@hip/protocol'
import { DiffDisplay } from './DiffDisplay'
import { clearContextProviders } from '@/components/context-menu'
import { copyText } from '@/ipc/clipboard'
import { useDiffAnnotationStore } from '@/store/diffAnnotationStore'
import { setComposerQuote } from '@/components/command-palette/composerBridge'

vi.mock('@/ipc/clipboard', () => ({ copyText: vi.fn(async () => true) }))
vi.mock('@/components/command-palette/composerBridge', () => ({
  setComposerQuote: vi.fn(() => true),
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})

const file: DiffFile = {
  path: 'src/a.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  hunks: [
    {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      header: 'function foo',
      lines: [
        { type: 'del', content: 'const x = 1', oldNo: 1, newNo: null },
        { type: 'add', content: 'const x = 2', oldNo: null, newNo: 1 },
      ],
    },
  ],
}

describe('DiffDisplay class polish', () => {
  beforeEach(() => {
    cleanup()
    clearContextProviders()
    useDiffAnnotationStore.setState({ bySession: {} })
  })

  afterEach(() => {
    clearContextProviders()
    cleanup()
  })

  it('sticky file header has soft border when expanded', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const header = screen.getByTestId('diff-file-header')
    expect(header).toHaveClass('border-b')
    expect(header.className).toMatch(/border-border/)
  })

  it('status chip shows a single letter with the full label in title', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const chip = screen.getByTestId('diff-status')
    expect(chip).toHaveTextContent('M')
    expect(chip).toHaveAttribute('title', 'artifact.diffView.statusModified')
    expect(chip).toHaveAttribute('aria-label', 'artifact.diffView.statusModified')
  })

  it('expanded header is sticky with data-expanded; collapsed header loses stickiness', () => {
    const { unmount } = render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const expandedHeader = screen.getByTestId('diff-file-header')
    expect(expandedHeader.className).toMatch(/sticky/)
    unmount()
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        collapsed={{ [file.path]: true }}
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const collapsedHeader = screen.getByTestId('diff-file-header')
    expect(collapsedHeader).not.toHaveClass('sticky')
    expect(collapsedHeader.querySelector('[data-expanded]')).toHaveAttribute('data-expanded', 'false')
  })

  it('renders no jump-list for multiple files', () => {
    render(
      <DiffDisplay
        files={[file, { ...file, path: 'src/b.ts' }]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    expect(screen.queryByTestId('diff-file-list')).toBeNull()
    expect(screen.queryAllByTestId('diff-file')).toHaveLength(2)
  })

  it('renders hover row actions and wires open-in-files + discard confirm', () => {
    const onOpen = vi.fn()
    const onConfirm = vi.fn()
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
        onOpenInFiles={onOpen}
        onDiscardOpen={() => {}}
        onDiscardConfirm={onConfirm}
        discardOpenPath="src/a.ts"
        running={false}
        onReviewFile={() => {}}
        onCopyPath={() => {}}
      />,
    )
    expect(screen.getByTestId('diff-discard')).toBeInTheDocument()
    expect(screen.getByTestId('diff-open-files')).toBeInTheDocument()
    expect(screen.getByTestId('diff-file-menu')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('diff-open-files'))
    expect(onOpen).toHaveBeenCalledWith('src/a.ts')
    expect(screen.getByTestId('diff-discard-popover')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('diff-discard-confirm'))
    expect(onConfirm).toHaveBeenCalledWith('src/a.ts', file)
  })

  it('hunk hover actions copy, annotate, and quote the hunk', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('diff-hunk-copy'))
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('@@ -1,1 +1,1 @@'))
    fireEvent.click(screen.getByTestId('diff-hunk-annotate'))
    expect(useDiffAnnotationStore.getState().list('s1')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('diff-hunk-quote'))
    expect(setComposerQuote).toHaveBeenCalledWith(expect.stringContaining('src/a.ts'))
  })

  it('drops sticky header border when collapsed to avoid double hairline', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        collapsed={{ [file.path]: true }}
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const header = screen.getByTestId('diff-file-header')
    expect(header).not.toHaveClass('border-b')
    expect(screen.getByTestId('diff-file').className).toMatch(/border-b/)
    expect(screen.getByTestId('diff-file').className).toMatch(/border-border/)
  })

  it('@@ hunk span and header tail stay quiet tertiary', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const atSpan = screen.getByText(/@@ -1,1 \+1,1 @@/)
    expect(atSpan).toHaveClass('text-ink-tertiary')
    const tail = screen.getByText('function foo')
    expect(tail.className).toMatch(/text-ink-tertiary/)
  })

  it('word-diff spans use soft /25 tints', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    // Equal-length del/add pair → word-diff; mid '1' vs '2' is changed.
    const success = document.querySelector('.bg-success\\/25')
    const danger = document.querySelector('.bg-danger\\/25')
    expect(success).toBeTruthy()
    expect(danger).toBeTruthy()
    expect(document.querySelector('.bg-success\\/30')).toBeNull()
    expect(document.querySelector('.bg-danger\\/30')).toBeNull()
  })

  it('split view gives each column its own horizontal scroll pane', () => {
    render(
      <DiffDisplay
        files={[{ ...file, hunks: [{ ...file.hunks[0], lines: [{ type: 'ctx', content: 'x'.repeat(400), oldNo: 1, newNo: 1 }] }] }]}
        viewMode="split"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    // 左右两栏各自是横向滚动容器；行保持内容宽度，超长行只在所属栏内滚动。
    const panes = document.querySelectorAll('div.overflow-x-auto')
    expect(panes).toHaveLength(2)
    expect(document.querySelectorAll('.w-max.min-w-full').length).toBeGreaterThan(0)
    // hunk 标题行（含“复制片段”操作）整行渲染一次，横贯在双栏上方，而不是只出现在某一栏。
    expect(screen.getAllByTestId('diff-hunk-header')).toHaveLength(1)
    expect(screen.getByTestId('diff-hunk-copy')).toBeInTheDocument()
  })
})
