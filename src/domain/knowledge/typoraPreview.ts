/**
 * Typora-style live preview (WYSIWYM) for the knowledge Source editor.
 *
 * Single editing surface: markdown syntax renders in place (headings large,
 * bold bold, lists with bullets, tasks with checkboxes, quotes with a rail,
 * fences as code blocks, `---` as a divider, images inline). Syntax markers
 * are hidden; when the caret is inside an element, its raw syntax reappears
 * (Typora's reveal-on-demand) so the user can edit markers directly.
 *
 * Decorations are visual only — the document text is never modified, so
 * autosave / export / search keep working on the raw markdown.
 *
 * Parsing: lezer markdown via `markdownLanguage` (GFM) — Task / Strikethrough
 * / Table nodes. Tables are intentionally left raw (edit as source).
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import {
  RangeSetBuilder,
  type EditorState,
  type Extension,
} from '@codemirror/state'

/** Docs above this size skip live decorations (plain source) to keep typing fast. */
export const TYPORA_MAX_DECORATED_CHARS = 200_000

/** Wiki-link pattern used inside paragraphs (`[[Title]]`, `[[#fragment]]`). */
const WIKI_LINK_RE = /\[\[[^[\]\n]{1,200}\]\]/g

export interface TyporaPreviewOptions {
  /** Resolve `assets/…` src → display URL for inline image widgets. */
  resolveAsset?: (src: string) => Promise<string | null> | null
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

class BulletWidget extends WidgetType {
  eq(other: BulletWidget): boolean {
    return other instanceof BulletWidget
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'kb-tp-bullet'
    span.textContent = '•'
    return span
  }
}

class OrderedNumberWidget extends WidgetType {
  constructor(readonly n: number) {
    super()
  }
  eq(other: OrderedNumberWidget): boolean {
    return other instanceof OrderedNumberWidget && other.n === this.n
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'kb-tp-list-num'
    span.textContent = String(this.n)
    return span
  }
}

/** Interactive `[ ]` / `[x]` checkbox — click writes back to the doc. */
class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    /** Doc range of the `[ ]` marker at build time (toggle writes back here). */
    readonly from: number,
    readonly to: number,
  ) {
    super()
  }
  eq(other: TaskCheckboxWidget): boolean {
    return (
      other instanceof TaskCheckboxWidget &&
      other.checked === this.checked &&
      other.from === this.from &&
      other.to === this.to
    )
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span')
    box.className = 'kb-tp-task' + (this.checked ? ' kb-tp-task-checked' : '')
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.checked))
    box.textContent = this.checked ? '✓' : ''
    // Keep the caret where it is when clicking the box.
    box.addEventListener('mousedown', (e) => e.preventDefault())
    box.addEventListener('click', (e) => {
      e.preventDefault()
      view.dispatch({
        changes: {
          from: this.from,
          to: this.to,
          insert: this.checked ? '[ ]' : '[x]',
        },
      })
      view.focus()
    })
    return box
  }
}

class HrWidget extends WidgetType {
  eq(other: HrWidget): boolean {
    return other instanceof HrWidget
  }
  toDOM(): HTMLElement {
    const div = document.createElement('div')
    div.className = 'kb-tp-hr'
    div.setAttribute('aria-hidden', 'true')
    return div
  }
}

/** Code-fence opening line → language chip. */
class FenceLabelWidget extends WidgetType {
  constructor(readonly language: string) {
    super()
  }
  eq(other: FenceLabelWidget): boolean {
    return other instanceof FenceLabelWidget && other.language === this.language
  }
  toDOM(): HTMLElement {
    const chip = document.createElement('span')
    chip.className = 'kb-tp-fence-label'
    chip.textContent = this.language || 'code'
    return chip
  }
}

/** Inline image: local `assets/…` resolves async; external URLs render directly. */
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly resolver: ((src: string) => Promise<string | null> | null) | undefined,
  ) {
    super()
  }
  eq(other: ImageWidget): boolean {
    return (
      other instanceof ImageWidget &&
      other.src === this.src &&
      other.alt === this.alt
    )
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'kb-tp-img-wrap'
    const img = document.createElement('img')
    img.className = 'kb-tp-img'
    img.alt = this.alt
    if (/^(data:|https?:|\/\/)/.test(this.src)) {
      img.src = this.src
    } else if (this.resolver) {
      const res = this.resolver(this.src)
      if (res) {
        res.then((url) => {
          if (img.isConnected && url) img.src = url
        })
      }
    }
    wrap.appendChild(img)
    return wrap
  }
}

// ---------------------------------------------------------------------------
// Decoration builder (pure — unit-testable without a view)
// ---------------------------------------------------------------------------

type Pending = { from: number; to: number; deco: Decoration; point: boolean }

