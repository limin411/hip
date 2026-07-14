import { describe, expect, it } from 'vitest'
import { joinYamlFrontmatter, splitYamlFrontmatter } from './frontmatter'

describe('splitYamlFrontmatter / joinYamlFrontmatter', () => {
  it('returns empty fmText when no leading fence', () => {
    const md = '# Body\n\nparagraph\n'
    expect(splitYamlFrontmatter(md)).toEqual({ fmText: '', body: md })
    expect(joinYamlFrontmatter('', md)).toBe(md)
  })

  it('splits and re-joins a standard FM + body doc', () => {
    const md = '---\ntags: [a, b]\nstatus: draft\n---\n\n# Body\n'
    const { fmText, body } = splitYamlFrontmatter(md)
    expect(fmText).toBe('---\ntags: [a, b]\nstatus: draft\n---')
    expect(body).toBe('\n# Body\n')
    expect(joinYamlFrontmatter(fmText, body)).toBe(md)
  })

  it('handles FM-only documents', () => {
    const md = '---\ntags: [x]\n---\n'
    const { fmText, body } = splitYamlFrontmatter(md)
    expect(fmText).toBe('---\ntags: [x]\n---')
    expect(body).toBe('')
    expect(joinYamlFrontmatter(fmText, body)).toBe('---\ntags: [x]\n---\n')
  })

  it('does not treat mid-doc thematic breaks as FM', () => {
    const md = '# Title\n\n---\n\nmore\n'
    expect(splitYamlFrontmatter(md)).toEqual({ fmText: '', body: md })
  })

  it('round-trips body edits while preserving opaque FM', () => {
    const md = '---\naliases: [KB]\n---\n\nHello\n'
    const { fmText, body } = splitYamlFrontmatter(md)
    const nextBody = 'Hello world\n'
    expect(joinYamlFrontmatter(fmText, nextBody)).toBe(
      '---\naliases: [KB]\n---\nHello world\n',
    )
    // original body kept blank line after fence when present
    expect(body).toBe('\nHello\n')
  })

  it('normalizes CRLF when FM is present', () => {
    const md = '---\r\ntags: [a]\r\n---\r\n\r\nBody\r\n'
    const { fmText, body } = splitYamlFrontmatter(md)
    expect(fmText).toBe('---\ntags: [a]\n---')
    expect(body).toBe('\nBody\n')
  })
})
