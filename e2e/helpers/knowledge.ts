/**
 * Knowledge base e2e helpers (WebdriverIO + Tauri).
 * Prefer stable data-testids; reuse context-menu open retries from surface patterns.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import {
  openContextMenu,
  clickContextMenuItem,
} from './context-menu.js'

async function clickTestId(testid: string, timeout = 10000): Promise<void> {
  const el = await browser.$(`[data-testid="${testid}"]`)
  await el.waitForExist({ timeout })
  await browser.execute((node: HTMLElement) => node.click(), el)
}

/** Open knowledge surface via sidebar nav (product path). */
export async function openKnowledgeFromMenu(): Promise<void> {
  const nav = await browser.$('[data-testid="sidebar-nav-knowledge"]')
  await nav.waitForExist({ timeout: 20000 })
  await browser.execute((el: HTMLElement) => el.click(), nav)
  await (await browser.$('[data-testid="knowledge-page"]')).waitForExist({ timeout: 20000 })
  // Ensure knowledge sidebar list is the active section (create + space rows live there).
  await (await browser.$('[data-testid="sidebar-new-space"]')).waitForExist({ timeout: 15000 })
}

/**
 * Create a space by name and enter workspace.
 * Uses the sidebar "New knowledge base" control.
 */
/** Set a React controlled <input> value and fire input/change. */
async function setReactInputValue(testid: string, value: string): Promise<void> {
  const input = await browser.$(`[data-testid="${testid}"]`)
  await input.waitForExist({ timeout: 10000 })
  await browser.execute(
    (el: HTMLInputElement, v: string) => {
      el.focus()
      const proto = window.HTMLInputElement.prototype
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      desc?.set?.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },
    input,
    value,
  )
}

export async function createSpaceAndOpen(name: string): Promise<void> {
  // Prefer sidebar CTA; fall back to empty-state alias if present.
  const sidebarBtn = await browser.$('[data-testid="sidebar-new-space"]')
  if (await sidebarBtn.isExisting()) {
    await browser.execute((node: HTMLElement) => node.click(), sidebarBtn)
  } else {
    await clickTestId('knowledge-create-space')
  }
  await (await browser.$('[data-testid="knowledge-create-space-name"]')).waitForExist({
    timeout: 10000,
  })
  await setReactInputValue('knowledge-create-space-name', name)
  await browser.pause(100)

  const confirm = await browser.$('[data-testid="knowledge-create-space-confirm"]')
  await confirm.waitForExist({ timeout: 5000 })
  // Wait until React enables the button (name non-empty)
  await browser.waitUntil(
    async () => {
      const disabled = await confirm.getAttribute('disabled')
      return disabled === null || disabled === 'false'
    },
    { timeout: 5000, interval: 100, timeoutMsg: 'create-space confirm stayed disabled' },
  )
  await browser.execute((node: HTMLElement) => node.click(), confirm)

  await (await browser.$('[data-testid="knowledge-workspace"]')).waitForExist({
    timeout: 20000,
  })
}

/** Open a Radix menu trigger, then click a menu item by test id (with retries). */
async function clickMenuItem(triggerTestId: string, itemTestId: string): Promise<void> {
  const trigger = await browser.$(`[data-testid="${triggerTestId}"]`)
  await trigger.waitForExist({ timeout: 15000 })

  for (let attempt = 0; attempt < 4; attempt++) {
    let item = await browser.$(`[data-testid="${itemTestId}"]`)
    if (await item.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), item)
      return
    }

    // Focus + Enter (Radix) then pointer click fallback
    await browser.execute((el: HTMLElement) => {
      el.focus()
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }, trigger)
    await browser.pause(40)
    await browser.keys('Enter')
    item = await browser.$(`[data-testid="${itemTestId}"]`)
    try {
      await item.waitForExist({ timeout: 1200 })
      await browser.execute((el: HTMLElement) => el.click(), item)
      return
    } catch {
      // try pointer path
    }

    await browser.execute((el: HTMLElement) => {
      const rect = el.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
        }),
      )
      el.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
        }),
      )
      el.click()
    }, trigger)

    item = await browser.$(`[data-testid="${itemTestId}"]`)
    try {
      await item.waitForExist({ timeout: 1500 })
      await browser.execute((el: HTMLElement) => el.click(), item)
      return
    } catch {
      // Escape any half-open menu, then retry
      await browser.keys('Escape').catch(() => {})
      await browser.pause(100)
    }
  }

  throw new Error(
    `menu item [data-testid="${itemTestId}"] did not open from [data-testid="${triggerTestId}"]`,
  )
}
/** Create a doc via tree blank-area context menu and wait for CodeMirror host. */
export async function createDocAndExpectEditor(): Promise<void> {
  // Already editing? skip create
  if (await (await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')).isExisting()) {
    return
  }
  await openContextMenu('[data-testid="knowledge-tree-pane"]')
  await clickContextMenuItem('knowledgeTree.newDoc')
  await (await browser.$('[data-testid="knowledge-doc-editor"]')).waitForExist({
    timeout: 15000,
  })
  await (await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')).waitForExist({
    timeout: 10000,
  })
}
/** Focus CM content and type text (ASCII plain markers preferred). */
export async function typeInKnowledgeEditor(text: string): Promise<void> {
  const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
  await content.waitForExist({ timeout: 10000 })

  // CodeMirror 6 contenteditable: WebDriver keys are flaky on WKWebView.
  // Prefer insertText / beforeinput which CM handles as real edits.
  await browser.execute(
    (el: HTMLElement, t: string) => {
      el.focus()
      // Place caret at end
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      sel?.removeAllRanges()
      sel?.addRange(range)

      const inserted = document.execCommand('insertText', false, t)
      if (!inserted) {
        el.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: t,
          }),
        )
        // Last resort: append a text node (may not update CM state — keys next)
      }
    },
    content,
    text,
  )

  // Fallback: keyboard if insertText did not stick
  const afterInsert = await content.getText()
  if (!afterInsert.includes(text)) {
    await browser.execute((el: HTMLElement) => el.focus(), content)
    await browser.pause(50)
    await browser.keys(text)
  }

  await browser.waitUntil(
    async () => {
      const t = await content.getText()
      return t.includes(text)
    },
    { timeout: 10000, interval: 200, timeoutMsg: `editor missing text: ${text}` },
  )
}

