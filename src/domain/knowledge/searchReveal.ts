/**
 * Best-effort scroll-to-match after opening a search hit.
 * Pure match finder is unit-tested; DOM / CM helpers are thin wrappers.
 */

import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { tokenizeKnowledge } from './search'

export type RevealMatch = {
  offset: number
  /** Length of the matched substring (full query or fallback token). */
  length: number
}

/**
 * First case-insensitive match of the full query, else first matching token.
 * Returns offset + matched length, or null when nothing matches.
 */
export function findRevealMatch(text: string, query: string): RevealMatch | null {
  const q = query.trim()
  if (!q || !text) return null
  const lower = text.toLowerCase()
  const qi = lower.indexOf(q.toLowerCase())
  if (qi >= 0) return { offset: qi, length: q.length }
  for (const t of tokenizeKnowledge(q)) {
    if (!t) continue
    const i = lower.indexOf(t.toLowerCase())
    if (i >= 0) return { offset: i, length: t.length }
  }
  return null
}

/** @deprecated Prefer `findRevealMatch`; kept for call-site convenience. */
export function findRevealOffset(text: string, query: string): number | null {
  return findRevealMatch(text, query)?.offset ?? null
}

/** Scroll CodeMirror to the first match of `query` (select + center). */
export function revealInCodeMirror(view: EditorView, query: string): boolean {
  const text = view.state.doc.toString()
  const match = findRevealMatch(text, query)
  if (!match) return false
  const end = Math.min(text.length, match.offset + Math.max(1, match.length))
  view.dispatch({
    selection: EditorSelection.range(match.offset, end),
    effects: EditorView.scrollIntoView(match.offset, { y: 'center' }),
  })
  return true
}

/**
 * Scroll CodeMirror to a 1-based source line (cursor at line start).
 * Used by the document outline when jumping from TOC → Source.
 */
export function revealLineInCodeMirror(view: EditorView, lineNumber: number): boolean {
  const doc = view.state.doc
  if (lineNumber < 1 || lineNumber > doc.lines) return false
  const line = doc.line(lineNumber)
  view.dispatch({
    selection: EditorSelection.cursor(line.from),
    effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
  })
  return true
}

/**
 * Best-effort: scroll the nth heading (0-based occurrence among h1–h6)
 * matching exact textContent under `root`. Used by Live TOC jumps when
 * block-id scroll is unavailable.
 */
export function revealHeadingInRoot(
  root: HTMLElement,
  text: string,
  occurrence = 0,
): boolean {
  const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6')
  let seen = 0
  for (const el of headings) {
    const label = (el.textContent ?? '').trim()
    if (label !== text.trim()) continue
    if (seen === occurrence) {
      if (typeof (el as HTMLElement).scrollIntoView === 'function') {
        ;(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' })
        return true
      }
      return false
    }
    seen += 1
  }
  return false
}

/**
 * Best-effort: walk text nodes under `root` and scroll the first match into view.
 * Preview markdown may reflow tokens; full-query match preferred.
 */
export function revealInPreviewRoot(root: HTMLElement, query: string): boolean {
  return findRevealElementInRoot(root, query) != null
}

/**
 * Like `revealInPreviewRoot` but returns the matched element (for flash highlight),
 * or null when no match. Caller should add/remove a temporary highlight class.
 */
export function findRevealElementInRoot(root: HTMLElement, query: string): HTMLElement | null {
  const q = query.trim()
  if (!q) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const value = node.nodeValue ?? ''
    const match = findRevealMatch(value, q)
    if (match && node.parentElement) {
      node.parentElement.scrollIntoView({ block: 'center', inline: 'nearest' })
      return node.parentElement
    }
    node = walker.nextNode()
  }
  // Fallback: search concatenated visible text is too heavy; try root textContent once.
  const all = root.textContent ?? ''
  if (findRevealMatch(all, q) != null) {
    root.scrollIntoView({ block: 'start', inline: 'nearest' })
    return root
  }
  return null
}
