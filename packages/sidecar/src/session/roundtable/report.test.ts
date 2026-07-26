import { describe, it, expect } from 'vitest'
import {
  buildRoundtableReportHtml,
  buildRoundtableReportBundle,
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
    decision: '## 路径\n\n- 先试点\n- 再 RFC\n\n```ts\nexport const plan = "A"\n```',
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
  ],
  generatedAt: '2026-07-26T00:00:00.000Z',
}

describe('roundtable conclusion report', () => {
  it('renders verdict, decision, escapes html', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(ROUNDTABLE_REPORT_FILENAME).toBe('roundtable-report.html')
    expect(html).toContain('圆桌会议报告')
    expect(html).toContain('分阶段推进 A')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('Should we rewrite the API? <script>')
  })

  it('is conclusion-only: no process / rounds / speech dumps', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('id="sec-verdict"')
    expect(html).toContain('id="sec-decision"')
    expect(html).toMatch(/class="[^"]*verdict-hero/)
    expect(html).toContain('核心结论')
    expect(html).toContain('拒绝一次性重写')
    expect(html).toContain('关键取舍')
    // process removed
    expect(html).not.toContain('id="sec-process"')
    expect(html).not.toContain('id="sec-rounds"')
    expect(html).not.toContain('id="sec-overview"')
    expect(html).not.toContain('class="round-fold"')
    expect(html).not.toContain('class="flow-steps"')
    expect(html).not.toContain('class="debate-timeline"')
    expect(html).not.toContain('A 太贵') // advisor speech text
    expect(html).not.toContain('两周试点')
    expect(html).toContain('讨论过程不写入')
  })

  it('renders GFM in decision once (no preview+body duplicate)', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('class="code-block"')
    expect(html).toContain('data-lang="ts"')
    expect(html).toContain('export const plan')
    expect(html).toContain('<ul>')
    expect(html).toContain('先试点')
    // collapsible open path should not emit prose-preview
    expect(html).not.toContain('class="prose-preview"')
  })

  it('shows cast titles in context, not full discussion', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('长期架构官')
    expect(html).toContain('成本怀疑论者')
    expect(html).toContain('id="sec-context"')
  })

  it('keeps fixed TOC shell and data-jump', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('id="toc"')
    expect(html).toContain('class="shell"')
    expect(html).toContain('id="report-main"')
    expect(html).toContain('data-jump="sec-verdict"')
    expect(html).toContain(ROUNDTABLE_REPORT_NAV_SCRIPT.slice(0, 40))
    expect(ROUNDTABLE_REPORT_STYLES).toContain('.md')
  })

  it('strips verdict echo from decision body', () => {
    const html = buildRoundtableReportHtml({
      ...sample,
      decision: {
        verdict: '只保留这一句结论。',
        decision: '只保留这一句结论。\n\n## 细则\n\n- 第一步',
        keyTradeoffs: [],
        residual: [],
        nextSteps: ['做'],
      },
    })
    // verdict appears in hero
    expect(html).toContain('只保留这一句结论。')
    // decision section should still have 细则, not only a second full hero dump
    expect(html).toContain('细则')
    expect(html).toContain('第一步')
  })
})

describe('roundtable report bundle', () => {
  it('emits main conclusion file only', () => {
    const files = buildRoundtableReportBundle(sample)
    expect(files).toHaveLength(1)
    expect(files[0]?.filename).toBe(ROUNDTABLE_REPORT_FILENAME)
    expect(files[0]?.kind).toBe('main')
    expect(files[0]?.html).toContain('核心结论')
    expect(files[0]?.html).not.toContain('id="sec-rounds"')
  })
})
