/**
 * Live top-level block gutter: ⋮⋮ grip (menu / drag) + `+` slash (R5 Gate A).
 * Evolves R4 path-A `+` handle; keeps openSlashAtTopLevelBlock.
 */
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import {
  applyTurnInto,
  canTurnIntoNarrow,
  type TurnIntoTarget,
} from '@/domain/knowledge/turnInto'
import {
  blockPlainText,
  deleteTopLevelBlock,
  duplicateTopLevelBlock,
  insertEmptyParagraphNear,
  selectTopLevelBlock,
  topLevelBlockAt,
} from '@/domain/knowledge/blockOps'
import {
  findDropTarget,
  moveTopLevelBlock,
  resolveSourceBlock,
} from '@/domain/knowledge/blockDrag'
import i18n from '@/i18n'
import { openSlashAtTopLevelBlock } from './liveBlockHandle'

export { openSlashAtTopLevelBlock }

const key = new PluginKey('knowledge-live-block-gutter')
const DRAG_THRESHOLD_PX = 4

type MenusFlag = { current: boolean }

type TurnCmds = {
  wrapHeading: (level: number) => boolean
  wrapBlockquote: () => boolean
}

function t(keyPath: string, fallback: string): string {
  return i18n.t(keyPath, { defaultValue: fallback })
}

function topLevelBlockRange(
  view: EditorView,
  clientY: number,
): { from: number; to: number; top: number } | null {
  const pm = view.dom
  const rect = pm.getBoundingClientRect()
  if (clientY < rect.top || clientY > rect.bottom) return null
  const x = rect.left + 24
  const pos = view.posAtCoords({ left: x, top: clientY })
  if (pos == null) return null
  try {
    const block = topLevelBlockAt(view.state.doc, pos.pos)
    if (!block) return null
    const coords = view.coordsAtPos(Math.min(block.from + 1, block.to - 1))
    return {
      from: block.from,
      to: block.to,
      top: coords.top - rect.top + pm.scrollTop,
    }
  } catch {
    return null
  }
}

function clearBlockHighlight(root: HTMLElement) {
  root.querySelectorAll('.knowledge-live-block-selected').forEach((el) => {
    el.classList.remove('knowledge-live-block-selected')
  })
}

function highlightBlockDom(view: EditorView, from: number, root: HTMLElement) {
  clearBlockHighlight(root)
  try {
    const dom = view.nodeDOM(from)
    if (dom instanceof HTMLElement) {
      dom.classList.add('knowledge-live-block-selected')
    }
  } catch {
    // ignore
  }
}

export type BlockGutterOptions = {
  onOpenedSlash?: () => void
  /** menusOpen for bubble shouldShow */
  menusOpenRef?: MenusFlag
  /** Optional turn-into command runners (Milkdown). */
  getTurnCmds?: () => TurnCmds | null
  /** Notify host that block menu visibility changed. */
  onBlockMenuOpenChange?: (open: boolean) => void
}

/**
 * Create gutter plugin: grip + plus + menu + drag.
 */
