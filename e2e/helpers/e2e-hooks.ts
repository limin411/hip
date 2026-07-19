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
  simulateAgentWriteFinished: (s: string, opts?: { path?: string }) => { turnId: string; callId: string }
  simulateToolStarted?: (s: string, opts?: { name?: string; path?: string }) => { turnId: string; callId: string }
  getFocusedPath?: () => string | null
  getFsActivePath?: (s: string) => string | null
  seedGoal?: (
    s: string,
    g: { id?: string; description: string; status: 'active' | 'paused' | 'blocked' | 'completed'; turns?: number; maxTurns?: number },
  ) => void
  seedParallelRun?: (o: {
    hostSessionId: string
    n?: number
    baseCwd: string
    prompt?: string
  }) => { runId: string; slotCount: number }
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
  openSettingsPageForE2e?: (page?: string) => void
  openHistoryPageForE2e?: () => void
  openTrashPageForE2e?: () => void
  simulatePluginInstallError: (error?: string) => void
  getMemoryConfig?: () => Promise<Record<string, unknown>>
  setMemoryConfig?: (partial: Record<string, unknown>) => Promise<Record<string, unknown>>
  seedMemoryItem?: (item: Record<string, unknown>) => Promise<Record<string, unknown>>
  listMemories?: (filter?: Record<string, unknown>) => Promise<unknown[]>
  deleteMemory?: (id: string, hard?: boolean) => Promise<boolean>
  restoreMemory?: (id: string) => Promise<Record<string, unknown>>
  emptyMemoryTrash?: () => Promise<number>
  triggerMemoryConsolidate?: (projectKeyHash?: string) => void
  getActiveSessionMemoryFlags?: () => {
    useMemories?: boolean
    generateMemories?: boolean
    incognito?: boolean
  } | null
  getActiveSessionForcePlan?: () => boolean | null
  getWorkflowSession?: (sessionId: string) => {
    activeWorkflow: { id: string; name: string } | null
    runId: string | null
    runStatus: string | null
    nodeStatuses: Record<string, string>
  }
  seedSubagentPause?: (sessionId: string) => {
    turnId: string
    callId: string
    marker: '[hip:subagent_paused]'
  }
  seedAgentInterrupt?: (sessionId: string, question?: string) => { turnId: string; question: string }
  seedPlanApproval?: (sessionId: string) => {
    turnId: string
    planItems: { content: string; status: string }[]
  }
  seedPlanProgress?: (
    sessionId: string,
    opts?: { complete?: boolean },
  ) => {
    turnId: string
    planItems: { content: string; status: string }[]
  }
  seedBackgroundTaskKilled?: (sessionId: string) => {
    turnId: string
    agentId: string
    taskId: string
  }
  simulateInvalidWorkflowError?: (sessionId: string, reason?: string) => void
  getLastAssistantText?: (sessionId: string) => string | null
  getPendingInterrupt?: (sessionId: string) => { turnId: string; question: string } | null
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

/** Open Settings → page via uiStore (DEV bridge). */
export async function openSettingsPageForE2e(page = 'general'): Promise<void> {
  await browser.execute((p: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks?.openSettingsPageForE2e) throw new Error('__hipE2E.openSettingsPageForE2e missing')
    hooks.openSettingsPageForE2e(p)
  }, page)
}

/** Open Session History via uiStore (DEV bridge). */
export async function openHistoryPageForE2e(): Promise<void> {
  await browser.execute(() => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks?.openHistoryPageForE2e) throw new Error('__hipE2E.openHistoryPageForE2e missing')
    hooks.openHistoryPageForE2e()
  })
}

/** Open Recycle Bin via uiStore (DEV bridge). */
export async function openTrashPageForE2e(): Promise<void> {
  await browser.execute(() => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks?.openTrashPageForE2e) throw new Error('__hipE2E.openTrashPageForE2e missing')
    hooks.openTrashPageForE2e()
  })
}

