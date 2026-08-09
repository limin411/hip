// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@/i18n'
import {
  BacklinkPanel,
  dedupeOutboundLinks,
  extractBrokenTarget,
  extractMdLinkHref,
  outboundRowLabel,
} from './BacklinkPanel'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import type { KnowledgeLinkOutboundRow } from '@/ipc/knowledge'

const openExternal = vi.fn()
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: (...args: unknown[]) => openExternal(...args),
}))

function seedStore(overrides: Partial<Record<string, unknown>> = {}) {
  useKnowledgeStore.setState({
    activeSpaceId: 'spc_1',
    activeDocId: 'doc_cur',
    spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
    nodes: [
      { id: 'doc_cur', parentId: null, kind: 'doc', title: '当前', order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'doc_b', parentId: null, kind: 'doc', title: '文档 B', order: 1, createdAt: 1, updatedAt: 1 },
    ],
    backlinks: [
      { fromDocId: 'doc_a', fromTitle: '文档 A', raw: '[[当前]]', kind: 'wiki', fragment: null },
    ],
    outboundLinks: [
      { kind: 'wiki', raw: '[[文档 B]]', targetTitle: '文档 B', targetDocId: 'doc_b', fragment: null, display: null },
      { kind: 'md', raw: '[site](https://example.com)', targetTitle: null, targetDocId: null, fragment: null, display: 'site' },
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

describe('extractMdLinkHref', () => {
  it('parses markdown link destinations', () => {
    expect(extractMdLinkHref('[a](https://x.test)')).toBe('https://x.test')
    expect(extractMdLinkHref('[a](https://x.test "t")')).toBe('https://x.test')
    expect(extractMdLinkHref('[[wiki]]')).toBeNull()
  })
})

describe('outboundRowLabel', () => {
  it('shows a single title for plain wiki links (no [[Title]] echo)', () => {
    expect(
      outboundRowLabel({
        kind: 'wiki',
        raw: '[[文档 B]]',
        targetTitle: '文档 B',
        targetDocId: 'doc_b',
        fragment: null,
        display: null,
      }),
    ).toEqual({ title: '文档 B', snippet: null })
  })

  it('shows target under alias and href under md label', () => {
    expect(
      outboundRowLabel({
        kind: 'wiki',
        raw: '[[文档 B|别名]]',
        targetTitle: '文档 B',
        targetDocId: 'doc_b',
        fragment: null,
        display: '别名',
      }),
    ).toEqual({ title: '别名', snippet: '文档 B' })

    expect(
      outboundRowLabel({
        kind: 'md',
        raw: '[site](https://example.com)',
        targetTitle: null,
        targetDocId: null,
        fragment: null,
        display: 'site',
      }),
    ).toEqual({ title: 'site', snippet: 'https://example.com' })
  })
})

describe('dedupeOutboundLinks', () => {
  it('collapses repeated links to the same target', () => {
    const links: KnowledgeLinkOutboundRow[] = [
      {
        kind: 'wiki',
        raw: '[[文档 B]]',
        targetTitle: '文档 B',
        targetDocId: 'doc_b',
        fragment: null,
        display: null,
      },
      {
        kind: 'wiki',
        raw: '[[文档 B|别名]]',
        targetTitle: '文档 B',
        targetDocId: 'doc_b',
        fragment: null,
        display: '别名',
      },
      {
        kind: 'wiki',
        raw: '[[文档 B#Intro]]',
        targetTitle: '文档 B',
        targetDocId: 'doc_b',
        fragment: 'Intro',
        display: null,
      },
    ]
    const out = dedupeOutboundLinks(links)
    expect(out).toHaveLength(2)
    expect(out[0]!.raw).toBe('[[文档 B]]')
    expect(out[1]!.fragment).toBe('Intro')
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
    expect(screen.getByTestId('knowledge-backlink-row-wiki-doc_b--0')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-backlink-row-doc_cur-[[缺失文档]]')).toBeInTheDocument()
  })

  it('wiki outbound row is single-line (no redundant raw under title)', () => {
    seedStore({
      outboundLinks: [
        {
          kind: 'wiki',
          raw: '[[文档 B]]',
          targetTitle: '文档 B',
          targetDocId: 'doc_b',
          fragment: null,
          display: null,
        },
      ],
    })
    render(<BacklinkPanel />)
    const row = screen.getByTestId('knowledge-backlink-row-wiki-doc_b--0')
    expect(row).toHaveTextContent('文档 B')
    expect(row).not.toHaveTextContent('[[文档 B]]')
  })

  it('dedupes identical outbound targets in the panel', () => {
    seedStore({
      outboundLinks: [
        {
          kind: 'wiki',
          raw: '[[文档 B]]',
          targetTitle: '文档 B',
          targetDocId: 'doc_b',
          fragment: null,
          display: null,
        },
        {
          kind: 'wiki',
          raw: '[[文档 B]]',
          targetTitle: '文档 B',
          targetDocId: 'doc_b',
          fragment: null,
          display: null,
        },
      ],
    })
    render(<BacklinkPanel />)
    expect(screen.getByTestId('knowledge-backlink-count-outbound')).toHaveTextContent('1')
    expect(screen.getAllByTestId(/^knowledge-backlink-row-wiki-doc_b/)).toHaveLength(1)
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

  it('outbound wiki row opens target via openDoc', () => {
    seedStore()
    const openDoc = vi
      .spyOn(useKnowledgeStore.getState(), 'openDoc')
      .mockResolvedValue(undefined)
    render(<BacklinkPanel />)
    fireEvent.click(screen.getByTestId('knowledge-backlink-row-wiki-doc_b--0'))
    expect(openDoc).toHaveBeenCalledWith('doc_b')
  })

  it('outbound resolves by live title when index targetDocId is missing', () => {
    seedStore({
      outboundLinks: [
        {
          kind: 'wiki',
          raw: '[[文档 B]]',
          targetTitle: '文档 B',
          targetDocId: null,
          fragment: null,
          display: null,
        },
      ],
    })
    const openDoc = vi
      .spyOn(useKnowledgeStore.getState(), 'openDoc')
      .mockResolvedValue(undefined)
    render(<BacklinkPanel />)
    fireEvent.click(screen.getByTestId('knowledge-backlink-row-wiki-文档 B--0'))
    expect(openDoc).toHaveBeenCalledWith('doc_b')
  })

  it('outbound md row opens external href', async () => {
    openExternal.mockReset()
    openExternal.mockResolvedValue(undefined)
    seedStore()
    render(<BacklinkPanel />)
    fireEvent.click(
      screen.getByTestId('knowledge-backlink-row-md-[site](https://example.com)--1'),
    )
    await vi.waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith('https://example.com')
    })
  })

  it('broken row create calls repairBrokenLink and opens the new doc', async () => {
    seedStore()
    const repair = vi
      .spyOn(useKnowledgeStore.getState(), 'repairBrokenLink')
      .mockResolvedValue('doc_new')
    const openDoc = vi
      .spyOn(useKnowledgeStore.getState(), 'openDoc')
      .mockResolvedValue(undefined)
    render(<BacklinkPanel />)
    fireEvent.click(screen.getByTestId('knowledge-backlink-create-doc_cur-[[缺失文档]]'))
    await vi.waitFor(() => {
      expect(repair).toHaveBeenCalledWith('doc_cur', '[[缺失文档]]', '缺失文档')
      expect(openDoc).toHaveBeenCalledWith('doc_new')
    })
  })

  it('renders nothing without an active doc', () => {
    seedStore({ activeDocId: null })
    render(<BacklinkPanel />)
    expect(screen.queryByTestId('knowledge-backlink-panel')).not.toBeInTheDocument()
  })
})
