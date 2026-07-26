import { describe, it, expect } from 'vitest'
import {
  buildRoundtableReportHtml,
  buildRoundtableReportBundle,
  personaReportFilename,
  ROUNDTABLE_REPORT_FILENAME,
  ROUNDTABLE_REPORT_NAV_SCRIPT,
  ROUNDTABLE_REPORT_STYLES,
} from './report.js'

const sample = {
  issue: 'Should we rewrite the API? <script>',
  language: 'zh-CN' as const,
  agenda: ['定方向', '定路径'],
  rationale: '有明显取舍',
  rounds: [
    {
      round: 1,
      focus: '方向',
      speeches: [
        {
          speaker: 'strategist' as const,
          content: '长期选 A。示例：\n\n```ts\nexport const plan = "A"\n```\n\n并用 `plan` 落地。',
        },
        { speaker: 'skeptic' as const, content: 'A 太贵' },
        { speaker: 'creative' as const, content: '混合方案' },
        { speaker: 'operator' as const, content: '分阶段' },
        { speaker: 'audience' as const, content: '先稳' },
      ],
      stage: { round: 1, agreed: ['分阶段'], open: ['成本'] },
    },
    {
      round: 2,
      focus: '落地',
      speeches: [{ speaker: 'operator' as const, content: '两周试点' }],
      stage: { round: 2, agreed: ['试点'], open: [] },
    },
  ],
  cast: [
    {
      id: 'strategist' as const,
      title: '长期架构官',
      lens: '长期 API 边界',
      mustCover: ['不可逆承诺'],
    },
    {
      id: 'skeptic' as const,
      title: '成本怀疑论者',
      lens: '成本与失败模式',
      mustCover: ['最坏下行'],
    },
  ],
  decision: {
    verdict: '分阶段推进 A：先试点再 RFC，拒绝一次性重写。',
    decision: '分阶段推进 A\n\n- 先试点\n- 再 RFC',
    keyTradeoffs: ['速度换风险可控'],
    residual: ['时间风险'],
    nextSteps: ['试点', 'RFC'],
    confidence: 'high' as const,
  },
  edges: [
    {
      round: 1,
      from: 'skeptic',
      to: 'strategist',
      relation: 'rebut' as const,
      summary: '成本',
    },
    {
      round: 1,
      from: 'operator',
      to: 'strategist',
      relation: 'support' as const,
      summary: '可分期',
    },
  ],
  generatedAt: '2026-07-26T00:00:00.000Z',
}

describe('roundtable report html template', () => {
  it('renders issue, seats, decision, escapes html', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(ROUNDTABLE_REPORT_FILENAME).toBe('roundtable-report.html')
    expect(html).toContain('圆桌会议报告')
    expect(html).toContain('长期架构官')
    expect(html).toContain('分阶段推进 A')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('Should we rewrite the API? <script>')
  })

  it('puts core verdict hero before overview/process', () => {
    const html = buildRoundtableReportHtml(sample)
    const v = html.indexOf('id="sec-verdict"')
    const o = html.indexOf('id="sec-overview"')
    const p = html.indexOf('id="sec-process"')
    expect(v).toBeGreaterThan(0)
    expect(o).toBeGreaterThan(v)
    expect(p).toBeGreaterThan(o)
    expect(html).toMatch(/class="[^"]*verdict-hero/)
    expect(html).toContain('核心结论')
    expect(html).toContain('拒绝一次性重写')
    expect(html).toContain('关键取舍')
  })

  it('uses pure HTML diagrams (no mermaid CDN / no spaghetti SVG)', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('class="flow-steps"')
    expect(html).toContain('class="seat-board"')
    expect(html).toContain('class="debate-timeline"')
    expect(html).not.toContain('cdn.jsdelivr.net/npm/mermaid')
    expect(html).not.toContain('class="mermaid"')
    expect(html).not.toContain('flowchart LR')
    expect(html).not.toContain('class="diagram debate-diagram"')
  })

  it('renders GFM markdown in decision and speeches', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('class="code-block"')
    expect(html).toContain('data-lang="ts"')
    expect(html).toContain('export const plan')
    expect(html).toContain('class="inline-code"')
    // decision list via marked
    expect(html).toContain('<ul>')
    expect(html).toContain('先试点')
  })

  it('keeps fixed TOC shell and data-jump', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('id="toc"')
    expect(html).toContain('class="shell"')
    expect(html).toContain('id="report-main"')
    expect(html).toContain('data-jump="sec-overview"')
    expect(html).toContain(ROUNDTABLE_REPORT_NAV_SCRIPT.slice(0, 40))
    expect(ROUNDTABLE_REPORT_STYLES).toContain('.flow-steps')
    expect(ROUNDTABLE_REPORT_STYLES).toContain('.md')
  })

  it('collapses rounds by default', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('class="round-fold"')
    expect(html).toContain('id="sec-round-1"')
  })

  it('renders markdown lists/bold in long speech', () => {
    const html = buildRoundtableReportHtml({
      ...sample,
      rounds: [
        {
          round: 1,
          focus: 'f',
          speeches: [
            {
              speaker: 'skeptic',
              content: '## 怀疑论者发言\n\n- 成本过高\n- 证据不足\n\n结论是 **暂缓**。',
            },
          ],
          stage: { round: 1, agreed: [], open: [] },
        },
      ],
    })
    expect(html).toMatch(/<h2[^>]*>怀疑论者发言<\/h2>/)
    expect(html).toContain('<ul>')
    expect(html).toContain('成本过高')
    expect(html).toContain('<strong>暂缓</strong>')
  })
})

describe('roundtable report bundle', () => {
  it('emits main + persona files', () => {
    const files = buildRoundtableReportBundle(sample)
    expect(files[0]?.filename).toBe(ROUNDTABLE_REPORT_FILENAME)
    expect(files.length).toBeGreaterThanOrEqual(2)
    const skeptic = files.find((f) => f.persona === 'skeptic')
    expect(skeptic?.html).toContain('怀疑论者')
    expect(skeptic?.html).toContain(ROUNDTABLE_REPORT_FILENAME)
    expect(skeptic?.html).toContain(personaReportFilename('strategist'))
  })
})