export async function simulatePluginInstallError(error = 'e2e package structure invalid'): Promise<void> {
  await browser.execute((msg: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks) throw new Error('__hipE2E missing')
    hooks.simulatePluginInstallError(msg)
  }, error)
}

export type WorkflowSessionSnapshot = {
  activeWorkflow: { id: string; name: string } | null
  runId: string | null
  runStatus: string | null
  nodeStatuses: Record<string, string>
}

/** Read workflow store projection after inject (DEV only; no product DAG shell). */
export async function getWorkflowSession(sessionId: string): Promise<WorkflowSessionSnapshot> {
  return browser.execute((id: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks?.getWorkflowSession) throw new Error('__hipE2E.getWorkflowSession missing')
    return hooks.getWorkflowSession(id)
  }, sessionId)
}

/** Subagent pause marker handoff (Track B) — first-line `[hip:subagent_paused]`. */
export async function seedSubagentPause(
  sessionId: string,
): Promise<{ turnId: string; callId: string; marker: '[hip:subagent_paused]' }> {
  return browser.execute((id: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks?.seedSubagentPause) throw new Error('__hipE2E.seedSubagentPause missing')
    return hooks.seedSubagentPause(id)
  }, sessionId)
}

export async function seedAgentInterrupt(
  sessionId: string,
  question?: string,
): Promise<{ turnId: string; question: string }> {
  return browser.execute(
    (id: string, q: string | undefined) => {
      const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
      if (!hooks?.seedAgentInterrupt) throw new Error('__hipE2E.seedAgentInterrupt missing')
      return hooks.seedAgentInterrupt(id, q)
    },
    sessionId,
    question,
  )
}

export async function seedPlanApproval(
  sessionId: string,
): Promise<{ turnId: string; planItems: { content: string; status: string }[] }> {
  return browser.execute((id: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks?.seedPlanApproval) throw new Error('__hipE2E.seedPlanApproval missing')
    return hooks.seedPlanApproval(id)
  }, sessionId)
}

export async function seedPlanProgress(
  sessionId: string,
  opts?: { complete?: boolean },
): Promise<{ turnId: string; planItems: { content: string; status: string }[] }> {
  return browser.execute(
    (id: string, o: { complete?: boolean } | undefined) => {
      const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
      if (!hooks?.seedPlanProgress) throw new Error('__hipE2E.seedPlanProgress missing')
      return hooks.seedPlanProgress(id, o)
    },
    sessionId,
    opts,
  )
}

export async function seedBackgroundTaskKilled(
  sessionId: string,
): Promise<{ turnId: string; agentId: string; taskId: string }> {
  return browser.execute((id: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks?.seedBackgroundTaskKilled) throw new Error('__hipE2E.seedBackgroundTaskKilled missing')
    return hooks.seedBackgroundTaskKilled(id)
  }, sessionId)
}

export async function simulateInvalidWorkflowError(sessionId: string, reason?: string): Promise<void> {
  await browser.execute(
    (id: string, r: string | undefined) => {
      const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
      if (!hooks?.simulateInvalidWorkflowError) throw new Error('__hipE2E.simulateInvalidWorkflowError missing')
      hooks.simulateInvalidWorkflowError(id, r)
    },
    sessionId,
    reason,
  )
}

export async function getLastAssistantText(sessionId: string): Promise<string | null> {
  return browser.execute((id: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks?.getLastAssistantText) throw new Error('__hipE2E.getLastAssistantText missing')
    return hooks.getLastAssistantText(id)
  }, sessionId)
}

export async function getPendingInterrupt(
  sessionId: string,
): Promise<{ turnId: string; question: string } | null> {
  return browser.execute((id: string) => {
    const hooks = (window as unknown as { __hipE2E?: HipE2E }).__hipE2E
    if (!hooks?.getPendingInterrupt) throw new Error('__hipE2E.getPendingInterrupt missing')
    return hooks.getPendingInterrupt(id)
  }, sessionId)
}
