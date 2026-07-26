/**
 * Diagrams for roundtable reports — pure HTML/CSS (no Mermaid CDN, no client layout).
 * Readable in srcDoc preview and offline browser open.
 */
import type { PersonaId, RoundtableEdgeResult, RoundtableLang } from './types.js'
import { esc, shortLabel } from './report-prose.js'

export const PERSONA_HUE: Record<PersonaId, string> = {
  strategist: '220',
  skeptic: '0',
  creative: '280',
  operator: '150',
  audience: '35',
}

export function resetDiagramIds(): void {
  /* no-op — kept for API stability */
}

function relLabel(lang: RoundtableLang, rel: string): string {
  if (lang === 'zh-CN' || lang === 'zh-TW') {
    if (rel === 'rebut') return '反驳'
    if (rel === 'support') return '附议'
    return '提问'
  }
  if (lang === 'ja') {
    if (rel === 'rebut') return '反論'
    if (rel === 'support') return '支持'
    return '質問'
  }
  if (lang === 'ko') {
    if (rel === 'rebut') return '반박'
    if (rel === 'support') return '지지'
    return '질문'
  }
  return rel
}

/** Horizontal step pipeline — CSS flex, no JS. */
export function mermaidFlowPipeline(args: {
  lang: RoundtableLang
  rounds: Array<{ round: number; focus: string }>
  hasDecision: boolean
  labels: { issue: string; decision: string; round: (n: number) => string }
}): string {
  // Keep export name for call-site stability; output is pure HTML steps.
  const steps: Array<{ kind: string; title: string; sub: string }> = [
    { kind: 'issue', title: args.labels.issue, sub: '' },
  ]
  for (const r of args.rounds) {
    steps.push({
      kind: 'round',
      title: args.labels.round(r.round),
      sub: shortLabel(r.focus, 20),
    })
  }
  if (args.hasDecision) {
    steps.push({ kind: 'decision', title: args.labels.decision, sub: '' })
  }

  const parts = steps
    .map((s, i) => {
      const arrow =
        i < steps.length - 1
          ? `<span class="flow-arrow" aria-hidden="true">→</span>`
          : ''
      return `<div class="flow-step flow-${esc(s.kind)}">
  <div class="flow-step-title">${esc(s.title)}</div>
  ${s.sub ? `<div class="flow-step-sub">${esc(s.sub)}</div>` : ''}
</div>${arrow}`
    })
    .join('\n')

  return `<div class="flow-steps" role="list">${parts}</div>`
}

/** Seat chips around hip — clean board, no graph layout. */
export function mermaidSeatArchitecture(args: {
  seats: PersonaId[]
  seatLabels: Record<string, string>
  chairLabel: string
}): string {
  if (!args.seats.length) return ''
  const seats = args.seats
    .map((id) => {
      const hue = PERSONA_HUE[id] ?? '220'
      return `<span class="seat-chip" style="--persona-h:${hue}">${esc(args.seatLabels[id] ?? id)}</span>`
    })
    .join('\n    ')
  return `<div class="seat-board">
  <div class="seat-chair">${esc(args.chairLabel)}</div>
  <div class="seat-ring">${seats}</div>
</div>`
}

/**
 * Debate visualization: ranked timeline of key exchanges (not a node graph).
 * Graphs with 10+ edges are unreadable; a timeline is scannable.
 */
