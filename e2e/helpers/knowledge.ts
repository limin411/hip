/**
 * Knowledge base e2e helpers (WebdriverIO + Tauri).
 * Prefer stable data-testids; reuse + menu open retries from surface patterns.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  openContextMenu,
  clickContextMenuItem,
} from './context-menu.js'

async function openNewSessionMenu(): Promise<void> {
  const button = await browser.$('[data-testid="new-session-button"]')
  await button.waitForExist({ timeout: 20000 })

  let chatItem = await browser.$('[data-testid="new-session-chat"]')
  if (await chatItem.isExisting()) return

  for (let attempt = 0; attempt < 3; attempt++) {
    await browser.execute((el: HTMLElement) => {
      el.focus()
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }, button)
    await browser.pause(50)
    await browser.keys('Enter')

    chatItem = await browser.$('[data-testid="new-session-chat"]')
    try {
      await chatItem.waitForExist({ timeout: 1000 })
      return
    } catch {
      try {
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
        }, button)
        chatItem = await browser.$('[data-testid="new-session-chat"]')
        await chatItem.waitForExist({ timeout: 1000 })
        return
      } catch {
        // retry
      }
    }
  }

  throw new Error('new-session menu did not open after retries')
}

async function clickTestId(testid: string, timeout = 10000): Promise<void> {
  const el = await browser.$(`[data-testid="${testid}"]`)
  await el.waitForExist({ timeout })
  await browser.execute((node: HTMLElement) => node.click(), el)
}

/** Open knowledge surface from title-bar + menu. */
export async function openKnowledgeFromMenu(): Promise<void> {
  await openNewSessionMenu()
  await clickTestId('new-session-kb')
  await (await browser.$('[data-testid="knowledge-page"]')).waitForExist({ timeout: 20000 })
}

/**
 * Create a space by name and enter workspace.
 * Assumes knowledge home is visible.
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
  await clickTestId('knowledge-create-space')
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
/** Create a doc and wait for default edit mode (CodeMirror host). */
export async function createDocAndExpectEditor(): Promise<void> {
  // Already editing? skip create
  if (await (await browser.$('[data-testid="knowledge-doc-editor"] .cm-content')).isExisting()) {
    return
  }
  await clickMenuItem('knowledge-new-menu', 'knowledge-new-doc')
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

/** Navigate to knowledge home from workspace (back button). */
export async function goKnowledgeHome(): Promise<void> {
  const back = await browser.$('[data-testid="knowledge-back-home"]')
  await back.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), back)
  await (await browser.$('[data-testid="knowledge-home"]')).waitForExist({ timeout: 15000 })
  await clearHomeSearch()
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
 * Synthetic HTML5 DnD: drag source row onto target row (into folder / after doc).
 * Uses the same MIME type as SpaceTree.
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

      const dt = new DataTransfer()
      const mime = 'application/x-hip-knowledge-node'
      // extract id from knowledge-tree-doc-XXX or knowledge-tree-folder-XXX
      const nodeId = srcId.replace(/^knowledge-tree-(doc|folder)-/, '')
      dt.setData(mime, nodeId)
      dt.effectAllowed = 'move'

      source.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }),
      )
      // Drop into folder center (into) or on doc (after)
      const rect = target.getBoundingClientRect()
      const clientY = rect.top + rect.height * 0.5
      target.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientY,
          clientX: rect.left + rect.width / 2,
        }),
      )
      target.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientY,
          clientX: rect.left + rect.width / 2,
        }),
      )
      source.dispatchEvent(
        new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }),
      )
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