/**
 * Toggle Source (edit) ↔ Preview via SegmentedControl (clicks the inactive tab).
 * When Live is enabled (3-way control), prefers toggling between source and preview
 * so e2e stays on CodeMirror rather than Live.
 */
export async function toggleKnowledgePreviewOrEdit(): Promise<void> {
  const toggle = await browser.$('[data-testid="knowledge-edit-toggle"]')
  await toggle.waitForExist({ timeout: 10000 })
  await browser.execute((root: HTMLElement) => {
    const tabs = Array.from(root.querySelectorAll('[role="tab"]')) as HTMLElement[]
    if (tabs.length <= 2) {
      const inactive = tabs.find((t) => t.getAttribute('aria-selected') !== 'true')
      inactive?.click()
      return
    }
    // 3-way (Live | Source | Preview): click Source if in Preview, else Preview.
    const selected = tabs.find((t) => t.getAttribute('aria-selected') === 'true')
    const selectedLabel = (selected?.textContent ?? '').trim().toLowerCase()
    const targetLabel = selectedLabel.includes('preview') || selectedLabel.includes('预览') || selectedLabel.includes('預覽')
      ? /source|edit|源码|原始碼|编辑|編輯/i
      : /preview|预览|預覽/i
    const target =
      tabs.find((t) => targetLabel.test((t.textContent ?? '').trim())) ??
      tabs.find((t) => t.getAttribute('aria-selected') !== 'true')
    target?.click()
  }, toggle)
}

export async function expectKnowledgeEditor(): Promise<void> {
  await (await browser.$('[data-testid="knowledge-doc-editor"]')).waitForExist({
    timeout: 10000,
  })
}

export async function expectKnowledgeReader(contains?: string): Promise<void> {
  const reader = await browser.$('[data-testid="knowledge-doc-reader"]')
  await reader.waitForExist({ timeout: 10000 })
  if (contains) {
    await browser.waitUntil(
      async () => {
        const t = await reader.getText()
        return t.includes(contains)
      },
      { timeout: 10000, interval: 200, timeoutMsg: `reader missing: ${contains}` },
    )
  }
}

export async function expectNoKnowledgeEditor(): Promise<void> {
  await browser.waitUntil(
    async () => !(await (await browser.$('[data-testid="knowledge-doc-editor"]')).isExisting()),
    { timeout: 10000, interval: 200 },
  )
}

export async function closeKnowledgeChipIfOpen(): Promise<void> {
  const close = await browser.$('[data-testid="knowledge-tab-close"]')
  if (await close.isExisting()) {
    await browser.execute((el: HTMLElement) => el.click(), close)
    await browser.pause(200)
  }
}

/** Rename via inline title input. */
export async function setKnowledgeDocTitle(title: string): Promise<void> {
  const input = await browser.$('[data-testid="knowledge-doc-title"]')
  await input.waitForExist({ timeout: 10000 })
  await browser.execute(
    (el: HTMLInputElement, v: string) => {
      el.focus()
      const proto = window.HTMLInputElement.prototype
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      desc?.set?.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.blur()
    },
    input,
    title,
  )
  await browser.pause(200)
}

/** Click markdown toolbar bold. */
export async function clickKnowledgeBold(): Promise<void> {
  await clickTestId('knowledge-md-bold')
}

/** Install e2e save-dialog seam returning a fixed path. */
export async function installSavePathSeam(path: string): Promise<void> {
  await browser.execute((p: string) => {
    ;(window as unknown as { __hipSavePath?: () => Promise<string | null> }).__hipSavePath =
      async () => p
  }, path)
}

export async function clearSavePathSeam(): Promise<void> {
  await browser.execute(() => {
    delete (window as unknown as { __hipSavePath?: unknown }).__hipSavePath
  })
}

/** Install directory picker seam (import / project pick). */
export async function installPickDirSeam(dir: string): Promise<void> {
  await browser.execute((d: string) => {
    ;(window as unknown as { __hipPickDir?: () => Promise<string | null> }).__hipPickDir =
      async () => d
  }, dir)
}

export async function clearPickDirSeam(): Promise<void> {
  await browser.execute(() => {
    delete (window as unknown as { __hipPickDir?: unknown }).__hipPickDir
  })
}

/** Clear home search so space cards / recent list are visible again. */
export async function clearHomeSearch(): Promise<void> {
  const input = await browser.$('[data-testid="knowledge-search"]')
  if (!(await input.isExisting())) return
  await setReactInputValue('knowledge-search', '')
  await browser.pause(100)
}

/**
 * Ensure knowledge section is active in the sidebar (spaces list / create CTA).
 * No separate "home" management page — spaces live in the app sidebar.
 */
export async function goKnowledgeHome(): Promise<void> {
  await openKnowledgeFromMenu()
}
/** First folder row testid under the tree, or null. */
export async function firstKnowledgeFolderTestId(): Promise<string | null> {
  return browser.execute(() => {
    const el = document.querySelector('[data-testid^="knowledge-tree-folder-"]')
    return el?.getAttribute('data-testid') ?? null
  })
}

/**
 * Expand collapsed folders only (lucide-chevron-right = collapsed).
 * Never click open folders (avoids collapse).
 */
