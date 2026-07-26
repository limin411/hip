/**
 * Lightweight markdown → HTML for roundtable reports.
 * Supports: fenced code, inline code, **bold**, *italic*, headings, lists, hr, paragraphs.
 * Also: clean advisor raw output; structured decision cards.
 */

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Inline: `code`, **bold**, *italic*. */
export function inlineProseHtml(s: string): string {
  return applyInline(s)
}

function applyInline(s: string): string {
  type Seg = { kind: 'text' | 'code' | 'bold' | 'em'; v: string }
  const segs: Seg[] = []
  const re = /(`([^`\n]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) segs.push({ kind: 'text', v: s.slice(last, m.index) })
    if (m[2] != null) segs.push({ kind: 'code', v: m[2] })
    else if (m[3] != null) segs.push({ kind: 'bold', v: m[3] })
    else if (m[4] != null) segs.push({ kind: 'em', v: m[4] })
    last = m.index + m[0].length
  }
  if (last < s.length) segs.push({ kind: 'text', v: s.slice(last) })

  return segs
    .map((seg) => {
      if (seg.kind === 'code') return `<code class="inline-code">${esc(seg.v)}</code>`
      if (seg.kind === 'bold') return `<strong>${esc(seg.v)}</strong>`
      if (seg.kind === 'em') return `<em>${esc(seg.v)}</em>`
      return esc(seg.v).replace(/\n/g, '<br/>')
    })
    .join('')
}

/** Render text with fenced code + markdown-lite blocks. */
export function richProseHtml(s: string): string {
  const text = s.replace(/\r\n/g, '\n')
  if (!text.trim()) return ''

  const fenceRe = /```([A-Za-z0-9_+#.-]*)\n?([\s\S]*?)```/g
  const chunks: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > last) {
      chunks.push(blocksHtml(text.slice(last, m.index)))
    }
    const lang = (m[1] || '').trim()
    const code = (m[2] ?? '').replace(/\n$/, '')
    const langAttr = lang ? ` data-lang="${esc(lang)}"` : ''
    const langLabel = lang ? `<span class="code-lang">${esc(lang)}</span>` : ''
    chunks.push(
      `<div class="code-block"${langAttr}>${langLabel}<pre><code>${esc(code)}</code></pre></div>`,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) {
    chunks.push(blocksHtml(text.slice(last)))
  }
  return chunks.join('\n')
}

function blocksHtml(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      i++
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push('<hr class="prose-hr"/>')
      i++
      continue
    }

    const hm = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (hm) {
      const level = hm[1]!.length
      const tag = level <= 2 ? 'h3' : 'h4'
      out.push(`<${tag} class="prose-h">${applyInline(hm[2]!)}</${tag}>`)
      i++
      continue
    }

    const titleBold = trimmed.match(/^\*\*(.+)\*\*$/)
    if (titleBold && titleBold[1]!.length < 80) {
      out.push(`<h3 class="prose-h">${applyInline(titleBold[1]!)}</h3>`)
      i++
      continue
    }
    if (/^【[^】]{1,60}】/.test(trimmed) && trimmed.length < 120) {
      out.push(`<h3 class="prose-h">${applyInline(trimmed)}</h3>`)
      i++
      continue
    }
    // Chinese section labels only (not "1. item" — those are ordered lists)
    if (
      /^[一二三四五六七八九十]+、\S/.test(trimmed) &&
      trimmed.length < 56 &&
      !/[。！？]/.test(trimmed.slice(-1))
    ) {
      out.push(`<h4 class="prose-h">${applyInline(trimmed)}</h4>`)
      i++
      continue
    }

    if (/^[-*+]\s+\S/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length) {
        const t = (lines[i] ?? '').trim()
        if (/^[-*+]\s+\S/.test(t)) {
          items.push(`<li>${applyInline(t.replace(/^[-*+]\s+/, ''))}</li>`)
          i++
          continue
        }
        if (/^\s{2,}\S/.test(lines[i] ?? '') && items.length) {
          const prev = items.pop()!
          items.push(prev.replace(/<\/li>$/, `<br/>${applyInline(t)}</li>`))
          i++
          continue
        }
        break
      }
      out.push(`<ul class="prose-ul">${items.join('')}</ul>`)
      continue
    }

    if (/^\d+[.)、]\s+\S/.test(trimmed) || /^\([ivxIVX\d]+\)\s+\S/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length) {
        const t = (lines[i] ?? '').trim()
        if (/^\d+[.)、]\s+\S/.test(t)) {
          items.push(`<li>${applyInline(t.replace(/^\d+[.)、]\s+/, ''))}</li>`)
          i++
          continue
        }
        if (/^\([ivxIVX\d]+\)\s+\S/.test(t)) {
          items.push(`<li>${applyInline(t.replace(/^\([ivxIVX\d]+\)\s+/, ''))}</li>`)
          i++
          continue
        }
        break
      }
      out.push(`<ol class="prose-ol">${items.join('')}</ol>`)
      continue
    }

    const buf: string[] = [line]
    i++
    while (i < lines.length) {
      const n = lines[i] ?? ''
      const nt = n.trim()
      if (!nt) break
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(nt)) break
      if (/^#{1,3}\s+/.test(nt)) break
      if (/^[-*+]\s+\S/.test(nt)) break
      if (/^\d+[.)、]\s+\S/.test(nt)) break
      if (/^\*\*.+\*\*$/.test(nt) && nt.length < 80) break
      if (/^【[^】]+】/.test(nt) && nt.length < 120) break
      buf.push(n)
      i++
    }
    const t = buf.join('\n').trim()
    if (t) out.push(`<p class="prose-p">${applyInline(t)}</p>`)
  }

  return out.join('\n')
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
  return snip(line.replace(/^#+\s*/, '').replace(/^\*\*(.+)\*\*$/, '$1'), n)
}

/** Strip tool chatter / envelope tails from managed-agent advisor output. */
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
  t = paras.join('\n\n').trim()

  return t.trim() || raw.trim()
}

