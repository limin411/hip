// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { DiffFile } from '@hip/protocol'
import type React from 'react'
import { DiffDisplay } from './DiffDisplay'
import { clearContextProviders } from '@/components/context-menu'
import { copyText } from '@/ipc/clipboard'
import { useDiffAnnotationStore } from '@/store/diffAnnotationStore'
import { setComposerQuote } from '@/components/command-palette/composerBridge'
import { insertComposerText } from '@/components/command-palette/composerBridge'
import { useHipConfigStore } from '@/store/hipConfigStore'

vi.mock('@/ipc/clipboard', () => ({ copyText: vi.fn(async () => true) }))
vi.mock('@/components/command-palette/composerBridge', () => ({
  setComposerQuote: vi.fn(() => true),
  insertComposerText: vi.fn(() => true),
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, vars?: Record<string, unknown>) => {
        if (key === 'artifact.changesView.explainHunkPrompt') {
          return `EXPLAIN ${String(vars?.path ?? '')} ${String(vars?.text ?? '')}`
        }
        // 轻量插值：{{key}} → 值（模板文本带占位符时）
        return vars
          ? Object.entries(vars).reduce((s, [k, v]) => s.split(`{{${k}}}`).join(String(v)), key)
          : key
      },
    }),
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

  it('T4: word-diff spans use /36 tints with 2px rounding', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    // Equal-length del/add pair → word-diff; mid '1' vs '2' is changed.
    const success = document.querySelector('.bg-diff-add\\/\\[0\\.36\\]')
    const danger = document.querySelector('.bg-diff-del\\/\\[0\\.36\\]')
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
    expect(panes[0]!.querySelector('.bg-diff-del\\/\\[0\\.36\\]')).toBeTruthy()
    expect(panes[1]!.querySelector('.bg-diff-add\\/\\[0\\.36\\]')).toBeTruthy()
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
    expect(panes[0]!.querySelector('.bg-diff-del\\/\\[0\\.36\\]')).toBeNull()
    expect(panes[1]!.querySelector('.bg-diff-add\\/\\[0\\.36\\]')).toBeNull()
    panes = panesOf([
      { type: 'del', content: 'short', oldNo: 1, newNo: null },
      { type: 'add', content: 'x'.repeat(2500), oldNo: null, newNo: 1 },
    ])
    expect(panes[0]!.querySelector('.bg-diff-del\\/\\[0\\.36\\]')).toBeNull()
    expect(panes[1]!.querySelector('.bg-diff-add\\/\\[0\\.36\\]')).toBeNull()
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

  it('T7: summary bar renders only with showSummary and reports totals', () => {
    const twoFiles: DiffFile[] = [
      file,
      { ...file, path: 'src/b.ts', additions: 3, deletions: 4 },
    ]
    const summary = { totalFiles: 2, totalAdditions: 4, totalDeletions: 5 }
    render(
      <DiffDisplay
        files={twoFiles}
        summary={summary}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    // 默认不渲染（Timeline/Diff 共享组件回归防护）
    expect(screen.queryByTestId('diff-summarybar')).toBeNull()
    cleanup()
    render(
      <DiffDisplay
        files={twoFiles}
        summary={summary}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
        showSummary
        filterQuery=""
        onFilterChange={() => {}}
      />,
    )
    const bar = screen.getByTestId('diff-summarybar')
    expect(bar).toHaveTextContent('artifact.changesView.summaryCount')
    expect(bar).toHaveTextContent('+4')
    expect(bar).toHaveTextContent('−5')
    expect(screen.getByTestId('diff-filter-input')).toBeInTheDocument()
  })

  it('T12: add/del rows expose copy-line and quote-line actions; ctx rows do not', () => {
    render(
      <DiffDisplay
        files={[fWith([
          { type: 'ctx', content: 'keep', oldNo: 1, newNo: 1 },
          { type: 'del', content: 'old line', oldNo: 2, newNo: null },
          { type: 'add', content: 'new line', oldNo: null, newNo: 2 },
        ])]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
      />,
    )
    const rows = rowsOf()
    const btns = (row: HTMLElement, id: string) => row.querySelectorAll(`[data-testid="${id}"]`)
    // 上下文行无操作按钮
    expect(btns(rows[0]!, 'diff-line-copy')).toHaveLength(0)
    // 变更行有复制/引用
    expect(btns(rows[1]!, 'diff-line-copy')).toHaveLength(1)
    expect(btns(rows[1]!, 'diff-line-quote')).toHaveLength(1)
    expect(btns(rows[2]!, 'diff-line-copy')).toHaveLength(1)
    fireEvent.click(btns(rows[1]!, 'diff-line-copy')[0]!)
    expect(copyText).toHaveBeenCalledWith('old line')
    fireEvent.click(btns(rows[2]!, 'diff-line-quote')[0]!)
    expect(setComposerQuote).toHaveBeenCalledWith('src/b.ts\nnew line')
  })

  it('T13: formatFileDiff renders git-style headers per status', async () => {
    const { formatFileDiff } = await import('./DiffDisplay')
    const base = { additions: 0, deletions: 0, hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [] }] }
    const mod = formatFileDiff({ ...base, path: 'x.ts', status: 'modified' })
    expect(mod).toContain('diff --git a/x.ts b/x.ts')
    expect(mod).toContain('--- a/x.ts')
    expect(mod).toContain('+++ b/x.ts')
    expect(mod).toContain('@@ -1,1 +1,1 @@')
    const added = formatFileDiff({ ...base, path: 'y.ts', status: 'added' })
    expect(added).toContain('new file mode 100644')
    const renamed = formatFileDiff({ ...base, path: 'y.ts', oldPath: 'z.ts', status: 'renamed' })
    expect(renamed).toContain('rename from z.ts')
    expect(renamed).toContain('rename to y.ts')
    const deleted = formatFileDiff({ ...base, path: 'y.ts', status: 'deleted' })
    expect(deleted).toContain('deleted file mode 100644')
  })

  it('T9: summary refresh button spins and disables while refreshing', () => {
    render(
      <DiffDisplay
        files={[file]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
        showSummary
        filterQuery=""
        onFilterChange={() => {}}
        refreshing
      />,
    )
    const btn = screen.getByTestId('diff-summary-refresh')
    expect(btn).toBeDisabled()
    expect(btn.querySelector('.animate-spin')).toBeTruthy()
  })

  it('T8: filter input reports changes, Escape clears, empty state shows label', () => {
    const onFilter = vi.fn()
    render(
      <DiffDisplay
        files={[]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
        showSummary
        filterQuery="zzz"
        onFilterChange={onFilter}
        filterEmptyLabel="无匹配"
      />,
    )
    const input = screen.getByTestId('diff-filter-input')
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(onFilter).toHaveBeenCalledWith('abc')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onFilter).toHaveBeenLastCalledWith('')
    expect(screen.getByTestId('diff-filter-empty')).toHaveTextContent('无匹配')
  })

  it('T14/T15: hunk explain injects a prompt; rows expose row semantics', () => {
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
    // hunk 结构 role=group
    const hunk = screen.getByTestId('diff-hunk-header').querySelector('[role="group"]')
    expect(hunk).toHaveAttribute('aria-label', 'artifact.diffView.hunkLabel')
    // 行 role=row + 行类型 aria-label
    const rows = rowsOf()
    expect(rows[0]).toHaveAttribute('role', 'row')
    expect(rows[0]).toHaveAttribute('aria-label', 'artifact.diffView.rowContext')
    expect(rows[1]).toHaveAttribute('aria-label', 'artifact.diffView.rowDeleted')
    expect(rows[2]).toHaveAttribute('aria-label', 'artifact.diffView.rowAdded')
    // 解释按钮 → 注入含路径与 hunk 文本的提示
    fireEvent.click(screen.getByTestId('diff-hunk-explain'))
    expect(insertComposerText).toHaveBeenCalledWith(
      expect.stringContaining('src/b.ts'),
    )
    expect(insertComposerText).toHaveBeenCalledWith(expect.stringContaining('@@ -1,1 +1,1 @@'))
  })

  it('T16: minimap shows for long multi-hunk expanded files and jumps to hunks', () => {
    const longFile: DiffFile = {
      ...file,
      path: 'src/long.ts',
      hunks: [
        { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, header: '', lines: [
          { type: 'del', content: 'a', oldNo: 1, newNo: null },
          { type: 'add', content: 'b', oldNo: null, newNo: 1 },
        ] },
        { oldStart: 200, oldLines: 1, newStart: 200, newLines: 1, header: '', lines: [
          { type: 'add', content: 'c', oldNo: null, newNo: 200 },
        ] },
        { oldStart: 500, oldLines: 1, newStart: 500, newLines: 1, header: '', lines: [
          { type: 'del', content: 'd', oldNo: 500, newNo: null },
        ] },
      ],
    }
    const onJump = vi.fn()
    render(
      <DiffDisplay
        files={[longFile]}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
        onHunkJump={onJump}
      />,
    )
    // 展开文件：估算 500 行 + 3 hunk → minimap 3 色点
    const minimap = screen.getByTestId('diff-minimap')
    expect(minimap.querySelectorAll('button')).toHaveLength(3)
    const dot = screen.getByTestId('diff-minimap-hunk-1')
    expect(dot.getAttribute('style')).toContain('rgb(var(--success-rgb))')
    fireEvent.click(dot)
    expect(onJump).toHaveBeenCalledWith('src/long.ts', 1)
  })

  it('T16: minimap hidden when collapsed, short, or narrow', () => {
    const longFile: DiffFile = {
      ...file,
      path: 'src/long.ts',
      hunks: [
        { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, header: '', lines: [
          { type: 'del', content: 'a', oldNo: 1, newNo: null },
          { type: 'add', content: 'b', oldNo: null, newNo: 1 },
        ] },
        { oldStart: 200, oldLines: 1, newStart: 200, newLines: 1, header: '', lines: [
          { type: 'add', content: 'c', oldNo: null, newNo: 200 },
        ] },
        { oldStart: 500, oldLines: 1, newStart: 500, newLines: 1, header: '', lines: [
          { type: 'del', content: 'd', oldNo: 500, newNo: null },
        ] },
      ],
    }
    const renderWith = (extra?: Partial<React.ComponentProps<typeof DiffDisplay>>) =>
      render(
        <DiffDisplay
          files={[longFile]}
          viewMode="unified"
          sessionId="s1"
          onToggleCollapse={() => {}}
          {...extra}
        />,
      )
    renderWith({ collapsed: { 'src/long.ts': true } })
    expect(screen.queryByTestId('diff-minimap')).toBeNull()
    cleanup()
    renderWith({ narrow: true })
    expect(screen.queryByTestId('diff-minimap')).toBeNull()
    cleanup()
    renderWith({ files: [file] }) // 短文件（1 hunk）
    expect(screen.queryByTestId('diff-minimap')).toBeNull()
  })

  it('T17: groupByStatus renders group headers and preserves order within groups', () => {
    const files: DiffFile[] = [
      { ...file, path: 'a.ts', status: 'modified' },
      { ...file, path: 'b.ts', status: 'added' },
      { ...file, path: 'c.ts', status: 'modified' },
      { ...file, path: 'd.ts', status: 'deleted' },
    ]
    render(
      <DiffDisplay
        files={files}
        viewMode="unified"
        sessionId="s1"
        onToggleCollapse={() => {}}
        groupByStatus
      />,
    )
    const headers = screen.getAllByTestId('diff-group-header')
    expect(headers).toHaveLength(3) // A / M / D（无 renamed）
    expect(headers[0]).toHaveTextContent('A')
    expect(headers[1]).toHaveTextContent('M')
    // 组内顺序保持；组间 A → M → D
    const paths = screen.getAllByTestId('diff-file-header').map((h) => h.textContent ?? '')
    const aIdx = paths.findIndex((p) => p.includes('b.ts'))
    const mIdx = paths.findIndex((p) => p.includes('a.ts'))
    const dIdx = paths.findIndex((p) => p.includes('d.ts'))
    expect(aIdx).toBeLessThan(mIdx)
    expect(mIdx).toBeLessThan(dIdx)
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

  it('chrome dark: line decorations follow the code-block palette, not app tokens', () => {
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
    // 代码区容器：diff 主色变量按代码块明度切到深档（原型深色板 #4caf50/#ff5252）
    const area = screen.getByTestId('diff-code-area')
    expect(area.getAttribute('style')).toContain('--diff-add-rgb: 76 175 80')
    expect(area.getAttribute('style')).toContain('--diff-del-rgb: 255 82 82')
    const rows = rowsOf()
    const del = rows[0]!
    const add = rows[1]!
    // 色条/描边：引用 diff 变量（随容器覆盖解析为深档）
    expect(del.style.borderLeftColor).toBe('rgb(var(--diff-del-rgb))')
    expect(add.style.borderLeftColor).toBe('rgb(var(--diff-add-rgb))')
    expect(del.style.boxShadow).toBe('inset 0 0 0 1px rgb(var(--diff-del-rgb) / 0.24)')
    expect(add.style.boxShadow).toBe('inset 0 0 0 1px rgb(var(--diff-add-rgb) / 0.24)')
    // 行号列：底纹 = 主题 headerBackground（不再用应用 bg-subtle 白灰），分隔线 = 主题 border；
    // add/del 行号文字 = 主色（对齐原型），ctx 行号 = headerText
    const lns = del.querySelectorAll<HTMLElement>('.bg-surface-subtle\\/\\[0\\.62\\]')
    expect(lns[0]!.style.backgroundColor).toBe('#161b22')
    expect(lns[0]!.style.color).toBe('rgb(var(--diff-del-rgb))')
    expect(lns[1]!.style.borderRightColor).toBe('#30363d')
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

  it('T1/T2 unified: change rows get rail border + ring shadow and block rounding; ctx rows stay plain', () => {
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
    // 上下文行：无色条、无底色、无描边 shadow；border 透明占位保持行号列对齐
    expect(rows[0]!.className).toContain('border-l-[3px] border-transparent')
    expect(rows[0]!.className).not.toMatch(/bg-(success|danger|diff)/)
    expect(rows[0]!.style.boxShadow).toBe('')
    // del 行：13% 底色 + 左侧 3px 主色色条（border，不被行号列遮挡）+ 块首圆角/间距
    expect(rows[1]!.className).toContain('bg-diff-del/[0.13]')
    expect(rows[1]!.className).toContain('border-l-[3px]')
    expect(rows[1]!.style.borderLeftColor).toBe('rgb(var(--diff-del-rgb))')
    expect(rows[1]!.className).toContain('rounded-t-[6px]')
    expect(rows[1]!.className).toContain('mt-[3px]')
    expect(rows[1]!.style.boxShadow).toBe('inset 0 0 0 1px rgb(var(--diff-del-rgb) / 0.24)')
    // add 行：success 侧 + 块末圆角/间距
    expect(rows[2]!.className).toContain('bg-diff-add/[0.13]')
    expect(rows[2]!.style.borderLeftColor).toBe('rgb(var(--diff-add-rgb))')
    expect(rows[2]!.className).toContain('rounded-b-[6px]')
    expect(rows[2]!.className).toContain('mb-[3px]')
    expect(rows[2]!.style.boxShadow).toBe('inset 0 0 0 1px rgb(var(--diff-add-rgb) / 0.24)')
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
    expect(rows[0]!.className).toContain('rounded-t-[6px]')
    expect(rows[1]!.className).not.toMatch(/rounded-/)
    expect(rows[2]!.className).not.toMatch(/rounded-/)
    expect(rows[3]!.className).toContain('rounded-b-[6px]')
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
    expect(single[0]!.className).toContain('rounded-[6px]')
    expect(single[2]!.className).toContain('rounded-[6px]')
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
      Array.from(row.querySelectorAll('span')).filter((s) => s.className.includes('bg-surface-subtle/[0.62]'))
    const ctxLn = lnSpans(rows[0]!)
    expect(ctxLn).toHaveLength(2)
    expect(ctxLn[0]!.className).toContain('text-ink-tertiary/80')
    // 第二行号列带右侧分隔线（100% 边框，对齐原型）
    expect(ctxLn[1]!.className).toContain('border-r border-border')
    expect(ctxLn[0]!.className).not.toMatch(/border-r/)
    // 变更行行号随行类型着色（全强度，对齐原型）
    const delLn = lnSpans(rows[1]!)
    expect(delLn[0]!.className).toContain('text-diff-del')
    const addLn = lnSpans(rows[2]!)
    expect(addLn[0]!.className).toContain('text-diff-add')
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
    // 左栏：del 行 = danger 色条（border 内联）+ 中性描边 100%；首行块首圆角/间距、末行块末圆角/间距
    expect(left[1]!.className).toContain('border-l-[3px]')
    expect(left[1]!.style.borderLeftColor).toBe('rgb(var(--diff-del-rgb))')
    expect(left[1]!.style.boxShadow).toBe('inset 0 0 0 1px rgb(var(--border-rgb))')
    expect(left[1]!.className).toContain('rounded-t-[6px]')
    expect(left[1]!.className).toContain('mt-[3px]')
    expect(left[2]!.className).toContain('rounded-b-[6px]')
    expect(left[2]!.className).toContain('mb-[3px]')
    expect(left[0]!.style.boxShadow).toBe('')
    // 右栏：add 行 = success 色条 + 中性描边
    expect(right[1]!.style.borderLeftColor).toBe('rgb(var(--diff-add-rgb))')
    expect(right[2]!.style.borderLeftColor).toBe('rgb(var(--diff-add-rgb))')
    expect(right[1]!.style.boxShadow).toBe('inset 0 0 0 1px rgb(var(--border-rgb))')
    // 单行号列带分隔线；del 行号着色
    const ln = Array.from(left[1]!.querySelectorAll('span')).find((s) => s.className.includes('bg-surface-subtle/[0.62]'))!
    expect(ln.className).toContain('border-r border-border')
    expect(ln.className).toContain('text-diff-del')
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
    expect(l2[1]!.style.boxShadow).toBe('inset 0 0 0 1px rgb(var(--border-rgb))')
    expect(l2[1]!.className).toContain('rounded-b-[6px]')
    expect(l2[1]!.className).toContain('border-l-[3px] border-transparent')
    expect(l2[0]!.className).toContain('rounded-t-[6px]')
  })
})
