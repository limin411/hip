/**
 * Lightweight prose → HTML for roundtable reports.
 * Supports fenced code blocks, inline code, soft paragraphs — no full markdown engine.
 */

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Inline: escape + `code` spans + newlines as <br/>. */
export function inlineProseHtml(s: string): string {
  const parts: string[] = []
  const re = /`([^`\n]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      parts.push(esc(s.slice(last, m.index)).replace(/\n/g, '<br/>'))
    }
    parts.push(`<code class="inline-code">${esc(m[1]!)}</code>`)
    last = m.index + m[0].length
  }
  if (last < s.length) {
    parts.push(esc(s.slice(last)).replace(/\n/g, '<br/>'))
  }
  return parts.join('')
}

/**
 * Render advisor/issue text with fenced ``` blocks and inline code.
 * Keeps output self-contained (no external highlighters).
 */
export function richProseHtml(s: string): string {
  const text = s.replace(/\r\n/g, '\n')
  if (!text.trim()) return ''

  const fenceRe = /```([A-Za-z0-9_+#.-]*)\n?([\s\S]*?)```/g
  const chunks: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > last) {
      chunks.push(wrapParagraphs(text.slice(last, m.index)))
    }
    const lang = (m[1] || '').trim()
    const code = (m[2] ?? '').replace(/\n$/, '')
    const langAttr = lang ? ` data-lang="${esc(lang)}"` : ''
    const langLabel = lang
      ? `<span class="code-lang">${esc(lang)}</span>`
      : ''
    chunks.push(
      `<div class="code-block"${langAttr}>${langLabel}<pre><code>${esc(code)}</code></pre></div>`,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) {
    chunks.push(wrapParagraphs(text.slice(last)))
  }
  return chunks.join('\n')
}

function wrapParagraphs(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  // Split on blank lines into paragraphs; single newlines stay as <br/>
  return t
    .split(/\n{2,}/)
    .map((p) => `<p class="prose-p">${inlineProseHtml(p.trim())}</p>`)
    .join('\n')
}

export function snip(text: string, n = 140): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, n - 1)}…`
}

/** First non-empty line / sentence for card previews. */
export function firstLine(text: string, n = 100): string {
  const line =
    text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('```')) ?? text.trim()
  return snip(line.replace(/^#+\s*/, ''), n)
}

/**
 * Collapsible speech body: short preview always visible; full rich prose in <details>.
 * Short texts skip the fold.
 */
export function collapsibleProse(
  content: string,
  labels: { more: string; less: string },
  threshold = 220,
): string {
  const full = richProseHtml(content)
  const plain = content.replace(/\s+/g, ' ').trim()
  if (plain.length <= threshold && !/```/.test(content)) {
    return `<div class="prose">${full}</div>`
  }
  const preview = esc(firstLine(content, 160))
  return `<div class="prose prose-fold">
  <p class="prose-preview">${preview}</p>
  <details class="fold">
    <summary><span class="more">${esc(labels.more)}</span><span class="less">${esc(labels.less)}</span></summary>
    <div class="fold-body">${full}</div>
  </details>
</div>`
}