export async function expandAllKnowledgeFolders(): Promise<void> {
  for (let pass = 0; pass < 6; pass++) {
    const toClick = await browser.execute(() => {
      const ids: string[] = []
      document.querySelectorAll('[data-testid^="knowledge-tree-folder-"]').forEach((row) => {
        const tid = row.getAttribute('data-testid')
        if (!tid) return
        // Collapsed folders use ChevronRight icon
        if (row.querySelector('svg.lucide-chevron-right')) {
          ids.push(tid)
        }
      })
      return ids
    })
    if (!toClick.length) break
    for (const tid of toClick) {
      await browser.execute((id: string) => {
        document
          .querySelector(`[data-testid="${id}"]`)
          ?.querySelector('button')
          ?.click()
      }, tid)
      await browser.pause(80)
    }
    await browser.pause(150)
  }
}

/** All doc row testids currently in the tree. */
export async function listKnowledgeDocTestIds(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid^="knowledge-tree-doc-"]')).map(
      (el) => el.getAttribute('data-testid') ?? '',
    ).filter(Boolean),
  )
}

/**
 * Synthetic pointer DnD matching SpaceTree: drag via grip handle only.
 * Press grip on source row → move past threshold onto target center → release.
 */
export async function dndKnowledgeTreeNode(
  sourceTestId: string,
  targetTestId: string,
): Promise<void> {
  await browser.execute(
    (srcId: string, tgtId: string) => {
      const source = document.querySelector(`[data-testid="${srcId}"]`) as HTMLElement | null
      const target = document.querySelector(`[data-testid="${tgtId}"]`) as HTMLElement | null
      if (!source || !target) throw new Error(`dnd nodes missing: ${srcId} -> ${tgtId}`)

      // knowledge-tree-doc-XXX / knowledge-tree-folder-XXX → node id
      const nodeId = srcId.replace(/^knowledge-tree-(doc|folder)-/, '')
      const grip =
        (document.querySelector(
          `[data-testid="knowledge-tree-drag-${nodeId}"]`,
        ) as HTMLElement | null) ||
        (source.querySelector('[data-tree-drag-handle]') as HTMLElement | null)
      if (!grip) throw new Error(`dnd grip missing for ${srcId}`)

      const srcRect = grip.getBoundingClientRect()
      const tgtRect = target.getBoundingClientRect()
      const startX = srcRect.left + srcRect.width / 2
      const startY = srcRect.top + srcRect.height / 2
      // Center of target → folder "into" / doc "after" mid-band
      const endX = tgtRect.left + tgtRect.width / 2
      const endY = tgtRect.top + tgtRect.height * 0.5
      const pointerId = 1

      const fire = (
        type: string,
        el: EventTarget,
        clientX: number,
        clientY: number,
      ) => {
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX,
            clientY,
          }),
        )
      }

      fire('pointerdown', grip, startX, startY)
      // Past SpaceTree DRAG_THRESHOLD_PX (5)
      fire('pointermove', document, startX, startY + 12)
      fire('pointermove', document, endX, endY)
      fire('pointerup', document, endX, endY)
    },
    sourceTestId,
    targetTestId,
  )
  await browser.pause(400)
}

// ---------------------------------------------------------------------------
// Extended helpers: home, CRUD, search, disk, export
// ---------------------------------------------------------------------------

/** HIP_DATA_DIR set by wdio.conf (isolated e2e data). */
export function getHipDataDir(): string {
  const dir = process.env.HIP_DATA_DIR
  if (!dir) throw new Error('HIP_DATA_DIR is not set')
  return dir
}

export function knowledgeRootOnDisk(): string {
  return path.join(getHipDataDir(), 'knowledge')
}

/** Recursively collect .md files under dir. */
function walkMdFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walkMdFiles(full, out)
    else if (ent.isFile() && ent.name.endsWith('.md')) out.push(full)
  }
  return out
}

/** Wait until some knowledge doc on disk contains marker text. */
export async function waitForDocBodyOnDisk(
  marker: string,
  timeoutMs = 15000,
): Promise<string> {
  let found = ''
  await browser.waitUntil(
    async () => {
      const root = knowledgeRootOnDisk()
      const files = walkMdFiles(root)
      for (const f of files) {
        try {
          const body = fs.readFileSync(f, 'utf8')
          if (body.includes(marker)) {
            found = f
            return true
          }
        } catch {
          // ignore mid-write races
        }
      }
      return false
    },
    {
      timeout: timeoutMs,
      interval: 300,
      timeoutMsg: `no knowledge .md on disk contains: ${marker}`,
    },
  )
  return found
}

/** List space names from knowledge/index.json (best-effort). */
export function listSpaceNamesOnDisk(): string[] {
  const indexPath = path.join(knowledgeRootOnDisk(), 'index.json')
  if (!fs.existsSync(indexPath)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
      spaces?: Array<{ name?: string }>
    }
    return (raw.spaces ?? []).map((s) => s.name ?? '').filter(Boolean)
  } catch {
    return []
  }
}

/** Wait until a space name is absent from disk index. */
export async function waitForSpaceNameGoneOnDisk(
  name: string,
  timeoutMs = 15000,
): Promise<void> {
  await browser.waitUntil(
    async () => !listSpaceNamesOnDisk().includes(name),
    {
      timeout: timeoutMs,
      interval: 300,
      timeoutMsg: `space still on disk index: ${name}`,
    },
  )
}

/** Wait for save-status chip to show saved (or disappear after save). */
export async function waitForSaveStatusSaved(timeoutMs = 10000): Promise<void> {
  const status = await browser.$('[data-testid="knowledge-save-status"]')
  // Status may only appear while saving/saved; wait for idle/saved text if present
  await browser.waitUntil(
    async () => {
      if (!(await status.isExisting())) return true
      const t = (await status.getText()).toLowerCase()
      // i18n: "Saved" / "已保存" / "saving" — accept non-saving
      return !t.includes('saving') && !t.includes('保存中')
    },
    { timeout: timeoutMs, interval: 200, timeoutMsg: 'save-status stuck saving' },
  )
}

