/**
 * Feishu-style chrome for renderable diagram fences (mermaid / svg):
 * label · Source | Preview segment · copy source.
 *
 * Pure DOM (NodeView-friendly); no React.
 */

import i18n from '@/i18n'
import { copyText } from '@/ipc/clipboard'

export type DiagramChromeMode = 'edit' | 'preview'

export type DiagramChrome = {
  header: HTMLElement
  setMode: (mode: DiagramChromeMode) => void
  contains: (target: EventTarget | null) => boolean
}

const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'

const SEGMENT_IDLE =
  'rounded px-1.5 py-0.5 text-caption font-medium text-ink-tertiary hover:bg-state-hover hover:text-ink'
const SEGMENT_ACTIVE =
  'rounded px-1.5 py-0.5 text-caption font-medium bg-surface text-ink shadow-sm'

export function createDiagramChrome(opts: {
  kind: 'mermaid' | 'svg'
  label: string
  /** Prefix for data-testid, e.g. knowledge-live-mermaid */
  testIdPrefix: string
  getSource: () => string
  onMode: (mode: DiagramChromeMode) => void
  /**
   * Called after copy when the block was in edit/source mode. Restores edit
   * after clipboard fallback steals focus from ProseMirror.
   */
  onRestoreEditAfterCopy?: () => void
}): DiagramChrome {
  const header = document.createElement('div')
  header.className =
    'flex h-7 items-center justify-between gap-2 border-b border-border/80 px-2.5'
  header.setAttribute('data-testid', `${opts.testIdPrefix}-chrome`)
  header.dataset.kind = opts.kind
  // Defensive: keep controls outside the editable surface.
  header.contentEditable = 'false'

  const left = document.createElement('div')
  left.className = 'flex min-w-0 items-center gap-2'

  const labelEl = document.createElement('span')
  labelEl.className =
    'min-w-0 truncate text-caption font-medium text-ink-tertiary'
  labelEl.textContent = opts.label
  labelEl.setAttribute('data-testid', `${opts.testIdPrefix}-label`)

  const segment = document.createElement('div')
  segment.className =
    'flex shrink-0 items-center gap-0.5 rounded-md bg-surface-muted p-0.5'
  segment.setAttribute('role', 'group')
  segment.setAttribute(
    'aria-label',
    i18n.t('knowledge.doc.modeLabel', { defaultValue: 'Document mode' }),
  )
  segment.setAttribute('data-testid', `${opts.testIdPrefix}-mode`)

  const sourceBtn = document.createElement('button')
  sourceBtn.type = 'button'
  sourceBtn.className = SEGMENT_IDLE
  sourceBtn.textContent = i18n.t('knowledge.doc.source', {
    defaultValue: 'Source',
  })
  sourceBtn.setAttribute('data-testid', `${opts.testIdPrefix}-mode-source`)
  sourceBtn.setAttribute(
    'aria-label',
    i18n.t('knowledge.doc.source', { defaultValue: 'Source' }),
  )

  const previewBtn = document.createElement('button')
  previewBtn.type = 'button'
  previewBtn.className = SEGMENT_IDLE
  previewBtn.textContent = i18n.t('knowledge.doc.preview', {
    defaultValue: 'Preview',
  })
  previewBtn.setAttribute('data-testid', `${opts.testIdPrefix}-mode-preview`)
  previewBtn.setAttribute(
    'aria-label',
    i18n.t('knowledge.doc.preview', { defaultValue: 'Preview' }),
  )

  segment.append(sourceBtn, previewBtn)
  left.append(labelEl, segment)

  const copyBtn = document.createElement('button')
  copyBtn.type = 'button'
  copyBtn.setAttribute('data-testid', `${opts.testIdPrefix}-copy`)
  copyBtn.className =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-state-hover hover:text-ink'
  copyBtn.title = 'Copy source'
  copyBtn.setAttribute('aria-label', 'Copy source')
  copyBtn.innerHTML = COPY_ICON

  // Mode switches on mousedown (not click): preventDefault on mousedown is
  // required to avoid PM stealing selection, but that can suppress the
  // subsequent click in WebKit / happy-dom — so the action must run here.
  sourceBtn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    opts.onMode('edit')
  })
  previewBtn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    opts.onMode('preview')
  })
  // Still handle click for keyboard activation (Space/Enter on focused button).
  sourceBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    opts.onMode('edit')
  })
  previewBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    opts.onMode('preview')
  })

  copyBtn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  copyBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    // Capture before async copy: focus steal can flip chrome/mode mid-flight.
    const restoreEdit = mode === 'edit'
    void copyText(opts.getSource()).finally(() => {
      if (restoreEdit) opts.onRestoreEditAfterCopy?.()
    })
  })

  header.append(left, copyBtn)

  let mode: DiagramChromeMode = 'edit'

  const setMode = (next: DiagramChromeMode) => {
    mode = next
    header.dataset.mode = next
    const sourceActive = next === 'edit'
    sourceBtn.className = sourceActive ? SEGMENT_ACTIVE : SEGMENT_IDLE
    previewBtn.className = sourceActive ? SEGMENT_IDLE : SEGMENT_ACTIVE
    sourceBtn.setAttribute('aria-pressed', sourceActive ? 'true' : 'false')
    previewBtn.setAttribute('aria-pressed', sourceActive ? 'false' : 'true')
  }

  setMode(mode)

  return {
    header,
    setMode,
    contains: (target) => {
      if (!(target instanceof Node)) return false
      return header.contains(target)
    },
  }
}