export function createLiveBlockGutterPlugin(
  opts: BlockGutterOptions = {},
): ReturnType<typeof $prose> {
  return $prose(() => {
    let gutter: HTMLDivElement | null = null
    let grip: HTMLButtonElement | null = null
    let plus: HTMLButtonElement | null = null
    let menu: HTMLDivElement | null = null
    let dropLine: HTMLDivElement | null = null
    let root: HTMLElement | null = null
    let lastFrom = -1
    let menuOpen = false

    // drag state
    let dragActive = false
    let dragPending = false
    let dragStartX = 0
    let dragStartY = 0
    let dragSourceFrom = -1
    let dragSourceTo = -1
    let dragSourceDom: HTMLElement | null = null

    const setMenusFlag = (open: boolean) => {
      menuOpen = open
      if (opts.menusOpenRef) {
        // only force true while menu open; host ORs with slash/wiki
      }
      opts.onBlockMenuOpenChange?.(open)
    }

    const hideMenu = () => {
      if (menu) menu.style.display = 'none'
      setMenusFlag(false)
    }

    const ensureDropLine = () => {
      if (dropLine || !root) return dropLine
      dropLine = document.createElement('div')
      dropLine.className =
        'knowledge-live-drop-line pointer-events-none absolute left-0 right-0 z-50 h-0.5 bg-accent'
      dropLine.style.display = 'none'
      dropLine.setAttribute('data-testid', 'knowledge-live-drop-line')
      root.appendChild(dropLine)
      return dropLine
    }

    const hideDropLine = () => {
      if (dropLine) dropLine.style.display = 'none'
    }

    const showDropLineAt = (clientY: number) => {
      const line = ensureDropLine()
      if (!line || !root) return
      const rootRect = root.getBoundingClientRect()
      line.style.display = 'block'
      line.style.top = `${clientY - rootRect.top + root.scrollTop}px`
      line.style.left = '0px'
      line.style.width = '100%'
    }

    const buildMenu = (view: EditorView) => {
      if (menu || !root) return menu
      menu = document.createElement('div')
      menu.className =
        'knowledge-live-block-menu absolute z-[70] min-w-[11rem] rounded-lg border border-border bg-surface py-1 shadow-overlay'
      menu.setAttribute('role', 'menu')
      menu.setAttribute('data-testid', 'knowledge-live-block-menu')
      menu.style.display = 'none'

      const item = (
        label: string,
        testId: string,
        onClick: () => void,
        danger = false,
      ) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = danger
          ? 'flex w-full items-center px-3 py-1.5 text-left text-meta text-danger hover:bg-state-hover'
          : 'flex w-full items-center px-3 py-1.5 text-left text-meta text-ink hover:bg-state-hover'
        b.textContent = label
        b.setAttribute('role', 'menuitem')
        b.setAttribute('data-testid', testId)
        b.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
        })
        b.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          onClick()
          hideMenu()
        })
        return b
      }

      const runTurn = (target: TurnIntoTarget) => {
        if (lastFrom < 0) return
        selectTopLevelBlock(view, lastFrom)
        const cmds = opts.getTurnCmds?.()
        if (!cmds) return
        applyTurnInto(view, target, cmds)
      }

      menu.append(
        item(t('knowledge.block.delete', 'Delete'), 'knowledge-live-block-delete', () => {
          if (lastFrom >= 0) deleteTopLevelBlock(view, lastFrom)
          if (root) clearBlockHighlight(root)
        }, true),
        item(t('knowledge.block.duplicate', 'Duplicate'), 'knowledge-live-block-duplicate', () => {
          if (lastFrom < 0) return
          const b = topLevelBlockAt(view.state.doc, lastFrom)
          if (b) {
            void navigator.clipboard?.writeText(blockPlainText(b.node)).catch(() => {})
          }
          duplicateTopLevelBlock(view, lastFrom)
        }),
        item(t('knowledge.block.insertAbove', 'Insert above'), 'knowledge-live-block-insert-above', () => {
          if (lastFrom < 0) return
          const at = insertEmptyParagraphNear(view, lastFrom, -1)
          if (at != null && openSlashAtTopLevelBlock(view, at)) {
            opts.onOpenedSlash?.()
          }
        }),
        item(t('knowledge.block.insertBelow', 'Insert below'), 'knowledge-live-block-insert-below', () => {
          if (lastFrom < 0) return
          if (openSlashAtTopLevelBlock(view, lastFrom)) {
            opts.onOpenedSlash?.()
          }
        }),
      )

      const sep = document.createElement('div')
      sep.className = 'my-1 h-px bg-border'
      sep.setAttribute('role', 'separator')
      menu.append(sep)

      const sub = document.createElement('div')
      sub.className = 'px-3 py-1 text-caption text-ink-tertiary'
      sub.textContent = t('knowledge.block.turnInto', 'Turn into')
      menu.append(sub)

      const turns: { id: TurnIntoTarget; label: string; testId: string }[] = [
        { id: 'paragraph', label: t('knowledge.bubble.paragraph', 'Paragraph'), testId: 'knowledge-live-block-turn-p' },
        { id: 'h1', label: t('knowledge.toolbar.h1', 'Heading 1'), testId: 'knowledge-live-block-turn-h1' },
        { id: 'h2', label: t('knowledge.toolbar.h2', 'Heading 2'), testId: 'knowledge-live-block-turn-h2' },
        { id: 'h3', label: t('knowledge.toolbar.h3', 'Heading 3'), testId: 'knowledge-live-block-turn-h3' },
        { id: 'quote', label: t('knowledge.toolbar.quote', 'Quote'), testId: 'knowledge-live-block-turn-quote' },
      ]
      for (const trn of turns) {
        menu.append(
          item(trn.label, trn.testId, () => {
            if (!canTurnIntoNarrow(view.state) && trn.id !== 'paragraph') {
              // still try after select
            }
            runTurn(trn.id)
          }),
        )
      }

      root.appendChild(menu)
      return menu
    }

    const showMenu = (view: EditorView) => {
      const m = buildMenu(view)
      if (!m || !gutter || !root) return
      const gRect = gutter.getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      m.style.display = 'block'
      m.style.left = `${gRect.right - rootRect.left + root.scrollLeft + 4}px`
      m.style.top = `${gRect.top - rootRect.top + root.scrollTop}px`
      setMenusFlag(true)
      if (lastFrom >= 0) {
        selectTopLevelBlock(view, lastFrom)
        highlightBlockDom(view, lastFrom, root)
      }
    }

    const ensureGutter = (view: EditorView) => {
      if (gutter) return gutter
      root = view.dom.parentElement
      if (!root) return null
      if (getComputedStyle(root).position === 'static') {
        root.style.position = 'relative'
      }

      gutter = document.createElement('div')
      gutter.className =
        'knowledge-live-block-gutter absolute z-40 flex items-center gap-0.5 opacity-0 transition-opacity'
      gutter.style.left = '0px'
      gutter.setAttribute('data-testid', 'knowledge-live-block-gutter')

      grip = document.createElement('button')
      grip.type = 'button'
      grip.textContent = '⋮⋮'
      grip.className =
        'knowledge-live-block-grip flex h-6 w-6 cursor-grab items-center justify-center rounded-md border border-border bg-surface text-[10px] leading-none text-ink-tertiary shadow-sm hover:bg-state-hover hover:text-ink active:cursor-grabbing'
      grip.setAttribute('data-testid', 'knowledge-live-block-grip')
      grip.setAttribute('aria-label', t('knowledge.block.grip', 'Drag or open block menu'))
      grip.tabIndex = -1

      plus = document.createElement('button')
      plus.type = 'button'
      plus.textContent = '+'
      plus.className =
        'knowledge-live-block-plus flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface text-meta text-ink-tertiary shadow-sm hover:bg-state-hover hover:text-ink'
      plus.setAttribute('data-testid', 'knowledge-live-block-plus')
      plus.setAttribute('aria-label', t('knowledge.blockHandle.add', 'Add block below'))
      plus.tabIndex = -1

      plus.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
      })
      plus.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        hideMenu()
        if (lastFrom < 0) return
        if (openSlashAtTopLevelBlock(view, lastFrom)) {
          opts.onOpenedSlash?.()
        }
      })

      grip.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (lastFrom < 0 || !view.editable) return
        dragPending = true
        dragActive = false
        dragStartX = e.clientX
        dragStartY = e.clientY
        const src = resolveSourceBlock(view.state.doc, lastFrom)
        if (!src) {
          dragPending = false
          return
        }
        dragSourceFrom = src.from
        dragSourceTo = src.to
        try {
          const dom = view.nodeDOM(src.from)
          dragSourceDom = dom instanceof HTMLElement ? dom : null
        } catch {
          dragSourceDom = null
        }

        const onMove = (ev: PointerEvent) => {
          if (!dragPending && !dragActive) return
          const dx = ev.clientX - dragStartX
          const dy = ev.clientY - dragStartY
          if (!dragActive && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
            dragActive = true
            hideMenu()
            if (dragSourceDom) dragSourceDom.style.opacity = '0.4'
          }
          if (!dragActive) return
          const target = findDropTarget(view, ev.clientY, dragSourceFrom, dragSourceTo)
          if (target) showDropLineAt(target.clientY)
          else hideDropLine()
        }

        const onUp = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          const wasDrag = dragActive
          dragPending = false
          dragActive = false
          hideDropLine()
          if (dragSourceDom) {
            dragSourceDom.style.opacity = ''
            dragSourceDom = null
          }
          if (wasDrag) {
            const target = findDropTarget(
              view,
              ev.clientY,
              dragSourceFrom,
              dragSourceTo,
            )
            if (target) {
              moveTopLevelBlock(
                view,
                dragSourceFrom,
                dragSourceTo,
                target.insertPos,
              )
            }
            dragSourceFrom = -1
            dragSourceTo = -1
            return
          }
          // click → menu
          showMenu(view)
        }

        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      })

      gutter.append(grip, plus)
      root.appendChild(gutter)
      return gutter
    }

    const hideGutter = () => {
      if (gutter) gutter.style.opacity = '0'
      if (!menuOpen) {
        lastFrom = -1
      }
    }

    const showAt = (view: EditorView, from: number, _to: number, top: number) => {
      const g = ensureGutter(view)
      if (!g || !root) return
      lastFrom = from
      g.style.top = `${Math.max(0, top - 2)}px`
      g.style.left = '0px'
      g.style.opacity = '1'
    }

    return new Plugin({
      key,
      props: {
        handleKeyDown(view, event) {
          if (event.key === 'Escape' && menuOpen) {
            hideMenu()
            if (root) clearBlockHighlight(root)
            return true
          }
          if (
            (event.key === 'Backspace' || event.key === 'Delete') &&
            view.state.selection instanceof TextSelection === false
          ) {
            // NodeSelection delete handled by PM default
          }
          return false
        },
      },
      view(view) {
        let moveRaf = 0
        let lastMove: MouseEvent | null = null

        const onDocClick = (e: MouseEvent) => {
          if (!menuOpen || !menu) return
          const t = e.target as Node
          if (menu.contains(t) || grip?.contains(t)) return
          hideMenu()
          if (root) clearBlockHighlight(root)
        }
        document.addEventListener('mousedown', onDocClick, true)

        const processMove = () => {
          moveRaf = 0
          const e = lastMove
          lastMove = null
          if (dragActive || dragPending) return
          if (!e || !view.editable) {
            if (!menuOpen) hideGutter()
            return
          }
          const pmRect = view.dom.getBoundingClientRect()
          // Keep visible when over gutter
          if (gutter && gutter.contains(e.target as Node)) return
          if (menu && menu.contains(e.target as Node)) return
          if (e.clientX > pmRect.left + 56) {
            if (!menuOpen) hideGutter()
            return
          }
          const range = topLevelBlockRange(view, e.clientY)
          if (!range) {
            if (!menuOpen) hideGutter()
            return
          }
          showAt(view, range.from, range.to, range.top)
        }

        const onMove = (e: MouseEvent) => {
          lastMove = e
          if (moveRaf) return
          moveRaf = requestAnimationFrame(processMove)
        }
        const onLeave = (e: MouseEvent) => {
          const rel = e.relatedTarget as Node | null
          if (gutter && rel && gutter.contains(rel)) return
          if (menu && rel && menu.contains(rel)) return
          lastMove = null
          if (moveRaf) {
            cancelAnimationFrame(moveRaf)
            moveRaf = 0
          }
          if (!menuOpen && !dragActive) hideGutter()
        }

        view.dom.addEventListener('mousemove', onMove)
        view.dom.addEventListener('mouseleave', onLeave)

        // selected block accent via CSS injected once
        if (root || view.dom.parentElement) {
          const r = view.dom.parentElement
          if (r && !r.querySelector('style[data-knowledge-block-gutter]')) {
            const style = document.createElement('style')
            style.setAttribute('data-knowledge-block-gutter', '1')
            style.textContent = `
              .knowledge-live-block-selected {
                box-shadow: inset 2px 0 0 var(--accent, #c2410c);
                background: color-mix(in srgb, var(--accent, #c2410c) 6%, transparent);
                border-radius: 2px;
              }
            `
            r.appendChild(style)
          }
        }

        return {
          destroy() {
            document.removeEventListener('mousedown', onDocClick, true)
            view.dom.removeEventListener('mousemove', onMove)
            view.dom.removeEventListener('mouseleave', onLeave)
            if (moveRaf) cancelAnimationFrame(moveRaf)
            hideMenu()
            hideDropLine()
            gutter?.remove()
            menu?.remove()
            dropLine?.remove()
            gutter = null
            grip = null
            plus = null
            menu = null
            dropLine = null
            root = null
          },
        }
      },
    })
  })
}