/** Whether a sidebar space row with the given name exists. */
export async function spaceCardByName(name: string): Promise<boolean> {
  return browser.execute((target: string) => {
    const rows = Array.from(
      document.querySelectorAll('[data-testid^="sidebar-space-"]'),
    ) as HTMLElement[]
    return rows.some(
      (c) =>
        c.getAttribute('data-space-name') === target ||
        (c.textContent ?? '').trim() === target ||
        (c.textContent ?? '').includes(target),
    )
  }, name)
}
export async function openSpaceCardByName(name: string): Promise<void> {
  await browser.waitUntil(async () => spaceCardByName(name), {
    timeout: 15000,
    interval: 200,
    timeoutMsg: `sidebar space missing: ${name}`,
  })
  await browser.execute((target: string) => {
    const rows = Array.from(
      document.querySelectorAll('[data-testid^="sidebar-space-"]'),
    ) as HTMLElement[]
    const row =
      rows.find((c) => c.getAttribute('data-space-name') === target) ??
      rows.find((c) => (c.textContent ?? '').trim() === target) ??
      rows.find((c) => (c.textContent ?? '').includes(target))
    if (!row) throw new Error(`sidebar space not found: ${target}`)
    row.click()
  }, name)
  await (await browser.$('[data-testid="knowledge-workspace"]')).waitForExist({
    timeout: 20000,
  })
}

/**
 * Open sidebar space context menu and click a menu item (rename/delete).
 */
async function openSpaceCardMenuAndClick(
  name: string,
  itemTestId: string,
): Promise<void> {
  await browser.waitUntil(async () => spaceCardByName(name), {
    timeout: 15000,
    interval: 200,
    timeoutMsg: `sidebar space not found: ${name}`,
  })

  // Map legacy home card menu item testids → context menu item ids.
  const contextItemId =
    itemTestId === 'knowledge-space-rename'
      ? 'knowledgeSpace.rename'
      : itemTestId === 'knowledge-space-delete'
        ? 'knowledgeSpace.delete'
        : itemTestId

  for (let attempt = 0; attempt < 4; attempt++) {
    await browser.execute((target: string) => {
      const rows = Array.from(
        document.querySelectorAll('[data-testid^="sidebar-space-"]'),
      ) as HTMLElement[]
      const row =
        rows.find((c) => c.getAttribute('data-space-name') === target) ??
        rows.find((c) => (c.textContent ?? '').trim() === target) ??
        rows.find((c) => (c.textContent ?? '').includes(target))
      if (!row) throw new Error(`sidebar space not found: ${target}`)
      const rect = row.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      row.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 2,
        }),
      )
    }, name)

    const item = await browser.$(`[data-testid="context-menu-item-${contextItemId}"]`)
    try {
      await item.waitForExist({ timeout: 2000 })
      await browser.execute((node: HTMLElement) => node.click(), item)
      return
    } catch {
      await browser.keys('Escape').catch(() => {})
      await browser.pause(120)
    }
  }
  throw new Error(`sidebar space context menu item not opened: ${contextItemId} for ${name}`)
}

export async function renameSpaceFromHome(
  currentName: string,
  nextName: string,
): Promise<void> {
  await openSpaceCardMenuAndClick(currentName, 'knowledge-space-rename')
  await setReactInputValue('knowledge-rename-space-name', nextName)
  await browser.pause(100)
  const confirm = await browser.$('[data-testid="knowledge-rename-space-confirm"]')
  await confirm.waitForExist({ timeout: 5000 })
  await browser.waitUntil(
    async () => {
      const disabled = await confirm.getAttribute('disabled')
      return disabled === null || disabled === 'false'
    },
    { timeout: 5000, interval: 100 },
  )
  await browser.execute((node: HTMLElement) => node.click(), confirm)
  await browser.waitUntil(async () => spaceCardByName(nextName), {
    timeout: 15000,
    interval: 200,
    timeoutMsg: `rename failed → ${nextName}`,
  })
}

export async function deleteSpaceFromHome(
  name: string,
  opts?: { confirm?: boolean },
): Promise<void> {
  const doConfirm = opts?.confirm !== false
  await openSpaceCardMenuAndClick(name, 'knowledge-space-delete')
  if (doConfirm) {
    const btn = await browser.$('[data-testid="knowledge-delete-space-confirm"]')
    await btn.waitForExist({ timeout: 8000 })
    await browser.execute((node: HTMLElement) => node.click(), btn)
    await browser.waitUntil(async () => !(await spaceCardByName(name)), {
      timeout: 15000,
      interval: 200,
      timeoutMsg: `space card still present: ${name}`,
    })
  } else {
    const cancel = await browser.$('[data-testid="knowledge-delete-space-cancel"]')
    await cancel.waitForExist({ timeout: 8000 })
    await browser.execute((node: HTMLElement) => node.click(), cancel)
  }
}
/** Workspace overflow: delete active space. */
export async function deleteSpaceFromWorkspace(): Promise<void> {
  await clickMenuItem('knowledge-space-menu', 'knowledge-space-delete')
  const btn = await browser.$('[data-testid="knowledge-delete-space-confirm"]')
  await btn.waitForExist({ timeout: 8000 })
  await browser.execute((node: HTMLElement) => node.click(), btn)
  // After deleting the active space we land on the empty knowledge surface.
  await (await browser.$('[data-testid="knowledge-empty"]')).waitForExist({
    timeout: 20000,
  })
}

