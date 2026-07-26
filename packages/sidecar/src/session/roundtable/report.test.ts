import { describe, it, expect } from 'vitest'
import {
  buildRoundtableReportHtml,
  ROUNDTABLE_REPORT_FILENAME,
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
        { speaker: 'strategist' as const, content: '长期选 A' },
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
  decision: {
    decision: '分阶段推进 A',
    residual: ['时间风险'],
    nextSteps: ['试点', 'RFC'],
  },
  edges: [
    {
      round: 1,
      from: 'skeptic',
      to: 'strategist',
      relation: 'rebut' as const,
      summary: '成本',
    },
  ],
  generatedAt: '2026-07-26T00:00:00.000Z',
}

describe('roundtable report html template', () => {
  it('renders issue, all seats, decision, and escapes html', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(ROUNDTABLE_REPORT_FILENAME).toBe('roundtable-report.html')
    expect(ROUNDTABLE_REPORT_STYLES).toContain('.toc')
    expect(html).toContain('圆桌会议报告')
    expect(html).toContain('战略家')
    expect(html).toContain('受众倡导者')
    expect(html).toContain('分阶段推进 A')
    expect(html).toContain('反驳')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<!DOCTYPE html>')
  })

  it('includes TOC anchors that jump to each section', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('id="toc"')
    expect(html).toContain('目录')
    expect(html).toMatch(/href="#sec-issue"/)
    expect(html).toMatch(/href="#sec-plan"/)
    expect(html).toMatch(/href="#sec-round-1"/)
    expect(html).toMatch(/href="#sec-round-2"/)
    expect(html).toMatch(/href="#sec-edges"/)
    expect(html).toMatch(/href="#sec-decision"/)
    expect(html).toContain('id="sec-issue"')
    expect(html).toContain('id="sec-plan"')
    expect(html).toContain('id="sec-round-1"')
    expect(html).toContain('id="sec-round-2"')
    expect(html).toContain('id="sec-edges"')
    expect(html).toContain('id="sec-decision"')
    expect(html).toContain('href="#top"')
    expect(html).toContain('返回顶部')
    expect(html).toContain('scroll-behavior: smooth')
  })

  it('omits empty optional TOC entries', () => {
    const html = buildRoundtableReportHtml({
      issue: 'x',
      language: 'en',
      agenda: ['a'],
      rationale: 'r',
      rounds: [
        {
          round: 1,
          focus: 'f',
          speeches: [{ speaker: 'strategist', content: 'hi' }],
          stage: { round: 1, agreed: [], open: [] },
        },
      ],
    })
    expect(html).toContain('href="#sec-issue"')
    expect(html).toContain('href="#sec-round-1"')
    expect(html).not.toContain('href="#sec-edges"')
    expect(html).not.toContain('href="#sec-decision"')
    expect(html).toContain('Contents')
  })
})
