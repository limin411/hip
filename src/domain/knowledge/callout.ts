/**
 * GitHub/Obsidian-style callouts: `> [!note] Title` …
 * Rewrite to a stable HTML-ish fence that react-markdown renders as blockquote
 * with a detectable first paragraph, OR we parse blockquotes in the component.
 *
 * Approach: leave source as GFM blockquotes; knowledge blockquote component
 * detects a first-line pattern `[!type] optional title`.
 */

export const CALLOUT_TYPES = [
  'note',
  'tip',
  'info',
  'warning',
  'danger',
  'caution',
  'important',
] as const

export type CalloutType = (typeof CALLOUT_TYPES)[number]

const TYPE_SET = new Set<string>(CALLOUT_TYPES)

/**
 * Parse callout header from first blockquote line text.
 * `[!note]` / `[!NOTE] Title` → { type, title }
 */
export function parseCalloutHeader(firstLine: string): {
  type: CalloutType
  title: string | null
} | null {
  const m = firstLine.trim().match(/^\[!([A-Za-z]+)\]\s*(.*)$/)
  if (!m) return null
  const t = m[1].toLowerCase()
  if (!TYPE_SET.has(t)) return null
  const title = m[2].trim()
  return { type: t as CalloutType, title: title.length ? title : null }
}

/** Flatten react children to plain text (first line only for header detect). */
export function firstTextLine(node: unknown): string {
  const full = flattenText(node)
  const line = full.split('\n')[0] ?? ''
  return line.trim()
}

function flattenText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (typeof node === 'object' && node !== null && 'props' in node) {
    const el = node as { props?: { children?: unknown } }
    return flattenText(el.props?.children)
  }
  return ''
}
