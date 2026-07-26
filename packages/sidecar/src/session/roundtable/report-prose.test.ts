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

describe('richProseHtml', () => {
  it('escapes raw html', () => {
    expect(richProseHtml('x <script>y')).toContain('&lt;script&gt;')
    expect(richProseHtml('x <script>y')).not.toContain('<script>')
  })

  it('renders fenced code blocks', () => {
    const html = richProseHtml('before\n\n```ts\nconst a = 1\n```\n\nafter')
    expect(html).toContain('class="code-block"')
    expect(html).toContain('data-lang="ts"')
    expect(html).toContain('const a = 1')
    expect(html).toContain('<pre><code>')
  })

  it('renders inline code, bold, italic', () => {
    const html = richProseHtml('use `foo()` and **bold** and *em*')
    expect(html).toContain('class="inline-code"')
    expect(html).toContain('foo()')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>em</em>')
  })

  it('renders lists and headings', () => {
    const md = `**怀疑论者发言**

- 第一点
- 第二点

## 结论

1. 步骤甲
2. 步骤乙`
    const html = richProseHtml(md)
    expect(html).toContain('class="prose-h"')
    expect(html).toContain('怀疑论者发言')
    expect(html).toContain('class="prose-ul"')
    expect(html).toContain('<li>')
    expect(html).toContain('第一点')
    expect(html).toContain('class="prose-ol"')
  })
})

describe('collapsibleProse', () => {
  it('folds long text', () => {
    const long = '字'.repeat(300)
    const html = collapsibleProse(long, { more: '展开', less: '收起' })
    expect(html).toContain('prose-fold')
    expect(html).toContain('展开')
  })

  it('keeps short text open', () => {
    const html = collapsibleProse('短文', { more: 'more', less: 'less' })
    expect(html).not.toContain('prose-fold')
    expect(html).toContain('短文')
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

describe('decisionHtml / splitDecisionParts', () => {
  it('splits 【决定N】 cards', () => {
    const d = `导言\n\n【决定1｜账户】\n- 采用 A\n\n【决定2｜保险】\n- 采用 B`
    const parts = splitDecisionParts(d)
    expect(parts.length).toBeGreaterThanOrEqual(2)
    const html = decisionHtml(d, { more: 'more', less: 'less' })
    expect(html).toContain('decision-card')
    expect(html).toContain('决定1')
  })
})

describe('esc', () => {
  it('escapes quotes and tags', () => {
    expect(esc(`a<"b">`)).toBe('a&lt;&quot;b&quot;&gt;')
  })
})
