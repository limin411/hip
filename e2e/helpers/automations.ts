/**
 * Automations e2e helpers (WebdriverIO + Tauri).
 * Prefer stable data-testids; isolate via HIP_DATA_DIR/automations/*.json.
 * Schedule due is forced via window.__hipE2E.automationTick(now) — never wait 30s.
 */

import fs from 'node:fs'
import path from 'node:path'
import { waitForHipE2E } from './e2e-hooks.js'

/** HIP_DATA_DIR set by wdio.conf (isolated e2e data). */
export function getHipDataDir(): string {
  const dir = process.env.HIP_DATA_DIR
  if (!dir) throw new Error('HIP_DATA_DIR is not set')
  return dir
}

export function getAutomationsDir(): string {
  return path.join(getHipDataDir(), 'automations')
}

export function getAutomationsCatalogPath(): string {
  return path.join(getAutomationsDir(), 'catalog.json')
}

export function getAutomationsRunsPath(): string {
  return path.join(getAutomationsDir(), 'runs.json')
}

export type AutomationsCatalogFile = {
  version?: number
  automations?: Array<{
    id: string
    name: string
    prompt: string
    enabled: boolean
    trigger?: { kind: string; timeLocal?: string; weekday?: number }
    lastRunAt?: number | null
    lastStatus?: string | null
    nextRunAt?: number | null
  }>
}

export type AutomationsRunsFile = {
  version?: number
  runs?: Array<{
    id: string
    automationId: string
    status: string
    sessionId?: string | null
    startedAt?: number
  }>
}

export function readAutomationsCatalog(): AutomationsCatalogFile | null {
  const p = getAutomationsCatalogPath()
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as AutomationsCatalogFile
  } catch {
    return null
  }
}

export function readAutomationsRuns(): AutomationsRunsFile | null {
  const p = getAutomationsRunsPath()
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as AutomationsRunsFile
  } catch {
    return null
  }
}

/** Open automations surface via sidebar nav (product path). */
export async function openAutomationsFromMenu(): Promise<void> {
  const nav = await browser.$('[data-testid="sidebar-nav-automation"]')
  await nav.waitForExist({ timeout: 20000 })
  await browser.execute((el: HTMLElement) => el.click(), nav)
  await (await browser.$('[data-testid="automations-page"]')).waitForExist({
    timeout: 20000,
  })
}

/** Leave automations via chats nav. */
export async function leaveAutomationsToChats(): Promise<void> {
  const chats = await browser.$('[data-testid="sidebar-nav-chats"]')
  await chats.waitForExist({ timeout: 15000 })
  await browser.execute((el: HTMLElement) => el.click(), chats)
  await browser.waitUntil(
    async () => !(await (await browser.$('[data-testid="automations-page"]')).isExisting()),
    {
      timeout: 15000,
      interval: 200,
      timeoutMsg: 'automations-page still mounted after leave',
    },
  )
}

export async function expectAutomationsPage(): Promise<void> {
  await (await browser.$('[data-testid="automations-page"]')).waitForExist({
    timeout: 20000,
  })
  const placeholder = await browser.$('[data-testid="placeholder-automation"]')
  if (await placeholder.isExisting()) {
    throw new Error('expected AutomationsPage, got placeholder-automation')
  }
}

/**
 * Force a schedule host tick with optional epoch-ms `now`.
 * Installed by AutomationRunHost in non-production builds.
 */
export async function automationTick(now?: number): Promise<void> {
  await waitForHipE2E()
  await browser.waitUntil(
    async () => {
      try {
        return await browser.execute(
          () =>
            typeof (window as unknown as { __hipE2E?: { automationTick?: unknown } }).__hipE2E
              ?.automationTick === 'function',
        )
      } catch {
        return false
      }
    },
    {
      timeout: 15000,
      interval: 250,
      timeoutMsg: '__hipE2E.automationTick not installed (need AutomationsPage / AUTOMATION_PAGE)',
    },
  )
  await browser.execute((n?: number) => {
    const hooks = (window as unknown as {
      __hipE2E?: { automationTick?: (now?: number) => void }
    }).__hipE2E
    if (!hooks?.automationTick) throw new Error('__hipE2E.automationTick missing')
    hooks.automationTick(n)
  }, now)
}
