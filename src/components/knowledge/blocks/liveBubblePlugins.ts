/**
 * Live selection bubble toolbar (R4 Gate A + B).
 * Milkdown kit tooltipFactory + TooltipProvider; no Vue / Crepe.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import {
  tooltipFactory,
  TooltipProvider,
} from '@milkdown/kit/plugin/tooltip'
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  toggleLinkCommand,
  updateLinkCommand,
  wrapInBlockquoteCommand,
} from '@milkdown/kit/preset/commonmark'
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import type { CmdKey } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { knowledgeBubbleShouldShow } from '@/domain/knowledge/liveSelection'
import { sanitizeKnowledgeLinkHref } from '@/domain/knowledge/linkSanitize'
import {
  applyTurnInto,
  canTurnInto,
  canTurnIntoNarrow,
  type TurnIntoTarget,
} from '@/domain/knowledge/turnInto'
import i18n from '@/i18n'
import type { KnowledgeNode } from '@/domain/knowledge/types'

export type BubbleMenusFlag = { current: boolean }

export type BubbleWikiSource = {
  /** Docs in current space for link search. */
  current: KnowledgeNode[]
}

export const knowledgeBubbleTooltip = tooltipFactory('knowledge-bubble')

type Labels = {
  toolbar: string
  bold: string
  italic: string
  strike: string
  code: string
  h1: string
  h2: string
  h3: string
  link: string
  turnInto: string
  paragraph: string
  quote: string
  linkApply: string
  linkRemove: string
  linkHref: string
  clearMarks: string
  bullet: string
  ordered: string
  task: string
  fence: string
  linkSearch: string
}

function tLabels(): Labels {
  const t = (key: string, fallback: string) =>
    i18n.t(key, { defaultValue: fallback })
  return {
    toolbar: t('knowledge.bubble.label', 'Formatting'),
    bold: t('knowledge.toolbar.bold', 'Bold'),
    italic: t('knowledge.toolbar.italic', 'Italic'),
    strike: t('knowledge.toolbar.strike', 'Strikethrough'),
    code: t('knowledge.toolbar.code', 'Inline code'),
    h1: t('knowledge.toolbar.h1', 'Heading 1'),
    h2: t('knowledge.toolbar.h2', 'Heading 2'),
    h3: t('knowledge.toolbar.h3', 'Heading 3'),
    link: t('knowledge.toolbar.link', 'Link'),
    turnInto: t('knowledge.bubble.turnInto', 'Turn into'),
    paragraph: t('knowledge.bubble.paragraph', 'Paragraph'),
    quote: t('knowledge.toolbar.quote', 'Quote'),
    linkApply: t('knowledge.bubble.linkApply', 'Apply'),
    linkRemove: t('knowledge.bubble.linkRemove', 'Remove link'),
    linkHref: t('knowledge.bubble.linkHref', 'URL'),
    clearMarks: t('knowledge.bubble.clearMarks', 'Clear formatting'),
    bullet: t('knowledge.toolbar.bullet', 'Bullet list'),
    ordered: t('knowledge.toolbar.ordered', 'Numbered list'),
    task: t('knowledge.slash.task', 'Task list'),
    fence: t('knowledge.toolbar.fence', 'Code block'),
    linkSearch: t('knowledge.bubble.linkSearch', 'Search docs…'),
  }
}

const BTN =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-state-hover hover:text-ink disabled:opacity-40'
const BTN_ACTIVE = 'bg-state-hover text-ink'

function iconBtn(
  label: string,
  testId: string,
  onClick: () => void,
  text: string,
): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = BTN
  b.title = label
  b.setAttribute('aria-label', label)
  b.setAttribute('data-testid', testId)
  b.textContent = text
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

function call<T>(
  ctx: Ctx,
  cmd: { key: CmdKey<T> },
  payload?: T,
): boolean {
  try {
    return ctx.get(commandsCtx).call(cmd.key, payload)
  } catch {
    return false
  }
}

function selectionLinkHref(view: EditorView): string | null {
  const { from, to, empty, $from } = view.state.selection
  const type = view.state.schema.marks.link
  if (!type) return null
  if (!empty) {
    let found: string | null = null
    view.state.doc.nodesBetween(from, to, (node) => {
      const mark = type.isInSet(node.marks)
      if (mark) {
        found = (mark.attrs.href as string) ?? ''
        return false
      }
    })
    return found
  }
  const mark = type.isInSet($from.marks())
  return mark ? ((mark.attrs.href as string) ?? '') : null
}

