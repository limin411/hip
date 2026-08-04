/**
 * Live top-level block gutter: grip (menu / drag) + plus slash.
 * Phase A: slot layout, SVG icons, hover, ghost, drop line, edge scroll.
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
  deleteTopLevelRange,
  duplicateTopLevelBlock,
  insertEmptyParagraphNear,
  selectTopLevelBlock,
  topLevelBlockAt,
  topLevelIndexRange,
} from '@/domain/knowledge/blockOps'
import {
  findDropTargetV2,
  moveTopLevelBlock,
  moveTopLevelRange,
  resolveSourceBlock,
  type DropTarget,
} from '@/domain/knowledge/blockDrag'
import i18n from '@/i18n'
import { openSlashAtTopLevelBlock } from './liveBlockHandle'
import {
  iconGripVertical,
  iconPlus,
  setButtonIcon,
} from './liveChromeIcons'

export { openSlashAtTopLevelBlock }

const key = new PluginKey('knowledge-live-block-gutter')
const DRAG_THRESHOLD_PX = 4
/** Matches --knowledge-live-gutter-slot in knowledge-live.css */
export const GUTTER_SLOT_PX = 32
const EDGE_SCROLL_PX = 48
const EDGE_SCROLL_STEP = 14

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
  const x = rect.left + GUTTER_SLOT_PX + 8
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

function clearBlockHover(root: HTMLElement) {
  root.querySelectorAll('.knowledge-live-block-hover').forEach((el) => {
    el.classList.remove('knowledge-live-block-hover')
  })
}

function clearBlockHighlight(root: HTMLElement) {
  root.querySelectorAll('.knowledge-live-block-selected').forEach((el) => {
    el.classList.remove('knowledge-live-block-selected')
  })
}

function highlightBlockDom(
  view: EditorView,
  from: number,
  root: HTMLElement,
  mode: 'hover' | 'selected',
) {
  if (mode === 'hover') clearBlockHover(root)
  else clearBlockHighlight(root)
  try {
    const dom = view.nodeDOM(from)
    if (dom instanceof HTMLElement) {
      dom.classList.add(
        mode === 'hover'
          ? 'knowledge-live-block-hover'
          : 'knowledge-live-block-selected',
      )
    }
  } catch {
    // ignore
  }
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el
  while (cur) {
    if (cur.classList.contains('knowledge-live-editor')) return cur
    const { overflowY } = getComputedStyle(cur)
    if (overflowY === 'auto' || overflowY === 'scroll') return cur
    cur = cur.parentElement
  }
  return null
}

function edgeScroll(scroller: HTMLElement | null, clientY: number) {
  if (!scroller) return
  const rect = scroller.getBoundingClientRect()
  if (clientY < rect.top + EDGE_SCROLL_PX) {
    scroller.scrollTop -= EDGE_SCROLL_STEP
  } else if (clientY > rect.bottom - EDGE_SCROLL_PX) {
    scroller.scrollTop += EDGE_SCROLL_STEP
  }
}

