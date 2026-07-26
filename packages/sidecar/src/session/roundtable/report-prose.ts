/**
 * Report prose: GFM markdown → HTML via marked (build-time, no client JS).
 * html:false via custom renderer so user/model content cannot inject tags.
 */
import { Marked, type TokenizerAndRendererExtension } from 'marked'
import type { Tokens } from 'marked'

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Strip raw HTML tokens — treat as escaped text. */
const stripHtmlExt: TokenizerAndRendererExtension = {
  name: 'html',
  level: 'block',
  renderer(token) {
    const t = token as Tokens.HTML
    return `<p class="prose-p">${esc(t.text || '')}</p>\n`
  },
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  pedantic: false,
  extensions: [stripHtmlExt],
})

// Escape any residual raw HTML blocks/inlines the default renderer might emit.
marked.use({
  renderer: {
    html({ text }) {
      return esc(text)
    },
    code({ text, lang }) {
      const language = (lang || '').trim()
      const langAttr = language ? ` data-lang="${esc(language)}"` : ''
      const langLabel = language
        ? `<span class="code-lang">${esc(language)}</span>`
        : ''
      return `<div class="code-block"${langAttr}>${langLabel}<pre><code>${esc(text)}</code></pre></div>\n`
    },
    codespan({ text }) {
      return `<code class="inline-code">${esc(text)}</code>`
    },
    link({ href, title, text }) {
      // Only allow relative .html sibling links + http(s); block javascript:
      const h = (href || '').trim()
      if (!h || /^javascript:/i.test(h) || h.startsWith('data:')) {
        return esc(text)
      }
      const t = title ? ` title="${esc(title)}"` : ''
      return `<a href="${esc(h)}"${t}>${text}</a>`
    },
  },
})

/** GFM markdown → safe HTML. */
export function richProseHtml(s: string): string {
  const text = s.replace(/\r\n/g, '\n').trim()
  if (!text) return ''
  try {
    const html = marked.parse(text, { async: false }) as string
    return `<div class="md">${html}</div>`
  } catch {
    return `<div class="md"><p class="prose-p">${esc(text)}</p></div>`
  }
}

/** Inline-only markdown (no block wrappers). */
export function inlineProseHtml(s: string): string {
  const text = s.replace(/\r\n/g, '\n').trim()
  if (!text) return ''
  try {
    return marked.parseInline(text, { async: false }) as string
  } catch {
    return esc(text)
  }
}

export function snip(text: string, n = 140): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  const slice = t.slice(0, n - 1)
  const cut = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('；'),
    slice.lastIndexOf('，'),
    slice.lastIndexOf('. '),
    slice.lastIndexOf('; '),
    slice.lastIndexOf('、'),
  )
  if (cut > n * 0.45) return `${slice.slice(0, cut + 1)}…`
  return `${slice}…`
}

export function shortLabel(text: string, n = 18): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n - 1)}…`
}

export function firstLine(text: string, n = 100): string {
  const cleaned = stripToolNoise(text)
  const line =
    cleaned
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('```') && !/^---+$/.test(l) && l !== '…') ?? cleaned.trim()
  return snip(
    line
      .replace(/^#+\s*/, '')
      .replace(/^\*\*(.+)\*\*$/, '$1')
      .replace(/\*\*/g, ''),
    n,
  )
}

export function stripToolNoise(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n').trim()
  if (!t) return t

  t = t.replace(/\n*<!--hip\.speech_acts-->[\s\S]*$/i, '').trim()

  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t) as { prose?: string; text?: string }
      if (typeof obj.prose === 'string' && obj.prose.trim()) return obj.prose.trim()
      if (typeof obj.text === 'string' && obj.text.trim()) return obj.text.trim()
    } catch {
      // fall through
    }
  }

  const parts = t.split(/\n-{3,}\n/)
  if (parts.length > 1) {
    const last = parts[parts.length - 1]!.trim()
    if (last.length >= 80) t = last
  }

  const paras = t.split(/\n{2,}/)
  const noise =
    /^(I'm hitting|I am hitting|Let me |I'll |I will |搜索接口|让我先|我先暂停|我先核实|我先核查|正在|rate limit|tool |项目目录是空的)/i
  while (paras.length > 1 && noise.test(paras[0]!.trim()) && paras[0]!.length < 420) {
    paras.shift()
  }
  return paras.join('\n\n').trim() || raw.trim()
}

export function pickReportSpeechContent(raw: string, envelopeProse: string): string {
  const cleaned = stripToolNoise(raw)
  const prose = (envelopeProse || '').trim()
  if (cleaned.length >= prose.length * 1.15 || cleaned.length > prose.length + 80) {
    return cleaned
  }
  if (prose && prose !== '…') return stripToolNoise(prose)
  return cleaned || prose || '…'
}

/**
 * Collapsible body: full markdown once.
 * When open by default (or short enough), do NOT also show a plain-text preview —
 * that was duplicating long decision/speech content.
 */
