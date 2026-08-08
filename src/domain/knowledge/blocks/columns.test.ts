import { describe, expect, it } from 'vitest'
import {
  COLUMNS_GUARD_PROBE,
  columnsGuardOpen,
  extractColumnsGuard,
  joinColumnsGuard,
  jsonToColumns,
} from './columns'
import {
  dialectToHtmlCarriers,
  htmlCarriersToDialect,
} from './carriers'
import { carrierRoundTrip } from './dialectBridge'
import { normalizeMd } from '../mdNormalize'

void dialectToHtmlCarriers
void htmlCarriersToDialect

const simpleGuard = [
  '<!-- hip-columns:2 -->',
  'col one text',
  '<!-- hip-col -->',
  'col two text',
  '<!-- /hip-columns -->',
].join('\n')

describe('columns guard helpers (V2-E1)', () => {
  it('extracts a well-formed guard with per-column md', () => {
    const g = extractColumnsGuard(simpleGuard)
    expect(g).toEqual({ count: 2, columns: ['col one text', 'col two text'] })
  })

  it('rejects guards with wrong column count / out-of-range counts', () => {
    expect(
      extractColumnsGuard('<!-- hip-columns:3 -->\na\n<!-- hip-col -->\nb\n<!-- /hip-columns -->'),
    ).toBeNull()
    expect(
      extractColumnsGuard('<!-- hip-columns:9 -->\na\n<!-- hip-col -->\nb\n<!-- /hip-columns -->'),
    ).toBeNull()
    expect(extractColumnsGuard('<!-- hip-columns:1 -->\na\n<!-- /hip-columns -->')).toBeNull()
  })

  it('rejects guards missing the close marker (broken → plain paragraphs)', () => {
    expect(extractColumnsGuard('<!-- hip-columns:2 -->\na\n<!-- hip-col -->\nb')).toBeNull()
    expect(extractColumnsGuard('<!-- hip-columns:2 -->\na\nb\n<!-- /hip-columns -->')).toBeNull()
  })

  it('rejects empty columns', () => {
    expect(
      extractColumnsGuard('<!-- hip-columns:2 -->\n \n<!-- hip-col -->\nb\n<!-- /hip-columns -->'),
    ).toBeNull()
  })

  it('join is idempotent with extract', () => {
    const md = joinColumnsGuard(2, ['a', 'b'])
    expect(extractColumnsGuard(md)).toEqual({ count: 2, columns: ['a', 'b'] })
  })

  it('supports 3 and 4 columns', () => {
    const md = joinColumnsGuard(4, ['a', 'b', 'c', 'd'])
    expect(extractColumnsGuard(md)).toEqual({ count: 4, columns: ['a', 'b', 'c', 'd'] })
  })

  it('probe matches guards only', () => {
    expect(COLUMNS_GUARD_PROBE.test(simpleGuard)).toBe(true)
    expect(COLUMNS_GUARD_PROBE.test('plain text')).toBe(false)
    expect(COLUMNS_GUARD_PROBE.test(columnsGuardOpen(2))).toBe(false)
  })

  it('jsonToColumns is tolerant of garbage', () => {
    expect(jsonToColumns('["a","b"]')).toEqual(['a', 'b'])
    expect(jsonToColumns(null)).toEqual([])
    expect(jsonToColumns('not-json')).toEqual([])
    expect(jsonToColumns('[1, "a"]')).toEqual(['a'])
  })
})

describe('columns carrier round-trip (V2-E1)', () => {
  it('guard survives carrier bridge unchanged (idempotent)', () => {
    const back = carrierRoundTrip(simpleGuard)
    expect(normalizeMd(back)).toContain('<!-- hip-columns:2 -->')
    expect(back).toContain('col one text')
    expect(back).toContain('col two text')
    expect(back).toContain('<!-- /hip-columns -->')
    expect(extractColumnsGuard(back)).toEqual({ count: 2, columns: ['col one text', 'col two text'] })
  })

  it('nested wiki links survive inside columns', () => {
    const md = joinColumnsGuard(2, ['see [[Other Doc]] here', 'plain'])
    const back = carrierRoundTrip(md)
    expect(back).toContain('[[Other Doc]]')
    expect(extractColumnsGuard(back)?.columns[0]).toContain('[[Other Doc]]')
  })

  it('nested math + mermaid survive inside columns', () => {
    const md = joinColumnsGuard(2, [
      '$$\nx^2\n$$\n',
      '```mermaid\nflowchart LR\n  A --> B\n```\n',
    ])
    const back = carrierRoundTrip(md)
    const g = extractColumnsGuard(back)
    expect(g?.columns[0]).toContain('$$')
    expect(g?.columns[1]).toContain('```mermaid')
    expect(g?.columns[1]).toContain('A --> B')
  })

  it('nested lists / todo survive inside columns', () => {
    const md = joinColumnsGuard(2, ['- a\n- [ ] b\n', '> quote line\n'])
    const back = carrierRoundTrip(md)
    const g = extractColumnsGuard(back)
    expect(g?.columns[0]).toContain('- [ ] b')
    expect(g?.columns[1]).toContain('> quote line')
  })

  it('broken guard degrades to plain paragraphs without crashing', () => {
    const broken = '<!-- hip-columns:2 -->\nonly one column here\n<!-- /hip-columns -->'
    const back = carrierRoundTrip(broken)
    // Carrier either stays raw or drops to text — never throws.
    expect(typeof back).toBe('string')
  })

  it('document without columns serializes unchanged by the bridge', () => {
    const md = '# Title\n\nplain paragraph\n'
    const back = carrierRoundTrip(md)
    expect(back).toContain('# Title')
    expect(back).toContain('plain paragraph')
  })

  it('htmlCarriersToDialect converts the columns div back to a guard', () => {
    const html =
      '<div data-hip-block="columns" data-count="2" data-columns="[&quot;a&quot;,&quot;b&quot;]"></div>\n'
    const back = htmlCarriersToDialect(html)
    expect(back).toContain('<!-- hip-columns:2 -->')
    expect(extractColumnsGuard(back)).toEqual({ count: 2, columns: ['a', 'b'] })
  })

  it('malformed columns carrier degrades to text', () => {
    const html = '<div data-hip-block="columns" data-count="2" data-columns="[&quot;a&quot;]"></div>\n'
    expect(() => htmlCarriersToDialect(html)).not.toThrow()
    expect(extractColumnsGuard(htmlCarriersToDialect(html))).toBeNull()
  })
})
