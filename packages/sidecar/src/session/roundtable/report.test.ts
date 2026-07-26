import { describe, it, expect } from 'vitest'
import {
  buildRoundtableReportHtml,
  buildRoundtableReportBundle,
  personaReportFilename,
  ROUNDTABLE_REPORT_FILENAME,
  ROUNDTABLE_REPORT_NAV_SCRIPT,
  ROUNDTABLE_REPORT_STYLES,
} from './report.js'
import { ROUNDTABLE_MERMAID_CDN } from './report-diagrams.js'

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
  it('renders issue, seats, decision, escapes html', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(ROUNDTABLE_REPORT_FILENAME).toBe('roundtable-report.html')
    expect(html).toContain('圆桌会议报告')
    expect(html).toContain('战略家')
    expect(html).toContain('分阶段推进 A')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('Should we rewrite the API? <script>')
    expect(html).toContain('<!DOCTYPE html>')
  })

  it('uses mermaid diagrams (not hand-rolled SVG)', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('class="mermaid"')
    expect(html).toContain('flowchart LR')
    expect(html).toContain(ROUNDTABLE_MERMAID_CDN)
    expect(html).toContain('mermaid.initialize')
    // No legacy hand SVG debate/flow classes
    expect(html).not.toContain('class="diagram debate-diagram"')
    expect(html).not.toContain('class="diagram flow-diagram"')
    expect(html).not.toContain('id="m-rebut"')
  })

  it('keeps TOC fixed shell and data-jump nav', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('id="toc"')
    expect(html).toContain('class="shell"')
    expect(html).toContain('id="report-main"')
    expect(html).toContain('data-jump="sec-overview"')
    expect(html).toContain('data-jump="sec-decision"')
    expect(html).toContain('data-jump="sec-process"')
    expect(html).toContain(ROUNDTABLE_REPORT_NAV_SCRIPT.slice(0, 40))
    expect(ROUNDTABLE_REPORT_STYLES).toContain('#report-main')
    expect(ROUNDTABLE_REPORT_STYLES).toContain('.mermaid-wrap')
  })

  it('collapses rounds by default and limits storyline noise', () => {
    const html = buildRoundtableReportHtml(sample)
    expect(html).toContain('class="round-fold"')
    expect(html).toContain('id="sec-round-1"')
    expect(html).toContain('class="storyline"')
    // Full edge dump not a top-level always-open wall
    expect(html).toContain('class="code-block"')
    expect(html).toContain('data-lang="ts"')
  })

  it('renders markdown in speeches', () => {
    const html = buildRoundtableReportHtml({
      ...sample,
      rounds: [
        {
          round: 1,
          focus: 'f',
          speeches: [
            {
              speaker: 'skeptic',
              content: '**怀疑论者发言**\n\n- 成本过高\n- 证据不足\n\n结论是 **暂缓**。',
            },
          ],
          stage: { round: 1, agreed: [], open: [] },
        },
      ],
    })
    expect(html).toContain('怀疑论者发言')
    expect(html).toContain('class="prose-ul"')
    expect(html).toContain('<strong>暂缓</strong>')
  })

  it('omits empty optional sections', () => {
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
    expect(html).toContain('data-jump="sec-overview"')
    expect(html).not.toContain('data-jump="sec-decision"')
    expect(html).toContain('Contents')
  })
})

describe('roundtable report bundle', () => {
  it('emits main + persona files with mermaid', () => {
    const files = buildRoundtableReportBundle(sample)
    expect(files[0]?.filename).toBe(ROUNDTABLE_REPORT_FILENAME)
    expect(files).toHaveLength(1 + 5)
    const skeptic = files.find((f) => f.persona === 'skeptic')!
    expect(skeptic.html).toContain('怀疑论者')
    expect(skeptic.html).toContain('class="mermaid"')
    expect(skeptic.html).toContain(`href="${ROUNDTABLE_REPORT_FILENAME}"`)
    expect(skeptic.html).toContain(personaReportFilename('strategist'))
  })
})
