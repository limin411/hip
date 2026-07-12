import { closeSettings } from './settings.js'
import { openSettingsPageForE2e, waitForHipE2E } from './e2e-hooks.js'

type MemorySeed = {
  title: string
  content: string
  kind?: string
  scope?: string
  pinned?: boolean
  id?: string
}

type MemoryItem = {
  id: string
  title: string
  content: string
  kind: string
  scope: string
  status: string
  pinned?: boolean
}

type MemoryFlags = {
  useMemories?: boolean
  generateMemories?: boolean
  incognito?: boolean
} | null

/** Open Settings → Memory via DEV store bridge (reliable under shared-process residual state). */
export async function openMemorySettings(): Promise<void> {
  await waitForHipE2E()
  await openSettingsPageForE2e('memory')
  await browser.waitUntil(
    async () => {
      const empty = await browser.$('[data-testid="memory-config-empty"]')
      const panel = await browser.$('[data-testid="memory-config"]')
      return (await empty.isExisting()) || (await panel.isExisting())
    },
    { timeout: 15000, interval: 200, timeoutMsg: 'memory settings panel not visible' },
  )
}

export async function closeMemorySettings(): Promise<void> {
  await closeSettings()
}

/** Enable both use + generate via empty-state CTA (or no-op if already enabled). */
export async function enableMemoryBoth(): Promise<void> {
  const empty = await browser.$('[data-testid="memory-config-empty"]')
  if (await empty.isExisting()) {
    const btn = await browser.$('[data-testid="memory-enable-both"]')
    await btn.waitForClickable({ timeout: 10000 })
    await btn.click()
  }
  await browser.$('[data-testid="memory-config"]').waitForExist({ timeout: 15000 })
}

export async function seedMemoryItem(item: MemorySeed): Promise<MemoryItem> {
  await waitForHipE2E()
  const payload = {
    title: item.title,
    content: item.content,
    kind: item.kind ?? 'preference',
    scope: item.scope ?? 'global',
    ...(item.pinned !== undefined ? { pinned: item.pinned } : {}),
    ...(item.id ? { id: item.id } : {}),
  }
  const result = await browser.executeAsync((p, done) => {
    const hooks = (window as unknown as { __hipE2E?: {
      seedMemoryItem: (x: typeof p) => Promise<MemoryItem>
    } }).__hipE2E
    if (!hooks?.seedMemoryItem) {
      done({ error: 'seedMemoryItem missing' })
      return
    }
    hooks
      .seedMemoryItem(p as never)
      .then((r) => done(r))
      .catch((e: Error) => done({ error: e.message }))
  }, payload)
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error(String((result as { error: string }).error))
  }
  return result as MemoryItem
}

export async function listMemories(filter?: {
  status?: string
  limit?: number
  query?: string
}): Promise<MemoryItem[]> {
  await waitForHipE2E()
  const result = await browser.executeAsync((f, done) => {
    const hooks = (window as unknown as { __hipE2E?: {
      listMemories: (x?: typeof f) => Promise<MemoryItem[]>
    } }).__hipE2E
    if (!hooks?.listMemories) {
      done({ error: 'listMemories missing' })
      return
    }
    hooks
      .listMemories(f as never)
      .then((r) => done(r))
      .catch((e: Error) => done({ error: e.message }))
  }, filter ?? {})
  if (result && typeof result === 'object' && !Array.isArray(result) && 'error' in result) {
    throw new Error(String((result as { error: string }).error))
  }
  return result as MemoryItem[]
}

export async function deleteMemory(id: string, hard?: boolean): Promise<boolean> {
  await waitForHipE2E()
  const result = await browser.executeAsync((memId, h, done) => {
    const hooks = (window as unknown as { __hipE2E?: {
      deleteMemory: (id: string, hard?: boolean) => Promise<boolean>
    } }).__hipE2E
    if (!hooks?.deleteMemory) {
      done({ error: 'deleteMemory missing' })
      return
    }
    hooks
      .deleteMemory(memId, h === null ? undefined : h)
      .then((r) => done(r))
      .catch((e: Error) => done({ error: e.message }))
  }, id, hard === undefined ? null : hard)
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error(String((result as { error: string }).error))
  }
  return result as boolean
}

export async function restoreMemory(id: string): Promise<MemoryItem> {
  await waitForHipE2E()
  const result = await browser.executeAsync((memId, done) => {
    const hooks = (window as unknown as { __hipE2E?: {
      restoreMemory: (id: string) => Promise<MemoryItem>
    } }).__hipE2E
    if (!hooks?.restoreMemory) {
      done({ error: 'restoreMemory missing' })
      return
    }
    hooks
      .restoreMemory(memId)
      .then((r) => done(r))
      .catch((e: Error) => done({ error: e.message }))
  }, id)
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error(String((result as { error: string }).error))
  }
  return result as MemoryItem
}

export async function setMemoryConfig(partial: Record<string, unknown>): Promise<Record<string, unknown>> {
  await waitForHipE2E()
  const result = await browser.executeAsync((p, done) => {
    const hooks = (window as unknown as { __hipE2E?: {
      setMemoryConfig: (x: Record<string, unknown>) => Promise<Record<string, unknown>>
    } }).__hipE2E
    if (!hooks?.setMemoryConfig) {
      done({ error: 'setMemoryConfig missing' })
      return
    }
    hooks
      .setMemoryConfig(p)
      .then((r) => done(r))
      .catch((e: Error) => done({ error: e.message }))
  }, partial)
  if (result && typeof result === 'object' && 'error' in result && !('version' in result)) {
    throw new Error(String((result as { error: string }).error))
  }
  return result as Record<string, unknown>
}

export async function getActiveSessionMemoryFlags(): Promise<MemoryFlags> {
  await waitForHipE2E()
  return browser.execute(() => {
    const hooks = (window as unknown as { __hipE2E?: {
      getActiveSessionMemoryFlags: () => MemoryFlags
    } }).__hipE2E
    return hooks?.getActiveSessionMemoryFlags() ?? null
  })
}

/** Refresh Memory settings list by re-entering the panel (or filter click). */
export async function waitForMemoryListItem(id: string, timeoutMs = 15000): Promise<void> {
  await browser.waitUntil(
    async () => {
      const el = await browser.$(`[data-testid="memory-item-${id}"]`)
      return el.isExisting()
    },
    { timeout: timeoutMs, interval: 300, timeoutMsg: `memory-item-${id} not in list` },
  )
}
