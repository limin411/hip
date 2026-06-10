import type { Options } from '@wdio/types'
import { createServer, type ViteDevServer } from 'vite'

const VITE_PORT = 1420

// The tauri-service spawns the app binary directly (not via `tauri dev`), so the
// webview loads `devUrl` (http://localhost:1420) without anyone starting the
// frontend. We bring Vite up here so `yarn test:e2e` is self-contained; wdio
// awaits config.onPrepare before the service's onPrepare spawns the app, so the
// window loads the real UI instead of about:blank. If a dev server is already
// running (e.g. `scripts/dev.sh start web`) we reuse it and leave it alone.
let viteServer: ViteDevServer | undefined

async function pingVite(): Promise<boolean> {
  try {
    await fetch(`http://localhost:${VITE_PORT}`)
    return true
  } catch {
    return false
  }
}

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./e2e/**/*.spec.ts'],
  maxInstances: 1,

  services: [
    ['@wdio/tauri-service', {
      appBinaryPath: './src-tauri/target/debug/bundle/macos/hip.app/Contents/MacOS/hip',
      driverProvider: 'embedded',
    }],
  ],

  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      application: './src-tauri/target/debug/bundle/macos/hip.app/Contents/MacOS/hip',
    },
  }],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 20000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    // Generous: the debug bundle loads the Vite-dev frontend, so a cold WebKit
    // webview can take ~30s+ to mount and the first sidecar round-trip adds more.
    timeout: 180000,
    // Optional selective run: E2E_GREP filters by test title; E2E_INVERT=1 turns
    // it into an exclusion (run everything EXCEPT matches). Used to skip the
    // live-agent "send first message" flow, which is manual GUI-acceptance only.
    ...(process.env.E2E_GREP ? { grep: process.env.E2E_GREP, invert: process.env.E2E_INVERT === '1' } : {}),
  },

  reporters: ['spec'],

  onPrepare: async () => {
    if (await pingVite()) {
      console.log(`[e2e] reusing Vite already running on :${VITE_PORT}`)
      return
    }
    // No inline server config needed — vite.config.ts already pins port 1420
    // (strictPort). createServer loads it from the project root.
    viteServer = await createServer()
    await viteServer.listen()
    // listen() resolves once the server accepts connections; confirm with a few
    // pings so the app's webview never races ahead of the first served response.
    for (let i = 0; i < 10 && !(await pingVite()); i++) {
      await new Promise((r) => setTimeout(r, 200))
    }
    console.log(`[e2e] started Vite on :${VITE_PORT}`)
  },

  onComplete: async () => {
    if (viteServer) {
      await viteServer.close()
      viteServer = undefined
      console.log('[e2e] stopped Vite')
    }
  },
}
