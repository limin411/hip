/**
 * Composer helpers for eval: new-conversation landing and in-session InputBar.
 */

/**
 * Fill a textarea without WebDriver performActions key-chords.
 * Long multi-line prompts blow WKWebView `actions` (javascript error) when using browser.keys.
 */
async function fillTextarea(ta: WebdriverIO.Element, text: string): Promise<void> {
  await ta.waitForExist({ timeout: 10000 })
  await ta.click()
  const ok = await browser.execute((el: HTMLTextAreaElement, value: string) => {
    el.focus()
    // React controlled input: reset value tracker so onChange fires
    const tracker = (el as unknown as { _valueTracker?: { setValue: (v: string) => void } })
      ._valueTracker
    if (tracker) tracker.setValue('')
    const proto = window.HTMLTextAreaElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    if (desc?.set) desc.set.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.value === value
  }, ta, text)
  if (!ok) {
    // Last resort: setValue (still avoids multi-kb key action chains)
    await ta.setValue(text)
  }
}

export async function sendNewConversationMessage(text: string): Promise<void> {
  const root = await browser.$('[data-testid="new-conversation"]')
  await root.waitForExist({ timeout: 30000 })
  const ta = await root.$('textarea')
  await fillTextarea(ta, text)
  const send = await root.$('[data-testid="composer-send"]')
  await send.waitForEnabled({ timeout: 10000 })
  await send.click()
}

/** Prefer session InputBar; fall back to new-conversation. */
export async function sendEvalPrompt(text: string): Promise<void> {
  const sessionTa = await browser.$('[data-testid="input-bar"] textarea')
  if (await sessionTa.isExisting()) {
    await fillTextarea(sessionTa, text)
    const send = await browser.$('[data-testid="input-bar"] [data-testid="composer-send"]')
    if (await send.isExisting()) {
      await send.waitForEnabled({ timeout: 10000 })
      await send.click()
      return
    }
    const anySend = await browser.$('[data-testid="composer-send"]')
    await anySend.waitForEnabled({ timeout: 10000 })
    await anySend.click()
    return
  }
  await sendNewConversationMessage(text)
}

export async function getAllMessageTexts(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid="message-answer"]')).map((n) =>
      (n.textContent ?? '').trim(),
    ),
  )
}

export async function getLastAssistantTextReadOnly(): Promise<string> {
  const fromBridge = await browser.execute(() => {
    const hooks = (
      window as unknown as {
        __hipE2E?: {
          getLastAssistantText?: (s: string) => string | null
          getActiveSessionId?: () => string | null
        }
      }
    ).__hipE2E
    const sid = hooks?.getActiveSessionId?.()
    if (sid && hooks?.getLastAssistantText) {
      return hooks.getLastAssistantText(sid) ?? ''
    }
    return ''
  })
  if (fromBridge.trim()) return fromBridge

  const answers = await getAllMessageTexts()
  for (let i = answers.length - 1; i >= 0; i--) {
    if (answers[i] && !isThinkingPlaceholder(answers[i])) return answers[i]
  }
  return answers[answers.length - 1] ?? ''
}

function isThinkingPlaceholder(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  // Pure activity chrome without real answer body
  return /^(正在思考|思考中|thinking|initializing|初始化)[.…]?$/i.test(t) || t.length < 4
}

/** Read turn busyness from product UI (composer stop + activity + thinking copy). */
export async function readTurnBusyState(): Promise<{
  stopVisible: boolean
  sendVisible: boolean
  streaming: boolean
  activityBusy: boolean
  thinkingText: boolean
  permissionOpen: boolean
  interruptOpen: boolean
  busy: boolean
}> {
  return browser.execute(() => {
    const stopVisible = Boolean(document.querySelector('[data-testid="composer-stop"]'))
    const sendVisible = Boolean(document.querySelector('[data-testid="composer-send"]'))
    const streaming = Boolean(
      document.querySelector('[data-testid="streaming-cursor"], .streaming-cursor'),
    )
    const activity = document.querySelector('[data-testid="activity-bar"]')
    const activityText = activity?.textContent ?? ''
    // Match Chinese product copy: 正在思考 / 初始化 / 运行中 / 执行…
    const activityBusy = activity
      ? /运行|执行|思考|初始化|loading|running|thinking|initializ|working|tool/i.test(activityText)
      : false
    const body = document.body.innerText ?? ''
    const thinkingText = /正在思考|思考中/.test(body) && stopVisible
    const permissionOpen = Boolean(document.querySelector('[data-testid="permission-modal"]'))
    const interruptOpen = Boolean(
      document.querySelector('[data-testid="plan-approval-card"]') ||
        document.querySelector('[data-testid="chat-interrupt"]') ||
        document.querySelector('[data-testid="agent-interrupt"]'),
    )
    const busy =
      stopVisible || streaming || activityBusy || thinkingText || permissionOpen || interruptOpen
    return {
      stopVisible,
      sendVisible,
      streaming,
      activityBusy,
      thinkingText,
      permissionOpen,
      interruptOpen,
      busy,
    }
  })
}

/**
 * Wait for agent turn to fully settle.
 * Requires: saw running (stop/thinking) → then idle for stability window.
 */
export async function waitForTurnSettle(opts: {
  timeoutMs: number
  userPrompt: string
  onTick?: () => Promise<void>
  /** How long UI must stay idle before declare settled (ms). */
  stableMs?: number
}): Promise<{ settled: boolean; timedOut: boolean; sawRunning: boolean }> {
  const deadline = Date.now() + opts.timeoutMs
  const stableNeed = opts.stableMs ?? 2500
  let sawRunning = false
  let idleSince: number | null = null

  // Phase 0: wait until user message appears (session committed)
  while (Date.now() < deadline) {
    if (opts.onTick) await opts.onTick()
    const hasUser = await browser.execute((userPrompt: string) => {
      const nodes = Array.from(document.querySelectorAll('[data-message-id]'))
      return nodes.some((n) => (n.textContent ?? '').includes(userPrompt.slice(0, 48)))
    }, opts.userPrompt)
    if (hasUser) break
    // Also accept session tab existence after send
    const hasSession = await browser.execute(
      () => document.querySelectorAll('[data-testid="session-tab"]').length > 0,
    )
    if (hasSession && Date.now() > deadline - opts.timeoutMs + 15_000) break
    await browser.pause(400)
  }

  // Phase 1+2: must observe busy, then idle stable
  while (Date.now() < deadline) {
    if (opts.onTick) await opts.onTick()
    const st = await readTurnBusyState()

    if (st.busy) {
      sawRunning = true
      idleSince = null
      await browser.pause(500)
      continue
    }

    // Not busy — only settle if we already saw running (or stop→send flip)
    if (!sawRunning) {
      // Early: might not have flipped to stop yet; wait a bit more
      const elapsed = opts.timeoutMs - (deadline - Date.now())
      if (elapsed < 12_000) {
        await browser.pause(400)
        continue
      }
      // After 12s still never busy: likely send failed or no API — treat as settled-failed later
      return { settled: true, timedOut: false, sawRunning: false }
    }

    if (idleSince === null) idleSince = Date.now()
    if (Date.now() - idleSince >= stableNeed) {
      // Final answer present?
      const answer = await getLastAssistantTextReadOnly()
      if (isThinkingPlaceholder(answer) && Date.now() < deadline - 5_000) {
        idleSince = null
        await browser.pause(500)
        continue
      }
      return { settled: true, timedOut: false, sawRunning: true }
    }
    await browser.pause(400)
  }

  return { settled: false, timedOut: true, sawRunning }
}
