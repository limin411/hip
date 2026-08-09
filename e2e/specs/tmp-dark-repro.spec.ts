/**
 * TEMP repro (not for commit): dark-mode six-dot drag handle background.
 * Mounts the REAL app side menu via synthetic mousemove over a block, then
 * captures computed styles + element screenshot in light vs dark mode.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'

const shotDir = process.env.E2E_SCREENSHOT_DIR || path.join(os.tmpdir(), 'hip-e2e-screenshots')

async function mountMenu(tag: string): Promise<boolean> {
  const block = await browser.$('[data-testid="knowledge-doc-live-editor"] .bn-block')
  await block.waitForExist({ timeout: 10000 })
  const probe = await browser.execute((b: HTMLElement) => {
    const r = b.getBoundingClientRect()
    const x = Math.round(r.left + 40)
    const y = Math.round(r.top + Math.min(24, r.height / 2))
    const at = document
      .elementsFromPoint(x, y)
      .map((e) => (e.className ? String(e.className).slice(0, 40) : e.tagName))
      .slice(0, 6)
    for (const ev of ['mousemove', 'mouseover']) {
      b.dispatchEvent(
        new MouseEvent(ev, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
        }),
      )
    }
    return { x, y, rect: { l: r.left, t: r.top, w: r.width, h: r.height }, at }
  }, block)
  console.log(`[repro] ${tag} hover probe:`, JSON.stringify(probe))
  await browser.pause(600)
  const state = await browser.execute(() => ({
    hasMenu: !!document.querySelector('.bn-side-menu'),
    hasHandle: !!document.querySelector('[data-test="dragHandle"]'),
    hasKbMenu: !!document.querySelector('[data-testid="kb-side-menu"]'),
    menus: Array.from(document.querySelectorAll('.bn-side-menu')).map((m) => ({
      testid: m.getAttribute('data-testid'),
      html: m.outerHTML.slice(0, 220),
      rect: m.getBoundingClientRect().toJSON(),
    })),
  }))
  console.log(`[repro] ${tag} after hover:`, JSON.stringify(state))
  return state.hasKbMenu
}

async function capture(tag: string, pngName: string): Promise<void> {
  const handle = await browser.$('[data-test="dragHandle"]')
  if (!(await handle.isExisting())) {
    console.log(`[repro] ${tag} no handle to capture`)
    return
  }
  const info = await browser.execute((h: HTMLElement) => {
    const btn = h.closest('button') as HTMLElement | null
    const menu = h.closest('.bn-side-menu') as HTMLElement | null
    const editor = h.closest('.knowledge-blocknote-editor') as HTMLElement | null
    const cs = (el: HTMLElement | null) => {
      if (!el) return null
      const s = getComputedStyle(el)
      return {
        bg: s.backgroundColor,
        bgImage: s.backgroundImage.slice(0, 60),
        color: s.color,
        display: s.display,
        opacity: s.opacity,
      }
    }
    const r = btn?.getBoundingClientRect()
    return {
      dark: document.documentElement.classList.contains('dark'),
      btn: cs(btn),
      menu: cs(menu),
      btnRect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
      kbGrip: editor ? getComputedStyle(editor).getPropertyValue('--kb-grip').trim() : null,
      hoverBg: btn ? getComputedStyle(btn).getPropertyValue('background-color') : null,
      hoverColor: btn ? getComputedStyle(btn).color : null,
      stateHover: btn
        ? getComputedStyle(btn.closest('.knowledge-blocknote-editor') as HTMLElement).getPropertyValue('--state-hover').trim()
        : null,
    }
  }, handle)
  console.log(`[repro] ${tag} real handle:`, JSON.stringify(info))
  fs.mkdirSync(shotDir, { recursive: true })
  await browser.saveScreenshot(path.join(shotDir, pngName))
  console.log(`[repro] ${tag} saved ${pngName}`)
}

describe('tmp dark-mode six-dot repro (real menu)', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
  })

  it('captures the real side menu in light and dark mode', async () => {
    await browser.execute(() => document.documentElement.classList.remove('dark'))
    await browser.pause(300)
    const ok1 = await mountMenu('LIGHT')
    if (ok1) await capture('LIGHT', 'real-handle-LIGHT.png')

    await browser.execute(() => document.documentElement.classList.add('dark'))
    await browser.pause(500)
    const ok2 = await mountMenu('DARK')
    if (ok2) await capture('DARK', 'real-handle-DARK.png')
  })
})
