// packages/sidecar/src/session/skills/frontmatter.test.ts
import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from './frontmatter.js'

describe('parseFrontmatter', () => {
  it('extracts scalar keys from a leading --- fenced block', () => {
    const src = [
      '---',
      'name: PDF Filler',
      'description: Fill PDF forms from a CSV.',
      '---',
      '',
      '# Body',
      'Some markdown here.',
    ].join('\n')
    const { data, body } = parseFrontmatter(src)
    expect(data.name).toBe('PDF Filler')
    expect(data.description).toBe('Fill PDF forms from a CSV.')
    expect(body).toBe('# Body\nSome markdown here.')
  })

  it('strips matching single/double quotes around values', () => {
    const src = ['---', "name: 'Quoted Name'", 'description: "Has: a colon"', '---', 'b'].join('\n')
    const { data } = parseFrontmatter(src)
    expect(data.name).toBe('Quoted Name')
    expect(data.description).toBe('Has: a colon')
  })

  it('ignores unknown extra keys without throwing', () => {
    const src = ['---', 'name: X', 'version: 3', 'tags: a,b', '---', 'body'].join('\n')
    const { data } = parseFrontmatter(src)
    expect(data.name).toBe('X')
    expect(data.version).toBe('3')
  })

  it('returns empty data and the whole input as body when there is no frontmatter', () => {
    const src = '# No frontmatter\njust text'
    const { data, body } = parseFrontmatter(src)
    expect(data).toEqual({})
    expect(body).toBe(src)
  })

  it('returns empty data when the opening --- is not on the very first line', () => {
    const src = '\n---\nname: X\n---\nbody'
    const { data, body } = parseFrontmatter(src)
    expect(data).toEqual({})
    expect(body).toBe(src)
  })

  it('handles CRLF line endings', () => {
    const src = ['---', 'name: CRLF', 'description: ok', '---', 'body'].join('\r\n')
    const { data, body } = parseFrontmatter(src)
    expect(data.name).toBe('CRLF')
    expect(body).toBe('body')
  })

  it('returns the whole input as body when the closing --- is missing', () => {
    const src = '---\nname: X\nnever closes'
    const { data, body } = parseFrontmatter(src)
    expect(data).toEqual({})
    expect(body).toBe(src)
  })
})
