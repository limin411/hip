import { describe, it, expect } from 'vitest'
import {
  collapsibleProse,
  decisionHtml,
  esc,
  pickReportSpeechContent,
  richProseHtml,
  splitDecisionParts,
  stripToolNoise,
} from './report-prose.js'

describe('richProseHtml (marked GFM)', () => {
  it('escapes raw html injection', () => {
    const html = richProseHtml('x <script>alert(1)</script> y')
    expect(html).not.toContain('<script>alert')
    expect(html.toLowerCase()).toContain('script')
  })

  it('renders fenced code blocks', () => {
    const html = richProseHtml('before\n\n```ts\nconst a = 1\n```\n\nafter')
    expect(html).toContain('class="code-block"')
    expect(html).toContain('data-lang="ts"')
    expect(html).toContain('const a = 1')
  })

  it('renders bold, italic, inline code', () => {
    const html = richProseHtml('use `foo()` and **bold** and *em*')
    expect(html).toContain('class="inline-code"')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>em</em>')
  })

  it('renders lists and headings', () => {
    const md = `## 结论

- 第一点
- 第二点

1. 步骤甲
2. 步骤乙`
    const html = richProseHtml(md)
    expect(html).toMatch(/<h2[^>]*>结论<\/h2>/)
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>')
    expect(html).toContain('第一点')
    expect(html).toContain('<ol>')
  })

  it('does not leave raw ** when bold is well-formed', () => {
    const html = richProseHtml('这是 **重要** 结论')
    expect(html).toContain('<strong>重要</strong>')
    expect(html).not.toContain('**重要**')
  })
})

describe('collapsibleProse', () => {
  it('shows full markdown for short text', () => {
    const html = collapsibleProse('**短**文', { more: 'more', less: 'less' })
    expect(html).toContain('<strong>短</strong>')
    expect(html).not.toContain('prose-fold')
  })

  it('renders long structured text once without preview+body duplicate', () => {
    const long = '字'.repeat(400) + '\n\n- item a\n- item b'
    const html = collapsibleProse(long, { more: '展开', less: '收起' })
    // open-by-default path: single markdown body, no fold preview pair
    expect(html).toContain('<ul>')
    expect(html).toContain('item a')
    expect(html).not.toContain('prose-preview')
  })

  it('collapses very long non-structured text with preview only when closed', () => {
    const long = '纯叙述。'.repeat(200)
    const html = collapsibleProse(long, { more: '展开', less: '收起' }, 220, { open: false })
    expect(html).toContain('prose-fold')
    expect(html).toContain('prose-preview')
  })
})

describe('stripToolNoise / pickReportSpeechContent', () => {
  it('prefers content after --- separator', () => {
    const raw = `让我先搜索一下。\n\n---\n\n**战略家发言**\n\n真正的论点在这里。`
    const cleaned = stripToolNoise(raw)
    expect(cleaned).toContain('真正的论点')
    expect(cleaned).not.toContain('让我先搜索')
  })

  it('picks longer cleaned raw over short envelope prose', () => {
    const raw = `tool noise\n\n---\n\n${'完整发言内容。'.repeat(20)}`
    const prose = '短摘要'
    const picked = pickReportSpeechContent(raw, prose)
    expect(picked.length).toBeGreaterThan(prose.length)
    expect(picked).toContain('完整发言')
  })
})

describe('decisionHtml', () => {
  it('splits 【决定N】 cards', () => {
    const d = `导言\n\n【决定1｜账户】\n- 采用 A\n\n【决定2｜保险】\n- 采用 B`
    const parts = splitDecisionParts(d)
    expect(parts.length).toBeGreaterThanOrEqual(2)
    const html = decisionHtml(d, { more: 'more', less: 'less' })
    expect(html).toContain('decision-card')
    expect(html).toContain('决定1')
    expect(html).toContain('<ul>')
  })
})

describe('esc', () => {
  it('escapes quotes and tags', () => {
    expect(esc(`a<"b">`)).toBe('a&lt;&quot;b&quot;&gt;')
  })
})
