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
  it('renders issue, all seats, decision, and escapes html', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(ROUNDTABLE_REPORT_FILENAME).toBe('roundtable-report.html')
    expect(ROUNDTABLE_REPORT_STYLES).toContain('.toc')
    expect(html).toContain('圆桌会议报告')
    expect(html).toContain('战略家')
    expect(html).toContain('受众倡导者')
    expect(html).toContain('分阶段推进 A')
    expect(html).toContain('反驳')
    // User content is escaped; template may include a safe nav <script>.
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('Should we rewrite the API? <script>')
    expect(html).toContain('<!DOCTYPE html>')
  })

  it('includes fixed TOC with data-jump navigation (no hash white-screen)', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('id="toc"')
    expect(html).toContain('目录')
    expect(html).toContain('class="shell"')
    expect(html).toContain('id="report-main"')
    expect(html).toContain('data-jump="sec-issue"')
    expect(html).toContain('data-jump="sec-plan"')
    expect(html).toContain('data-jump="sec-process"')
    expect(html).toContain('data-jump="sec-round-1"')
    expect(html).toContain('data-jump="sec-round-2"')
    expect(html).toContain('data-jump="sec-edges"')
    expect(html).toContain('data-jump="sec-decision"')
    expect(html).toContain('data-jump="sec-roles"')
    expect(html).toContain('data-jump="top"')
    expect(html).toContain('id="sec-issue"')
    expect(html).toContain('id="sec-decision"')
    expect(html).toContain('返回顶部')
    expect(html).toContain(ROUNDTABLE_REPORT_NAV_SCRIPT.slice(0, 40))
    // Wide layout: no narrow max-width on shell/content
    expect(ROUNDTABLE_REPORT_STYLES).toContain('overflow: hidden')
    expect(ROUNDTABLE_REPORT_STYLES).toContain('#report-main')
    expect(ROUNDTABLE_REPORT_STYLES).toContain('max-width: none')
  })

  it('includes discussion process, rebuttal map, and role sub-report links', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('讨论时间线')
    expect(html).toContain('交锋图谱')
    expect(html).toContain('反驳与挑战')
    expect(html).toContain('各角色子报告')
    expect(html).toContain('rel-chip rebut')
    expect(html).toContain('rel-chip support')
    expect(html).toContain(`href="${personaReportFilename('strategist')}"`)
    expect(html).toContain(`href="${personaReportFilename('skeptic')}"`)
    expect(html).toContain('class="role-card"')
    expect(html).toContain('hip 汇总')
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
    expect(html).toContain('data-jump="sec-issue"')
    expect(html).toContain('data-jump="sec-round-1"')
    expect(html).toContain('data-jump="sec-roles"')
    expect(html).not.toContain('data-jump="sec-edges"')
    expect(html).not.toContain('data-jump="sec-decision"')
    expect(html).toContain('Contents')
  })
})

describe('roundtable report bundle (main + role sub-reports)', () => {
  it('emits main file plus one file per speaking seat', () => {
    const files = buildRoundtableReportBundle(sample)
    expect(files[0]?.filename).toBe(ROUNDTABLE_REPORT_FILENAME)
    expect(files[0]?.kind).toBe('main')
    // 5 unique speakers across rounds
    expect(files).toHaveLength(1 + 5)
    const names = files.map((f) => f.filename)
    expect(names).toContain(personaReportFilename('strategist'))
    expect(names).toContain(personaReportFilename('operator'))
    expect(names).toContain(personaReportFilename('audience'))
  })

  it('persona report includes stance, exchanges, back-link, and decision context', () => {
    const files = buildRoundtableReportBundle(sample)
    const skeptic = files.find((f) => f.persona === 'skeptic')
    expect(skeptic).toBeTruthy()
    const html = skeptic!.html
    expect(html).toContain('角色报告')
    expect(html).toContain('怀疑论者')
    expect(html).toContain('我的理解')
    expect(html).toContain('A 太贵')
    expect(html).toContain('我反驳了')
    expect(html).toContain('战略家')
    expect(html).toContain('成本')
    expect(html).toContain('对照 hip 决策')
    expect(html).toContain('分阶段推进 A')
    expect(html).toContain(`href="${ROUNDTABLE_REPORT_FILENAME}"`)
    expect(html).toContain('返回 hip 汇总')
    // Escaping still applied
    expect(html).toContain('&lt;script&gt;')
  })

  it('persona report lists inbound challenges for the target seat', () => {
    const files = buildRoundtableReportBundle(sample)
    const strategist = files.find((f) => f.persona === 'strategist')
    expect(strategist).toBeTruthy()
    const html = strategist!.html
    expect(html).toContain('反驳我的')
    expect(html).toContain('怀疑论者')
    expect(html).toContain('支持我的')
    expect(html).toContain('执行者')
  })
})