/** Workspace overflow: rename active space. */
export async function renameSpaceFromWorkspace(nextName: string): Promise<void> {
  await clickMenuItem('knowledge-space-menu', 'knowledge-space-rename')
  await setReactInputValue('knowledge-rename-space-name', nextName)
  await browser.pause(100)
  const confirm = await browser.$('[data-testid="knowledge-rename-space-confirm"]')
  await confirm.waitForExist({ timeout: 8000 })
  await browser.waitUntil(
    async () => {
      const disabled = await confirm.getAttribute('disabled')
      return disabled === null || disabled === 'false'
    },
    { timeout: 5000, interval: 100 },
  )
  await browser.execute((node: HTMLElement) => node.click(), confirm)
  await browser.pause(300)
}

/** Workspace: open delete modal and cancel (space remains). */
export async function cancelDeleteSpaceFromWorkspace(): Promise<void> {
  await clickMenuItem('knowledge-space-menu', 'knowledge-space-delete')
  const cancel = await browser.$('[data-testid="knowledge-delete-space-cancel"]')
  await cancel.waitForExist({ timeout: 8000 })
  await browser.execute((node: HTMLElement) => node.click(), cancel)
  await browser.pause(200)
  // Still on workspace
  await (await browser.$('[data-testid="knowledge-workspace"]')).waitForExist({
    timeout: 5000,
  })
}
/** Workspace: export space as zip via save-path seam. */
export async function exportSpaceZipTo(destPath: string): Promise<void> {
  await installSavePathSeam(destPath)
  await clickMenuItem('knowledge-space-menu', 'knowledge-space-export')
  await browser.waitUntil(
    async () => fs.existsSync(destPath) && fs.statSync(destPath).size > 0,
    { timeout: 20000, interval: 300, timeoutMsg: `zip not written: ${destPath}` },
  )
}

/** Create folder via tree blank-area context menu (root). */
export async function createFolderFromToolbar(): Promise<void> {
  const before = await browser.execute(
    () => document.querySelectorAll('[data-testid^="knowledge-tree-folder-"]').length,
  )
  await openContextMenu('[data-testid="knowledge-tree-pane"]')
  await clickContextMenuItem('knowledgeTree.newFolder')
  await browser.waitUntil(
    async () => {
      const n = await browser.execute(
        () => document.querySelectorAll('[data-testid^="knowledge-tree-folder-"]').length,
      )
      return n > before || (await firstKnowledgeFolderTestId()) != null
    },
    { timeout: 15000, interval: 200, timeoutMsg: 'no folder after create' },
  )
}
/** Tree sidebar text (handles empty-state vs populated tree). */
async function knowledgeTreeText(): Promise<string> {
  const tree = await browser.$('[data-testid="knowledge-tree"]')
  if (await tree.isExisting()) return tree.getText()
  const empty = await browser.$('[data-testid="knowledge-tree-empty"]')
  if (await empty.isExisting()) return empty.getText()
  const aside = await browser.$('[data-testid="knowledge-workspace"]')
  if (await aside.isExisting()) return aside.getText()
  return ''
}

export async function expectTreeContains(text: string, timeoutMs = 10000): Promise<void> {
  await browser.waitUntil(
    async () => (await knowledgeTreeText()).includes(text),
    { timeout: timeoutMs, interval: 200, timeoutMsg: `tree missing: ${text}` },
  )
}

export async function expectTreeNotContains(
  text: string,
  timeoutMs = 10000,
): Promise<void> {
  await browser.waitUntil(
    async () => !(await knowledgeTreeText()).includes(text),
    { timeout: timeoutMs, interval: 200, timeoutMsg: `tree still has: ${text}` },
  )
}
export async function deleteTreeNodeByTestId(testId: string): Promise<void> {
  await openContextMenu(`[data-testid="${testId}"]`)
  await clickContextMenuItem('knowledgeNode.delete')
  const btn = await browser.$('[data-testid="knowledge-delete-node-confirm"]')
  await btn.waitForExist({ timeout: 8000 })
  await browser.execute((node: HTMLElement) => node.click(), btn)
  await browser.pause(300)
  await browser.waitUntil(
    async () => !(await (await browser.$(`[data-testid="${testId}"]`)).isExisting()),
    { timeout: 10000, interval: 200, timeoutMsg: `node still in tree: ${testId}` },
  )
}

export async function renameTreeNodeByTestId(
  testId: string,
  nextTitle: string,
): Promise<void> {
  await openContextMenu(`[data-testid="${testId}"]`)
  await clickContextMenuItem('knowledgeNode.rename')
  await setReactInputValue('knowledge-rename-node-name', nextTitle)
  await browser.pause(100)
  const confirm = await browser.$('[data-testid="knowledge-rename-node-confirm"]')
  await confirm.waitForExist({ timeout: 5000 })
  await browser.waitUntil(
    async () => {
      const disabled = await confirm.getAttribute('disabled')
      return disabled === null || disabled === 'false'
    },
    { timeout: 5000, interval: 100 },
  )
  await browser.execute((node: HTMLElement) => node.click(), confirm)
  await expectTreeContains(nextTitle)
}

export async function setHomeSearchQuery(q: string): Promise<void> {
  await setReactInputValue('knowledge-search', q)
  await browser.pause(200)
}

export async function expectSearchHits(min = 1, timeoutMs = 15000): Promise<void> {
  await browser.waitUntil(
    async () => {
      const hits = await browser.$$('[data-testid="knowledge-search-hit"]')
      return hits.length >= min
    },
    { timeout: timeoutMs, interval: 300, timeoutMsg: `expected ≥${min} search hits` },
  )
}

export async function clickFirstSearchHit(): Promise<void> {
  await expectSearchHits(1)
  const hit = await browser.$('[data-testid="knowledge-search-hit"]')
  await browser.execute((el: HTMLElement) => el.click(), hit)
  await (await browser.$('[data-testid="knowledge-workspace"]')).waitForExist({
    timeout: 15000,
  })
}

