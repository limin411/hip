// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { TableInfoPanel } from './TableInfoPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.width != null) return `${opts.width}px`
      if (opts?.n != null) return `列 ${opts.n}`
      if (opts?.rows != null) return `${opts.rows} 行 · ${opts.cols} 列`
      return key
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

const CSV = 'a,100,c\n1,200,3\nx,300,z\n'
const META = JSON.stringify({
  cols: [
    { id: 'col_1', name: '任务', type: 'text', width: 180 },
    { id: 'col_2', name: '预算', type: 'number', width: 120 },
    { id: 'col_3', name: '状态', type: 'select', options: ['待办', '完成'], width: 130 },
  ],
})

describe('TableInfoPanel (table-right-panel PR-2, spec T2)', () => {
  beforeEach(() => {
    useKnowledgeStore.setState({
      tableDraft: { id: 'tbl_1', csv: CSV, meta: META },
    })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders stats: rows × cols', () => {
    render(<TableInfoPanel />)
    expect(screen.getByTestId('table-info-stats').textContent).toContain('3 行 · 3 列')
  })

  it('renders type distribution chips with counts', () => {
    render(<TableInfoPanel />)
    expect(screen.getByTestId('table-info-dist-text').textContent).toContain('1')
    expect(screen.getByTestId('table-info-dist-number').textContent).toContain('1')
    expect(screen.getByTestId('table-info-dist-select').textContent).toContain('1')
  })

  it('renders column list: name + width + data-col-id', () => {
    render(<TableInfoPanel />)
    const c0 = screen.getByTestId('table-info-col-0')
    expect(c0.textContent).toContain('任务')
    expect(c0.textContent).toContain('180px')
    expect(c0.getAttribute('data-col-id')).toBe('col_1')
    expect(screen.getByTestId('table-info-col-2').textContent).toContain('130px')
  })

  it('empty table (no rows) shows empty hint', () => {
    useKnowledgeStore.setState({
      tableDraft: { id: 'tbl_1', csv: '', meta: META },
    })
    render(<TableInfoPanel />)
    expect(screen.getByTestId('table-info-empty')).toBeTruthy()
    expect(screen.queryByTestId('table-info-stats')).toBeNull()
  })

  it('clicking a column requests a table column jump', () => {
    const spy = vi.spyOn(useKnowledgeStore.getState(), 'requestTableColumnJump')
    render(<TableInfoPanel />)
    fireEvent.click(screen.getByTestId('table-info-col-1'))
    expect(spy).toHaveBeenCalledWith('col_2')
  })

  it('draft updates flow into stats after debounce', async () => {
    vi.useFakeTimers()
    render(<TableInfoPanel />)
    useKnowledgeStore.setState({
      tableDraft: { id: 'tbl_1', csv: 'a\nb\nc\nd\n', meta: META },
    })
    await act(async () => {})
    // 防抖窗口内不更新（'33 行' = 数字 span 3 + '3 行 · 3 列'）
    expect(screen.getByTestId('table-info-stats').textContent).toContain('3 行 · 3 列')
    vi.advanceTimersByTime(220)
    await act(async () => {})
    expect(screen.getByTestId('table-info-stats').textContent).toContain('4 行 · 3 列')
  })
})
