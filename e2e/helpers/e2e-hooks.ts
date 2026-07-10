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
  injectServerMessage: (msg: Record<string, unknown>) => void
  getActiveSessionId: () => string | null
  simulateAgentWriteFinished: (s: string) => { turnId: string; callId: string }
  createChatSessionForE2e: () => string
  createCodeSessionForE2e: (cwd: string) => string
  simulateTurnRunning: (s: string) => { turnId: string; callId: string }
  simulateTurnCancelled: (s: string) => void
  simulateSessionError: (s: string, code?: string, message?: string) => void
  seedAgentCollaboration: (s: string) => { turnId: string; callId: string }
  getSessionDebugBundleJson: () => string | null
  simulatePermissionRequest: (s: string) => { turnId: string; requestId: string }
  seedCheckpoints: (s: string) => { count: number }
  openCommandPaletteForE2e: () => void
  closeCommandPaletteForE2e: () => void
  simulatePluginInstallError: (error?: string) => void
}

export async function getActiveSessionId(): Promise<string | null> {
  return browser.execute(() => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    return hooks?.getActiveSessionId() ?? null
  })
}

/** Inject a ServerMessage through the same pipeline as the WS transport (DEV only). */
export async function injectServerMessage(msg: Record<string, unknown>): Promise<void> {
  await browser.execute((m: Record<string, unknown>) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    hooks.injectServerMessage(m)
  }, msg)
}

/** Simulate agent write_file finish so diff refresh runs (file must already exist on disk). */
export async function simulateAgentWriteFinished(sessionId: string): Promise<{ turnId: string; callId: string }> {
  return browser.execute((id: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    return hooks.simulateAgentWriteFinished(id)
  }, sessionId)
}

export async function createChatSessionForE2e(): Promise<string> {
  return browser.execute(() => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    return hooks.createChatSessionForE2e()
  })
}

export async function createCodeSessionForE2e(cwd: string): Promise<string> {
  return browser.execute((dir: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    return hooks.createCodeSessionForE2e(dir)
  }, cwd)
}

export async function simulateTurnRunning(sessionId: string): Promise<{ turnId: string; callId: string }> {
  return browser.execute((id: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    return hooks.simulateTurnRunning(id)
  }, sessionId)
}

export async function simulateTurnCancelled(sessionId: string): Promise<void> {
  await browser.execute((id: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    hooks.simulateTurnCancelled(id)
  }, sessionId)
}

export async function simulateSessionError(
  sessionId: string,
  code = 'AGENT_ERROR',
  message = 'e2e simulated error',
): Promise<void> {
  await browser.execute(
    (id: string, c: string, m: string) => {
      const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
      if (!hooks) throw new Error('__hipE2E missing')
      hooks.simulateSessionError(id, c, m)
    },
    sessionId,
    code,
    message,
  )
}

export async function seedAgentCollaboration(sessionId: string): Promise<{ turnId: string; callId: string }> {
  return browser.execute((id: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    return hooks.seedAgentCollaboration(id)
  }, sessionId)
}

export async function getSessionDebugBundleJson(): Promise<string | null> {
  return browser.execute(() => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    return hooks?.getSessionDebugBundleJson() ?? null
  })
}

export async function simulatePermissionRequest(sessionId: string): Promise<{ turnId: string; requestId: string }> {
  return browser.execute((id: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    return hooks.simulatePermissionRequest(id)
  }, sessionId)
}

export async function seedCheckpoints(sessionId: string): Promise<{ count: number }> {
  return browser.execute((id: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    return hooks.seedCheckpoints(id)
  }, sessionId)
}

export async function openCommandPaletteForE2e(): Promise<void> {
  await browser.execute(() => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    hooks.openCommandPaletteForE2e()
  })
}

export async function closeCommandPaletteForE2e(): Promise<void> {
  await browser.execute(() => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    hooks.closeCommandPaletteForE2e()
  })
}

export async function simulatePluginInstallError(error = 'e2e package structure invalid'): Promise<void> {
  await browser.execute((msg: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    hooks.simulatePluginInstallError(msg)
  }, error)
}
