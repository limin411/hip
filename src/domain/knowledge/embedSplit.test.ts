import { describe, expect, it } from 'vitest'
import {
  bodyForEmbed,
  extractSectionByHeading,
  splitByEmbeds,
} from './embedSplit'

describe('splitByEmbeds', () => {
  it('returns single md segment without embeds', () => {
    expect(splitByEmbeds('hello')).toEqual([{ type: 'md', text: 'hello' }])
  })

  it('splits around embeds', () => {
    const segs = splitByEmbeds('A ![[Beta#H|x]] B')
    expect(segs).toHaveLength(3)
    expect(segs[0]).toEqual({ type: 'md', text: 'A ' })
    expect(segs[1]).toMatchObject({
      type: 'embed',
      docTitle: 'Beta',
      fragment: 'H',
      display: 'x',
    })
    expect(segs[2]).toEqual({ type: 'md', text: ' B' })
  })

  it('skips embeds in fences', () => {
    const segs = splitByEmbeds('```\n![[No]]\n```\n![[Yes]]')
    const embeds = segs.filter((s) => s.type === 'embed')
    expect(embeds).toHaveLength(1)
    expect(embeds[0]).toMatchObject({ docTitle: 'Yes' })
  })
})

describe('extractSectionByHeading', () => {
  const md = `# Top\n\nintro\n\n## Mid\n\nmid body\n\n### Deep\n\nd\n\n## After\n\nafter\n`

  it('takes section until next same-level heading', () => {
    const s = extractSectionByHeading(md, 'Mid')
    expect(s).toContain('## Mid')
    expect(s).toContain('mid body')
    expect(s).toContain('### Deep')
    expect(s).not.toContain('## After')
  })

  it('returns full body when heading missing', () => {
    expect(extractSectionByHeading(md, 'Nope')).toBe(md)
  })
})

describe('bodyForEmbed', () => {
  it('strips frontmatter', () => {
    const { body } = bodyForEmbed('---\ntags: [a]\nstatus: x\n---\n\n# Hi\n', null)
    expect(body).toContain('# Hi')
    expect(body).not.toContain('tags:')
  })

  it('caps length', () => {
    const long = 'x'.repeat(100)
    const { body, truncated } = bodyForEmbed(long, null, 10)
    expect(body).toHaveLength(10)
    expect(truncated).toBe(true)
  })
})
