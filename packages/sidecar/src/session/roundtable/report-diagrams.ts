/**
 * Inline SVG diagrams for roundtable HTML reports (self-contained, no CDN).
 */
import type { PersonaId, RoundtableEdgeResult, RoundtableLang } from './types.js'
import { esc } from './report-prose.js'

export const PERSONA_HUE: Record<PersonaId, string> = {
  strategist: '220',
  skeptic: '0',
  creative: '280',
  operator: '150',
  audience: '35',
}

const REL_STROKE: Record<string, string> = {
  rebut: '#f07178',
  support: '#7fd99a',
  question: '#e0b45a',
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

/** Horizontal pipeline: Issue → R1 → R2 → … → Decision */
export function svgFlowPipeline(args: {
  lang: RoundtableLang
  issue: string
  rounds: Array<{ round: number; focus: string }>
  decision?: string
  labels: { issue: string; decision: string; round: (n: number) => string }
}): string {
  const nodes: Array<{ id: string; label: string; sub: string; kind: string }> = [
    {
      id: 'issue',
      label: args.labels.issue,
      sub: snipSvg(args.issue, 28),
      kind: 'issue',
    },
  ]
  for (const r of args.rounds) {
    nodes.push({
      id: `r${r.round}`,
      label: args.labels.round(r.round),
      sub: snipSvg(r.focus, 22),
      kind: 'round',
    })
  }
  if (args.decision) {
    nodes.push({
      id: 'dec',
      label: args.labels.decision,
      sub: snipSvg(args.decision, 28),
      kind: 'decision',
    })
  }

  const n = Math.max(nodes.length, 1)
  const boxW = 118
  const boxH = 64
  const gap = 36
  const padX = 16
  const padY = 20
  const width = padX * 2 + n * boxW + (n - 1) * gap
  const height = padY * 2 + boxH + 8

  const boxes = nodes
    .map((node, i) => {
      const x = padX + i * (boxW + gap)
      const y = padY
      const fill =
        node.kind === 'decision'
          ? 'var(--diag-decision-fill)'
          : node.kind === 'issue'
            ? 'var(--diag-issue-fill)'
            : 'var(--diag-round-fill)'
      const stroke =
        node.kind === 'decision'
          ? 'var(--diag-decision-stroke)'
          : node.kind === 'issue'
            ? 'var(--diag-issue-stroke)'
            : 'var(--diag-round-stroke)'
      return `
      <g class="flow-node flow-${esc(node.kind)}">
        <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="12" ry="12"
          fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
        <text x="${x + boxW / 2}" y="${y + 24}" text-anchor="middle"
          class="flow-label">${esc(node.label)}</text>
        <text x="${x + boxW / 2}" y="${y + 44}" text-anchor="middle"
          class="flow-sub">${esc(node.sub)}</text>
      </g>`
    })
    .join('')

  const arrows = nodes
    .slice(0, -1)
    .map((_, i) => {
      const x1 = padX + i * (boxW + gap) + boxW
      const x2 = padX + (i + 1) * (boxW + gap)
      const y = padY + boxH / 2
      return `
      <line x1="${x1 + 4}" y1="${y}" x2="${x2 - 10}" y2="${y}"
        class="flow-arrow" marker-end="url(#arrowHead)"/>`
    })
    .join('')

  return `<div class="diagram-wrap" role="img" aria-label="flow">
<svg class="diagram flow-diagram" viewBox="0 0 ${width} ${height}" width="100%" height="${height}"
  preserveAspectRatio="xMidYMid meet">
  <defs>
    <marker id="arrowHead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" class="flow-arrow-head"/>
    </marker>
  </defs>
  ${arrows}
  ${boxes}
</svg>
</div>`
}

/** Circular debate graph: seats as nodes, edges as colored arcs. */
export function svgDebateGraph(args: {
  lang: RoundtableLang
  seats: PersonaId[]
  seatLabels: Record<string, string>
  edges: RoundtableEdgeResult[]
  title: string
}): string {
  const seats = args.seats
  if (!seats.length) {
    return `<p class="muted">—</p>`
  }

  const size = 360
  const cx = size / 2
  const cy = size / 2
  const R = 118
  const nodeR = 28

  const pos = new Map<string, { x: number; y: number; hue: string }>()
  seats.forEach((id, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / seats.length
    pos.set(id, {
      x: cx + R * Math.cos(ang),
      y: cy + R * Math.sin(ang),
      hue: PERSONA_HUE[id] ?? '220',
    })
  })

  // Multi-edges between same pair: offset slightly
  const pairCount = new Map<string, number>()
  const edgePaths = args.edges
    .filter((e) => pos.has(e.from) && pos.has(e.to))
    .map((e) => {
      const key = [e.from, e.to].sort().join('|')
      const idx = pairCount.get(key) ?? 0
      pairCount.set(key, idx + 1)
      const a = pos.get(e.from)!
      const b = pos.get(e.to)!
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      // Perpendicular offset for curve
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      const ox = (-dy / len) * (18 + idx * 12)
      const oy = (dx / len) * (18 + idx * 12)
      const cpx = mx + ox
      const cpy = my + oy
      const stroke = REL_STROKE[e.relation] ?? REL_STROKE.question
      const dash = e.relation === 'question' ? '4 3' : e.relation === 'support' ? '0' : '0'
      const marker =
        e.relation === 'rebut'
          ? 'url(#m-rebut)'
          : e.relation === 'support'
            ? 'url(#m-support)'
            : 'url(#m-question)'
      return `<path d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}"
        fill="none" stroke="${stroke}" stroke-width="2" stroke-dasharray="${dash}"
        marker-end="${marker}" opacity="0.9">
        <title>${esc(args.seatLabels[e.from] ?? e.from)} → ${esc(relLabel(args.lang, e.relation))} → ${esc(args.seatLabels[e.to] ?? e.to)}${e.summary ? `: ${esc(e.summary)}` : ''}</title>
      </path>`
    })
    .join('\n')

  const nodes = seats
    .map((id) => {
      const p = pos.get(id)!
      const label = snipSvg(args.seatLabels[id] ?? id, 6)
      return `
      <g class="debate-node">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${nodeR}"
          fill="hsl(${p.hue} 45% 42%)" stroke="hsl(${p.hue} 60% 68%)" stroke-width="2"/>
        <text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle"
          class="debate-node-label">${esc(label)}</text>
        <title>${esc(args.seatLabels[id] ?? id)}</title>
      </g>`
    })
    .join('')

  const legend = (['rebut', 'support', 'question'] as const)
    .map((rel, i) => {
      const x = 18 + i * 115
      return `
      <line x1="${x}" y1="${size - 14}" x2="${x + 22}" y2="${size - 14}"
        stroke="${REL_STROKE[rel]}" stroke-width="2.5"
        stroke-dasharray="${rel === 'question' ? '4 3' : '0'}"/>
      <text x="${x + 28}" y="${size - 10}" class="legend-text">${esc(relLabel(args.lang, rel))}</text>`
    })
    .join('')

  return `<div class="diagram-wrap debate-wrap" role="img" aria-label="${esc(args.title)}">
<svg class="diagram debate-diagram" viewBox="0 0 ${size} ${size}" width="100%"
  style="max-width:${size}px;margin:0 auto;display:block" preserveAspectRatio="xMidYMid meet">
  <defs>
    <marker id="m-rebut" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="${REL_STROKE.rebut}"/>
    </marker>
    <marker id="m-support" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="${REL_STROKE.support}"/>
    </marker>
    <marker id="m-question" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 Z" fill="${REL_STROKE.question}"/>
    </marker>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--diag-ring)" stroke-width="1" stroke-dasharray="3 5" opacity="0.5"/>
  ${edgePaths}
  ${nodes}
  ${legend}
</svg>
</div>`
}

/** Seat architecture: hip chair center + advisor ring. */
export function svgSeatArchitecture(args: {
  lang: RoundtableLang
  seats: PersonaId[]
  seatLabels: Record<string, string>
  chairLabel: string
  title: string
}): string {
  const size = 320
  const cx = size / 2
  const cy = size / 2 + 6
  const R = 100
  const seats = args.seats

  const chair = `
    <g class="arch-chair">
      <rect x="${cx - 42}" y="${cy - 22}" width="84" height="44" rx="12"
        fill="var(--diag-decision-fill)" stroke="var(--diag-decision-stroke)" stroke-width="1.5"/>
      <text x="${cx}" y="${cy + 5}" text-anchor="middle" class="arch-chair-label">${esc(args.chairLabel)}</text>
    </g>`

  const advisors = seats
    .map((id, i) => {
      const ang = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(seats.length, 1)
      const x = cx + R * Math.cos(ang)
      const y = cy + R * Math.sin(ang)
      const hue = PERSONA_HUE[id] ?? '220'
      const label = snipSvg(args.seatLabels[id] ?? id, 5)
      return `
      <line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"
        stroke="var(--diag-ring)" stroke-width="1" stroke-dasharray="2 4" opacity="0.55"/>
      <g>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="26"
          fill="hsl(${hue} 42% 40%)" stroke="hsl(${hue} 55% 65%)" stroke-width="1.5"/>
        <text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle"
          class="debate-node-label">${esc(label)}</text>
        <title>${esc(args.seatLabels[id] ?? id)}</title>
      </g>`
    })
    .join('')

  return `<div class="diagram-wrap" role="img" aria-label="${esc(args.title)}">
<svg class="diagram arch-diagram" viewBox="0 0 ${size} ${size}" width="100%"
  style="max-width:${size}px;margin:0 auto;display:block" preserveAspectRatio="xMidYMid meet">
  ${advisors}
  ${chair}
</svg>
</div>`
}

/** Compact KPI strip as SVG-friendly HTML metrics (not pure SVG). */
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

function snipSvg(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, Math.max(1, n - 1))}…`
}