export async function clickFirstRecentItem(): Promise<void> {
  const item = await browser.$('[data-testid="knowledge-recent-item"]')
  await item.waitForExist({ timeout: 15000 })
  await browser.execute((el: HTMLElement) => el.click(), item)
  await (await browser.$('[data-testid="knowledge-workspace"]')).waitForExist({
    timeout: 15000,
  })
}

/**
 * Ensure knowledge sidebar section is active (spaces list / create CTA).
 * Legacy name kept for e2e call sites.
 */
export async function ensureKnowledgeHome(): Promise<void> {
  if (await (await browser.$('[data-testid="sidebar-new-space"]')).isExisting()) {
    return
  }
  await openKnowledgeFromMenu()
  await (await browser.$('[data-testid="sidebar-new-space"]')).waitForExist({
    timeout: 15000,
  })
}

/** Count knowledge spaces in the app sidebar. */
export async function countSpaceCards(): Promise<number> {
  const rows = await browser.$$('[data-testid^="sidebar-space-"]')
  return rows.length
}

/** Export active doc via doc menu + save seam. */
export async function exportActiveDocTo(destPath: string): Promise<void> {
  await installSavePathSeam(destPath)
  await expectKnowledgeEditor()
  await browser.pause(500)
  await clickMenuItem('knowledge-doc-menu', 'knowledge-export-doc')
  await browser.waitUntil(
    async () => fs.existsSync(destPath) && fs.statSync(destPath).size > 0,
    { timeout: 15000, interval: 300, timeoutMsg: `export md not written: ${destPath}` },
  )
}

// ── Phase 0/1 helpers (Batch A–D) ─────────────────────────────────────────

export type KnowledgeEditorMode = 'live' | 'source' | 'preview'

/**
 * Force next/all knowledge_write_doc calls to fail (flush-abort tests).
 * Uses globalThis/window seam in src/ipc/knowledge.ts.
 */
export async function installWriteFailSeam(): Promise<void> {
  await browser.execute(() => {
    ;(window as unknown as { __hipKnowledgeWriteFail?: boolean }).__hipKnowledgeWriteFail = true
  })
}

export async function clearWriteFailSeam(): Promise<void> {
  await browser.execute(() => {
    delete (window as unknown as { __hipKnowledgeWriteFail?: unknown }).__hipKnowledgeWriteFail
  })
}

/** Select editor mode via SegmentedControl data-testid tabs. */
export async function setKnowledgeEditorMode(mode: KnowledgeEditorMode): Promise<void> {
  const tab = await browser.$(`[data-testid="knowledge-edit-toggle-${mode}"]`)
  // Flag-off UI only has source+preview; live tab may be absent.
  if (!(await tab.isExisting()) && mode === 'live') {
    throw new Error('Live mode tab not present (hip-knowledge-live flag off)')
  }
  // When flag off, "source" maps to Edit tab testid knowledge-edit-toggle-source
  const fallback =
    mode === 'source'
      ? await browser.$('[data-testid="knowledge-edit-toggle-source"]')
      : tab
  const el = (await tab.isExisting()) ? tab : fallback
  await el.waitForExist({ timeout: 10000 })
  await browser.execute((node: HTMLElement) => node.click(), el)
  await browser.pause(150)
}

export async function ensureKnowledgeSource(): Promise<void> {
  await setKnowledgeEditorMode('source')
  await expectKnowledgeEditor()
}

export async function ensureKnowledgePreview(): Promise<void> {
  await setKnowledgeEditorMode('preview')
  await expectNoKnowledgeEditor()
  await (await browser.$('[data-testid="knowledge-doc-reader"]')).waitForExist({
    timeout: 10000,
  })
}

/** Type MD then wait for autosave to leave "saving". */
export async function typeMarkdownAndSave(text: string): Promise<void> {
  await ensureKnowledgeSource()
  await typeInKnowledgeEditor(text)
  await waitForSaveStatusSaved(15000)
}

/**
 * In-page marker check (avoids shipping multi-MB getText over WebDriver).
 * Works for Source CM content or Preview reader.
 */
export async function knowledgeSurfaceContainsMarker(marker: string): Promise<boolean> {
  return browser.execute((m: string) => {
    const editor = document.querySelector(
      '[data-testid="knowledge-doc-editor"] .cm-content',
    ) as HTMLElement | null
    if (editor?.innerText?.includes(m) || editor?.textContent?.includes(m)) return true
    const reader = document.querySelector(
      '[data-testid="knowledge-doc-reader"]',
    ) as HTMLElement | null
    if (reader?.innerText?.includes(m) || reader?.textContent?.includes(m)) return true
    return false
  }, marker)
}

export async function waitForKnowledgeMarker(
  marker: string,
  timeoutMs = 15000,
): Promise<void> {
  await browser.waitUntil(async () => await knowledgeSurfaceContainsMarker(marker), {
    timeout: timeoutMs,
    interval: 200,
    timeoutMsg: `knowledge surface missing marker: ${marker}`,
  })
}

/** Click first GFM task checkbox in preview. */
export async function toggleFirstTaskCheckbox(): Promise<void> {
  await ensureKnowledgePreview()
  const box = await browser.$('[data-testid="knowledge-task-checkbox"]')
  await box.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLInputElement) => {
    el.click()
  }, box)
}

/** Open a tree doc by visible title (substring match on row text). */
export async function openTreeDocByTitle(title: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      const tid = await browser.execute((t: string) => {
        const rows = Array.from(
          document.querySelectorAll('[data-testid^="knowledge-tree-doc-"]'),
        ) as HTMLElement[]
        const row = rows.find((r) => (r.textContent ?? '').includes(t))
        return row?.getAttribute('data-testid') ?? null
      }, title)
      if (!tid) return false
      await browser.execute((id: string) => {
        const row = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
        // Open handler is on the inner button, not the row shell.
        const btn = row?.querySelector('button') as HTMLElement | null
        ;(btn ?? row)?.click()
      }, tid)
      return true
    },
    { timeout: 15000, interval: 300, timeoutMsg: `tree doc not found: ${title}` },
  )
  await browser.pause(200)
}

