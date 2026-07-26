/**
 * Mermaid diagram sources for roundtable HTML reports.
 * Rendered client-side via mermaid.js (CDN) — see ROUNDTABLE_MERMAID_BOOT_SCRIPT.
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

/** Kept for API compatibility; mermaid has no id collision issues. */
export function resetDiagramIds(): void {
  /* no-op */
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

/** Mermaid node / edge label: no raw quotes or newlines that break syntax. */
function mLabel(s: string, max = 28): string {
  return shortLabel(s.replace(/["#[\]{}|]/g, ' ').replace(/\s+/g, ' ').trim(), max)
}

function mermaidPre(code: string): string {
  // Escape so </pre> in content cannot break out; mermaid reads decoded textContent.
  return `<pre class="mermaid">${esc(code.trim())}</pre>`
}

export function mermaidWrap(code: string, caption?: string): string {
  return `<div class="mermaid-wrap">
  ${caption ? `<p class="diagram-cap">${esc(caption)}</p>` : ''}
  ${mermaidPre(code)}
  <noscript><p class="hint">Mermaid requires JavaScript.</p></noscript>
</div>`
}

/** Meeting pipeline: Issue → rounds → Decision */
export function mermaidFlowPipeline(args: {
  lang: RoundtableLang
  rounds: Array<{ round: number; focus: string }>
  hasDecision: boolean
  labels: { issue: string; decision: string; round: (n: number) => string }
}): string {
  const lines = ['flowchart LR']
  lines.push(`  I["${mLabel(args.labels.issue, 12)}"]`)
  let prev = 'I'
  for (const r of args.rounds) {
    const id = `R${r.round}`
    const focus = mLabel(r.focus, 16)
    lines.push(`  ${id}["${mLabel(args.labels.round(r.round), 10)}<br/>${focus}"]`)
    lines.push(`  ${prev} --> ${id}`)
    prev = id
  }
  if (args.hasDecision) {
    lines.push(`  D["${mLabel(args.labels.decision, 12)}"]`)
    lines.push(`  ${prev} --> D`)
    lines.push(`  style D fill:#1a7f4b22,stroke:#7fd99a`)
  }
  lines.push(`  style I fill:#3b6ef522,stroke:#7aa2ff`)
  return mermaidWrap(lines.join('\n'))
}

/** Council seats around hip chair */
export function mermaidSeatArchitecture(args: {
  seats: PersonaId[]
  seatLabels: Record<string, string>
  chairLabel: string
}): string {
  if (!args.seats.length) return ''
  const lines = ['flowchart TB']
  lines.push(`  HIP(("${mLabel(args.chairLabel, 8)}"))`)
  for (const id of args.seats) {
    const nid = id.slice(0, 3).toUpperCase()
    lines.push(`  ${nid}["${mLabel(args.seatLabels[id] ?? id, 8)}"]`)
    lines.push(`  HIP --- ${nid}`)
  }
  lines.push(`  style HIP fill:#7aa2ff33,stroke:#7aa2ff`)
  return mermaidWrap(lines.join('\n'))
}

/**
 * Debate graph as flowchart (rebuttals first, capped).
 * Uses --> 反驳, -.-> 提问, ==> 附议 for visual distinction.
 */
export function mermaidDebateGraph(args: {
  lang: RoundtableLang
  seats: PersonaId[]
  seatLabels: Record<string, string>
  edges: RoundtableEdgeResult[]
  maxEdges?: number
}): string {
  if (!args.seats.length) return `<p class="muted">—</p>`

  const maxEdges = args.maxEdges ?? 12
  const ranked = [...args.edges]
    .filter((e) => args.seats.includes(e.from as PersonaId) && args.seats.includes(e.to as PersonaId))
    .sort((a, b) => {
      const rank = (r: string) => (r === 'rebut' ? 0 : r === 'question' ? 1 : 2)
      return rank(a.relation) - rank(b.relation) || a.round - b.round
    })
    .slice(0, maxEdges)

  const idOf = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 12) || 'n'

  const lines = ['flowchart LR']
  for (const s of args.seats) {
    lines.push(`  ${idOf(s)}("${mLabel(args.seatLabels[s] ?? s, 8)}")`)
  }

  for (const e of ranked) {
    const a = idOf(e.from)
    const b = idOf(e.to)
    const lab = mLabel(`${relLabel(args.lang, e.relation)}${e.summary ? ': ' + e.summary : ''}`, 22)
    if (e.relation === 'rebut') lines.push(`  ${a} -->|"${lab}"| ${b}`)
    else if (e.relation === 'support') lines.push(`  ${a} ==>|"${lab}"| ${b}`)
    else lines.push(`  ${a} -.->|"${lab}"| ${b}`)
  }

  const cap =
    args.edges.length > ranked.length
      ? args.lang === 'zh-CN' || args.lang === 'zh-TW'
        ? `展示 ${ranked.length}/${args.edges.length} 条（优先反驳）`
        : `${ranked.length}/${args.edges.length} edges (rebuttals first)`
      : undefined

  return mermaidWrap(lines.join('\n'), cap)
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

/** Compact visible rebuttal list (not buried). */
export function edgeStorylineHtml(args: {
  lang: RoundtableLang
  edges: RoundtableEdgeResult[]
  seatLabels: Record<string, string>
  max?: number
  linkRoles?: boolean
  fileLink?: (href: string, label: string) => string
  personaFile?: (id: string) => string
}): string {
  const max = args.max ?? 10
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
            ? `关键交锋 ${ranked.length}/${args.edges.length}（完整列表在「交锋明细」）`
            : `Key ${ranked.length}/${args.edges.length} (full list below)`,
        )}</p>`
      : ''
  }`
}

/**
 * Boot mermaid after load. Uses CDN; if offline, leaves source visible in .mermaid pre.
 * Must run after mermaid.min.js is loaded.
 */
export const ROUNDTABLE_MERMAID_BOOT_SCRIPT = /* js */ `
(function () {
  function theme() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'default';
    } catch (e) {
      return 'dark';
    }
  }
  function run() {
    if (!window.mermaid) {
      document.querySelectorAll('.mermaid-wrap').forEach(function (w) {
        w.classList.add('mermaid-offline');
      });
      return;
    }
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        theme: theme(),
        securityLevel: 'strict',
        flowchart: { curve: 'basis', htmlLabels: false },
      });
      window.mermaid.run({ querySelector: '.mermaid' });
    } catch (err) {
      console.warn('mermaid render failed', err);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
`.trim()

/** CDN script tag for mermaid (browser + srcDoc with allow-scripts + network). */
export const ROUNDTABLE_MERMAID_CDN =
  'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js'
