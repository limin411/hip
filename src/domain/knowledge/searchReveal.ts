/**
 * Best-effort scroll-to-match after opening a search hit.
 * Pure offset finder is unit-tested; DOM / CM helpers are thin wrappers.
 */

import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { tokenizeKnowledge } from './search'

/**
 * First case-insensitive match of the full query, else first matching token.
 * Returns character offset into `text`, or null when nothing matches.
 */
export function findRevealOffset(text: string, query: string): number | null {
  const q = query.trim()
  if (!q || !text) return null
  const lower = text.toLowerCase()
  const qi = lower.indexOf(q.toLowerCase())
  if (qi >= 0) return qi
  for (const t of tokenizeKnowledge(q)) {
    if (!t) continue
    const i = lower.indexOf(t.toLowerCase())
    if (i >= 0) return i
  }
  return null
}

/** Scroll CodeMirror to the first match of `query` (select + center). */
export function revealInCodeMirror(view: EditorView, query: string): boolean {
  const text = view.state.doc.toString()
  const offset = findRevealOffset(text, query)
  if (offset == null) return false
  const end = Math.min(text.length, offset + Math.max(1, query.trim().length))
  view.dispatch({
    selection: EditorSelection.range(offset, end),
    effects: EditorView.scrollIntoView(offset, { y: 'center' }),
  })
  return true
}

/**
 * Best-effort: walk text nodes under `root` and scroll the first match into view.
 * Preview markdown may reflow tokens; full-query match preferred.
 */
export function revealInPreviewRoot(root: HTMLElement, query: string): boolean {
  const q = query.trim()
  if (!q) return false
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const value = node.nodeValue ?? ''
    const offset = findRevealOffset(value, q)
    if (offset != null && node.parentElement) {
      node.parentElement.scrollIntoView({ block: 'center', inline: 'nearest' })
      return true
    }
    node = walker.nextNode()
  }
  // Fallback: search concatenated visible text is too heavy; try root textContent once.
  const all = root.textContent ?? ''
  if (findRevealOffset(all, q) != null) {
    root.scrollIntoView({ block: 'start', inline: 'nearest' })
    return true
  }
  return false
}
