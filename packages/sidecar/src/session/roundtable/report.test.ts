import { describe, it, expect } from 'vitest'
import { buildRoundtableReportHtml, ROUNDTABLE_REPORT_FILENAME } from './report.js'

describe('roundtable report html', () => {
  it('renders issue, all seats, decision, and escapes html', () => {
    const html = buildRoundtableReportHtml({
      issue: 'Should we rewrite the API? <script>',
      language: 'zh-CN',
      agenda: ['定方向', '定路径'],
      rationale: '有明显取舍',
      rounds: [
        {
          round: 1,
          focus: '方向',
          speeches: [
            { speaker: 'strategist', content: '长期选 A' },
            { speaker: 'skeptic', content: 'A 太贵' },
            { speaker: 'creative', content: '混合方案' },
            { speaker: 'operator', content: '分阶段' },
            { speaker: 'audience', content: '先稳' },
          ],
          stage: { round: 1, agreed: ['分阶段'], open: ['成本'] },
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
          relation: 'rebut',
          summary: '成本',
        },
      ],
      generatedAt: '2026-07-26T00:00:00.000Z',
    })
    expect(ROUNDTABLE_REPORT_FILENAME).toBe('roundtable-report.html')
    expect(html).toContain('圆桌会议报告')
    expect(html).toContain('战略家')
    expect(html).toContain('受众倡导者')
    expect(html).toContain('分阶段推进 A')
    expect(html).toContain('反驳')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<!DOCTYPE html>')
  })
})