/**
 * Build Typora-style decorations for `state.doc` with the caret at `cursor`.
 * Elements containing the caret are left raw (reveal-on-demand).
 */
export function buildTyporaDecorations(
  state: EditorState,
  cursor: number,
  opts: TyporaPreviewOptions = {},
): DecorationSet {
  const doc = state.doc
  const pending: Pending[] = []
  const builder = new RangeSetBuilder<Decoration>()
  if (doc.length > TYPORA_MAX_DECORATED_CHARS) return builder.finish()
  const resolver = opts.resolveAsset

  const addMark = (from: number, to: number, cls: string) => {
    if (from < to) pending.push({ from, to, deco: Decoration.mark({ class: cls }), point: false })
  }
  const addReplace = (from: number, to: number, deco?: Decoration) => {
    if (from >= to) return
    pending.push({
      from,
      to,
      deco: deco ?? Decoration.replace({}),
      point: true,
    })
  }
  const replaceWithWidget = (from: number, to: number, widget: WidgetType) => {
    addReplace(from, to, Decoration.replace({ widget }))
  }

  const isActive = (node: SyntaxNode) => cursor > node.from && cursor < node.to

  /** Recursively walk children, keeping context for ordered-list numbering. */
  const walkChildren = (node: SyntaxNode, ordered: number | null = null) => {
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c, ordered)
  }

  const walk = (node: SyntaxNode, ordered: number | null = null): void => {
    const name = node.type.name
    // Reveal-on-demand: any element under the caret shows raw markdown.
    // The Document root is never "revealed" (it would blank the whole doc).
    if (node.parent != null && isActive(node)) return

    switch (name) {
      case 'ATXHeading1':
      case 'ATXHeading2':
      case 'ATXHeading3':
      case 'ATXHeading4':
      case 'ATXHeading5':
      case 'ATXHeading6': {
        const level = Number(name.slice('ATXHeading'.length))
        addMark(node.from, node.to, `kb-tp-h${level}`)
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.type.name === 'HeaderMark') {
            let to = c.to
            if (to < node.to && doc.sliceString(to, to + 1) === ' ') to += 1
            addReplace(c.from, to)
          } else {
            walk(c, ordered)
          }
        }
        return
      }
      case 'SetextHeading1':
      case 'SetextHeading2': {
        const level = name === 'SetextHeading1' ? 1 : 2
        const mark = node.getChild('HeaderMark')
        addMark(node.from, mark ? mark.from : node.to, `kb-tp-h${level}`)
        if (mark) addReplace(mark.from, mark.to)
        return
      }
      case 'Emphasis':
      case 'StrongEmphasis':
      case 'Strikethrough': {
        const cls =
          name === 'Emphasis'
            ? 'kb-tp-em'
            : name === 'StrongEmphasis'
              ? 'kb-tp-strong'
              : 'kb-tp-strike'
        const marks: SyntaxNode[] = []
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (/Mark$/.test(c.type.name)) marks.push(c)
          else walk(c, ordered)
        }
        if (marks.length >= 2) {
          addMark(marks[0].to, marks[marks.length - 1].from, cls)
          for (const m of marks) addReplace(m.from, m.to)
        }
        return
      }
      case 'InlineCode': {
        const marks: SyntaxNode[] = []
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.type.name === 'CodeMark') marks.push(c)
          else walk(c, ordered)
        }
        if (marks.length >= 2) {
          addMark(marks[0].to, marks[marks.length - 1].from, 'kb-tp-code')
          for (const m of marks) addReplace(m.from, m.to)
        }
        return
      }
      case 'Link': {
        const marks: SyntaxNode[] = []
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.type.name === 'LinkMark') marks.push(c)
          else walk(c, ordered)
        }
        if (marks.length >= 2) {
          // `[label](url)` — hide brackets + URL, style the label.
          addMark(marks[0].to, marks[1].from, 'kb-tp-link')
          addReplace(node.from, marks[0].to)
          addReplace(marks[1].from, node.to)
        }
        return
      }
      case 'Image': {
        const marks: SyntaxNode[] = []
        let urlNode: SyntaxNode | null = null
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.type.name === 'LinkMark') marks.push(c)
          else if (c.type.name === 'URL') urlNode = c
          else walk(c, ordered)
        }
        const src = urlNode ? doc.sliceString(urlNode.from, urlNode.to) : ''
        const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : ''
        replaceWithWidget(node.from, node.to, new ImageWidget(src, alt, resolver))
        return
      }
      case 'BulletList':
        walkChildren(node, null)
        return
      case 'OrderedList':
        walkChildren(node, 0)
        return
      case 'ListItem': {
        const mark = node.getChild('ListMark')
        if (mark) {
          if (ordered != null) {
            replaceWithWidget(mark.from, mark.to, new OrderedNumberWidget(ordered + 1))
            ordered += 1
          } else {
            replaceWithWidget(mark.from, mark.to, new BulletWidget())
          }
        }
        walkChildren(node, ordered)
        return
      }
      case 'Task': {
        const marker = node.getChild('TaskMarker')
        if (marker) {
          const raw = doc.sliceString(marker.from, marker.to)
          replaceWithWidget(
            marker.from,
            marker.to,
            new TaskCheckboxWidget(/[xX]/.test(raw), marker.from, marker.to),
          )
        }
        walkChildren(node, ordered)
        return
      }
      case 'Blockquote': {
        addMark(node.from, node.to, 'kb-tp-quote')
        walkChildren(node, ordered)
        return
      }
      case 'QuoteMark': {
        // `>` markers may sit at Blockquote level or inside nested Paragraphs.
        let to = node.to
        if (to < doc.length && doc.sliceString(to, to + 1) === ' ') to += 1
        addReplace(node.from, to)
        return
      }
      case 'FencedCode': {
        let open: SyntaxNode | null = null
        let close: SyntaxNode | null = null
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.type.name !== 'CodeMark') continue
          if (open == null) open = c
          else close = c
        }
        const info = node.getChild('CodeInfo')
        const text = node.getChild('CodeText')
        if (open) {
          const end = info ? info.to : open.to
          const lang = info ? doc.sliceString(info.from, info.to) : ''
          replaceWithWidget(open.from, end, new FenceLabelWidget(lang))
        }
        if (close) addReplace(close.from, close.to)
        if (text) addMark(text.from, text.to, 'kb-tp-fence')
        return
      }
      case 'CodeBlock': {
        const text = node.getChild('CodeText')
        if (text) addMark(text.from, text.to, 'kb-tp-fence')
        walkChildren(node, ordered)
        return
      }
      case 'HorizontalRule':
        replaceWithWidget(node.from, node.to, new HrWidget())
        return
      case 'Paragraph': {
        // Wiki links `[[…]]` — lezer doesn't parse them; style via regex.
        const text = doc.sliceString(node.from, node.to)
        WIKI_LINK_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = WIKI_LINK_RE.exec(text))) {
          const start = node.from + m.index
          const end = start + m[0].length
          if (cursor > start && cursor < end) continue
          addMark(start, end, 'kb-tp-wiki')
        }
        walkChildren(node, ordered)
        return
      }
      default:
        walkChildren(node, ordered)
    }
  }

  walk(syntaxTree(state).topNode)
  // Point ranges (replace/widget) must be added before mark ranges at the
  // same `from` (RangeSetBuilder sorts by `startSide`; replace < mark).
  pending.sort((a, b) => a.from - b.from || Number(b.point) - Number(a.point))
  for (const p of pending) builder.add(p.from, p.to, p.deco)
  return builder.finish()
}

