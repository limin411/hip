/**
 * Knowledge base e2e helpers (WebdriverIO + Tauri).
 * Prefer stable data-testids; reuse + menu open retries from surface patterns.
 */

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

/** Create a doc and wait for default edit mode (CodeMirror host). */
export async function createDocAndExpectEditor(): Promise<void> {
  await clickTestId('knowledge-new-doc')
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

/** Toggle Edit ↔ Preview via SegmentedControl (clicks the inactive tab). */
export async function toggleKnowledgePreviewOrEdit(): Promise<void> {
  const toggle = await browser.$('[data-testid="knowledge-edit-toggle"]')
  await toggle.waitForExist({ timeout: 10000 })
  await browser.execute((root: HTMLElement) => {
    const tabs = Array.from(root.querySelectorAll('[role="tab"]')) as HTMLElement[]
    const inactive = tabs.find((t) => t.getAttribute('aria-selected') !== 'true')
    inactive?.click()
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

/** Select a layout tab on knowledge-layout-toggle (0=source, 1=split) — index, not i18n label. */
export async function setKnowledgeLayout(layout: 'source' | 'split'): Promise<void> {
  const toggle = await browser.$('[data-testid="knowledge-layout-toggle"]')
  await toggle.waitForExist({ timeout: 10000 })
  const idx = layout === 'split' ? 1 : 0
  await browser.execute(
    (root: HTMLElement, i: number) => {
      const tabs = Array.from(root.querySelectorAll('[role="tab"]')) as HTMLElement[]
      tabs[i]?.click()
    },
    toggle,
    idx,
  )
  await browser.pause(150)
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
