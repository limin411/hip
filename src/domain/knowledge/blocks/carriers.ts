/**
 * Pure Markdown carriers for hip dialect blocks.
 * Used by dialectBridge pre/post and unit goldens — no React / BlockNote.
 */

import { CALLOUT_TYPES, type CalloutType } from '../callout'

const CALLOUT_TYPE_SET = new Set<string>(CALLOUT_TYPES)

export type CalloutCarrier = {
  type: CalloutType
  title: string
  body: string
}

export type MathCarrier = { src: string }
export type MermaidCarrier = { src: string }
export type SvgCarrier = { src: string }
export type EmbedCarrier = { title: string; fragment: string }
export type WikiCarrier = { title: string; alias: string }
export type ToggleCarrier = { summary: string; body: string }
export type ImageCaptionParts = {
  alt: string
  url: string
  caption: string
  /** Optional preview width in px (BN); not in MD unless post-meta. */
  previewWidth?: number | null
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function unescapeHtmlAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// ─── Callout ────────────────────────────────────────────────────────────────

export function serializeCallout(c: CalloutCarrier): string {
  const type = CALLOUT_TYPE_SET.has(c.type) ? c.type : 'note'
  const head = c.title.trim() ? `> [!${type}] ${c.title.trim()}` : `> [!${type}]`
  const body = c.body.replace(/\r\n/g, '\n').replace(/\n$/, '')
  if (!body.trim()) return `${head}\n`
  const lines = body.split('\n').map((line) => (line.length ? `> ${line}` : '>'))
  return `${head}\n${lines.join('\n')}\n`
}

export function parseCalloutMd(md: string): CalloutCarrier | null {
  const text = md.replace(/\r\n/g, '\n').trimEnd()
  const lines = text.split('\n')
  if (!lines.length) return null
  const first = lines[0]!.replace(/^>\s?/, '').trim()
  const m = first.match(/^\[!([A-Za-z]+)\]\s*(.*)$/)
  if (!m) return null
  const t = m[1]!.toLowerCase()
  if (!CALLOUT_TYPE_SET.has(t)) return null
  const title = (m[2] ?? '').trim()
  const bodyLines: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.startsWith('>')) {
      // allow trailing blank after block
      if (!line.trim()) continue
      break
    }
    bodyLines.push(line.replace(/^>\s?/, ''))
  }
  return {
    type: t as CalloutType,
    title,
    body: bodyLines.join('\n'),
  }
}

export function calloutToHtmlCarrier(c: CalloutCarrier): string {
  const type = CALLOUT_TYPE_SET.has(c.type) ? c.type : 'note'
  return `<div data-hip-block="callout" data-type="${escapeHtmlAttr(type)}" data-title="${escapeHtmlAttr(c.title)}">${escapeHtmlAttr(c.body)}</div>`
}

export function parseCalloutHtmlEl(el: HTMLElement): CalloutCarrier | null {
  if (el.getAttribute('data-hip-block') !== 'callout') return null
  const typeRaw = (el.getAttribute('data-type') ?? 'note').toLowerCase()
  const type = (CALLOUT_TYPE_SET.has(typeRaw) ? typeRaw : 'note') as CalloutType
  return {
    type,
    title: el.getAttribute('data-title') ?? '',
    body: el.textContent ?? '',
  }
}

// ─── Math ───────────────────────────────────────────────────────────────────

export function serializeMath(c: MathCarrier): string {
  const src = c.src.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
  return `$$\n${src}\n$$\n`
}

export function parseMathMd(md: string): MathCarrier | null {
  const m = md.replace(/\r\n/g, '\n').match(/^\$\$\n?([\s\S]*?)\n?\$\$\s*$/)
  if (!m) return null
  return { src: m[1]!.replace(/^\n+|\n+$/g, '') }
}

export function mathToHtmlCarrier(c: MathCarrier): string {
  return `<div data-hip-block="math">${escapeHtmlAttr(c.src)}</div>`
}

// ─── Mermaid / SVG fences ───────────────────────────────────────────────────

export function serializeMermaid(c: MermaidCarrier): string {
  const src = c.src.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
  return `\`\`\`mermaid\n${src}\n\`\`\`\n`
}

export function serializeSvg(c: SvgCarrier): string {
  const src = c.src.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
  return `\`\`\`svg\n${src}\n\`\`\`\n`
}

export function parseFenceMd(
  md: string,
  lang: 'mermaid' | 'svg',
): { src: string } | null {
  const re = new RegExp(
    `^\`\`\`${lang}\\s*\\n([\\s\\S]*?)\\n?\`\`\`\\s*$`,
    'i',
  )
  const m = md.replace(/\r\n/g, '\n').match(re)
  if (!m) return null
  return { src: m[1]!.replace(/\n$/, '') }
}

export function mermaidToHtmlCarrier(c: MermaidCarrier): string {
  return `<div data-hip-block="mermaid">${escapeHtmlAttr(c.src)}</div>`
}

