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
    expect(data.version).toBe(3) // YAML parses bare `3` as number
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

  // ─── New tests: full YAML types ──────────────────────────────────────────

  it('parses arrays from YAML frontmatter', () => {
    const src = [
      '---',
      'allowed-tools: [bash, git, read]',
      '---',
      'body',
    ].join('\n')
    const { data } = parseFrontmatter(src)
    expect(data['allowed-tools']).toEqual(['bash', 'git', 'read'])
  })

  it('parses nested objects from YAML frontmatter', () => {
    const src = [
      '---',
      'arguments:',
      '  - name: env',
      '    description: Target environment',
      '  - name: dry-run',
      '    description: Preview only',
      '---',
      'body',
    ].join('\n')
    const { data } = parseFrontmatter(src)
    expect(data.arguments).toEqual([
      { name: 'env', description: 'Target environment' },
      { name: 'dry-run', description: 'Preview only' },
    ])
  })

  it('parses booleans as native booleans, not strings', () => {
    const src = [
      '---',
      'auto-invoke: false',
      'enabled: true',
      '---',
      'body',
    ].join('\n')
    const { data } = parseFrontmatter(src)
    expect(data['auto-invoke']).toBe(false)
    expect(data.enabled).toBe(true)
  })

  it('parses numbers as native numbers, not strings', () => {
    const src = [
      '---',
      'priority: 10',
      'timeout: 30000',
      '---',
      'body',
    ].join('\n')
    const { data } = parseFrontmatter(src)
    expect(data.priority).toBe(10)
    expect(data.timeout).toBe(30000)
  })

  it('parses multi-line scalar (literal block) correctly', () => {
    const src = [
      '---',
      'description: |',
      '  Line one.',
      '  Line two.',
      '---',
      'body',
    ].join('\n')
    const { data } = parseFrontmatter(src)
    expect(data.description).toBe('Line one.\nLine two.\n')
  })

  it('returns empty data on invalid YAML (graceful degrade)', () => {
    const src = [
      '---',
      'name: OK',
      '  - broken indentation : :',
      '---',
      'body',
    ].join('\n')
    const { data, body } = parseFrontmatter(src)
    expect(data).toEqual({})
    expect(body).toBe('body')
  })

  it('returns empty data when YAML block parses to a non-object', () => {
    const src = [
      '---',
      '- just a list',
      '- no mapping',
      '---',
      'body',
    ].join('\n')
    const { data, body } = parseFrontmatter(src)
    expect(data).toEqual({})
    expect(body).toBe('body')
  })

  it('returns empty data when YAML block is just a scalar', () => {
    const src = [
      '---',
      'just a string',
      '---',
      'body',
    ].join('\n')
    const { data, body } = parseFrontmatter(src)
    expect(data).toEqual({})
    expect(body).toBe('body')
  })

  it('handles empty frontmatter block (just fences)', () => {
    const src = '---\n---\nbody'
    const { data, body } = parseFrontmatter(src)
    expect(data).toEqual({})
    expect(body).toBe('body')
  })

  it('preserves null values from YAML', () => {
    const src = [
      '---',
      'name: something',
      'optional-field: null',
      'also-null: ~',
      '---',
      'body',
    ].join('\n')
    const { data } = parseFrontmatter(src)
    expect(data['optional-field']).toBeNull()
    expect(data['also-null']).toBeNull()
  })
})
