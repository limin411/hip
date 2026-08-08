/**
 * Pure Markdown carriers for hip dialect blocks.
 * Used by dialectBridge pre/post and unit goldens — no React / BlockNote.
 */

import { CALLOUT_TYPES, type CalloutType } from '../callout'
import {
  COLUMNS_GUARD_PROBE,
  COLUMNS_MAX,
  COLUMNS_MIN,
  extractColumnsGuard,
  joinColumnsGuard,
  jsonToColumns,
} from './columns'

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
  // Body in data-body: BN HTML whitespace normalize collapses text-node newlines.
  return `<div data-hip-block="callout" data-type="${escapeHtmlAttr(type)}" data-title="${escapeHtmlAttr(c.title)}" data-body="${escapeHtmlAttr(c.body)}"></div>`
}

export function parseCalloutHtmlEl(el: HTMLElement): CalloutCarrier | null {
  if (el.getAttribute('data-hip-block') !== 'callout') return null
  const typeRaw = (el.getAttribute('data-type') ?? 'note').toLowerCase()
  const type = (CALLOUT_TYPE_SET.has(typeRaw) ? typeRaw : 'note') as CalloutType
  return {
    type,
    title: el.getAttribute('data-title') ?? '',
    body: el.getAttribute('data-body') ?? el.textContent ?? '',
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
  // data-src keeps multi-line LaTeX through BN whitespace normalize.
  return `<div data-hip-block="math" data-src="${escapeHtmlAttr(c.src)}"></div>`
}

// ─── Inline math ──────────────────────────────────────────────────────────────

/**
 * Convert inline `$...$` runs to `<span data-hip-inline="math">` carriers.
 * Heuristics (avoid currency / display-math false positives):
 * - opening `$` preceded by start, whitespace or non-word (not `\` escape, not word char)
 * - src does not start/end with whitespace and contains no `$` / newline
 * - closing `$` followed by end, whitespace or punctuation (not digit — "$5 and $10" stays text)
 */
export function inlineMathMdToHtml(md: string): string {
  return md.replace(
    /(^|[^\\$\w])[$]([^\s$][^$\n]*?)[$](?=$|[\s.,;:!?)\]}>-])/g,
    (_full, lead: string, src: string) => {
      const clean = src.trim()
      if (!clean) return _full
      return `${lead}<span data-hip-inline="math">${escapeHtmlAttr(clean)}</span>`
    },
  )
}

/** Convert `<span data-hip-inline="math">…</span>` back to inline `$…$`. */
export function htmlInlineMathToMd(md: string): string {
  return md.replace(
    /<span\b[^>]*data-hip-inline=["']math["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_full, inner: string) => `$${stripTags(inner).trim()}$`,
  )
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
  // data-src is required: BN preprocessHTMLWhitespace collapses div text newlines,
  // which breaks mermaid diagrams (and would corrupt SVG).
  return `<div data-hip-block="mermaid" data-src="${escapeHtmlAttr(c.src)}"></div>`
}

