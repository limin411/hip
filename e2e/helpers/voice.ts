/**
 * Voice dictation e2e helpers.
 *
 * CI must run the app with:
 *   HIP_VOICE_MOCK=1
 * and a build where VOICE_INPUT is true (default after bake-in).
 *
 * No real microphone or model download is required under mock mode.
 */

export async function clickComposerMic(browser: WebdriverIO.Browser) {
  const mic = await browser.$('[data-testid="composer-voice-mic"]')
  await mic.waitForExist({ timeout: 10_000 })
  await mic.click()
  return mic
}

export async function expectMicState(
  browser: WebdriverIO.Browser,
  state: string,
  timeout = 10_000,
) {
  await browser.waitUntil(
    async () => {
      const mic = await browser.$('[data-testid="composer-voice-mic"]')
      if (!(await mic.isExisting())) return false
      const s = await mic.getAttribute('data-state')
      return s === state
    },
    { timeout, timeoutMsg: `composer mic not in state ${state}` },
  )
}
