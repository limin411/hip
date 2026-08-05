import { describe, expect, it } from 'vitest'
import { EMPTY_DOC_META, type KnowledgeDocMeta } from './frontmatter'
import { applyMetaToDocument, formatFrontmatterFence } from './frontmatterWrite'

function meta(over: Partial<KnowledgeDocMeta> = {}): KnowledgeDocMeta {
  return { ...EMPTY_DOC_META, ...over, props: { ...EMPTY_DOC_META.props, ...over.props } }
}

describe('formatFrontmatterFence', () => {
  it('returns empty string when meta has no properties', () => {
    expect(formatFrontmatterFence(EMPTY_DOC_META)).toBe('')
  })

  it('writes short tag lists inline and long lists as blocks', () => {
    expect(formatFrontmatterFence(meta({ tags: ['a', 'b'] }))).toBe(
      '---\ntags: [a, b]\n---',
    )
    const long = formatFrontmatterFence(
      meta({
        tags: [
          'one',
          'two',
          'three',
          'four',
          'five-that-is-quite-long-enough-to-force-block',
        ],
      }),
    )
    expect(long).toContain('tags:')
    expect(long).toContain('  - one')
    expect(long).toContain('  - five-that-is-quite-long-enough-to-force-block')
  })

  it('quotes values with spaces or special YAML chars', () => {
    const fence = formatFrontmatterFence(
      meta({ status: 'in progress', date: '2026-08-05', priority: 'high', icon: '📌' }),
    )
    expect(fence).toContain('status: "in progress"')
    expect(fence).toContain('date: 2026-08-05')
    expect(fence).toContain('priority: high')
    expect(fence).toContain('icon: 📌')
  })

  it('writes sorted custom props with typed scalars', () => {
    const fence = formatFrontmatterFence(
      meta({
        props: {
          zeta: 'z',
          alpha: true,
          count: 3,
          list: ['x', 'y'],
          empty: '',
          skip: null as unknown as string,
        },
      }),
    )
    const body = fence.replace(/^---\n/, '').replace(/\n---$/, '')
    const lines = body.split('\n')
    expect(lines[0]).toMatch(/^alpha:/)
    expect(fence).toContain('alpha: true')
    expect(fence).toContain('count: 3')
    expect(fence).toContain('list: [x, y]')
    expect(fence).toContain('zeta: z')
    expect(fence).not.toContain('empty:')
    expect(fence).not.toContain('skip:')
  })
})

describe('applyMetaToDocument', () => {
  it('strips frontmatter when meta is empty', () => {
    expect(applyMetaToDocument('---\ntags: [a]\n---\n\n# Body\n', EMPTY_DOC_META)).toBe(
      '# Body\n',
    )
  })

  it('replaces existing frontmatter and keeps body with a single blank line', () => {
    const next = applyMetaToDocument('---\ntags: [old]\n---\n\nHello\n', meta({ tags: ['new'] }))
    expect(next).toBe('---\ntags: [new]\n---\nHello\n')
  })

  it('adds frontmatter to a body-only document', () => {
    const next = applyMetaToDocument('# Title\n', meta({ status: 'draft' }))
    expect(next).toBe('---\nstatus: draft\n---\n# Title\n')
  })

  it('handles empty body with fence-only meta', () => {
    const next = applyMetaToDocument('', meta({ aliases: ['KB'] }))
    expect(next).toBe('---\naliases: [KB]\n---\n')
  })
})
