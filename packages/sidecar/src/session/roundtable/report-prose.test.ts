import { describe, it, expect } from 'vitest'
import { collapsibleProse, esc, richProseHtml } from './report-prose.js'

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
    expect(html).toContain('before')
    expect(html).toContain('after')
  })

  it('renders inline code', () => {
    const html = richProseHtml('use `foo()` here')
    expect(html).toContain('class="inline-code"')
    expect(html).toContain('foo()')
  })
})

describe('collapsibleProse', () => {
  it('folds long text', () => {
    const long = '字'.repeat(300)
    const html = collapsibleProse(long, { more: '展开', less: '收起' })
    expect(html).toContain('prose-fold')
    expect(html).toContain('展开')
    expect(html).toContain('<details')
  })

  it('keeps short text open', () => {
    const html = collapsibleProse('短文', { more: 'more', less: 'less' })
    expect(html).not.toContain('prose-fold')
    expect(html).toContain('短文')
  })
})

describe('esc', () => {
  it('escapes quotes and tags', () => {
    expect(esc(`a<"b">`)).toBe('a&lt;&quot;b&quot;&gt;')
  })
})
