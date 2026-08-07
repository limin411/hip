/**
 * Pre-export style carriers for Live → disk Markdown.
 *
 * Probe-verified fact (BN 0.52.1): `blocksToMarkdownLossy` strips ALL styles
 * (highlight included) and inline HTML — silently. Before exporting we clone
 * the block tree and wrap styled text in reversible carriers:
 *
 * - highlight        → `==text==`
 * - textColor        → `<span data-hip-color="red">text</span>`
 * - backgroundColor  → `<span data-hip-bg-color="yellow">text</span>`
 *
 * BN passes literal text through verbatim, so the carriers land in the disk
 * Markdown; `dialectToHtmlCarriers` converts them back on the next Live open.
 * Unstyled text is never touched.
 */

type StyleRecord = Record<string, unknown>

type InlineNode = {
  type?: string
  text?: string
  styles?: StyleRecord
}

function isStyledTextNode(node: unknown): node is InlineNode & { text: string; styles: StyleRecord } {
  if (!node || typeof node !== 'object') return false
  const n = node as InlineNode
  return typeof n.text === 'string' && !!n.styles && typeof n.styles === 'object'
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Wrap one styled text node with dialect carriers (bg outer → color → highlight inner). */
export function wrapStyledText(text: string, styles: StyleRecord): string {
  const hl = styles.highlight === true
  const color =
    typeof styles.textColor === 'string' && styles.textColor !== 'default'
      ? styles.textColor
      : null
  const bg =
    typeof styles.backgroundColor === 'string' && styles.backgroundColor !== 'default'
      ? styles.backgroundColor
      : null
  if (!hl && !color && !bg) return text

  let out = escapeText(text)
  if (color) out = `<span data-hip-color="${color}">${out}</span>`
  if (bg) out = `<span data-hip-bg-color="${bg}">${out}</span>`
  if (hl) out = `==${out}==`
  return out
}

function wrapContentArray(nodes: unknown[]): void {
  for (const node of nodes) {
    if (!isStyledTextNode(node)) continue
    const wrapped = wrapStyledText(node.text, node.styles)
    if (wrapped !== node.text) node.text = wrapped
  }
}

/** Wrap styled inline arrays inside table cells too (rows[].cells[]). */
function walkBlockContent(content: unknown): void {
  if (Array.isArray(content)) {
    wrapContentArray(content)
    return
  }
  if (!content || typeof content !== 'object') return
  const rows = (content as { rows?: Array<{ cells?: unknown[][] }> }).rows
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    for (const cell of row.cells ?? []) {
      if (Array.isArray(cell)) wrapContentArray(cell)
    }
  }
}

/**
 * Deep-clone the block tree and replace styled text with carrier-wrapped text.
 * The clone is only used for Markdown export — the editor document is untouched.
 */
export function wrapStyledInlineForExport(
  blocks: readonly unknown[],
): unknown[] {
  const clone = JSON.parse(JSON.stringify(blocks)) as Array<{ content?: unknown }>
  for (const block of clone) {
    walkBlockContent(block.content)
  }
  return clone
}
