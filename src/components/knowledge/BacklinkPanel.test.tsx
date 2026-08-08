// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@/i18n'
import { BacklinkPanel, extractBrokenTarget } from './BacklinkPanel'
import { useKnowledgeStore } from '@/store/knowledgeStore'

function seedStore(overrides: Partial<Record<string, unknown>> = {}) {
  useKnowledgeStore.setState({
    activeSpaceId: 'spc_1',
    activeDocId: 'doc_cur',
    spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
    nodes: [{ id: 'doc_cur', parentId: null, kind: 'doc', title: '当前', order: 0, createdAt: 1, updatedAt: 1 }],
    backlinks: [
      { fromDocId: 'doc_a', fromTitle: '文档 A', raw: '[[当前]]', kind: 'wiki', fragment: null },
    ],
    outboundLinks: [
      { kind: 'wiki', raw: '[[文档 B]]', targetTitle: '文档 B', targetDocId: 'doc_b', fragment: null, display: null },
      { kind: 'md', raw: 'https://x', targetTitle: null, targetDocId: null, fragment: null, display: null },
    ],
    brokenLinks: [
      { fromDocId: 'doc_cur', fromTitle: '当前', raw: '[[缺失文档]]', kind: 'wiki' },
    ],
    linkPanelStatus: 'ready',
    ...overrides,
  } as never)
}

describe('extractBrokenTarget', () => {
  it('parses wiki target from raw', () => {
    expect(extractBrokenTarget('[[缺失文档]]')).toBe('缺失文档')
    expect(extractBrokenTarget('[[缺失文档|别名]]')).toBe('缺失文档')
    expect(extractBrokenTarget('[[缺失文档#标题]]')).toBe('缺失文档')
    expect(extractBrokenTarget('[md](url)')).toBeNull()
    expect(extractBrokenTarget('plain')).toBeNull()
  })
})

describe('BacklinkPanel (V2-L1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    cleanup()
  })

  it('renders section counts matching store data', () => {
    seedStore()
    render(<BacklinkPanel />)
    expect(screen.getByTestId('knowledge-backlink-count-inbound')).toHaveTextContent('1')
    expect(screen.getByTestId('knowledge-backlink-count-outbound')).toHaveTextContent('2')
    expect(screen.getByTestId('knowledge-backlink-count-broken')).toHaveTextContent('1')
    // 三组纵向堆叠，同时渲染
    expect(screen.getByTestId('knowledge-backlink-row-doc_a-[[当前]]')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-backlink-row-[[文档 B]]-0')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-backlink-row-doc_cur-[[缺失文档]]')).toBeInTheDocument()
  })

  it('shows per-section empty states', () => {
    seedStore({ backlinks: [], outboundLinks: [] })
    render(<BacklinkPanel />)
    expect(screen.getByTestId('knowledge-backlink-count-outbound')).toHaveTextContent('0')
    expect(screen.getByTestId('knowledge-backlink-empty-inbound')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-backlink-empty-outbound')).toBeInTheDocument()
    // 断链组不受影响
    expect(screen.getByTestId('knowledge-backlink-row-doc_cur-[[缺失文档]]')).toBeInTheDocument()
  })

  it('collapses long lists per section and expands', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      fromDocId: `doc_${i}`,
      fromTitle: `入链 ${i}`,
      raw: `[[当前]]`,
      kind: 'wiki' as const,
      fragment: null,
    }))
    seedStore({ backlinks: many })
    render(<BacklinkPanel />)
    const inboundRows = () => screen.getAllByTestId(/^knowledge-backlink-row-doc_\d-/)
    expect(inboundRows()).toHaveLength(5)
    fireEvent.click(screen.getByTestId('knowledge-backlink-expand-inbound'))
    expect(inboundRows()).toHaveLength(8)
  })

  it('broken row create calls repairBrokenLink and opens the new doc', async () => {
    seedStore()
    const repair = vi
      .spyOn(useKnowledgeStore.getState(), 'repairBrokenLink')
      .mockResolvedValue('doc_new')
    const openRecent = vi
      .spyOn(useKnowledgeStore.getState(), 'openRecent')
      .mockResolvedValue(undefined)
    render(<BacklinkPanel />)
    fireEvent.click(screen.getByTestId('knowledge-backlink-create-doc_cur-[[缺失文档]]'))
    await vi.waitFor(() => {
      expect(repair).toHaveBeenCalledWith('doc_cur', '[[缺失文档]]', '缺失文档')
      expect(openRecent).toHaveBeenCalledWith(expect.objectContaining({ docId: 'doc_new' }))
    })
  })

  it('renders nothing without an active doc', () => {
    seedStore({ activeDocId: null })
    render(<BacklinkPanel />)
    expect(screen.queryByTestId('knowledge-backlink-panel')).not.toBeInTheDocument()
  })
})
