import { describe, expect, it } from 'vitest'
import { applyWikiRewrites, planWikiTitleRewrites } from './rewriteWikiTitles'

describe('planWikiTitleRewrites', () => {
  it('rewrites wiki and embed titles', () => {
    const md = 'See [[Old]] and ![[Old#H]] and [[Other]]'
    const hits = planWikiTitleRewrites(md, 'Old', 'New')
    expect(hits).toHaveLength(2)
    const out = applyWikiRewrites(md, hits)
    expect(out).toContain('[[New]]')
    expect(out).toContain('![[New#H]]')
    expect(out).toContain('[[Other]]')
  })

  it('is case-insensitive on titles', () => {
    const hits = planWikiTitleRewrites('[[old]]', 'Old', 'New')
    expect(hits[0]?.replacement).toBe('[[New]]')
  })
})
