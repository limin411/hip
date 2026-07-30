/**
 * Lightweight top-level block `+` handle → open slash via insert `/` (path A, R4).
 */
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

const key = new PluginKey('knowledge-live-block-handle')

/**
 * Mutates doc: ensures empty paragraph context + '/' so existing slash UI opens.
 */
export function openSlashAtTopLevelBlock(
  view: EditorView,
  blockStartPos: number,
): boolean {
  if (view.composing) return false
  try {
    const $pos = view.state.doc.resolve(blockStartPos)
    // Top-level block: depth 1 under doc
    if ($pos.depth < 1) return false
    const blockDepth = 1
    const block = $pos.node(blockDepth)
    const blockFrom = $pos.before(blockDepth)
    const blockTo = $pos.after(blockDepth)

    let tr = view.state.tr
    const isEmptyPara =
      block.type.name === 'paragraph' && block.content.size === 0

    if (isEmptyPara) {
      const insertAt = blockFrom + 1
      tr = tr.insertText('/', insertAt)
      tr = tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
    } else {
      const para = view.state.schema.nodes.paragraph.create()
      tr = tr.insert(blockTo, para)
      // New empty para is at blockTo; content starts at blockTo+1
      const slashPos = blockTo + 1
      tr = tr.insertText('/', slashPos)
      tr = tr.setSelection(TextSelection.create(tr.doc, slashPos + 1))
    }
    view.dispatch(tr.scrollIntoView())
    view.focus()
    return true
  } catch {
    return false
  }
}

function topLevelBlockRange(
  view: EditorView,
  clientY: number,
): { from: number; to: number; top: number; left: number } | null {
  const pm = view.dom
  const rect = pm.getBoundingClientRect()
  if (clientY < rect.top || clientY > rect.bottom) return null
  // Probe x near left content edge
  const x = rect.left + 24
  const pos = view.posAtCoords({ left: x, top: clientY })
  if (pos == null) return null
  try {
    const $pos = view.state.doc.resolve(pos.pos)
    if ($pos.depth < 1) return null
    const from = $pos.before(1)
    const to = $pos.after(1)
    const coords = view.coordsAtPos(from + 1)
    return {
      from,
      to,
      top: coords.top - rect.top + pm.scrollTop,
      left: 0,
    }
  } catch {
    return null
  }
}

export function createLiveBlockHandlePlugin(opts: {
  /** Called after `/` is inserted so host can sync slash picker. */
  onOpened?: () => void
}): ReturnType<typeof $prose> {
  return $prose(() => {
    let handle: HTMLButtonElement | null = null
    let root: HTMLElement | null = null
    let lastFrom = -1

    const ensureHandle = (view: EditorView) => {
      if (handle) return handle
      root = view.dom.parentElement
      if (!root) return null
      if (getComputedStyle(root).position === 'static') {
        root.style.position = 'relative'
      }
      handle = document.createElement('button')
      handle.type = 'button'
      handle.textContent = '+'
      handle.className =
        'knowledge-live-block-plus absolute z-40 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface text-meta text-ink-tertiary opacity-0 shadow-sm transition-opacity hover:bg-state-hover hover:text-ink hover:opacity-100'
      handle.setAttribute('data-testid', 'knowledge-live-block-plus')
      handle.setAttribute('aria-label', 'Insert block')
      handle.tabIndex = -1
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
      })
      handle.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (lastFrom < 0) return
        if (openSlashAtTopLevelBlock(view, lastFrom)) {
          opts.onOpened?.()
        }
      })
      root.appendChild(handle)
      return handle
    }

    const hide = () => {
      if (handle) handle.style.opacity = '0'
      lastFrom = -1
    }

    const showAt = (view: EditorView, from: number, top: number) => {
      const h = ensureHandle(view)
      if (!h || !root) return
      lastFrom = from
      h.style.top = `${Math.max(0, top - 2)}px`
      h.style.left = '0px'
      h.style.opacity = '1'
    }

    return new Plugin({
      key,
      view(view) {
        const onMove = (e: MouseEvent) => {
          if (!view.editable) {
            hide()
            return
          }
          const range = topLevelBlockRange(view, e.clientY)
          if (!range) {
            hide()
            return
          }
          // Only show when pointer is near left gutter of the editor
          const pmRect = view.dom.getBoundingClientRect()
          if (e.clientX > pmRect.left + 48) {
            // Keep visible if over the button itself
            if (handle && handle.contains(e.target as Node)) return
            hide()
            return
          }
          showAt(view, range.from, range.top)
        }
        const onLeave = (e: MouseEvent) => {
          if (handle && handle.contains(e.relatedTarget as Node)) return
          hide()
        }
        view.dom.addEventListener('mousemove', onMove)
        view.dom.addEventListener('mouseleave', onLeave)
        return {
          destroy() {
            view.dom.removeEventListener('mousemove', onMove)
            view.dom.removeEventListener('mouseleave', onLeave)
            handle?.remove()
            handle = null
            root = null
          },
        }
      },
    })
  })
}
