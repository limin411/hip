import { describe, expect, it } from 'vitest'
import type { KnowledgeNode } from './types'
import {
  extractWikiLinks,
  formatWikiLink,
  listDocsInTreeOrder,
  parseWikiLinkInner,
  rankWikiCandidates,
  resolveWikiTitle,
  rewriteWikiLinksForPreview,
  titleFromWikiHref,
  wikiHrefForTitle,
  wikiLinkQueryAt,
  WIKI_LINK_HREF_PREFIX,
} from './wikiLink'

function doc(
  id: string,
  title: string,
  order: number,
  parentId: string | null = null,
): KnowledgeNode {
  return {
    id,
    parentId,
    kind: 'doc',
    title,
    order,
    createdAt: 1,
    updatedAt: 1,
  }
}

function folder(
  id: string,
  title: string,
  order: number,
  parentId: string | null = null,
): KnowledgeNode {
  return {
    id,
    parentId,
    kind: 'folder',
    title,
    order,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('parseWikiLinkInner', () => {
  it('parses title-only', () => {
    expect(parseWikiLinkInner('Hello')).toEqual({ title: 'Hello', display: null })
  })

  it('parses pipe display', () => {
    expect(parseWikiLinkInner('Hello|World')).toEqual({
      title: 'Hello',
      display: 'World',
    })
  })

  it('trims and treats empty display as null', () => {
    expect(parseWikiLinkInner('  A  |  ')).toEqual({ title: 'A', display: null })
  })
})

describe('extractWikiLinks', () => {
  it('extracts title and pipe forms', () => {
    const hits = extractWikiLinks('See [[Alpha]] and [[Beta|B]].')
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ title: 'Alpha', display: null })
    expect(hits[1]).toMatchObject({ title: 'Beta', display: 'B' })
  })

  it('skips fenced code blocks', () => {
    const md = '[[Keep]]\n```\n[[Skip]]\n```\n[[Also]]'
    const titles = extractWikiLinks(md).map((h) => h.title)
    expect(titles).toEqual(['Keep', 'Also'])
  })

  it('skips inline code', () => {
    const titles = extractWikiLinks('`[[nope]]` and [[yes]]').map((h) => h.title)
    expect(titles).toEqual(['yes'])
  })
})

describe('listDocsInTreeOrder + resolveWikiTitle', () => {
  const nodes: KnowledgeNode[] = [
    folder('fld_a', 'Folder', 0),
    doc('doc_b', 'Untitled', 1, 'fld_a'),
    doc('doc_a', 'Untitled', 0, 'fld_a'),
    doc('doc_root', 'Alpha', 0, null),
    doc('doc_case', 'alpha', 1, null),
  ]

  it('walks tree order (DFS) with id tie-break', () => {
    const docs = listDocsInTreeOrder(nodes)
    // Root: Alpha (order 0) before Folder (order 0, title after), then alpha (order 1).
    // Under Folder: Untitled order 0 (doc_a) before order 1 (doc_b).
    expect(docs.map((d) => d.id)).toEqual([
      'doc_root',
      'doc_a',
      'doc_b',
      'doc_case',
    ])
  })

  it('duplicate titles: first stable tree order wins', () => {
    const docs = listDocsInTreeOrder(nodes)
    const hit = resolveWikiTitle('Untitled', docs)
    expect(hit?.id).toBe('doc_a')
  })

  it('exact match before case-insensitive', () => {
    const docs = listDocsInTreeOrder(nodes)
    expect(resolveWikiTitle('alpha', docs)?.id).toBe('doc_case')
    expect(resolveWikiTitle('Alpha', docs)?.id).toBe('doc_root')
  })

  it('case-insensitive fallback when no exact', () => {
    const docs = [doc('d1', 'Hello World', 0)]
    expect(resolveWikiTitle('hello world', docs)?.id).toBe('d1')
  })

  it('empty / missing → null (broken)', () => {
    const docs = [doc('d1', 'X', 0)]
    expect(resolveWikiTitle('', docs)).toBeNull()
    expect(resolveWikiTitle('Missing', docs)).toBeNull()
  })
})