export function svgToHtmlCarrier(c: SvgCarrier): string {
  return `<div data-hip-block="svg" data-src="${escapeHtmlAttr(c.src)}"></div>`
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
  return `<div data-hip-block="toggle" data-summary="${escapeHtmlAttr(c.summary)}" data-body="${escapeHtmlAttr(c.body)}"></div>`
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

// ─── Color carriers ───────────────────────────────────────────────────────────

/**
 * Convert hip color spans (`data-hip-color` / `data-hip-bg-color`) in Source
 * Markdown to BN-parseable style spans (`data-text-color` / `data-background-color`,
 * BlockNote default textColor/backgroundColor styles).
 */
export function colorSpanMdToHtml(md: string): string {
  let out = md
  out = out.replace(
    /<span\b[^>]*data-hip-color=["']([^"']*)["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_full, color: string, inner: string) =>
      `<span data-text-color="${escapeHtmlAttr(color)}">${inner}</span>`,
  )
  out = out.replace(
    /<span\b[^>]*data-hip-bg-color=["']([^"']*)["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_full, color: string, inner: string) =>
      `<span data-background-color="${escapeHtmlAttr(color)}">${inner}</span>`,
  )
  return out
}

/** Reverse: BN style spans back to hip carriers. */
export function colorSpanHtmlToMd(md: string): string {
  let out = md
  // Live import path (our carriers → BN parse attrs)
  out = out.replace(
    /<span\b[^>]*data-text-color=["']([^"']*)["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_full, color: string, inner: string) =>
      `<span data-hip-color="${escapeHtmlAttr(color)}">${inner}</span>`,
  )
  out = out.replace(
    /<span\b[^>]*data-background-color=["']([^"']*)["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_full, color: string, inner: string) =>
      `<span data-hip-bg-color="${escapeHtmlAttr(color)}">${inner}</span>`,
  )
  // Live export path (BN external HTML uses data-style-type + data-value)
  out = out.replace(
    /<span\b[^>]*data-style-type=["']textColor["'][^>]*data-value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_full, color: string, inner: string) =>
      `<span data-hip-color="${escapeHtmlAttr(color)}">${inner}</span>`,
  )
  out = out.replace(
    /<span\b[^>]*data-value=["']([^"']*)["'][^>]*data-style-type=["']textColor["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_full, color: string, inner: string) =>
      `<span data-hip-color="${escapeHtmlAttr(color)}">${inner}</span>`,
  )
  out = out.replace(
    /<span\b[^>]*data-style-type=["']backgroundColor["'][^>]*data-value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_full, color: string, inner: string) =>
      `<span data-hip-bg-color="${escapeHtmlAttr(color)}">${inner}</span>`,
  )
  out = out.replace(
    /<span\b[^>]*data-value=["']([^"']*)["'][^>]*data-style-type=["']backgroundColor["'][^>]*>([\s\S]*?)<\/span>/gi,
    (_full, color: string, inner: string) =>
      `<span data-hip-bg-color="${escapeHtmlAttr(color)}">${inner}</span>`,
  )
  return out
}

/**
 * Reader-safe: strip hip color span tags, keep inner text.
 * The Reader pipeline intentionally has no rehypeRaw (raw-HTML policy); Live is
 * the color surface. Content is preserved — only the color cue is dropped.
 */
export function stripColorSpansForReader(md: string): string {
  return md
    .replace(
      /<span\b[^>]*data-hip-color=["'][^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
      (_full, inner: string) => stripTags(inner),
    )
    .replace(
      /<span\b[^>]*data-hip-bg-color=["'][^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
      (_full, inner: string) => stripTags(inner),
    )
}

// ─── Attachment (file/PDF card) ───────────────────────────────────────────────

/** Non-image extensions stay image-syntax `![name](path)` → attach card. */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i
const ATTACH_SRC_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/

export function serializeAttachment(c: { name: string; path: string }): string {
  const name = c.name.trim() || 'file'
  const path = c.path.trim()
  if (!path) return ''
  return `![${name}](${path})`
}

export function attachmentToHtmlCarrier(c: {
  name: string
  path: string
}): string {
  return `<div data-hip-block="attach" data-name="${escapeHtmlAttr(c.name)}" data-path="${escapeHtmlAttr(c.path)}"></div>`
}

/**
 * Convert `![alt](relative-non-image-ext)` into an attach div carrier.
 * Real images (image ext) and remote/data URLs are left for BN's image block.
 */
export function attachMdToHtmlCarriers(md: string): string {
  return md.replace(ATTACH_SRC_RE, (full, alt: string, url: string) => {
    if (/^(data:|https?:|blob:)/i.test(url)) return full
    if (IMAGE_EXT_RE.test(url)) return full
    return attachmentToHtmlCarrier({ name: alt.trim(), path: url })
  })
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

  // Columns guard first: the restored guard text exposes inner carriers to the
  // rules below (wiki spans / math / fences inside column md).
  out = out.replace(
    /<div\b[^>]*data-hip-block=["']columns["'][^>]*(?:\/>|>([\s\S]*?)<\/div>)/gi,
    (full, bodyHtml?: string) => {
      const countM = full.match(/data-count=["']([^"']*)["']/i)
      const colsM = full.match(/data-columns=["']([^"']*)["']/i)
      const columns = colsM
        ? jsonToColumns(unescapeHtmlAttr(colsM[1] ?? ''))
        : stripTags(bodyHtml ?? '')
          ? [stripTags(bodyHtml ?? '')]
          : []
      const count = Math.min(
        COLUMNS_MAX,
        Math.max(COLUMNS_MIN, Number(countM?.[1] ?? columns.length) || 2),
      )
      if (columns.length !== count || columns.some((c) => !c.trim())) {
        // 破损 carrier：降级为原样文本，不崩溃。
        return stripTags(full).replace(/\n+$/, '')
      }
      return joinColumnsGuard(count, columns).replace(/\n+$/, '')
    },
  )

  // Callout divs (prefer data-body — text nodes lose newlines under BN normalize)
  out = out.replace(
    /<div\b[^>]*data-hip-block=["']callout["'][^>]*(?:\/>|>([\s\S]*?)<\/div>)/gi,
    (full, bodyHtml?: string) => {
      const typeM = full.match(/data-type=["']([^"']*)["']/i)
      const titleM = full.match(/data-title=["']([^"']*)["']/i)
      const bodyM = full.match(/data-body=["']([^"']*)["']/i)
      const type = unescapeHtmlAttr(typeM?.[1] ?? 'note') as CalloutType
      const title = unescapeHtmlAttr(titleM?.[1] ?? '')
      const body = bodyM ? unescapeHtmlAttr(bodyM[1] ?? '') : stripTags(bodyHtml ?? '')
      return serializeCallout({ type, title, body }).replace(/\n$/, '')
    },
  )

  out = out.replace(
    /<div\b[^>]*data-hip-block=["']math["'][^>]*(?:\/>|>([\s\S]*?)<\/div>)/gi,
    (full, bodyHtml?: string) => {
      const srcM = full.match(/data-src=["']([^"']*)["']/i)
      const src = srcM ? unescapeHtmlAttr(srcM[1] ?? '') : stripTags(bodyHtml ?? '')
      return serializeMath({ src }).replace(/\n$/, '')
    },
  )

  out = out.replace(
    /<div\b[^>]*data-hip-block=["']mermaid["'][^>]*(?:\/>|>([\s\S]*?)<\/div>)/gi,
    (full, bodyHtml?: string) => {
      const srcM = full.match(/data-src=["']([^"']*)["']/i)
      const src = srcM ? unescapeHtmlAttr(srcM[1] ?? '') : stripTags(bodyHtml ?? '')
      return serializeMermaid({ src }).replace(/\n$/, '')
    },
  )

  out = out.replace(
    /<div\b[^>]*data-hip-block=["']svg["'][^>]*(?:\/>|>([\s\S]*?)<\/div>)/gi,
    (full, bodyHtml?: string) => {
      const srcM = full.match(/data-src=["']([^"']*)["']/i)
      const src = srcM ? unescapeHtmlAttr(srcM[1] ?? '') : stripTags(bodyHtml ?? '')
      return serializeSvg({ src }).replace(/\n$/, '')
    },
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
    /<div\b[^>]*data-hip-block=["']toggle["'][^>]*(?:\/>|>([\s\S]*?)<\/div>)/gi,
    (full, bodyHtml?: string) => {
      const sumM = full.match(/data-summary=["']([^"']*)["']/i)
      const bodyM = full.match(/data-body=["']([^"']*)["']/i)
      return serializeToggle({
        summary: unescapeHtmlAttr(sumM?.[1] ?? ''),
        body: bodyM ? unescapeHtmlAttr(bodyM[1] ?? '') : stripTags(bodyHtml ?? ''),
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

  // Inline math spans → literal $…$
  out = htmlInlineMathToMd(out)

  // Attach div carriers → `![name](path)`
  out = out.replace(
    /<div\b[^>]*data-hip-block=["']attach["'][^>]*>?[\s\S]*?<\/div>/gi,
    (full) => {
      const nameM = full.match(/data-name=["']([^"']*)["']/i)
      const pathM = full.match(/data-path=["']([^"']*)["']/i)
      const name = unescapeHtmlAttr(nameM?.[1] ?? '')
      const path = unescapeHtmlAttr(pathM?.[1] ?? '')
      return path ? `![${name}](${path})` : ''
    },
  )

  out = highlightHtmlToMd(out)

  // BN style spans → hip carriers
  out = colorSpanHtmlToMd(out)
  return out
}

/**
 * Convert dialect MD constructs into HTML carriers BN can parse into custom blocks.
 */
const COLUMNS_HOLDER_RE = /%%HIP_COLUMNS_(\d+)%%/g

export function dialectToHtmlCarriers(md: string): string {
  let out = md.replace(/\r\n/g, '\n')

  // Columns guard first: extract the whole guard so inner column md stays RAW
  // (BN re-serialization strips HTML tags from attribute values — carriers
  // inside data-columns would be corrupted). Placeholder keeps inner content
  // safe from the dialect rules below.
  const columnGuards: string[] = []
  out = out.replace(COLUMNS_GUARD_PROBE, (m) => {
    const g = extractColumnsGuard(m)
    if (!g) return m
    columnGuards.push(m)
    return `%%HIP_COLUMNS_${columnGuards.length - 1}%%`
  })

  // Embeds first (before wiki)
  out = out.replace(/!\[\[([^\]|#]+)(?:#([^\]]+))?\]\]/g, (_full, title: string, frag?: string) => {
    return embedToHtmlCarrier({
      title: title.trim(),
      fragment: (frag ?? '').trim(),
    }).replace(/\n$/, '')
  })

  // Attachment cards: `![name](relative-non-image-ext)` (before wiki/image steps).
  out = attachMdToHtmlCarriers(out)

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

  // Inline math — after display math + fences (both already replaced with divs).
  out = inlineMathMdToHtml(out)

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

  // Color spans last (they contain plain text or already-converted marks).
  out = colorSpanMdToHtml(out)

  // Restore columns guards (inner md kept raw — no carriers inside the JSON).
  out = out.replace(COLUMNS_HOLDER_RE, (_full, n: string) => {
    const g = extractColumnsGuard(columnGuards[Number(n)] ?? '')
    if (!g) return ''
    return `<div data-hip-block="columns" data-count="${g.count}" data-columns="${escapeHtmlAttr(
      JSON.stringify(g.columns),
    )}"></div>`
  })
  return out
}
