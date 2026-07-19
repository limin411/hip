import { describe, expect, it } from 'vitest'
import {
  extractEmbedLinks,
  extractOutboundLinks,
  splitTitleFragment,
} from './linkExtract'
import { buildDocIndexPayload, resolveOutbound } from './linkIndex'
import type { KnowledgeNode } from './types'
import {
  rewriteWikiLinksForPreview,
  splitWikiTitleFragment,
  wikiHrefForTitle,
  wikiPartsFromHref,
} from './wikiLink'

function doc(id: string, title: string, order = 0): KnowledgeNode {
  return {
    id,
    parentId: null,
    kind: 'doc',
    title,
    order,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('splitTitleFragment', () => {
  it('parses title only', () => {
    expect(splitTitleFragment('Alpha')).toEqual({ docTitle: 'Alpha', fragment: null })
  })
  it('parses title#heading', () => {
    expect(splitTitleFragment('Alpha#Intro')).toEqual({
      docTitle: 'Alpha',
      fragment: 'Intro',
    })
  })
  it('parses same-doc #heading', () => {
    expect(splitTitleFragment('#Intro')).toEqual({ docTitle: '', fragment: 'Intro' })
  })
})

describe('extractOutboundLinks', () => {
  it('extracts wiki embed and md', () => {
    const md = 'See [[Alpha#H]] and ![[Beta]] and [x](https://e.com).'
    const links = extractOutboundLinks(md)
    expect(links.map((l) => l.kind)).toEqual(['wiki', 'embed', 'md'])
    expect(links[0]).toMatchObject({
      kind: 'wiki',
      targetTitle: 'Alpha',
      fragment: 'H',
    })
    expect(links[1]).toMatchObject({ kind: 'embed', targetTitle: 'Beta' })
    expect(links[2].kind).toBe('md')
  })

  it('skips wiki that is part of embed', () => {
    const links = extractOutboundLinks('![[Only]]')
    expect(links).toHaveLength(1)
    expect(links[0]!.kind).toBe('embed')
  })

  it('strips frontmatter before extract', () => {
    const md = '---\ntags: [a]\nstatus: draft\n---\n\n[[Zed]]'
    const links = extractOutboundLinks(md)
    expect(links).toHaveLength(1)
    expect(links[0]!.targetTitle).toBe('Zed')
  })
})

describe('resolveOutbound + buildDocIndexPayload', () => {
  const nodes = [doc('doc_a', 'Alpha'), doc('doc_b', 'Beta')]

  it('resolves wiki targets', () => {
    const payload = buildDocIndexPayload(
      'doc_a',
      'Alpha',
      'Link [[Beta]] and [[Missing]]',
      nodes,
    )
    expect(payload.outbound).toHaveLength(2)
    expect(payload.outbound[0]!.targetDocId).toBe('doc_b')
    expect(payload.outbound[1]!.targetDocId).toBeNull()
  })

  it('same-doc fragment resolves to self', () => {
    const extracted = extractOutboundLinks('[[#Intro]]')
    const resolved = resolveOutbound('doc_a', extracted, [
      { id: 'doc_a', title: 'Alpha' },
    ])
    expect(resolved[0]!.targetDocId).toBe('doc_a')
    expect(resolved[0]!.fragment).toBe('Intro')
  })
})

describe('wiki heading href round-trip', () => {
  it('rewrites Title#H with fragment', () => {
    const out = rewriteWikiLinksForPreview('See [[Alpha#Intro|go]]')
    expect(out).toContain('](')
    const href = wikiHrefForTitle('Alpha', 'Intro')
    expect(out).toContain(href)
    const parts = wikiPartsFromHref(href)
    expect(parts).toEqual({ title: 'Alpha', fragment: 'Intro' })
  })

  it('splitWikiTitleFragment matches extract', () => {
    expect(splitWikiTitleFragment('A#B')).toEqual({ docTitle: 'A', fragment: 'B' })
  })

  it('extractEmbedLinks finds embeds', () => {
    expect(extractEmbedLinks('x ![[T]] y').map((h) => h.title)).toEqual(['T'])
  })
})
