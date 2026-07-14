import { describe, expect, it } from 'vitest'
import {
  countBrokenOutbound,
  createLinkIndex,
  getBacklinks,
  getOutbound,
  indexDocLinks,
  KNOWLEDGE_LINK_EXTRACT_MAX_CHARS,
  linkIndexStats,
  normalizeTitleKey,
  reindexSpaceLinks,
  removeSourceDoc,
  removeSpaceFromLinkIndex,
  reresolveSpaceLinks,
  titleKey,
} from './linkIndex'
import { docKey } from './search'

const docs = [
  { id: 'doc_a', title: 'Alpha', aliases: ['A1'], order: 0 },
  { id: 'doc_b', title: 'Beta', aliases: [], order: 1 },
  { id: 'doc_c', title: 'Gamma', aliases: ['Plan'], order: 2 },
]

describe('linkIndex composite keys', () => {
  it('titleKey is space-scoped and case-normalized', () => {
    expect(titleKey('spc_1', 'Hello World')).toBe(
      `spc_1::title:${normalizeTitleKey('Hello World')}`,
    )
    expect(titleKey('spc_1', 'Hello')).not.toBe(titleKey('spc_2', 'Hello'))
    expect(titleKey('spc_1', 'Alpha')).toBe(titleKey('spc_1', 'alpha'))
  })

  it('never stores bare docId / bare title as map keys', () => {
    const idx = createLinkIndex()
    indexDocLinks(idx, 'spc_1', 'doc_a', 'See [[Beta]] and [[Missing]].', docs)
    for (const key of idx.bySource.keys()) {
      expect(key).toContain(':')
      expect(key).toBe(docKey('spc_1', 'doc_a'))
    }
    for (const key of idx.byTargetDoc.keys()) {
      expect(key).toBe(docKey('spc_1', 'doc_b'))
    }
    for (const key of idx.byTargetTitle.keys()) {
      expect(key.startsWith('spc_1::title:')).toBe(true)
    }
  })
})

describe('indexDocLinks resolution', () => {
  it('resolves title and alias; marks missing as broken', () => {
    const idx = createLinkIndex()
    indexDocLinks(
      idx,
      'spc_1',
      'doc_a',
      '[[Beta]] and [[Plan]] and [[Nope]]',
      docs,
    )
    const out = getOutbound(idx, 'spc_1', 'doc_a')
    expect(out).toHaveLength(3)
    const beta = out.find((e) => e.title === 'Beta')
    expect(beta).toMatchObject({
      toDocId: 'doc_b',
      toSpaceId: 'spc_1',
      broken: false,
    })
    const plan = out.find((e) => e.title === 'Plan')
    expect(plan).toMatchObject({
      toDocId: 'doc_c',
      broken: false,
    })
    const nope = out.find((e) => e.title === 'Nope')
    expect(nope).toMatchObject({ broken: true, toDocId: null })
    expect(countBrokenOutbound(idx, 'spc_1', 'doc_a')).toBe(1)
  })

  it('dedupes repeated titles from one source', () => {
    const idx = createLinkIndex()
    indexDocLinks(idx, 'spc_1', 'doc_a', '[[Beta]] then [[Beta]] again', docs)
    expect(getOutbound(idx, 'spc_1', 'doc_a')).toHaveLength(1)
  })

  it('skips code fences via extractWikiLinks', () => {
    const idx = createLinkIndex()
    indexDocLinks(idx, 'spc_1', 'doc_a', '```\n[[Beta]]\n```\n[[Gamma]]', docs)
    const titles = getOutbound(idx, 'spc_1', 'doc_a').map((e) => e.title)
    expect(titles).toEqual(['Gamma'])
  })

  it('skips extract when body exceeds max chars', () => {
    const idx = createLinkIndex()
    const big = '[[Beta]]' + 'x'.repeat(KNOWLEDGE_LINK_EXTRACT_MAX_CHARS)
    indexDocLinks(idx, 'spc_1', 'doc_a', big, docs)
    expect(getOutbound(idx, 'spc_1', 'doc_a')).toHaveLength(0)
  })
})

