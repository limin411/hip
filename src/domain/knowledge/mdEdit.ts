import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * Wrap the current selection (or insert markers around empty selection).
 * Italic uses single `*` (MVP); prefer toolbar/keymap consistency over CommonMark edge cases.
 */
export function wrapSelection(
  state: EditorState,
  before: string,
  after: string = before,
): TransactionSpec {
  const changes = state.selection.ranges.map((range) => {
    const text = state.sliceDoc(range.from, range.to)
    return {
      from: range.from,
      to: range.to,
      insert: `${before}${text}${after}`,
    }
  })
  const ranges = state.selection.ranges.map((range, i) => {
    const ch = changes[i]
    const inserted = ch.insert.length
    if (range.empty) {
      const cursor = range.from + before.length
      return EditorSelection.range(cursor, cursor)
    }
    return EditorSelection.range(range.from, range.from + inserted)
  })
  return {
    changes,
    selection: EditorSelection.create(ranges),
  }
}

/** Toggle a line prefix (list, quote, task). Applies to all lines in selection. */
export function toggleLinePrefix(state: EditorState, prefix: string): TransactionSpec {
  const doc = state.doc
  const changes: { from: number; to: number; insert: string }[] = []
  const lineSet = new Set<number>()

  for (const range of state.selection.ranges) {
    const fromLine = doc.lineAt(range.from).number
    const toLine = doc.lineAt(range.to).number
    for (let n = fromLine; n <= toLine; n++) lineSet.add(n)
  }

  const lines = [...lineSet].sort((a, b) => a - b)
  let allHave = true
  for (const n of lines) {
    const line = doc.line(n)
    if (!line.text.startsWith(prefix)) {
      allHave = false
      break
    }
  }

  for (const n of lines) {
    const line = doc.line(n)
    if (allHave) {
      if (line.text.startsWith(prefix)) {
        changes.push({ from: line.from, to: line.from + prefix.length, insert: '' })
      }
    } else if (!line.text.startsWith(prefix)) {
      changes.push({ from: line.from, to: line.from, insert: prefix })
    }
  }

  return { changes }
}

/** Set ATX heading level 1–3 on the first line of the primary selection; 0 removes heading. */
export function setAtxHeading(state: EditorState, level: 0 | 1 | 2 | 3): TransactionSpec {
  const range = state.selection.main
  const line = state.doc.lineAt(range.from)
  const stripped = line.text.replace(/^#{1,6}\s+/, '')
  const insert = level === 0 ? stripped : `${'#'.repeat(level)} ${stripped}`
  return {
    changes: { from: line.from, to: line.to, insert },
    selection: EditorSelection.cursor(line.from + insert.length),
  }
}

export function applyEdit(view: EditorView, spec: TransactionSpec): boolean {
  if (view.composing) return false
  view.dispatch(spec)
  return true
}

export function wrapAndDispatch(view: EditorView, before: string, after?: string): boolean {
  return applyEdit(view, wrapSelection(view.state, before, after ?? before))
}

export function prefixAndDispatch(view: EditorView, prefix: string): boolean {
  return applyEdit(view, toggleLinePrefix(view.state, prefix))
}

export function headingAndDispatch(view: EditorView, level: 0 | 1 | 2 | 3): boolean {
  return applyEdit(view, setAtxHeading(view.state, level))
}

/** Insert markdown link; selection becomes link text if non-empty. */
export function insertLink(view: EditorView, url = 'https://'): boolean {
  if (view.composing) return false
  const state = view.state
  const range = state.selection.main
  const text = state.sliceDoc(range.from, range.to) || 'link'
  const insert = `[${text}](${url})`
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + insert.length),
  })
  return true
}

/** Wrap selection in fenced code block. */
export function insertFence(view: EditorView): boolean {
  if (view.composing) return false
  const state = view.state
  const range = state.selection.main
  const text = state.sliceDoc(range.from, range.to)
  const insert = text ? `\`\`\`\n${text}\n\`\`\`` : '```\n\n```'
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: text
      ? EditorSelection.cursor(range.from + insert.length)
      : EditorSelection.cursor(range.from + 4),
  })
  return true
}

/** Insert horizontal rule on its own line after the current line (or at cursor on empty line). */
export function insertHr(view: EditorView): boolean {
  if (view.composing) return false
  const state = view.state
  const range = state.selection.main
  const line = state.doc.lineAt(range.from)
  const insert = line.text.trim() === '' ? '---\n' : '\n---\n'
  const from = line.text.trim() === '' ? line.from : line.to
  view.dispatch({
    changes: { from, to: from, insert },
    selection: EditorSelection.cursor(from + insert.length),
  })
  return true
}

/**
 * Insert a 3×2 table skeleton (header + separator + 2 body rows, 3 columns).
 * Cursor lands in the first header cell.
 */
export function insertTableSkeleton(view: EditorView, skeleton: string): boolean {
  if (view.composing) return false
  const state = view.state
  const range = state.selection.main
  const line = state.doc.lineAt(range.from)
  let from = range.from
  let to = range.to
  let insert = skeleton
  if (range.empty && line.text.trim() === '') {
    from = line.from
    to = line.to
  } else if (range.empty) {
    from = line.to
    to = line.to
    insert = `\n${skeleton}`
  }
  // First cell content starts after leading `| ` (skip optional leading newline)
  const pipe = insert.indexOf('| ')
  const cursorOffset = pipe >= 0 ? pipe + 2 : insert.length
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + cursorOffset),
  })
  return true
}


/**
 * Insert or complete a wiki link `[[Title]]`.
 * When `replaceFrom`/`replaceTo` are set (incomplete `[[query`), replace that range.
 * Otherwise wrap selection as title (or insert `[[`…`]]` around empty selection).
 */
export function insertWikiLink(
  view: EditorView,
  title: string,
  opts?: { replaceFrom?: number; replaceTo?: number },
): boolean {
  if (view.composing) return false
  const state = view.state
  const t = title.trim()
  const insert = t ? `[[${t}]]` : '[[]]'
  if (opts?.replaceFrom != null && opts?.replaceTo != null) {
    const from = opts.replaceFrom
    const to = opts.replaceTo
    view.dispatch({
      changes: { from, to, insert },
      selection: EditorSelection.cursor(from + insert.length),
    })
    return true
  }
  const range = state.selection.main
  if (range.empty && !t) {
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: '[[]]' },
      selection: EditorSelection.cursor(range.from + 2),
    })
    return true
  }
  const selected = state.sliceDoc(range.from, range.to)
  const body = t || selected || ''
  const text = body ? `[[${body}]]` : '[[]]'
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: body
      ? EditorSelection.cursor(range.from + text.length)
      : EditorSelection.cursor(range.from + 2),
  })
  return true
}

/**
 * Replace a slash token range with a Markdown insert snippet (Source CM path).
 * Live should apply the same snippet via its own transaction API.
 */
export function applySlashInsert(
  view: EditorView,
  from: number,
  to: number,
  insert: string,
  cursorOffset: number,
): boolean {
  if (view.composing) return false
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + cursorOffset),
  })
  return true
}

/** Insert plain text (or markdown snippet) at the primary selection. */
export function insertTextAtCursor(view: EditorView, text: string): boolean {
  if (view.composing || !text) return false
  const range = view.state.selection.main
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: EditorSelection.cursor(range.from + text.length),
  })
  return true
}
