/** Wait until the DEV-only window.__hipE2E bridge is installed by the frontend. */
export async function waitForHipE2E(timeoutMs = 30000): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        return await browser.execute(() => typeof (window as unknown as { __hipE2E?: unknown }).__hipE2E !== 'undefined')
      } catch {
        return false
      }
    },
    { timeout: timeoutMs, interval: 500, timeoutMsg: 'window.__hipE2E not available (need non-production frontend)' },
  )
}

export async function getActiveSessionId(): Promise<string | null> {
  return browser.execute(() => {
    const e2e = (window as unknown as { __hipE2E?: { getActiveSessionId: () => string | null } }).__hipE2E
    return e2e?.getActiveSessionId() ?? null
  })
}

/** Simulate agent write_file finish so diff refresh runs (file must already exist on disk). */
export async function simulateAgentWriteFinished(sessionId: string): Promise<{ turnId: string; callId: string }> {
  return browser.execute((id: string) => {
    const e2e = (window as unknown as {
      __hipE2E?: { simulateAgentWriteFinished: (s: string) => { turnId: string; callId: string } }
    }).__hipE2E
    if (!e2e) throw new Error('__hipE2E missing')
    return e2e.simulateAgentWriteFinished(id)
  }, sessionId)
}