describe('rankWikiCandidates (picker only)', () => {
  const docs = [
    doc('d1', 'Project Plan', 0),
    doc('d2', 'API Notes', 1),
    doc('d3', 'Planning', 2),
  ]

  it('empty query returns tree order slice', () => {
    const ranked = rankWikiCandidates('', docs, 2)
    expect(ranked.map((r) => r.node.id)).toEqual(['d1', 'd2'])
  })

  it('ranks prefix higher than includes', () => {
    const ranked = rankWikiCandidates('Plan', docs)
    // Planning starts with Plan → 0.9; Project Plan includes → 0.75
    expect(ranked[0]?.node.title).toBe('Planning')
    expect(ranked.map((r) => r.node.title)).toContain('Project Plan')
  })

  it('uses fuzzy subsequence for non-contiguous', () => {
    const ranked = rankWikiCandidates('apnts', docs)
    expect(ranked.some((r) => r.node.id === 'd2')).toBe(true)
  })
})

describe('rewriteWikiLinksForPreview', () => {
  it('rewrites to relative __wiki__ markdown links', () => {
    const out = rewriteWikiLinksForPreview('Go [[Alpha]] and [[Beta|B]].')
    expect(out).toContain(`[Alpha](${WIKI_LINK_HREF_PREFIX}${encodeURIComponent('Alpha')})`)
    expect(out).toContain(`[B](${WIKI_LINK_HREF_PREFIX}${encodeURIComponent('Beta')})`)
  })

  it('does not touch code fences', () => {
    const md = '```\n[[Skip]]\n```\n[[Ok]]'
    const out = rewriteWikiLinksForPreview(md)
    expect(out).toContain('[[Skip]]')
    expect(out).toContain(`[Ok](${wikiHrefForTitle('Ok')})`)
  })
})

describe('wiki href helpers', () => {
  it('round-trips unicode titles', () => {
    const t = '中文标题'
    expect(titleFromWikiHref(wikiHrefForTitle(t))).toBe(t)
  })

  it('rejects non-wiki hrefs', () => {
    expect(titleFromWikiHref('https://example.com')).toBeNull()
  })
})

describe('wikiLinkQueryAt (picker context)', () => {
  it('detects open wiki after [[', () => {
    expect(wikiLinkQueryAt('hello [[Alp', 11)).toEqual({
      query: 'Alp',
      from: 8,
      to: 11,
    })
  })

  it('null when closed or no open', () => {
    expect(wikiLinkQueryAt('[[Done]] x', 8)).toBeNull()
    expect(wikiLinkQueryAt('no wiki', 3)).toBeNull()
  })

  it('null across newline', () => {
    expect(wikiLinkQueryAt('[[a\nb', 5)).toBeNull()
  })
})

describe('formatWikiLink', () => {
  it('formats title and optional display', () => {
    expect(formatWikiLink('A')).toBe('[[A]]')
    expect(formatWikiLink('A', 'B')).toBe('[[A|B]]')
  })
})

describe('rename policy (no rewrite)', () => {
  it('extract leaves bodies unchanged when titles rename elsewhere', () => {
    // Phase 1 / K22: rename does not rewrite [[Old]] in other files.
    // Resolution after rename simply fails until the user edits.
    const body = 'See [[Old Title]] for more.'
    const docsBefore = [doc('d1', 'Old Title', 0)]
    const docsAfter = [doc('d1', 'New Title', 0)]
    expect(resolveWikiTitle('Old Title', docsBefore)?.id).toBe('d1')
    expect(resolveWikiTitle('Old Title', docsAfter)).toBeNull()
    // Source body still contains old wiki text (no auto-rewrite helper).
    expect(extractWikiLinks(body)[0]?.title).toBe('Old Title')
  })
})