/** Prefer cleaned full raw when richer than short envelope.prose. */
export function pickReportSpeechContent(raw: string, envelopeProse: string): string {
  const cleaned = stripToolNoise(raw)
  const prose = (envelopeProse || '').trim()
  if (cleaned.length >= prose.length * 1.15 || cleaned.length > prose.length + 80) {
    return cleaned
  }
  if (prose && prose !== '…') return stripToolNoise(prose)
  return cleaned || prose || '…'
}

export function collapsibleProse(
  content: string,
  labels: { more: string; less: string },
  threshold = 280,
  opts?: { open?: boolean },
): string {
  const body = stripToolNoise(content)
  const full = richProseHtml(body)
  const plain = body.replace(/\s+/g, ' ').trim()

  if (plain.length <= threshold && !/```/.test(body)) {
    return `<div class="prose">${full}</div>`
  }

  const preview = esc(firstLine(body, 140))
  const openAttr = opts?.open ? ' open' : ''
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

  // Zero-width lookaheads: advance lastIndex manually to avoid infinite loops.
  const r2 =
    /(?=【决定[^】]*】)|(?=#{1,3}\s*决定)|(?=\*\*决定[^*]*\*\*)|(?=决定\s*[1-9１-９][\s:：.|｜])/g
  const idxs: number[] = []
  let m: RegExpExecArray | null
  while ((m = r2.exec(t)) !== null) {
    if (m.index > 0) idxs.push(m.index)
    if (r2.lastIndex === m.index) r2.lastIndex = m.index + 1
  }

  if (idxs.length === 0) {
    if (t.length > 600 && t.includes('\n\n')) {
      const chunks = t.split(/\n{2,}/).filter((c) => c.trim())
      if (chunks.length >= 2 && chunks.length <= 8) {
        return chunks.map((c, i) => ({
          title: String(i + 1),
          body: c.trim(),
        }))
      }
    }
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
  if (parts.length <= 1 && (parts[0]?.body.length ?? 0) < 360) {
    return `<div class="prose decision-body">${richProseHtml(decision)}</div>`
  }

  return `<div class="decision-cards">
  ${parts
    .map((p, i) => {
      const title = p.title || String(i + 1)
      const body = p.body
      const short = body.replace(/\s+/g, ' ').length < 320
      const inner = short
        ? `<div class="prose">${richProseHtml(body)}</div>`
        : collapsibleProse(body, labels, 240)
      return `<article class="decision-card">
    <h3 class="decision-card-title">${esc(title)}</h3>
    ${inner}
  </article>`
    })
    .join('\n')}
</div>`
}