export function collapsibleProse(
  content: string,
  labels: { more: string; less: string },
  threshold = 220,
  opts?: { open?: boolean },
): string {
  const body = stripToolNoise(content)
  const full = richProseHtml(body)
  const plain = body.replace(/\s+/g, ' ').trim()

  if (plain.length <= threshold) {
    return `<div class="prose">${full}</div>`
  }

  // Auto-open moderately long structured content so markdown is immediately visible
  const structured = /^#{1,3}\s|^\*\*.+\*\*|^\s*[-*+]\s|^\s*\d+[.)]/m.test(body)
  const open = opts?.open ?? (structured || plain.length < 900)
  if (open) {
    // Single render — no preview + full body pair
    return `<div class="prose">${full}</div>`
  }

  const preview = esc(firstLine(body, 140))
  return `<div class="prose prose-fold">
  <p class="prose-preview">${preview}</p>
  <details class="fold">
    <summary><span class="more">${esc(labels.more)}</span><span class="less">${esc(labels.less)}</span></summary>
    <div class="fold-body">${full}</div>
  </details>
</div>`
}

/** Drop decision body lines that merely restate the hero verdict. */
export function stripVerdictEcho(decision: string, verdict: string): string {
  const v = (verdict || '').replace(/\s+/g, ' ').trim()
  let d = (decision || '').replace(/\r\n/g, '\n').trim()
  if (!v || !d) return d
  const vNorm = v.toLowerCase()
  // Whole-body echo
  if (d.replace(/\s+/g, ' ').trim().toLowerCase() === vNorm) return ''
  const lines = d.split('\n')
  while (lines.length) {
    const first = lines[0]!.replace(/\s+/g, ' ').trim()
    if (!first) {
      lines.shift()
      continue
    }
    const fNorm = first
      .replace(/^#+\s*/, '')
      .replace(/^\*\*(.+)\*\*$/, '$1')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    if (fNorm === vNorm || vNorm.startsWith(fNorm) || fNorm.startsWith(vNorm.slice(0, Math.min(40, vNorm.length)))) {
      lines.shift()
      continue
    }
    break
  }
  return lines.join('\n').trim()
}

export interface DecisionPart {
  title: string
  body: string
}

export function splitDecisionParts(decision: string): DecisionPart[] {
  const t = decision.replace(/\r\n/g, '\n').trim()
  if (!t) return []

  // Prefer 【决定…】 / ## 决定 / 决定N｜ forms; avoid over-splitting prose.
  const r2 =
    /(?=【\s*决定[^】]*】)|(?=#{1,3}\s*决定)|(?=\*\*决定[^*]*\*\*)|(?=决定\s*[1-9１-９][\s:：.|｜\-—])/g
  const idxs: number[] = []
  let m: RegExpExecArray | null
  while ((m = r2.exec(t)) !== null) {
    if (m.index > 0) idxs.push(m.index)
    if (r2.lastIndex === m.index) r2.lastIndex = m.index + 1
  }

  if (idxs.length === 0) {
    return [{ title: '', body: t }]
  }

  const cuts = [0, ...idxs, t.length]
  const parts: DecisionPart[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const slice = t.slice(cuts[i], cuts[i + 1]).trim()
    if (!slice) continue
    const fl = slice.split('\n')[0]!.trim()
    const titleMatch =
      fl.match(/^【\s*([^】]+)】/) ||
      fl.match(/^\*\*(.+?)\*\*/) ||
      fl.match(/^(#{1,3}\s*.+)$/) ||
      fl.match(/^(决定\s*[1-9１-９][^\n]{0,80})/)
    if (titleMatch) {
      const title = titleMatch[1]!.replace(/^#+\s*/, '').trim()
      const body = slice.slice(fl.length).trim()
      // Title in h3; body is remainder only (never re-include the heading line alone)
      parts.push({ title, body })
    } else if (slice.replace(/\s+/g, ' ').trim().length > 20) {
      // Lead-in before first titled decision
      parts.push({ title: '', body: slice })
    }
  }
  return parts.length ? parts : [{ title: '', body: t }]
}

export function decisionHtml(
  decision: string,
  labels: { more: string; less: string },
  opts?: { verdict?: string },
): string {
  const cleaned = opts?.verdict ? stripVerdictEcho(decision, opts.verdict) : decision
  if (!cleaned.trim()) return ''

  const parts = splitDecisionParts(cleaned)
  if (parts.length <= 1) {
    const body = parts[0]?.body || cleaned
    return `<div class="prose decision-body">${richProseHtml(body)}</div>`
  }

  return `<div class="decision-cards">
  ${parts
    .map((p) => {
      if (!p.title && !p.body.trim()) return ''
      const bodyHtml = p.body.trim()
        ? collapsibleProse(p.body, labels, 280, { open: true })
        : ''
      if (!p.title) {
        return `<article class="decision-card">${bodyHtml}</article>`
      }
      return `<article class="decision-card">
    <h3 class="decision-card-title">${esc(p.title)}</h3>
    ${bodyHtml}
  </article>`
    })
    .filter(Boolean)
    .join('\n')}
</div>`
}