/** Title of the active (aria-selected) tree doc, or null. */
export async function activeTreeDocTitle(): Promise<string | null> {
  return browser.execute(() => {
    const row = document.querySelector(
      '[data-testid^="knowledge-tree-doc-"][aria-selected="true"]',
    ) as HTMLElement | null
    return row?.textContent?.trim() ?? null
  })
}

export async function expectSearchGroups(min = 1, timeoutMs = 15000): Promise<void> {
  await browser.waitUntil(
    async () => {
      const groups = await browser.$$('[data-testid="knowledge-search-group"]')
      return groups.length >= min
    },
    { timeout: timeoutMs, interval: 300, timeoutMsg: `expected ≥${min} search groups` },
  )
}

/** Click preview wiki link by target title (resolved or broken). */
export async function clickWikiLinkInPreview(title: string, broken = false): Promise<void> {
  await ensureKnowledgePreview()
  const testId = broken ? 'knowledge-wiki-link-broken' : 'knowledge-wiki-link'
  await browser.waitUntil(
    async () => {
      const found = await browser.execute(
        (tid: string, t: string) => {
          const links = Array.from(
            document.querySelectorAll(`[data-testid="${tid}"]`),
          ) as HTMLElement[]
          const el = links.find((a) => a.getAttribute('data-wiki-title') === t)
          if (!el) return false
          el.click()
          return true
        },
        testId,
        title,
      )
      return found
    },
    { timeout: 10000, interval: 200, timeoutMsg: `wiki link not found: ${title} broken=${broken}` },
  )
  await browser.pause(200)
}

export async function confirmWikiCreate(): Promise<void> {
  const confirm = await browser.$('[data-testid="knowledge-wiki-create-confirm"]')
  await confirm.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), confirm)
  await browser.pause(300)
}

export async function cancelWikiCreate(): Promise<void> {
  const cancel = await browser.$('[data-testid="knowledge-wiki-create-cancel"]')
  await cancel.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), cancel)
  await browser.pause(200)
}

/** Create a second doc via tree context menu (always creates even if editor already open). */
export async function createNewDocFromMenu(): Promise<void> {
  await openContextMenu('[data-testid="knowledge-tree-pane"]')
  await clickContextMenuItem('knowledgeTree.newDoc')
  // May open template picker first when space has templates.
  const picker = await browser.$('[data-testid="knowledge-template-picker"]')
  if (await picker.isExisting()) {
    await clickTestId('knowledge-template-empty')
  }
  await (await browser.$('[data-testid="knowledge-doc-editor"]')).waitForExist({
    timeout: 15000,
  })
  await browser.pause(200)
}

// ── Phase 1 + Live helpers (Batch E–F) ────────────────────────────────────

/** Attachment file picker seam (`pickAttachmentFiles`). */
export async function installPickAttachmentFilesSeam(paths: string[]): Promise<void> {
  await browser.execute((ps: string[]) => {
    ;(
      window as unknown as { __hipPickAttachmentFiles?: () => Promise<string[] | null> }
    ).__hipPickAttachmentFiles = async () => ps
  }, paths)
}

export async function clearPickAttachmentFilesSeam(): Promise<void> {
  await browser.execute(() => {
    delete (window as unknown as { __hipPickAttachmentFiles?: unknown })
      .__hipPickAttachmentFiles
  })
}

/** Live editor flag (product-on by default; pass false to opt out). Re-read on next React render. */
export async function setKnowledgeLiveFlag(enabled: boolean): Promise<void> {
  await browser.execute((on: boolean) => {
    try {
      if (on) localStorage.setItem('hip-knowledge-live', 'true')
      else localStorage.setItem('hip-knowledge-live', 'false')
    } catch {
      // ignore
    }
  }, enabled)
  // Nudge a re-render by toggling a harmless UI interaction if needed.
  await browser.pause(100)
}

export async function clearKnowledgeLiveFlag(): Promise<void> {
  await browser.execute(() => {
    try {
      localStorage.removeItem('hip-knowledge-live')
      localStorage.removeItem('hip-knowledge-editor-mode')
    } catch {
      // ignore
    }
  })
}

export async function ensureKnowledgeLive(): Promise<void> {
  await setKnowledgeLiveFlag(true)
  // Re-open mode control after flag is set (component re-renders on next interaction).
  await browser.pause(200)
  await setKnowledgeEditorMode('live')
  await (await browser.$('[data-testid="knowledge-doc-live-editor"]')).waitForExist({
    timeout: 20000,
  })
}

/** Type into Live ProseMirror host (best-effort). */
export async function typeInKnowledgeLiveEditor(text: string): Promise<void> {
  const host = await browser.$(
    '[data-testid="knowledge-doc-live-editor"] .ProseMirror, [data-testid="knowledge-doc-live-editor"] [contenteditable="true"]',
  )
  await host.waitForExist({ timeout: 15000 })
  await browser.execute(
    (el: HTMLElement, t: string) => {
      el.focus()
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      sel?.removeAllRanges()
      sel?.addRange(range)
      const ok = document.execCommand('insertText', false, t)
      if (!ok) {
        el.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: t,
          }),
        )
      }
    },
    host,
    text,
  )
  await browser.pause(200)
}

