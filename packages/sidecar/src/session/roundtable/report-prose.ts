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
 * Collapsible body: always render full markdown in fold.
 * Preview is plain first line (not raw ** markers).
 * Medium content opens by default so markdown is immediately visible.
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

  // Auto-open moderately long structured content so markdown isn't "hidden"
  const structured = /^#{1,3}\s|^\*\*.+\*\*|^\s*[-*+]\s|^\s*\d+[.)]/m.test(body)
  const open = opts?.open ?? (structured || plain.length < 900)
  const openAttr = open ? ' open' : ''
  const preview = esc(firstLine(body, 140))

  return `<div class="prose prose-fold">
  <p class="prose-preview">${preview}</p>
  <details class="fold"${openAttr}>
    <summary><span class="more">${esc(labels.more)}</span><span class="less">${esc(labels.less)}</span></summary>
    <div class="fold-body">${full}</div>
  </details>
</div>`
}

export interface DecisionPart {
  title: string
  body: string
}

export function splitDecisionParts(decision: string): DecisionPart[] {
  const t = decision.replace(/\r\n/g, '\n').trim()
  if (!t) return []

  const r2 =
    /(?=【决定[^】]*】)|(?=#{1,3}\s*决定)|(?=\*\*决定[^*]*\*\*)|(?=决定\s*[1-9１-９][\s:：.|｜])/g
  const idxs: number[] = []
  let m: RegExpExecArray | null
  while ((m = r2.exec(t)) !== null) {
    if (m.index > 0) idxs.push(m.index)
    if (r2.lastIndex === m.index) r2.lastIndex = m.index + 1
  }

  if (idxs.length === 0) {
    // Prefer single rich markdown body — don't over-split
    return [{ title: '', body: t }]
  }

  const cuts = [0, ...idxs, t.length]
  const parts: DecisionPart[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const slice = t.slice(cuts[i], cuts[i + 1]).trim()
    if (!slice) continue
    const fl = slice.split('\n')[0]!.trim()
    const titleMatch =
      fl.match(/^【([^】]+)】/) || fl.match(/^\*\*(.+?)\*\*/) || fl.match(/^(#{1,3}\s*.+)$/)
    if (titleMatch) {
      const title = titleMatch[1]!.replace(/^#+\s*/, '').trim()
      const body = slice.slice(fl.length).trim()
      parts.push({ title, body: body || slice })
    } else {
      parts.push({ title: '', body: slice })
    }
  }
  return parts.length ? parts : [{ title: '', body: t }]
}

export function decisionHtml(
  decision: string,
  labels: { more: string; less: string },
): string {
  const parts = splitDecisionParts(decision)
  if (parts.length <= 1) {
    return `<div class="prose decision-body">${richProseHtml(decision)}</div>`
  }

  return `<div class="decision-cards">
  ${parts
    .map((p, i) => {
      const title = p.title || String(i + 1)
      const body = p.body
      const short = body.replace(/\s+/g, ' ').length < 400
      const inner = short
        ? `<div class="prose">${richProseHtml(body)}</div>`
        : collapsibleProse(body, labels, 280, { open: true })
      return `<article class="decision-card">
    <h3 class="decision-card-title">${esc(title)}</h3>
    ${inner}
  </article>`
    })
    .join('\n')}
</div>`
}