export function svgToHtmlCarrier(c: SvgCarrier): string {
  return `<div data-hip-block="svg">${escapeHtmlAttr(c.src)}</div>`
}

// ─── Embed ──────────────────────────────────────────────────────────────────

export function serializeEmbed(c: EmbedCarrier): string {
  const title = c.title.trim()
  const frag = c.fragment.trim()
  if (frag) return `![[${title}#${frag}]]\n`
  return `![[${title}]]\n`
}

export function parseEmbedMd(md: string): EmbedCarrier | null {
  return parseEmbedToken(md.replace(/\r\n/g, '\n').trim())
}

export function parseEmbedToken(raw: string): EmbedCarrier | null {
  const m = raw.trim().match(/^!\[\[([^\]|#]+)(?:#([^\]]+))?\]\]$/)
  if (!m) return null
  return { title: m[1]!.trim(), fragment: (m[2] ?? '').trim() }
}

export function embedToHtmlCarrier(c: EmbedCarrier): string {
  return `<div data-hip-block="embed" data-title="${escapeHtmlAttr(c.title)}" data-fragment="${escapeHtmlAttr(c.fragment)}"></div>`
}

// ─── Wiki ───────────────────────────────────────────────────────────────────

export function serializeWiki(c: WikiCarrier): string {
  const title = c.title.trim()
  const alias = c.alias.trim()
  if (alias) return `[[${title}|${alias}]]`
  return `[[${title}]]`
}

export function parseWikiToken(raw: string): WikiCarrier | null {
  const m = raw.trim().match(/^\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]$/)
  if (!m) return null
  return { title: m[1]!.trim(), alias: (m[2] ?? '').trim() }
}

export function wikiToHtmlCarrier(c: WikiCarrier): string {
  const display = c.alias.trim() || c.title.trim()
  return `<span data-hip-inline="wiki" data-title="${escapeHtmlAttr(c.title)}" data-alias="${escapeHtmlAttr(c.alias)}">${escapeHtmlAttr(display)}</span>`
}

// ─── Toggle ─────────────────────────────────────────────────────────────────

export function serializeToggle(c: ToggleCarrier): string {
  const summary = c.summary.trim() || 'Details'
  const body = c.body.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>\n`
}

export function parseToggleMd(md: string): ToggleCarrier | null {
  const m = md
    .replace(/\r\n/g, '\n')
    .match(/^<details>\s*<summary>([\s\S]*?)<\/summary>\s*([\s\S]*?)\s*<\/details>\s*$/i)
  if (!m) return null
  return {
    summary: m[1]!.trim(),
    body: m[2]!.replace(/^\n+|\n+$/g, ''),
  }
}

export function toggleToHtmlCarrier(c: ToggleCarrier): string {
  return `<div data-hip-block="toggle" data-summary="${escapeHtmlAttr(c.summary)}">${escapeHtmlAttr(c.body)}</div>`
}

// ─── Highlight ──────────────────────────────────────────────────────────────

export function serializeHighlight(text: string): string {
  return `==${text}==`
}

/** Convert ==highlight== runs to <mark data-hip-mark="highlight">. */
export function highlightMdToHtml(md: string): string {
  return md.replace(/==([^=\n]+)==/g, (_full, inner: string) => {
    return `<mark data-hip-mark="highlight">${escapeHtmlAttr(inner)}</mark>`
  })
}

export function highlightHtmlToMd(md: string): string {
  return md.replace(
    /<mark\b[^>]*data-hip-mark=["']highlight["'][^>]*>([\s\S]*?)<\/mark>/gi,
    (_full, inner: string) => `==${stripTags(inner)}==`,
  )
}

// ─── Image caption ──────────────────────────────────────────────────────────

export function serializeImage(parts: ImageCaptionParts): string {
  const alt = parts.alt
  const url = parts.url
  const cap = parts.caption.trim()
  if (cap) {
    const esc = cap.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `![${alt}](${url} "${esc}")`
  }
  return `![${alt}](${url})`
}

export function parseImageMd(md: string): ImageCaptionParts | null {
  const m = md
    .trim()
    .match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/)
  if (!m) return null
  return {
    alt: m[1] ?? '',
    url: m[2] ?? '',
    caption: m[3] ?? '',
  }
}

// ─── HTML carrier → dialect ─────────────────────────────────────────────────

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

/**
 * Rewrite data-hip-* HTML carriers (from BN external HTML) back to MD dialect.
 */
export function htmlCarriersToDialect(md: string): string {
  let out = md.replace(/\r\n/g, '\n')

  // Callout divs
  out = out.replace(
    /<div\b[^>]*data-hip-block=["']callout["'][^>]*>([\s\S]*?)<\/div>/gi,
    (full, bodyHtml: string) => {
      const typeM = full.match(/data-type=["']([^"']*)["']/i)
      const titleM = full.match(/data-title=["']([^"']*)["']/i)
      const type = unescapeHtmlAttr(typeM?.[1] ?? 'note') as CalloutType
      const title = unescapeHtmlAttr(titleM?.[1] ?? '')
      const body = stripTags(bodyHtml)
      return serializeCallout({ type, title, body }).replace(/\n$/, '')
    },
  )

  out = out.replace(
    /<div\b[^>]*data-hip-block=["']math["'][^>]*>([\s\S]*?)<\/div>/gi,
    (_full, bodyHtml: string) =>
      serializeMath({ src: stripTags(bodyHtml) }).replace(/\n$/, ''),
  )

  out = out.replace(
    /<div\b[^>]*data-hip-block=["']mermaid["'][^>]*>([\s\S]*?)<\/div>/gi,
    (_full, bodyHtml: string) =>
      serializeMermaid({ src: stripTags(bodyHtml) }).replace(/\n$/, ''),
  )

  out = out.replace(
    /<div\b[^>]*data-hip-block=["']svg["'][^>]*>([\s\S]*?)<\/div>/gi,
    (_full, bodyHtml: string) =>
      serializeSvg({ src: stripTags(bodyHtml) }).replace(/\n$/, ''),
  )

  out = out.replace(
    /<div\b[^>]*data-hip-block=["']embed["'][^>]*\/?>/gi,
    (full) => {
      const titleM = full.match(/data-title=["']([^"']*)["']/i)
      const fragM = full.match(/data-fragment=["']([^"']*)["']/i)
      return serializeEmbed({
        title: unescapeHtmlAttr(titleM?.[1] ?? ''),
        fragment: unescapeHtmlAttr(fragM?.[1] ?? ''),
      }).replace(/\n$/, '')
    },
  )

  out = out.replace(
    /<div\b[^>]*data-hip-block=["']toggle["'][^>]*>([\s\S]*?)<\/div>/gi,
    (full, bodyHtml: string) => {
      const sumM = full.match(/data-summary=["']([^"']*)["']/i)
      return serializeToggle({
        summary: unescapeHtmlAttr(sumM?.[1] ?? ''),
        body: stripTags(bodyHtml),
      }).replace(/\n$/, '')
    },
  )

  // Wiki inline spans
  out = out.replace(
    /<span\b[^>]*data-hip-inline=["']wiki["'][^>]*>[\s\S]*?<\/span>/gi,
    (full) => {
      const titleM = full.match(/data-title=["']([^"']*)["']/i)
      const aliasM = full.match(/data-alias=["']([^"']*)["']/i)
      return serializeWiki({
        title: unescapeHtmlAttr(titleM?.[1] ?? ''),
        alias: unescapeHtmlAttr(aliasM?.[1] ?? ''),
      })
    },
  )

  out = highlightHtmlToMd(out)
  return out
}

/**
 * Convert dialect MD constructs into HTML carriers BN can parse into custom blocks.
 */
export function dialectToHtmlCarriers(md: string): string {
  let out = md.replace(/\r\n/g, '\n')

  // Embeds first (before wiki)
  out = out.replace(/!\[\[([^\]|#]+)(?:#([^\]]+))?\]\]/g, (_full, title: string, frag?: string) => {
    return embedToHtmlCarrier({
      title: title.trim(),
      fragment: (frag ?? '').trim(),
    }).replace(/\n$/, '')
  })

  // Wiki links (not already HTML)
  out = out.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_full, title: string, alias?: string) => {
    return wikiToHtmlCarrier({
      title: title.trim(),
      alias: (alias ?? '').trim(),
    })
  })

  // Display math $$...$$
  out = out.replace(/\$\$\n?([\s\S]*?)\n?\$\$/g, (_full, src: string) => {
    return mathToHtmlCarrier({ src: src.replace(/^\n+|\n+$/g, '') })
  })

  // Mermaid / SVG fences
  out = out.replace(
    /```mermaid\s*\n([\s\S]*?)```/gi,
    (_full, src: string) => mermaidToHtmlCarrier({ src: src.replace(/\n$/, '') }),
  )
  out = out.replace(
    /```svg\s*\n([\s\S]*?)```/gi,
    (_full, src: string) => svgToHtmlCarrier({ src: src.replace(/\n$/, '') }),
  )

  // Callout blockquotes: consecutive > lines starting with [!type]
  out = out.replace(/(^|\n)((?:>.*(?:\n|$))+)/g, (full, lead: string, block: string) => {
    const parsed = parseCalloutMd(block)
    if (!parsed) return full
    return `${lead}${calloutToHtmlCarrier(parsed)}`
  })

  // details/summary toggle
  out = out.replace(
    /<details>\s*<summary>([\s\S]*?)<\/summary>\s*([\s\S]*?)\s*<\/details>/gi,
    (_full, summary: string, body: string) =>
      toggleToHtmlCarrier({
        summary: stripTags(summary).trim(),
        body: body.replace(/^\n+|\n+$/g, ''),
      }),
  )

  // Avoid transforming $...$ inside code fences: highlight only outside fences is hard;
  // apply highlight globally except we already replaced fences with divs.
  out = highlightMdToHtml(out)

  return out
}