export type BlockGutterOptions = {
  onOpenedSlash?: () => void
  menusOpenRef?: MenusFlag
  getTurnCmds?: () => TurnCmds | null
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
    let dropInto: HTMLDivElement | null = null
    let ghost: HTMLDivElement | null = null
    let root: HTMLElement | null = null
    let lastFrom = -1
    let menuOpen = false
    let hoverFrom = -1
    /** Multi-select: continuous top-level index range, or null. */
    let multiFromIndex: number | null = null
    let multiToIndex: number | null = null
    let multiAnchorFrom = -1

    let dragActive = false
    let dragPending = false
    let dragStartX = 0
    let dragStartY = 0
    let dragSourceFrom = -1
    let dragSourceTo = -1
    let dragSourceDom: HTMLElement | null = null
    let scroller: HTMLElement | null = null

    const clearMulti = (view?: EditorView) => {
      multiFromIndex = null
      multiToIndex = null
      multiAnchorFrom = -1
      if (root) clearBlockHighlight(root)
      if (view && root) {
        // keep hover if any
      }
    }

    const paintMulti = (view: EditorView) => {
      if (!root || multiFromIndex == null || multiToIndex == null) return
      clearBlockHighlight(root)
      let pos = 0
      for (let i = 0; i < view.state.doc.childCount; i++) {
        const child = view.state.doc.child(i)
        if (i >= multiFromIndex && i <= multiToIndex) {
          try {
            const dom = view.nodeDOM(pos)
            if (dom instanceof HTMLElement) {
              dom.classList.add('knowledge-live-block-selected')
            }
          } catch {
            // ignore
          }
        }
        pos += child.nodeSize
      }
    }

    const setMenusFlag = (open: boolean) => {
      menuOpen = open
      opts.onBlockMenuOpenChange?.(open)
    }

    const hideMenu = () => {
      if (menu) menu.style.display = 'none'
      setMenusFlag(false)
    }

    const ensureDropLine = () => {
      if (dropLine || !root) return dropLine
      dropLine = document.createElement('div')
      dropLine.className = 'knowledge-live-drop-line'
      dropLine.setAttribute('data-testid', 'knowledge-live-drop-line')
      dropLine.setAttribute('data-visible', 'false')
      root.appendChild(dropLine)
      return dropLine
    }

    const hideDropLine = () => {
      if (dropLine) dropLine.setAttribute('data-visible', 'false')
      if (dropInto) dropInto.setAttribute('data-visible', 'false')
    }

    const ensureDropInto = () => {
      if (dropInto || !root) return dropInto
      dropInto = document.createElement('div')
      dropInto.className = 'knowledge-live-drop-into'
      dropInto.setAttribute('data-testid', 'knowledge-live-drop-into')
      dropInto.setAttribute('data-visible', 'false')
      root.appendChild(dropInto)
      return dropInto
    }

    const showDropTarget = (target: DropTarget) => {
      if (!root) return
      const rootRect = root.getBoundingClientRect()
      if (target.kind === 'into') {
        if (dropLine) dropLine.setAttribute('data-visible', 'false')
        const bar = ensureDropInto()
        if (!bar) return
        bar.setAttribute('data-visible', 'true')
        bar.style.left = `${(target.clientX ?? rootRect.left + GUTTER_SLOT_PX) - rootRect.left + root.scrollLeft}px`
        bar.style.top = `${target.clientY - rootRect.top + root.scrollTop - (target.intoHeight ?? 24) / 2}px`
        bar.style.height = `${target.intoHeight ?? 24}px`
        return
      }
      if (dropInto) dropInto.setAttribute('data-visible', 'false')
      const line = ensureDropLine()
      if (!line) return
      line.setAttribute('data-visible', 'true')
      line.style.top = `${target.clientY - rootRect.top + root.scrollTop - 1}px`
    }

    const removeGhost = () => {
      ghost?.remove()
      ghost = null
    }

    const ensureGhost = (sourceDom: HTMLElement, clientX: number, clientY: number) => {
      removeGhost()
      ghost = document.createElement('div')
      ghost.className = 'knowledge-live-drag-ghost'
      ghost.setAttribute('data-testid', 'knowledge-live-drag-ghost')
      const text = (sourceDom.textContent ?? '').trim().slice(0, 120)
      ghost.textContent = text || '…'
      ghost.style.left = `${clientX + 12}px`
      ghost.style.top = `${clientY + 8}px`
      document.body.appendChild(ghost)
    }

    const moveGhost = (clientX: number, clientY: number) => {
      if (!ghost) return
      ghost.style.left = `${clientX + 12}px`
      ghost.style.top = `${clientY + 8}px`
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
          if (root) {
            clearBlockHighlight(root)
            clearBlockHover(root)
          }
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
        { id: 'bullet', label: t('knowledge.toolbar.bullet', 'Bullet list'), testId: 'knowledge-live-block-turn-bullet' },
        { id: 'ordered', label: t('knowledge.toolbar.ordered', 'Numbered list'), testId: 'knowledge-live-block-turn-ordered' },
        { id: 'task', label: t('knowledge.slash.task', 'Task list'), testId: 'knowledge-live-block-turn-task' },
        { id: 'code', label: t('knowledge.toolbar.fence', 'Code block'), testId: 'knowledge-live-block-turn-code' },
      ]
      for (const trn of turns) {
        menu.append(
          item(trn.label, trn.testId, () => {
            void canTurnIntoNarrow(view.state)
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
        highlightBlockDom(view, lastFrom, root, 'selected')
      }
    }

    const ensureGutter = (view: EditorView) => {
      if (gutter) return gutter
      root = view.dom.parentElement
      if (!root) return null
      if (getComputedStyle(root).position === 'static') {
        root.style.position = 'relative'
      }
      scroller = findScrollParent(view.dom)

      gutter = document.createElement('div')
      gutter.className = 'knowledge-live-block-gutter'
      gutter.style.left = '0px'
      gutter.setAttribute('data-testid', 'knowledge-live-block-gutter')
      gutter.setAttribute('data-visible', 'false')

      grip = document.createElement('button')
      grip.type = 'button'
      setButtonIcon(grip, iconGripVertical())
      grip.className = 'knowledge-live-block-grip'
      grip.setAttribute('data-testid', 'knowledge-live-block-grip')
      grip.setAttribute('aria-label', t('knowledge.block.grip', 'Drag or open block menu'))
      grip.tabIndex = -1

      plus = document.createElement('button')
      plus.type = 'button'
      setButtonIcon(plus, iconPlus())
      plus.className = 'knowledge-live-block-plus'
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

        // Shift+click: extend multi-select range among top-level blocks
        if (e.shiftKey) {
          const cur = topLevelBlockAt(view.state.doc, lastFrom)
          if (!cur) return
          if (multiAnchorFrom < 0) multiAnchorFrom = lastFrom
          const range = topLevelIndexRange(
            view.state.doc,
            multiAnchorFrom,
            lastFrom,
          )
          if (range) {
            multiFromIndex = range.fromIndex
            multiToIndex = range.toIndex
            paintMulti(view)
          }
          return
        }

        dragPending = true
        dragActive = false
        dragStartX = e.clientX
        dragStartY = e.clientY
        const src = resolveSourceBlock(view.state.doc, lastFrom)
        if (!src) {
          dragPending = false
          return
        }
        // If multi-select includes this block, drag whole range
        const curBlock = topLevelBlockAt(view.state.doc, lastFrom)
        let rangeDrag = false
        if (
          curBlock &&
          multiFromIndex != null &&
          multiToIndex != null &&
          curBlock.index >= multiFromIndex &&
          curBlock.index <= multiToIndex
        ) {
          rangeDrag = true
          let from = 0
          for (let i = 0; i < multiFromIndex; i++) {
            from += view.state.doc.child(i).nodeSize
          }
          let to = from
          for (let i = multiFromIndex; i <= multiToIndex; i++) {
            to += view.state.doc.child(i).nodeSize
          }
          dragSourceFrom = from
          dragSourceTo = to
        } else {
          clearMulti()
          multiAnchorFrom = lastFrom
          dragSourceFrom = src.from
          dragSourceTo = src.to
        }
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
            if (dragSourceDom) {
              dragSourceDom.style.opacity = '0.35'
              ensureGhost(dragSourceDom, ev.clientX, ev.clientY)
            }
          }
          if (!dragActive) return
          moveGhost(ev.clientX, ev.clientY)
          edgeScroll(scroller, ev.clientY)
          const target = findDropTargetV2(
            view,
            ev.clientY,
            dragSourceFrom,
            dragSourceTo,
            { allowInto: !rangeDrag, clientX: ev.clientX },
          )
          if (target) showDropTarget(target)
          else hideDropLine()
        }

        const onUp = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          const wasDrag = dragActive
          dragPending = false
          dragActive = false
          hideDropLine()
          removeGhost()
          if (dragSourceDom) {
            dragSourceDom.style.opacity = ''
            dragSourceDom = null
          }
          if (wasDrag) {
            const target = findDropTargetV2(
              view,
              ev.clientY,
              dragSourceFrom,
              dragSourceTo,
              { allowInto: !rangeDrag, clientX: ev.clientX },
            )
            if (target) {
              if (
                rangeDrag &&
                multiFromIndex != null &&
                multiToIndex != null
              ) {
                moveTopLevelRange(
                  view,
                  multiFromIndex,
                  multiToIndex,
                  target.insertPos,
                )
                clearMulti()
              } else {
                moveTopLevelBlock(
                  view,
                  dragSourceFrom,
                  dragSourceTo,
                  target.insertPos,
                )
              }
            }
            dragSourceFrom = -1
            dragSourceTo = -1
            return
          }
          // plain click: single select + menu
          clearMulti()
          multiAnchorFrom = lastFrom
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
      if (gutter) gutter.setAttribute('data-visible', 'false')
      if (root && !menuOpen) {
        clearBlockHover(root)
        hoverFrom = -1
      }
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
      g.setAttribute('data-visible', 'true')
      if (hoverFrom !== from && !menuOpen) {
        hoverFrom = from
        highlightBlockDom(view, from, root, 'hover')
      }
    }

    return new Plugin({
      key,
      props: {
        handleKeyDown(view, event) {
          if (event.key === 'Escape') {
            if (menuOpen) {
              hideMenu()
              if (root) {
                clearBlockHighlight(root)
                clearBlockHover(root)
              }
              return true
            }
            if (multiFromIndex != null) {
              clearMulti()
              return true
            }
          }
          if (
            (event.key === 'Backspace' || event.key === 'Delete') &&
            multiFromIndex != null &&
            multiToIndex != null
          ) {
            event.preventDefault()
            deleteTopLevelRange(view, multiFromIndex, multiToIndex)
            clearMulti()
            return true
          }
          if (
            (event.key === 'Backspace' || event.key === 'Delete') &&
            view.state.selection instanceof TextSelection === false
          ) {
            // NodeSelection delete handled by PM default
          }
          // Typing cancels multi-select
          if (
            multiFromIndex != null &&
            event.key.length === 1 &&
            !event.metaKey &&
            !event.ctrlKey
          ) {
            clearMulti()
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
          if (root) {
            clearBlockHighlight(root)
            clearBlockHover(root)
          }
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
          if (gutter && gutter.contains(e.target as Node)) return
          if (menu && menu.contains(e.target as Node)) return
          // Hot zone: gutter slot + left content margin
          const hotRight = pmRect.left + GUTTER_SLOT_PX + 48
          if (e.clientX > hotRight) {
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

        return {
          destroy() {
            document.removeEventListener('mousedown', onDocClick, true)
            view.dom.removeEventListener('mousemove', onMove)
            view.dom.removeEventListener('mouseleave', onLeave)
            if (moveRaf) cancelAnimationFrame(moveRaf)
            hideMenu()
            hideDropLine()
            removeGhost()
            gutter?.remove()
            menu?.remove()
            dropLine?.remove()
            dropInto?.remove()
            gutter = null
            grip = null
            plus = null
            menu = null
            dropLine = null
            dropInto = null
            root = null
          },
        }
      },
    })
  })
}
