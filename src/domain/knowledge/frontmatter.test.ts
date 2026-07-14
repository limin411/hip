import { describe, it, expect } from 'vitest'
import {
  EMPTY_DOC_META,
  matchDocByTitleOrAlias,
  metaToSearchFields,
  parseFrontmatter,
} from './frontmatter'

describe('parseFrontmatter', () => {
  it('returns empty meta and full body when no fence', () => {
    const raw = '# Hello\n\nbody text'
    const r = parseFrontmatter(raw)
    expect(r.hasFrontmatter).toBe(false)
    expect(r.meta).toEqual(EMPTY_DOC_META)
    expect(r.bodyWithoutFm).toBe(raw)
  })

  it('parses inline tags/status/aliases and strips body', () => {
    const raw = `---
tags: [design, hip]
status: draft
aliases: [KB Plan, Plan]
---

# Body

content here
`
    const r = parseFrontmatter(raw)
    expect(r.hasFrontmatter).toBe(true)
    expect(r.meta.tags).toEqual(['design', 'hip'])
    expect(r.meta.status).toBe('draft')
    expect(r.meta.aliases).toEqual(['KB Plan', 'Plan'])
    expect(r.bodyWithoutFm).toBe('# Body\n\ncontent here\n')
    expect(r.bodyWithoutFm).not.toContain('tags:')
    expect(r.bodyWithoutFm).not.toContain('---')
  })

  it('parses block-list YAML form', () => {
    const raw = `---
tags:
  - alpha
  - beta
status: published
aliases:
  - Other Name
---
body only
`
    const r = parseFrontmatter(raw)
    expect(r.meta.tags).toEqual(['alpha', 'beta'])
    expect(r.meta.status).toBe('published')
    expect(r.meta.aliases).toEqual(['Other Name'])
    expect(r.bodyWithoutFm).toBe('body only\n')
  })

  it('ignores unknown keys and comments', () => {
    const raw = `---
# note
title: ignored
tags: [x]
foo: bar
---
hi
`
    const r = parseFrontmatter(raw)
    expect(r.meta.tags).toEqual(['x'])
    expect(r.meta.status).toBeNull()
    expect(r.bodyWithoutFm).toBe('hi\n')
  })

  it('treats unclosed fence as no frontmatter', () => {
    const raw = `---
tags: [x]
still body
`
    const r = parseFrontmatter(raw)
    expect(r.hasFrontmatter).toBe(false)
    expect(r.bodyWithoutFm).toBe(raw)
  })

  it('dedupes tags case-insensitively (first spelling wins)', () => {
    const raw = `---
tags: [Design, design, DESIGN]
---
x
`
    expect(parseFrontmatter(raw).meta.tags).toEqual(['Design'])
  })

  it('metaToSearchFields joins for MiniSearch', () => {
    expect(
      metaToSearchFields({
        tags: ['a', 'b'],
        status: 'draft',
        aliases: ['X', 'Y'],
      }),
    ).toEqual({ tags: 'a b', status: 'draft', aliases: 'X Y' })
    expect(metaToSearchFields(EMPTY_DOC_META)).toEqual({
      tags: '',
      status: '',
      aliases: '',
    })
  })
})

describe('matchDocByTitleOrAlias', () => {
  const docs = [
    { id: 'd1', title: 'Alpha', aliases: ['A1'] },
    { id: 'd2', title: 'Beta', aliases: ['plan', 'KB Plan'] },
    { id: 'd3', title: 'alpha', aliases: [] },
  ]

  it('prefers exact title over case-insensitive', () => {
    expect(matchDocByTitleOrAlias('alpha', docs)).toEqual({
      id: 'd3',
      match: 'title',
    })
  })

  it('falls back to case-insensitive title', () => {
    expect(matchDocByTitleOrAlias('ALPHA', [{ id: 'd1', title: 'Alpha' }])).toEqual({
      id: 'd1',
      match: 'title-ci',
    })
  })

  it('matches aliases case-insensitively after titles', () => {
    expect(matchDocByTitleOrAlias('kb plan', docs)).toEqual({
      id: 'd2',
      match: 'alias',
    })
  })

  it('first tree-order doc wins on duplicate titles', () => {
    const dup = [
      { id: 'first', title: 'Untitled' },
      { id: 'second', title: 'Untitled' },
    ]
    expect(matchDocByTitleOrAlias('Untitled', dup)?.id).toBe('first')
  })

  it('returns null when nothing matches', () => {
    expect(matchDocByTitleOrAlias('zzz', docs)).toBeNull()
    expect(matchDocByTitleOrAlias('  ', docs)).toBeNull()
  })
})