export type BubbleProviderHandle = {
  provider: TooltipProvider
  isVisible: () => boolean
  hide: () => void
  destroy: () => void
}

/**
 * Build bubble DOM + TooltipProvider for a Live editor view.
 * `menusOpenRef` is read on each shouldShow (slash/wiki).
 */
export function createKnowledgeBubble(
  ctx: Ctx,
  view: EditorView,
  root: HTMLElement,
  menusOpenRef: BubbleMenusFlag,
  wikiNodesRef?: BubbleWikiSource,
): BubbleProviderHandle {
  const labels = tLabels()
  const content = document.createElement('div')
  content.className =
    'knowledge-live-bubble z-[60] flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface px-1 py-0.5 shadow-overlay'
  content.setAttribute('role', 'toolbar')
  content.setAttribute('aria-label', labels.toolbar)
  content.setAttribute('data-testid', 'knowledge-live-bubble')
  content.style.position = 'absolute'
  content.style.zIndex = '60'
  // TooltipProvider toggles dataset.show
  content.dataset.show = 'false'
  content.style.display = 'none'

  let linkPanelOpen = false
  let turnMenuOpen = false

  const mainRow = document.createElement('div')
  mainRow.className = 'flex items-center gap-0.5'
  mainRow.setAttribute('data-testid', 'knowledge-live-bubble-main')

  const linkPanel = document.createElement('div')
  linkPanel.className =
    'ml-1 flex max-w-xs flex-col gap-1 border-l border-border pl-1'
  linkPanel.setAttribute('data-testid', 'knowledge-live-bubble-link-panel')
  linkPanel.hidden = true

  const linkRow = document.createElement('div')
  linkRow.className = 'flex items-center gap-1'

  const docHits = document.createElement('div')
  docHits.className = 'flex max-h-28 flex-col overflow-y-auto'
  docHits.setAttribute('data-testid', 'knowledge-live-bubble-link-docs')

  const turnMenu = document.createElement('div')
  turnMenu.className =
    'absolute left-0 top-full z-[61] mt-1 min-w-[9rem] rounded-md border border-border bg-surface py-1 shadow-overlay'
  turnMenu.setAttribute('data-testid', 'knowledge-live-bubble-turn-menu')
  turnMenu.hidden = true
  content.style.position = 'absolute'

  const hrefInput = document.createElement('input')
  hrefInput.type = 'text'
  hrefInput.className =
    'h-7 w-40 rounded border border-border bg-surface px-1.5 text-meta text-ink'
  hrefInput.placeholder = labels.linkHref
  hrefInput.setAttribute('aria-label', labels.linkHref)
  hrefInput.setAttribute('data-testid', 'knowledge-live-bubble-link-href')
  hrefInput.addEventListener('mousedown', (e) => e.stopPropagation())

  const refreshDocHits = () => {
    docHits.replaceChildren()
    const q = hrefInput.value.trim().toLowerCase()
    if (!q || q.includes('://') || q.startsWith('http')) return
    const nodes = (wikiNodesRef?.current ?? []).filter(
      (n) => n.kind === 'doc' && n.title.toLowerCase().includes(q),
    )
    for (const n of nodes.slice(0, 8)) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className =
        'w-full truncate px-2 py-1 text-left text-meta text-ink hover:bg-state-hover'
      b.textContent = n.title
      b.setAttribute('data-testid', `knowledge-live-bubble-link-doc-${n.id}`)
      b.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
      })
      b.addEventListener('click', () => {
        // Insert wiki-style markdown link target as md link to # or use [[ via text
        const href = sanitizeKnowledgeLinkHref(`[[${n.title}]]`) || `wiki://${encodeURIComponent(n.title)}`
        // Prefer plain URL-like title path for md: use relative wiki token as text link
        const existing = selectionLinkHref(view)
        const finalHref = `#${encodeURIComponent(n.title)}`
        if (existing != null) {
          call(ctx, updateLinkCommand, { href: finalHref })
        } else {
          call(ctx, toggleLinkCommand, { href: finalHref })
        }
        // Also try inserting wiki if selection empty handled by toggle
        void href
        linkPanelOpen = false
        linkPanel.hidden = true
        view.focus()
      })
      docHits.append(b)
    }
  }
  hrefInput.addEventListener('input', refreshDocHits)

  const applyLink = () => {
    const raw = hrefInput.value.trim()
    // Wiki title without scheme → markdown link to #title (navigable via app later)
    let href = sanitizeKnowledgeLinkHref(raw)
    if (!href && raw && !raw.includes('://')) {
      href = `#${encodeURIComponent(raw)}`
    }
    if (!href) return
    const existing = selectionLinkHref(view)
    if (existing != null) {
      call(ctx, updateLinkCommand, { href })
    } else {
      call(ctx, toggleLinkCommand, { href })
    }
    linkPanelOpen = false
    linkPanel.hidden = true
  }

  const removeLink = () => {
    call(ctx, toggleLinkCommand, {})
    linkPanelOpen = false
    linkPanel.hidden = true
  }

  linkRow.append(
    hrefInput,
    iconBtn(labels.linkApply, 'knowledge-live-bubble-link-apply', applyLink, '✓'),
    iconBtn(labels.linkRemove, 'knowledge-live-bubble-link-remove', removeLink, '×'),
  )
  linkPanel.append(linkRow, docHits)

  const runMark = (fn: () => boolean) => {
    fn()
    try {
      ctx.get(editorViewCtx).focus()
    } catch {
      view.focus()
    }
  }

  mainRow.append(
    iconBtn(labels.bold, 'knowledge-live-bubble-bold', () => {
      runMark(() => call(ctx, toggleStrongCommand))
    }, 'B'),
    iconBtn(labels.italic, 'knowledge-live-bubble-italic', () => {
      runMark(() => call(ctx, toggleEmphasisCommand))
    }, 'I'),
    iconBtn(labels.strike, 'knowledge-live-bubble-strike', () => {
      runMark(() => call(ctx, toggleStrikethroughCommand))
    }, 'S'),
    iconBtn(labels.code, 'knowledge-live-bubble-code', () => {
      runMark(() => call(ctx, toggleInlineCodeCommand))
    }, '</>'),
  )

  const sep = document.createElement('span')
  sep.className = 'mx-0.5 h-4 w-px bg-border'
  sep.setAttribute('aria-hidden', 'true')
  mainRow.append(sep)

  mainRow.append(
    iconBtn(labels.h1, 'knowledge-live-bubble-h1', () => {
      runMark(() => call(ctx, wrapInHeadingCommand, 1))
    }, 'H1'),
    iconBtn(labels.h2, 'knowledge-live-bubble-h2', () => {
      runMark(() => call(ctx, wrapInHeadingCommand, 2))
    }, 'H2'),
    iconBtn(labels.h3, 'knowledge-live-bubble-h3', () => {
      runMark(() => call(ctx, wrapInHeadingCommand, 3))
    }, 'H3'),
  )

  const sep2 = document.createElement('span')
  sep2.className = 'mx-0.5 h-4 w-px bg-border'
  sep2.setAttribute('aria-hidden', 'true')
  mainRow.append(sep2)

  mainRow.append(
    iconBtn(labels.link, 'knowledge-live-bubble-link', () => {
      linkPanelOpen = !linkPanelOpen
      turnMenuOpen = false
      turnMenu.hidden = true
      linkPanel.hidden = !linkPanelOpen
      if (linkPanelOpen) {
        hrefInput.value = selectionLinkHref(view) ?? ''
        hrefInput.focus()
      }
    }, '🔗'),
  )

  const turnBtn = iconBtn(labels.turnInto, 'knowledge-live-bubble-turn', () => {
    turnMenuOpen = !turnMenuOpen
    linkPanelOpen = false
    linkPanel.hidden = true
    turnMenu.hidden = !turnMenuOpen
  }, '↕')
  mainRow.append(turnBtn)

  mainRow.append(
    iconBtn(labels.clearMarks, 'knowledge-live-bubble-clear', () => {
      runMark(() => {
        const { state, dispatch } = view
        const { from, to, empty } = state.selection
        if (empty) return false
        let tr = state.tr
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isInline) return
          for (const mark of node.marks) {
            tr = tr.removeMark(pos, pos + node.nodeSize, mark.type)
          }
        })
        if (tr.docChanged) {
          dispatch(tr)
          return true
        }
        return false
      })
    }, 'Tₓ'),
  )

  const turnTargets: { id: TurnIntoTarget; label: string; testId: string }[] = [
    { id: 'paragraph', label: labels.paragraph, testId: 'knowledge-live-turn-p' },
    { id: 'h1', label: labels.h1, testId: 'knowledge-live-turn-h1' },
    { id: 'h2', label: labels.h2, testId: 'knowledge-live-turn-h2' },
    { id: 'h3', label: labels.h3, testId: 'knowledge-live-turn-h3' },
    { id: 'quote', label: labels.quote, testId: 'knowledge-live-turn-quote' },
    { id: 'bullet', label: labels.bullet, testId: 'knowledge-live-turn-bullet' },
    { id: 'ordered', label: labels.ordered, testId: 'knowledge-live-turn-ordered' },
    { id: 'task', label: labels.task, testId: 'knowledge-live-turn-task' },
    { id: 'code', label: labels.fence, testId: 'knowledge-live-turn-code' },
  ]
  for (const item of turnTargets) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className =
      'flex w-full items-center px-3 py-1.5 text-left text-meta text-ink hover:bg-state-hover'
    b.textContent = item.label
    b.setAttribute('data-testid', item.testId)
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    b.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!canTurnInto(view.state, item.id) && !canTurnIntoNarrow(view.state)) {
        // still attempt
      }
      applyTurnInto(view, item.id, {
        wrapHeading: (level) => call(ctx, wrapInHeadingCommand, level),
        wrapBlockquote: () => call(ctx, wrapInBlockquoteCommand),
      })
      turnMenuOpen = false
      turnMenu.hidden = true
      view.focus()
    })
    turnMenu.append(b)
  }

  content.append(mainRow, linkPanel, turnMenu)

  // Sync active mark styles on update via MutationObserver on show — light pass in shouldShow path.

  const provider = new TooltipProvider({
    content,
    debounce: 0,
    root,
    offset: 8,
    shouldShow: (v) => {
      const show = knowledgeBubbleShouldShow(v, {
        menusOpen: menusOpenRef.current,
      })
      if (!show) {
        linkPanelOpen = false
        turnMenuOpen = false
        linkPanel.hidden = true
        turnMenu.hidden = true
      }
      // Update button active states
      if (show) {
        try {
          const { from, $from, empty } = v.state.selection
          const marks = empty
            ? $from.marks()
            : v.state.doc.resolve(from).marks()
          const has = (name: string) => marks.some((m) => m.type.name === name)
          const setActive = (testId: string, on: boolean) => {
            const el = content.querySelector(`[data-testid="${testId}"]`)
            if (el instanceof HTMLElement) {
              el.className = on ? `${BTN} ${BTN_ACTIVE}` : BTN
            }
          }
          setActive('knowledge-live-bubble-bold', has('strong'))
          setActive('knowledge-live-bubble-italic', has('emphasis'))
          setActive('knowledge-live-bubble-strike', has('strike_through'))
          setActive('knowledge-live-bubble-code', has('inlineCode'))
        } catch {
          // ignore
        }
      }
      return show
    },
  })

  // Show/hide display with dataset (TooltipProvider only sets dataset.show)
  const syncDisplay = () => {
    const on = content.dataset.show === 'true'
    content.style.display = on ? 'flex' : 'none'
  }
  const mo = new MutationObserver(syncDisplay)
  mo.observe(content, { attributes: true, attributeFilter: ['data-show'] })
  provider.onShow = () => {
    content.style.display = 'flex'
  }
  provider.onHide = () => {
    content.style.display = 'none'
    linkPanelOpen = false
    turnMenuOpen = false
    linkPanel.hidden = true
    turnMenu.hidden = true
  }

  provider.update(view)

  return {
    provider,
    isVisible: () => content.dataset.show === 'true',
    hide: () => provider.hide(),
    destroy: () => {
      mo.disconnect()
      provider.destroy()
      content.remove()
    },
  }
}

/**
 * Configure milkdown tooltip plugin view. Call inside Editor.config before create.
 * Returns plugins to `.use()`.
 */
export function configureKnowledgeBubble(
  ctx: Ctx,
  root: HTMLElement,
  menusOpenRef: BubbleMenusFlag,
  handleRef: { current: BubbleProviderHandle | null },
  wikiNodesRef?: BubbleWikiSource,
): void {
  ctx.set(knowledgeBubbleTooltip.key, {
    view: (view) => {
      const handle = createKnowledgeBubble(
        ctx,
        view,
        root,
        menusOpenRef,
        wikiNodesRef,
      )
      handleRef.current = handle
      return {
        update: (v, prev) => {
          handle.provider.update(v, prev)
        },
        destroy: () => {
          handle.destroy()
          if (handleRef.current === handle) handleRef.current = null
        },
      }
    },
  })
}

/** Spread into Editor.use — tooltipFactory returns a dual plugin array. */
export const liveBubblePlugins = knowledgeBubbleTooltip
