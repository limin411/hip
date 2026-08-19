/**
 * Maintainer-only: capture README product screenshots from the live desktop UI.
 *
 *   HIP_DOCS_SHOTS=1 E2E_GREP=@docs-shots yarn test:e2e --spec e2e/specs/docs-screenshots.spec.ts
 *
 * Writes WebP (and a PNG source) under docs/images/. Skipped unless HIP_DOCS_SHOTS=1
 * so CI / yarn test:e2e:full never overwrite marketing shots.
 */
import { expect } from 'expect-webdriverio'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { expandActivityTrailIfCollapsed } from '../helpers/composer-tune.js'
import {
  closeOverlayForE2e,
  createCodeSessionForE2e,
  injectServerMessage,
  openSettingsPageForE2e,
  seedAgentCollaboration,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { selectPanelTab } from '../helpers/panel.js'
import { switchToChatSurface, switchToCodeSurface } from '../helpers/surface.js'

const enabled = process.env.HIP_DOCS_SHOTS === '1'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.join(repoRoot, 'docs', 'images')
const FIXTURE = path.resolve(repoRoot, 'e2e/fixtures/sample-project')

function encodeWebp(pngPath: string, webpPath: string): void {
  const r = spawnSync('cwebp', ['-q', '82', '-m', '6', pngPath, '-o', webpPath], {
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    throw new Error(`cwebp failed for ${pngPath}: ${r.stderr || r.stdout || r.status}`)
  }
}

async function forceEnglish(): Promise<void> {
  await browser.execute(() => {
    localStorage.setItem('i18nextLng', 'en')
    const raw = localStorage.getItem('hip-ui')
    let parsed: { state?: Record<string, unknown> } = { state: {} }
    try {
      if (raw) parsed = JSON.parse(raw) as { state?: Record<string, unknown> }
    } catch {
      parsed = { state: {} }
    }
    parsed.state = { ...(parsed.state ?? {}), language: 'en', theme: 'light' }
    localStorage.setItem('hip-ui', JSON.stringify(parsed))
  })
  await browser.refresh()
  await waitForAppReady()
  await waitForMainApp()
  await waitForHipE2E()
}

async function shot(basename: string): Promise<string> {
  fs.mkdirSync(outDir, { recursive: true })
  const png = path.join(outDir, `${basename}.png`)
  const webp = path.join(outDir, `${basename}.webp`)
  await browser.pause(400)
  await browser.saveScreenshot(png)
  expect(fs.existsSync(png)).toBe(true)
  encodeWebp(png, webp)
  expect(fs.existsSync(webp)).toBe(true)
  // Keep PNG only as an encode source; README links WebP.
  fs.rmSync(png, { force: true })
  return webp
}

async function seedDemoTurn(sessionId: string): Promise<void> {
  const turnId = `docs-turn-${Date.now().toString(36)}`
  const callId = `docs-read-${Date.now().toString(36)}`
  await injectServerMessage({
    type: 'agent:started',
    sessionId,
    turnId,
    agentId: 'supervisor',
    role: 'supervisor',
  })
  await injectServerMessage({
    type: 'token:stream',
    sessionId,
    turnId,
    agentId: 'supervisor',
    delta: 'I’ll inspect the workspace layout, then propose a small, reviewable change.',
  })
  await injectServerMessage({
    type: 'tool:started',
    sessionId,
    turnId,
    agentId: 'supervisor',
    role: 'supervisor',
    callId,
    name: 'read_file',
    input: JSON.stringify({ path: 'README.md' }),
    seq: 1,
  })
  await injectServerMessage({
    type: 'tool:finished',
    sessionId,
    turnId,
    agentId: 'supervisor',
    callId,
    status: 'finished',
    output: '# sample-project\n\nFixture workspace used by hip desktop e2e.\n',
  })
  await injectServerMessage({
    type: 'token:stream',
    sessionId,
    turnId,
    agentId: 'supervisor',
    delta: '\n\nREADME is a tiny fixture. Next I’ll skim `src/a.ts` and keep the edit scoped.',
  })
}

describe('README product screenshots @docs-shots', function () {
  before(async function () {
    if (!enabled) {
      this.skip()
      return
    }
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
    await forceEnglish()
    await leaveSpecialViewsIfOpen()
  })

  it('captures Chat landing, Code landing, agent session, Settings, Knowledge', async function () {
    if (!enabled) {
      this.skip()
      return
    }

    await switchToChatSurface()
    await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 60000 })
    await shot('chat-surface')

    await switchToCodeSurface()
    await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 60000 })
    await shot('code-surface')

    const sessionId = await createCodeSessionForE2e(FIXTURE)
    expect(sessionId).toBeTruthy()
    await injectServerMessage({
      type: 'session:title',
      sessionId,
      title: 'sample-project',
    })
    await seedDemoTurn(sessionId)
    await seedAgentCollaboration(sessionId)
    await expandActivityTrailIfCollapsed()
    try {
      await selectPanelTab('files')
    } catch {
      // Rail may already be open on Files; still a useful workbench shot.
    }
    await shot('code-session')

    await openSettingsPageForE2e('model')
    await (await browser.$('[data-testid="settings-page"]')).waitForExist({ timeout: 15000 })
    await (await browser.$('[data-testid="model-config-cards"]')).waitForExist({ timeout: 15000 })
    await shot('settings-models')
    await closeOverlayForE2e()

    const knowledgeNav = await browser.$('[data-testid="sidebar-nav-knowledge"]')
    await knowledgeNav.waitForExist({ timeout: 15000 })
    await browser.execute((el: HTMLElement) => el.click(), knowledgeNav)
    await (await browser.$('[data-testid="knowledge-page"]')).waitForExist({ timeout: 20000 })
    await shot('knowledge-home')
  })
})