// ---------------------------------------------------------------------------
// ViewPlugin wrapper
// ---------------------------------------------------------------------------

class TyporaPreviewPlugin {
  decorations: DecorationSet
  private readonly resolveAsset: TyporaPreviewOptions['resolveAsset']

  constructor(
    view: EditorView,
    opts: TyporaPreviewOptions,
  ) {
    this.resolveAsset = opts.resolveAsset
    this.decorations = buildTyporaDecorations(
      view.state,
      view.state.selection.main.head,
      opts,
    )
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet) {
      this.decorations = buildTyporaDecorations(
        update.state,
        update.state.selection.main.head,
        { resolveAsset: this.resolveAsset },
      )
    }
  }
}

/** Typora-style live preview extension for the knowledge Source editor. */
export function typoraLivePreview(opts: TyporaPreviewOptions = {}): Extension {
  return ViewPlugin.fromClass(
    class extends TyporaPreviewPlugin {
      constructor(view: EditorView) {
        super(view, opts)
      }
    },
    { decorations: (v: TyporaPreviewPlugin) => v.decorations },
  )
}

/** Convenience for tests: iterate decorations into a readable list. */
export type TyporaDecorationRecord = {
  from: number
  to: number
  kind: 'mark' | 'replace'
  cls?: string
  widget?: string
  hidden?: boolean
}

export function collectTyporaDecorations(set: DecorationSet): TyporaDecorationRecord[] {
  const out: TyporaDecorationRecord[] = []
  set.between(0, 1e9, (from, to, deco: Decoration) => {
    const spec = deco.spec as { class?: string; widget?: WidgetType | null }
    if (deco.point) {
      out.push({
        from,
        to,
        kind: 'replace',
        widget: spec.widget?.constructor.name,
        hidden: spec.widget == null,
      })
    } else {
      out.push({ from, to, kind: 'mark', cls: spec.class })
    }
  })
  return out
}

// Keep the import used in type positions for TS tooling.
export type { EditorState }