export function mermaidDebateGraph(args: {
  lang: RoundtableLang
  seats: PersonaId[]
  seatLabels: Record<string, string>
  edges: RoundtableEdgeResult[]
  maxEdges?: number
}): string {
  // Prefer rebuttals; cap for clarity
  const maxEdges = args.maxEdges ?? 10
  const ranked = [...args.edges]
    .sort((a, b) => {
      const rank = (r: string) => (r === 'rebut' ? 0 : r === 'question' ? 1 : 2)
      return a.round - b.round || rank(a.relation) - rank(b.relation)
    })
    .slice(0, maxEdges)

  if (!ranked.length) return `<p class="muted">—</p>`

  const items = ranked
    .map((e) => {
      const relClass =
        e.relation === 'rebut' || e.relation === 'support' || e.relation === 'question'
          ? e.relation
          : 'question'
      const from = esc(args.seatLabels[e.from] ?? e.from)
      const to = esc(args.seatLabels[e.to] ?? e.to)
      return `<li class="dt-item ${relClass}">
  <div class="dt-line">
    <span class="round-tag">R${e.round}</span>
    <span class="dt-from">${from}</span>
    <span class="rel-chip ${relClass}">${esc(relLabel(args.lang, e.relation))}</span>
    <span class="dt-to">${to}</span>
  </div>
  ${e.summary ? `<div class="sum">${esc(shortLabel(e.summary, 96))}</div>` : ''}
</li>`
    })
    .join('\n')

  const cap =
    args.edges.length > ranked.length
      ? `<p class="hint diagram-cap">${esc(
          args.lang === 'zh-CN' || args.lang === 'zh-TW'
            ? `关键交锋 ${ranked.length}/${args.edges.length}（优先反驳）`
            : `Key ${ranked.length}/${args.edges.length} (rebuttals first)`,
        )}</p>`
      : ''

  return `<div class="debate-timeline-wrap">
  <ol class="debate-timeline">${items}</ol>
  ${cap}
</div>`
}

export function metricsRow(items: Array<{ label: string; value: string }>): string {
  if (!items.length) return ''
  return `<div class="metrics" role="group">
  ${items
    .map(
      (it) => `<div class="metric">
    <div class="metric-value">${esc(it.value)}</div>
    <div class="metric-label">${esc(it.label)}</div>
  </div>`,
    )
    .join('\n  ')}
</div>`
}

export function edgeStorylineHtml(args: {
  lang: RoundtableLang
  edges: RoundtableEdgeResult[]
  seatLabels: Record<string, string>
  max?: number
  linkRoles?: boolean
  fileLink?: (href: string, label: string) => string
  personaFile?: (id: string) => string
}): string {
  const max = args.max ?? 8
  const ranked = [...args.edges]
    .sort((a, b) => {
      const rank = (r: string) => (r === 'rebut' ? 0 : r === 'question' ? 1 : 2)
      return a.round - b.round || rank(a.relation) - rank(b.relation)
    })
    .slice(0, max)

  if (!ranked.length) return `<p class="muted">—</p>`

  const nameOf = (id: string): string => {
    const label = esc(args.seatLabels[id] ?? id)
    if (args.linkRoles && args.fileLink && args.personaFile) {
      return args.fileLink(args.personaFile(id), label)
    }
    return label
  }

  return `<ol class="storyline">
  ${ranked
    .map((e) => {
      const relClass =
        e.relation === 'rebut' || e.relation === 'support' || e.relation === 'question'
          ? e.relation
          : 'question'
      return `<li class="storyline-item ${relClass}">
    <span class="round-tag">R${e.round}</span>
    <span class="from">${nameOf(e.from)}</span>
    <span class="rel-chip ${relClass}">${esc(relLabel(args.lang, e.relation))}</span>
    <span class="to">${nameOf(e.to)}</span>
    ${e.summary ? `<div class="sum">${esc(shortLabel(e.summary, 80))}</div>` : ''}
  </li>`
    })
    .join('\n')}
</ol>${
    args.edges.length > ranked.length
      ? `<p class="hint">${esc(
          args.lang === 'zh-CN' || args.lang === 'zh-TW'
            ? `关键 ${ranked.length}/${args.edges.length}（完整列表可展开）`
            : `Key ${ranked.length}/${args.edges.length} (expand for full list)`,
        )}</p>`
      : ''
  }`
}

/** @deprecated no CDN — kept so old imports don't break if any */
export const ROUNDTABLE_MERMAID_CDN = ''
export const ROUNDTABLE_MERMAID_BOOT_SCRIPT = ''