/** Whether a space card with the given name exists on home. */
export async function spaceCardByName(name: string): Promise<boolean> {
  return browser.execute((target: string) => {
    const cards = Array.from(
      document.querySelectorAll('[data-testid="knowledge-space-card"]'),
    ) as HTMLElement[]
    return cards.some(
      (c) =>
        c.getAttribute('data-space-name') === target ||
        (c.textContent ?? '').includes(target),
    )
  }, name)
}
export async function openSpaceCardByName(name: string): Promise<void> {
  await clearHomeSearch()
  await browser.waitUntil(async () => spaceCardByName(name), {
    timeout: 15000,
    interval: 200,
    timeoutMsg: `space card missing: ${name}`,
  })
  await browser.execute((target: string) => {
    const cards = Array.from(
      document.querySelectorAll('[data-testid="knowledge-space-card"]'),
    ) as HTMLElement[]
    const card =
      cards.find((c) => c.getAttribute('data-space-name') === target) ??
      cards.find((c) => (c.textContent ?? '').includes(target))
    if (!card) throw new Error(`space card not found: ${target}`)
    const btn = card.querySelector('button')
    ;(btn ?? card).click()
  }, name)
  await (await browser.$('[data-testid="knowledge-workspace"]')).waitForExist({
    timeout: 20000,
  })
}

/**
 * Open home card overflow menu and click a menu item (rename/delete).
 * Menu trigger is opacity-0 until hover — force-visible then open like Radix menus.
 */
async function openSpaceCardMenuAndClick(
  name: string,
  itemTestId: string,
): Promise<void> {
  await clearHomeSearch()
  await browser.waitUntil(async () => spaceCardByName(name), {
    timeout: 15000,
    interval: 200,
    timeoutMsg: `space card not found: ${name}`,
  })

  for (let attempt = 0; attempt < 4; attempt++) {
    await browser.execute((target: string) => {
      const cards = Array.from(
        document.querySelectorAll('[data-testid="knowledge-space-card"]'),
      ) as HTMLElement[]
      const card =
        cards.find((c) => c.getAttribute('data-space-name') === target) ??
        cards.find((c) => (c.textContent ?? '').includes(target))
      if (!card) throw new Error(`space card not found: ${target}`)
      const menuBtn = card.querySelector(
        '[data-testid="knowledge-space-menu"]',
      ) as HTMLElement | null
      if (!menuBtn) throw new Error('knowledge-space-menu missing on card')
      let el: HTMLElement | null = menuBtn
      while (el) {
        el.style.opacity = '1'
        el.style.pointerEvents = 'auto'
        el.style.visibility = 'visible'
        if (el === card) break
        el = el.parentElement
      }
      menuBtn.focus()
      menuBtn.click()
    }, name)

    const item = await browser.$(`[data-testid="${itemTestId}"]`)
    try {
      await item.waitForExist({ timeout: 2000 })
      await browser.execute((node: HTMLElement) => node.click(), item)
      return
    } catch {
      await browser.keys('Escape').catch(() => {})
      await browser.pause(120)
      await browser.keys('Enter')
      try {
        await item.waitForExist({ timeout: 1500 })
        await browser.execute((node: HTMLElement) => node.click(), item)
        return
      } catch {
        // retry
      }
    }
  }
  throw new Error(`home space menu item not opened: ${itemTestId} for ${name}`)
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
  await (await browser.$('[data-testid="knowledge-home"]')).waitForExist({
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

/** Create folder via toolbar new-menu. */
export async function createFolderFromToolbar(): Promise<void> {
  const before = await browser.execute(
    () => document.querySelectorAll('[data-testid^="knowledge-tree-folder-"]').length,
  )
  await clickMenuItem('knowledge-new-menu', 'knowledge-new-folder')
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

/** Ensure knowledge home is visible (open from menu if needed, leave workspace). */
export async function ensureKnowledgeHome(): Promise<void> {
  if (await (await browser.$('[data-testid="knowledge-home"]')).isExisting()) {
    await clearHomeSearch()
    return
  }
  if (await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting()) {
    await goKnowledgeHome()
    return
  }
  await openKnowledgeFromMenu()
  if (await (await browser.$('[data-testid="knowledge-workspace"]')).isExisting()) {
    await goKnowledgeHome()
  }
  await (await browser.$('[data-testid="knowledge-home"]')).waitForExist({
    timeout: 15000,
  })
  await clearHomeSearch()
}
/** Count space cards on home. */
export async function countSpaceCards(): Promise<number> {
  const cards = await browser.$$('[data-testid="knowledge-space-card"]')
  return cards.length
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
