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

type HipE2E = {
  getActiveSessionId: () => string | null
  simulateAgentWriteFinished: (s: string) => { turnId: string; callId: string }
  createChatSessionForE2e: () => string
  createCodeSessionForE2e: (cwd: string) => string
  simulateTurnRunning: (s: string) => { turnId: string; callId: string }
  simulateTurnCancelled: (s: string) => void
  simulateSessionError: (s: string, code?: string, message?: string) => void
  seedAgentCollaboration: (s: string) => { turnId: string; callId: string }
  getSessionDebugBundleJson: () => string | null
}

export async function getActiveSessionId(): Promise<string | null> {
  return browser.execute(() => {
    const e2e = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    return e2e?.getActiveSessionId() ?? null
  })
}

/** Simulate agent write_file finish so diff refresh runs (file must already exist on disk). */
export async function simulateAgentWriteFinished(sessionId: string): Promise<{ turnId: string; callId: string }> {
  return browser.execute((id: string) => {
    const e2e = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!e2e) throw new Error('__hipE2E missing')
    return e2e.simulateAgentWriteFinished(id)
  }, sessionId)
}

export async function createChatSessionForE2e(): Promise<string> {
  return browser.execute(() => {
    const e2e = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!e2e) throw new Error('__hipE2E missing')
    return e2e.createChatSessionForE2e()
  })
}

export async function createCodeSessionForE2e(cwd: string): Promise<string> {
  return browser.execute((dir: string) => {
    const e2e = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!e2e) throw new Error('__hipE2E missing')
    return e2e.createCodeSessionForE2e(dir)
  }, cwd)
}

export async function simulateTurnRunning(sessionId: string): Promise<{ turnId: string; callId: string }> {
  return browser.execute((id: string) => {
    const e2e = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!e2e) throw new Error('__hipE2E missing')
    return e2e.simulateTurnRunning(id)
  }, sessionId)
}

export async function simulateTurnCancelled(sessionId: string): Promise<void> {
  await browser.execute((id: string) => {
    const e2e = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!e2e) throw new Error('__hipE2E missing')
    e2e.simulateTurnCancelled(id)
  }, sessionId)
}

export async function simulateSessionError(
  sessionId: string,
  code = 'AGENT_ERROR',
  message = 'e2e simulated error',
): Promise<void> {
  await browser.execute(
    (id: string, c: string, m: string) => {
      const e2e = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
      if (!e2e) throw new Error('__hipE2E missing')
      e2e.simulateSessionError(id, c, m)
    },
    sessionId,
    code,
    message,
  )
}

export async function seedAgentCollaboration(sessionId: string): Promise<{ turnId: string; callId: string }> {
  return browser.execute((id: string) => {
    const e2e = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!e2e) throw new Error('__hipE2E missing')
    return e2e.seedAgentCollaboration(id)
  }, sessionId)
}

export async function getSessionDebugBundleJson(): Promise<string | null> {
  return browser.execute(() => {
    const e2e = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    return e2e?.getSessionDebugBundleJson() ?? null
  })
}