describe('getBacklinks', () => {
  it('lists inbound resolved edges and ignores broken title noise', () => {
    const idx = createLinkIndex()
    indexDocLinks(idx, 'spc_1', 'doc_a', '[[Beta]]', docs)
    indexDocLinks(idx, 'spc_1', 'doc_c', '[[Beta]] and [[Missing]]', docs)
    const backs = getBacklinks(idx, 'spc_1', 'doc_b')
    expect(backs.map((e) => e.fromDocId).sort()).toEqual(['doc_a', 'doc_c'])
    expect(backs.every((e) => e.broken === false)).toBe(true)
  })

  it('does not bleed across spaces (composite keys)', () => {
    const idx = createLinkIndex()
    const docs2 = [{ id: 'doc_b', title: 'Beta', aliases: [], order: 0 }]
    indexDocLinks(idx, 'spc_1', 'doc_a', '[[Beta]]', docs)
    indexDocLinks(idx, 'spc_2', 'doc_x', '[[Beta]]', docs2)
    expect(getBacklinks(idx, 'spc_1', 'doc_b').map((e) => e.fromSpaceId)).toEqual([
      'spc_1',
    ])
    expect(getBacklinks(idx, 'spc_2', 'doc_b').map((e) => e.fromDocId)).toEqual([
      'doc_x',
    ])
  })
})

describe('incremental remove / reindex', () => {
  it('removeSourceDoc clears outbound and reverse indexes', () => {
    const idx = createLinkIndex()
    indexDocLinks(idx, 'spc_1', 'doc_a', '[[Beta]] [[Nope]]', docs)
    expect(getBacklinks(idx, 'spc_1', 'doc_b')).toHaveLength(1)
    removeSourceDoc(idx, 'spc_1', 'doc_a')
    expect(getOutbound(idx, 'spc_1', 'doc_a')).toHaveLength(0)
    expect(getBacklinks(idx, 'spc_1', 'doc_b')).toHaveLength(0)
    expect(linkIndexStats(idx).edges).toBe(0)
  })

  it('reresolve after rename: old title becomes broken (no body rewrite)', () => {
    const idx = createLinkIndex()
    indexDocLinks(idx, 'spc_1', 'doc_a', 'See [[Old Title]]', [
      { id: 'doc_t', title: 'Old Title', order: 0 },
    ])
    expect(getOutbound(idx, 'spc_1', 'doc_a')[0]?.broken).toBe(false)
    expect(getBacklinks(idx, 'spc_1', 'doc_t')).toHaveLength(1)

    reresolveSpaceLinks(idx, 'spc_1', [{ id: 'doc_t', title: 'New Title', order: 0 }])
    expect(getOutbound(idx, 'spc_1', 'doc_a')[0]?.broken).toBe(true)
    expect(getBacklinks(idx, 'spc_1', 'doc_t')).toHaveLength(0)
    expect(countBrokenOutbound(idx, 'spc_1', 'doc_a')).toBe(1)
  })

  it('reresolve recovers via alias without re-reading body', () => {
    const idx = createLinkIndex()
    indexDocLinks(idx, 'spc_1', 'doc_a', '[[KB Plan]]', [
      { id: 'doc_t', title: 'KB Plan', order: 0 },
    ])
    reresolveSpaceLinks(idx, 'spc_1', [
      { id: 'doc_t', title: 'Renamed', aliases: ['KB Plan'], order: 0 },
    ])
    expect(getOutbound(idx, 'spc_1', 'doc_a')[0]).toMatchObject({
      broken: false,
      toDocId: 'doc_t',
    })
  })

  it('reindexSpaceLinks uses bodies map', () => {
    const idx = createLinkIndex()
    const bodies = new Map([['doc_a', '[[Beta]]']])
    reindexSpaceLinks(idx, 'spc_1', docs, bodies)
    expect(getOutbound(idx, 'spc_1', 'doc_a')[0]?.toDocId).toBe('doc_b')
  })

  it('removeSpaceFromLinkIndex drops only that space', () => {
    const idx = createLinkIndex()
    indexDocLinks(idx, 'spc_1', 'doc_a', '[[Beta]]', docs)
    indexDocLinks(idx, 'spc_2', 'doc_x', '[[Beta]]', [
      { id: 'doc_b', title: 'Beta', order: 0 },
    ])
    removeSpaceFromLinkIndex(idx, 'spc_1')
    expect(getOutbound(idx, 'spc_1', 'doc_a')).toHaveLength(0)
    expect(getBacklinks(idx, 'spc_2', 'doc_b')).toHaveLength(1)
  })

  it('indexDocLinks replaces prior edges for same source', () => {
    const idx = createLinkIndex()
    indexDocLinks(idx, 'spc_1', 'doc_a', '[[Beta]]', docs)
    indexDocLinks(idx, 'spc_1', 'doc_a', '[[Gamma]]', docs)
    expect(getOutbound(idx, 'spc_1', 'doc_a').map((e) => e.title)).toEqual(['Gamma'])
    expect(getBacklinks(idx, 'spc_1', 'doc_b')).toHaveLength(0)
    expect(getBacklinks(idx, 'spc_1', 'doc_c')).toHaveLength(1)
  })
})
