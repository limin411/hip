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
import { useHipConfigStore } from '@/store/hipConfigStore'

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
    useHipConfigStore.setState({ config: { version: 1 } })
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

  it('renders always-visible row actions and wires open-in-files + discard confirm', () => {
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
    const actionBar = screen.getByTestId('diff-discard').parentElement
    expect(actionBar).not.toHaveClass('opacity-0')
    expect(actionBar).not.toHaveClass('group-hover:opacity-100')
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

  it('hunk header actions are always visible instead of hover-only', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const actionBar = screen.getByTestId('diff-hunk-copy').parentElement
    expect(actionBar).not.toHaveClass('opacity-0')
    expect(actionBar).not.toHaveClass('group-hover/hunk:opacity-100')
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

  it('T4: word-diff spans use /35 tints with 2px rounding', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    // Equal-length del/add pair → word-diff; mid '1' vs '2' is changed.
    const success = document.querySelector('.bg-success\\/35')
    const danger = document.querySelector('.bg-danger\\/35')
    expect(success).toBeTruthy()
    expect(danger).toBeTruthy()
    expect(success!.className).toContain('rounded-[2px]')
    expect(danger!.className).toContain('rounded-[2px]')
    expect(document.querySelector('.bg-success\\/25')).toBeNull()
  })

  it('T4: split view word-diffs aligned del/add pairs on both sides', () => {
    render(
      <DiffDisplay
        files={[{ ...file, hunks: [{ ...file.hunks[0], lines: [
          { type: 'ctx', content: 'keep', oldNo: 1, newNo: 1 },
          { type: 'del', content: 'const x = 1', oldNo: 2, newNo: null },
          { type: 'add', content: 'const x = 2', oldNo: null, newNo: 2 },
        ] }] }]}
        viewMode="split"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const panes = document.querySelectorAll('div.overflow-x-auto')
    expect(panes).toHaveLength(2)
    // 左栏 del 侧有 danger 高亮 span，右栏 add 侧有 success 高亮 span
    expect(panes[0]!.querySelector('.bg-danger\\/35')).toBeTruthy()
    expect(panes[1]!.querySelector('.bg-success\\/35')).toBeTruthy()
  })

  it('T4: no word-diff spans for unpaired or overlong lines', () => {
    // 纯删除（右栏无 add 配对）→ 两侧无 span；超长 add 行 → 跳过计算
    const panesOf = (lines: Array<{ type: 'ctx' | 'del' | 'add'; content: string; oldNo: number | null; newNo: number | null }>) => {
      cleanup()
      render(
        <DiffDisplay
          files={[{ ...file, hunks: [{ ...file.hunks[0], lines }] }]}
          viewMode="split"
          sessionId="s1"
          onToggleCollapse={() => {}}
        />,
      )
      return document.querySelectorAll('div.overflow-x-auto')
    }
    let panes = panesOf([
      { type: 'del', content: 'gone', oldNo: 1, newNo: null },
      { type: 'ctx', content: 'after', oldNo: 2, newNo: 1 },
    ])
    expect(panes[0]!.querySelector('.bg-danger\\/35')).toBeNull()
    expect(panes[1]!.querySelector('.bg-success\\/35')).toBeNull()
    panes = panesOf([
      { type: 'del', content: 'short', oldNo: 1, newNo: null },
      { type: 'add', content: 'x'.repeat(2500), oldNo: null, newNo: 1 },
    ])
    expect(panes[0]!.querySelector('.bg-danger\\/35')).toBeNull()
    expect(panes[1]!.querySelector('.bg-success\\/35')).toBeNull()
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

  it('T5: hunk badge counts add/del lines', () => {
    render(
      <DiffDisplay
        files={[{ ...file, additions: 2, deletions: 1, hunks: [{
          oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, header: '',
          lines: [
            { type: 'del', content: 'a', oldNo: 1, newNo: null },
            { type: 'add', content: 'b', oldNo: null, newNo: 1 },
            { type: 'add', content: 'c', oldNo: null, newNo: 2 },
          ],
        }] }]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const badge = screen.getByTestId('diff-hunk-badge')
    expect(badge).toHaveTextContent('+2')
    expect(badge).toHaveTextContent('−1')
  })

  it('T11: expand-context buttons render only when the file is expandable', () => {
    const onExpand = vi.fn()
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
        canExpandContext={() => false}
        onExpandContext={onExpand}
      />,
    )
    expect(screen.queryByTestId('diff-hunk-expand-up')).toBeNull()
    expect(screen.queryByTestId('diff-hunk-expand-down')).toBeNull()
    cleanup()
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
        canExpandContext={() => true}
        onExpandContext={onExpand}
      />,
    )
    fireEvent.click(screen.getByTestId('diff-hunk-expand-up'))
    expect(onExpand).toHaveBeenCalledWith('src/a.ts', 'up')
    fireEvent.click(screen.getByTestId('diff-hunk-expand-down'))
    expect(onExpand).toHaveBeenLastCalledWith('src/a.ts', 'down')
  })

  it('applies code block color to diff code area', () => {
    useHipConfigStore.setState({
      config: { version: 1, codeBlock: { colorTheme: 'dark' } },
    })
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const area = screen.getByTestId('diff-code-area')
    expect(area).toHaveStyle({
      backgroundColor: '#0d1117',
      color: '#e6edf3',
    })
    expect(area.querySelector('span[style*="#e6edf3"]')).toBeTruthy()
  })

  // ---- PR-1: 行级可见性（T1 色条 / T2 块分组 / T3 行号列） ----

  const fWith = (lines: Array<{ type: 'ctx' | 'del' | 'add'; content: string; oldNo: number | null; newNo: number | null }>): DiffFile => ({
    path: 'src/b.ts',
    status: 'modified',
    additions: lines.filter((l) => l.type === 'add').length,
    deletions: lines.filter((l) => l.type === 'del').length,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: '', lines }],
  })

  const rowsOf = () =>
    Array.from(screen.getByTestId('diff-code-area').querySelectorAll<HTMLElement>('div')).filter((d) =>
      d.className.includes('leading-[1.55]'),
    )

  it('T1/T2 unified: change rows get rail+ring shadow and block rounding; ctx rows stay plain', () => {
    render(
      <DiffDisplay
        files={[fWith([
          { type: 'ctx', content: 'keep', oldNo: 1, newNo: 1 },
          { type: 'del', content: 'old', oldNo: 2, newNo: null },
          { type: 'add', content: 'new', oldNo: null, newNo: 2 },
          { type: 'ctx', content: 'tail', oldNo: 3, newNo: 3 },
        ])]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const rows = rowsOf()
    expect(rows).toHaveLength(4)
    // 上下文行：无底色、无色条/描边 shadow
    expect(rows[0]!.className).not.toMatch(/bg-(success|danger)/)
    expect(rows[0]!.style.boxShadow).toBe('')
    // del 行：12% 底色 + 色条 + 主色描边 + 块首圆角/间距
    expect(rows[1]!.className).toContain('bg-danger/[0.12]')
    expect(rows[1]!.className).toContain('rounded-t-[4px]')
    expect(rows[1]!.className).toContain('mt-px')
    expect(rows[1]!.style.boxShadow).toContain('inset 2px 0 0 0 rgb(var(--danger-rgb))')
    expect(rows[1]!.style.boxShadow).toContain('inset 0 0 0 1px rgb(var(--danger-rgb) / 0.3)')
    // add 行：success 侧 + 块末圆角/间距
    expect(rows[2]!.className).toContain('bg-success/[0.12]')
    expect(rows[2]!.className).toContain('rounded-b-[4px]')
    expect(rows[2]!.className).toContain('mb-px')
    expect(rows[2]!.style.boxShadow).toContain('inset 2px 0 0 0 rgb(var(--success-rgb))')
    expect(rows[3]!.style.boxShadow).toBe('')
  })

  it('T2: multi-row run rounds only first/last rows; ctx split splits runs', () => {
    render(
      <DiffDisplay
        files={[fWith([
          { type: 'del', content: 'a', oldNo: 1, newNo: null },
          { type: 'del', content: 'b', oldNo: 2, newNo: null },
          { type: 'add', content: 'x', oldNo: null, newNo: 1 },
          { type: 'add', content: 'y', oldNo: null, newNo: 2 },
        ])]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const rows = rowsOf()
    expect(rows[0]!.className).toContain('rounded-t-[4px]')
    expect(rows[1]!.className).not.toMatch(/rounded-/)
    expect(rows[2]!.className).not.toMatch(/rounded-/)
    expect(rows[3]!.className).toContain('rounded-b-[4px]')
    // 单行块（del,ctx,add）首末同圆角
    cleanup()
    render(
      <DiffDisplay
        files={[fWith([
          { type: 'del', content: 'a', oldNo: 1, newNo: null },
          { type: 'ctx', content: 'keep', oldNo: 2, newNo: 1 },
          { type: 'add', content: 'x', oldNo: null, newNo: 2 },
        ])]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const single = rowsOf()
    expect(single[0]!.className).toContain('rounded-[4px]')
    expect(single[2]!.className).toContain('rounded-[4px]')
  })

  it('T3: line-number column gets its own tint, separator, and type coloring', () => {
    render(
      <DiffDisplay
        files={[fWith([
          { type: 'ctx', content: 'keep', oldNo: 1, newNo: 1 },
          { type: 'del', content: 'old', oldNo: 2, newNo: null },
          { type: 'add', content: 'new', oldNo: null, newNo: 2 },
        ])]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const rows = rowsOf()
    const lnSpans = (row: HTMLElement) =>
      Array.from(row.querySelectorAll('span')).filter((s) => s.className.includes('bg-surface-subtle/70'))
    const ctxLn = lnSpans(rows[0]!)
    expect(ctxLn).toHaveLength(2)
    expect(ctxLn[0]!.className).toContain('text-ink-tertiary/80')
    // 第二行号列带右侧分隔线
    expect(ctxLn[1]!.className).toContain('border-r border-border/70')
    expect(ctxLn[0]!.className).not.toMatch(/border-r/)
    // 变更行行号随行类型着色
    const delLn = lnSpans(rows[1]!)
    expect(delLn[0]!.className).toContain('text-danger/80')
    const addLn = lnSpans(rows[2]!)
    expect(addLn[0]!.className).toContain('text-success/80')
  })

  it('T2/T3 split: blocks get neutral ring, per-side rail, and gutter separator', () => {
    // 等长配对 del,del / add,add → 两行块：首行 rounded-t、末行 rounded-b
    render(
      <DiffDisplay
        files={[fWith([
          { type: 'ctx', content: 'keep', oldNo: 1, newNo: 1 },
          { type: 'del', content: 'old1', oldNo: 2, newNo: null },
          { type: 'del', content: 'old2', oldNo: 3, newNo: null },
          { type: 'add', content: 'new1', oldNo: null, newNo: 2 },
          { type: 'add', content: 'new2', oldNo: null, newNo: 3 },
          { type: 'ctx', content: 'tail', oldNo: 4, newNo: 4 },
        ])]}
        viewMode="split"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const panes = document.querySelectorAll('div.overflow-x-auto')
    expect(panes).toHaveLength(2)
    const cells = (pane: Element) =>
      Array.from(pane.querySelectorAll<HTMLElement>('div')).filter((d) => d.className.includes('leading-[1.55]'))
    const left = cells(panes[0]!)
    const right = cells(panes[1]!)
    expect(left).toHaveLength(4) // ctx, del, del, ctx
    // 左栏：del 行 = danger 色条 + 中性描边；首行块首圆角/间距、末行块末圆角/间距
    expect(left[1]!.style.boxShadow).toContain('inset 2px 0 0 0 rgb(var(--danger-rgb))')
    expect(left[1]!.style.boxShadow).toContain('inset 0 0 0 1px rgb(var(--border-rgb) / 0.85)')
    expect(left[1]!.className).toContain('rounded-t-[4px]')
    expect(left[1]!.className).toContain('mt-px')
    expect(left[2]!.className).toContain('rounded-b-[4px]')
    expect(left[2]!.className).toContain('mb-px')
    expect(left[0]!.style.boxShadow).toBe('')
    // 右栏：add 行 = success 色条 + 中性描边
    expect(right[1]!.style.boxShadow).toContain('inset 2px 0 0 0 rgb(var(--success-rgb))')
    expect(right[2]!.style.boxShadow).toContain('inset 2px 0 0 0 rgb(var(--success-rgb))')
    // 单行号列带分隔线；del 行号着色
    const ln = Array.from(left[1]!.querySelectorAll('span')).find((s) => s.className.includes('bg-surface-subtle/70'))!
    expect(ln.className).toContain('border-r border-border/70')
    expect(ln.className).toContain('text-danger/80')
    // 不等长配对 del / add,add → 左栏空单元格仍属块（中性描边 + 块末圆角）
    cleanup()
    render(
      <DiffDisplay
        files={[fWith([
          { type: 'del', content: 'old', oldNo: 1, newNo: null },
          { type: 'add', content: 'new1', oldNo: null, newNo: 1 },
          { type: 'add', content: 'new2', oldNo: null, newNo: 2 },
        ])]}
        viewMode="split"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const l2 = cells(document.querySelectorAll('div.overflow-x-auto')[0]!)
    expect(l2[1]!.style.boxShadow).toBe('inset 0 0 0 1px rgb(var(--border-rgb) / 0.85)')
    expect(l2[1]!.className).toContain('rounded-b-[4px]')
    expect(l2[0]!.className).toContain('rounded-t-[4px]')
  })
})
