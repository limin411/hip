import { describe, expect, it } from 'vitest'
import {
  carrierRoundTrip,
  detectDialectLoss,
  postSerializeMdFromLive,
  preParseMdForLive,
} from './dialectBridge'
import {
  FIDELITY_GOLDENS,
  FIDELITY_MATRIX,
  DIALECT_PRESERVE_PROBES,
} from './fidelity'
import {
  parseCalloutMd,
  serializeCallout,
  parseMathMd,
  serializeMath,
  parseFenceMd,
  serializeMermaid,
  serializeSvg,
  parseEmbedToken,
  serializeEmbed,
  parseWikiToken,
  serializeWiki,
  parseToggleMd,
  serializeToggle,
  parseImageMd,
  serializeImage,
  htmlCarriersToDialect,
} from './carriers'
import { normalizeMd } from '../mdNormalize'

describe('fidelity matrix skeleton', () => {
  it('documents L2/L3 entries with probes', () => {
    expect(FIDELITY_MATRIX.length).toBeGreaterThanOrEqual(8)
    for (const e of FIDELITY_MATRIX) {
      expect(['L0', 'L1', 'L2', 'L3']).toContain(e.level)
      expect(e.probe).toBeInstanceOf(RegExp)
    }
  })

  it('dialect preserve probes cover core hip markers', () => {
    const ids = DIALECT_PRESERVE_PROBES.map((p) => p.id)
    for (const need of ['callout', 'math', 'mermaid', 'wiki', 'embed']) {
      expect(ids).toContain(need)
    }
  })
})

describe('carrier pure serialize/parse', () => {
  it('callout round-trips types', () => {
    for (const type of ['note', 'tip', 'warning', 'danger', 'info', 'important'] as const) {
      const md = serializeCallout({ type, title: 'T', body: 'body' })
      const parsed = parseCalloutMd(md)
      expect(parsed?.type).toBe(type)
      expect(parsed?.title).toBe('T')
      expect(parsed?.body).toContain('body')
    }
  })

  it('math / mermaid / svg round-trip', () => {
    expect(parseMathMd(serializeMath({ src: 'x^2' }))?.src).toBe('x^2')
    expect(parseFenceMd(serializeMermaid({ src: 'graph TD;A-->B' }), 'mermaid')?.src).toContain(
      'A-->B',
    )
    expect(parseFenceMd(serializeSvg({ src: '<svg></svg>' }), 'svg')?.src).toContain('svg')
  })

  it('wiki / embed / toggle / image caption', () => {
    expect(serializeWiki({ title: 'A', alias: '' })).toBe('[[A]]')
    expect(parseWikiToken('[[A|B]]')).toEqual({ title: 'A', alias: 'B' })
    expect(parseEmbedToken('![[Doc#H]]')).toEqual({ title: 'Doc', fragment: 'H' })
    expect(serializeEmbed({ title: 'Doc', fragment: 'H' }).trim()).toBe('![[Doc#H]]')
    const tog = parseToggleMd(serializeToggle({ summary: 'S', body: 'hidden' }))
    expect(tog?.summary).toBe('S')
    expect(tog?.body).toContain('hidden')
    const img = parseImageMd(serializeImage({ alt: 'a', url: 'assets/x.png', caption: 'cap' }))
    expect(img?.caption).toBe('cap')
  })
})

describe('dialect bridge carrier round-trip (L3 goldens)', () => {
  for (const g of FIDELITY_GOLDENS) {
    it(`golden ${g.id} survives carrier bridge`, () => {
      const back = carrierRoundTrip(g.md)
      const entry = FIDELITY_MATRIX.find(
        (e) => g.id === e.id || g.id.startsWith(`${e.id}-`) || g.id.startsWith(e.id),
      )
      const probe =
        entry?.probe ??
        DIALECT_PRESERVE_PROBES.find((p) => g.id.startsWith(p.id))?.probe ??
        /./
      expect(probe.test(normalizeMd(back)) || probe.test(back)).toBe(true)
      expect(detectDialectLoss(g.md, back)).toEqual([])
    })
  }

  it('preParse emits data-hip carriers for callout', () => {
    const pre = preParseMdForLive('> [!note] Hi\n> body\n')
    expect(pre).toContain('data-hip-block="callout"')
    expect(pre).toContain('data-type="note"')
  })

  it('postSerialize restores callout from HTML carrier', () => {
    const html =
      '<div data-hip-block="callout" data-type="tip" data-title="T">hello</div>\n'
    const md = postSerializeMdFromLive(html)
    expect(md).toMatch(/\[!tip\]/)
    expect(md).toContain('hello')
  })

  it('htmlCarriersToDialect restores wiki span', () => {
    const md = htmlCarriersToDialect(
      'See <span data-hip-inline="wiki" data-title="Other" data-alias="">Other</span>.',
    )
    expect(md).toContain('[[Other]]')
  })
})