/** Save current doc as a space template via doc menu. */
export async function saveDocAsTemplate(name: string): Promise<void> {
  await clickMenuItem('knowledge-doc-menu', 'knowledge-save-as-template')
  await setReactInputValue('knowledge-save-template-name', name)
  const confirm = await browser.$('[data-testid="knowledge-save-template-confirm"]')
  await confirm.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), confirm)
  await browser.pause(400)
}

/**
 * Open new-doc via tree context menu; returns whether template picker appeared.
 * Does **not** confirm — use pickTemplateEmpty / pickTemplateByName / cancelTemplatePicker.
 */
export async function openNewDocMaybePicker(): Promise<'picker' | 'editor'> {
  await openContextMenu('[data-testid="knowledge-tree-pane"]')
  await clickContextMenuItem('knowledgeTree.newDoc')
  await browser.pause(300)
  const picker = await browser.$('[data-testid="knowledge-template-picker"]')
  if (await picker.isExisting()) return 'picker'
  await (await browser.$('[data-testid="knowledge-doc-editor"]')).waitForExist({
    timeout: 15000,
  })
  return 'editor'
}

export async function cancelTemplatePicker(): Promise<void> {
  const cancel = await browser.$('[data-testid="knowledge-template-pick-cancel"]')
  await cancel.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), cancel)
  await browser.waitUntil(
    async () =>
      !(await (await browser.$('[data-testid="knowledge-template-picker"]')).isExisting()),
    { timeout: 5000, interval: 100 },
  )
}

export async function pickTemplateEmpty(): Promise<void> {
  await clickTestId('knowledge-template-empty')
  await (await browser.$('[data-testid="knowledge-doc-editor"]')).waitForExist({
    timeout: 15000,
  })
}

/** Pick first template row whose label contains `name` substring. */
export async function pickTemplateByName(name: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      const clicked = await browser.execute((n: string) => {
        const buttons = Array.from(
          document.querySelectorAll('[data-testid^="knowledge-template-item-"]'),
        ) as HTMLElement[]
        const btn = buttons.find((b) => (b.textContent ?? '').includes(n))
        if (!btn) return false
        btn.click()
        return true
      }, name)
      return clicked
    },
    { timeout: 10000, interval: 200, timeoutMsg: `template not found: ${name}` },
  )
  await (await browser.$('[data-testid="knowledge-doc-editor"]')).waitForExist({
    timeout: 15000,
  })
}

export async function saveVersionManual(): Promise<void> {
  await clickMenuItem('knowledge-doc-menu', 'knowledge-save-version')
  await browser.pause(500)
}

export async function openVersionHistory(): Promise<void> {
  await clickMenuItem('knowledge-doc-menu', 'knowledge-version-history')
  await (await browser.$('[data-testid="knowledge-versions-list"]')).waitForExist({
    timeout: 10000,
  })
}

/** Restore the first (newest) version row and confirm. */
export async function restoreNewestVersion(): Promise<void> {
  await openVersionHistory()
  const restore = await browser.$('[data-testid="knowledge-version-restore"]')
  await restore.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), restore)
  const confirm = await browser.$('[data-testid="knowledge-version-restore-confirm"]')
  await confirm.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), confirm)
  await browser.pause(500)
}

export async function clickFilterTag(tag: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      return browser.execute((tg: string) => {
        const buttons = Array.from(
          document.querySelectorAll('[data-testid="knowledge-filter-tag"]'),
        ) as HTMLElement[]
        const btn = buttons.find((b) => (b.textContent ?? '').trim() === tg)
        if (!btn) return false
        btn.click()
        return true
      }, tag)
    },
    { timeout: 15000, interval: 300, timeoutMsg: `filter tag not found: ${tag}` },
  )
  await browser.pause(200)
}

export async function attachAssetFromPath(absPath: string): Promise<void> {
  await ensureKnowledgeSource()
  await installPickAttachmentFilesSeam([absPath])
  await clickTestId('knowledge-attach-asset')
  await browser.pause(600)
  await clearPickAttachmentFilesSeam()
  await waitForSaveStatusSaved(15000)
}

/** List entry paths inside a zip via system `unzip -l` (macOS/Linux e2e hosts). */
export function listZipEntryNames(zipPath: string): string[] {
  const out = execSync(`unzip -l ${JSON.stringify(zipPath)}`, {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  })
  // Lines look like: "        12  07-14-2026 12:00   docs/doc_x.md"
  const names: string[] = []
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*\d+\s+\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+(.+)$/)
    if (m?.[1]) {
      const name = m[1].trim()
      if (name && name !== 'Name' && !name.startsWith('---')) names.push(name)
    }
  }
  return names
}

/** Open Source slash menu at line start and pick an item by slash name (e.g. `h1`). */
export async function applySlashMenuItem(name: string): Promise<void> {
  await ensureKnowledgeSource()
  const content = await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')
  await content.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => {
    el.focus()
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel?.removeAllRanges()
    sel?.addRange(range)
    document.execCommand('insertText', false, '\n/')
  }, content)
  await browser.pause(200)

  let menu = await browser.$('[data-testid="knowledge-slash-menu"]')
  if (!(await menu.isExisting())) {
    await browser.execute((el: HTMLElement) => el.focus(), content)
    await browser.keys('/')
    await browser.pause(250)
    menu = await browser.$('[data-testid="knowledge-slash-menu"]')
  }
  await menu.waitForExist({ timeout: 10000 })

  let item = await browser.$(`[data-testid="knowledge-slash-${name}"]`)
  if (!(await item.isExisting())) {
    await browser.keys(name)
    await browser.pause(200)
    item = await browser.$(`[data-testid="knowledge-slash-${name}"]`)
  }
  await item.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), item)
  await browser.pause(200)
}

/** Count tree docs currently visible. */
export async function countTreeDocs(): Promise<number> {
  return browser.execute(
    () => document.querySelectorAll('[data-testid^="knowledge-tree-doc-"]').length,
  )
}
