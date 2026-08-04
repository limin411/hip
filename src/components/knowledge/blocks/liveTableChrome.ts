/**
 * Live table chrome: +row/+col, delete row/col, Tab cell nav (R5 Gate B).
 * Uses @milkdown/kit/prose/tables — no Vue table-block.
 */
import {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  goToNextCell,
  isInTable,
} from '@milkdown/kit/prose/tables'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { keymap } from '@milkdown/kit/prose/keymap'
import { $prose } from '@milkdown/kit/utils'
import i18n from '@/i18n'

const key = new PluginKey('knowledge-live-table-chrome')

function t(k: string, fb: string) {
  return i18n.t(k, { defaultValue: fb })
}

function btn(
  label: string,
  testId: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.title = title
  b.setAttribute('aria-label', title)
  b.setAttribute('data-testid', testId)
  b.className =
    'flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface text-caption text-ink-secondary shadow-sm hover:bg-state-hover hover:text-ink'
  b.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  b.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  return b
}

export function createLiveTableChromePlugin(): ReturnType<typeof $prose> {
  return $prose(() => {
    let bar: HTMLDivElement | null = null
    let root: HTMLElement | null = null

    const hide = () => {
      if (bar) bar.style.display = 'none'
    }

    const ensure = (view: EditorView) => {
      if (bar) return bar
      root = view.dom.parentElement
      if (!root) return null
      if (getComputedStyle(root).position === 'static') {
        root.style.position = 'relative'
      }
      bar = document.createElement('div')
      bar.className =
        'knowledge-live-table-chrome absolute z-40 flex items-center gap-1 rounded-md border border-border bg-surface px-1 py-0.5 shadow-sm'
      bar.setAttribute('data-testid', 'knowledge-live-table-chrome')
      bar.style.display = 'none'

      bar.append(
        btn('+', 'knowledge-live-table-add-row', t('knowledge.table.addRow', 'Add row'), () => {
          addRowAfter(view.state, view.dispatch)
          view.focus()
        }),
        btn('⊞', 'knowledge-live-table-add-col', t('knowledge.table.addCol', 'Add column'), () => {
          addColumnAfter(view.state, view.dispatch)
          view.focus()
        }),
        btn('×r', 'knowledge-live-table-del-row', t('knowledge.table.delRow', 'Delete row'), () => {
          deleteRow(view.state, view.dispatch)
          view.focus()
        }),
        btn('×c', 'knowledge-live-table-del-col', t('knowledge.table.delCol', 'Delete column'), () => {
          deleteColumn(view.state, view.dispatch)
          view.focus()
        }),
      )
      root.appendChild(bar)
      return bar
    }

    const position = (view: EditorView) => {
      const b = ensure(view)
      if (!b || !root) return
      if (!isInTable(view.state)) {
        hide()
        return
      }
      try {
        const { from } = view.state.selection
        const coords = view.coordsAtPos(from)
        const rootRect = root.getBoundingClientRect()
        b.style.display = 'flex'
        b.style.left = `${coords.left - rootRect.left + root.scrollLeft}px`
        b.style.top = `${coords.top - rootRect.top + root.scrollTop - 28}px`
      } catch {
        hide()
      }
    }

    return new Plugin({
      key,
      view() {
        return {
          update(v) {
            position(v)
          },
          destroy() {
            bar?.remove()
            bar = null
            root = null
          },
        }
      },
    })
  })
}

/** Tab/Shift-Tab between table cells. */
export function createLiveTableTabPlugin(): ReturnType<typeof $prose> {
  return $prose(() =>
    keymap({
      Tab: (state, dispatch, view) => {
        if (!isInTable(state)) return false
        return goToNextCell(1)(state, dispatch, view)
      },
      'Shift-Tab': (state, dispatch, view) => {
        if (!isInTable(state)) return false
        return goToNextCell(-1)(state, dispatch, view)
      },
    }),
  )
}

export const liveTablePlugins = [
  createLiveTableChromePlugin(),
  createLiveTableTabPlugin(),
]
