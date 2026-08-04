/**
 * Live image NodeSelection chrome: alt edit + delete (R5 Gate B, R5-K7 no width MD).
 */
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import i18n from '@/i18n'

const key = new PluginKey('knowledge-live-image-chrome')

function t(k: string, fb: string) {
  return i18n.t(k, { defaultValue: fb })
}

function selectedImage(view: EditorView): { pos: number; node: import('@milkdown/kit/prose/model').Node } | null {
  const { selection } = view.state
  if (!(selection instanceof NodeSelection)) return null
  const node = selection.node
  if (node.type.name !== 'image') return null
  return { pos: selection.from, node }
}

export function createLiveImageChromePlugin(): ReturnType<typeof $prose> {
  return $prose(() => {
    let bar: HTMLDivElement | null = null
    let altInput: HTMLInputElement | null = null
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
        'knowledge-live-image-chrome absolute z-40 flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-1 shadow-overlay'
      bar.setAttribute('data-testid', 'knowledge-live-image-chrome')
      bar.style.display = 'none'

      altInput = document.createElement('input')
      altInput.type = 'text'
      altInput.className =
        'h-7 w-36 rounded border border-border bg-surface px-1.5 text-meta text-ink'
      altInput.placeholder = t('knowledge.image.alt', 'Alt text')
      altInput.setAttribute('data-testid', 'knowledge-live-image-alt')
      altInput.addEventListener('mousedown', (e) => e.stopPropagation())
      altInput.addEventListener('change', () => {
        const sel = selectedImage(view)
        if (!sel || !altInput) return
        const tr = view.state.tr.setNodeMarkup(sel.pos, undefined, {
          ...sel.node.attrs,
          alt: altInput.value,
        })
        view.dispatch(tr)
        view.focus()
      })

      const del = document.createElement('button')
      del.type = 'button'
      del.textContent = t('knowledge.image.delete', 'Delete')
      del.className =
        'h-7 rounded-md px-2 text-meta text-danger hover:bg-state-hover'
      del.setAttribute('data-testid', 'knowledge-live-image-delete')
      del.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
      })
      del.addEventListener('click', () => {
        const sel = selectedImage(view)
        if (!sel) return
        const tr = view.state.tr.delete(sel.pos, sel.pos + sel.node.nodeSize)
        try {
          tr.setSelection(TextSelection.near(tr.doc.resolve(sel.pos)))
        } catch {
          // ignore
        }
        view.dispatch(tr.scrollIntoView())
        view.focus()
        hide()
      })

      bar.append(altInput, del)
      root.appendChild(bar)
      return bar
    }

    const position = (view: EditorView) => {
      const b = ensure(view)
      if (!b || !root || !altInput) return
      const sel = selectedImage(view)
      if (!sel) {
        hide()
        return
      }
      try {
        const coords = view.coordsAtPos(sel.pos)
        const rootRect = root.getBoundingClientRect()
        b.style.display = 'flex'
        b.style.left = `${coords.left - rootRect.left + root.scrollLeft}px`
        b.style.top = `${coords.top - rootRect.top + root.scrollTop - 36}px`
        if (document.activeElement !== altInput) {
          altInput.value = String(sel.node.attrs.alt ?? '')
        }
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
            altInput = null
            root = null
          },
        }
      },
    })
  })
}

export const liveImagePlugins = [createLiveImageChromePlugin()]
