import type { Options } from '@wdio/types'
import { createServer, type ViteDevServer } from 'vite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const VITE_PORT = 1420
const DEFAULT_BINARY = './src-tauri/target/debug/hip'
const appBinaryPath = process.env.E2E_BINARY || DEFAULT_BINARY

// Isolated data dir so repeated E2E runs do not accumulate sessions.
const e2eDataDir = process.env.E2E_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-data-'))
process.env.HIP_DATA_DIR = e2eDataDir

let viteServer: ViteDevServer | undefined

async function pingVite(): Promise<boolean> {
  try {
    await fetch(`http://localhost:${VITE_PORT}`)
    return true
  } catch {
    return false
  }
}

async function waitForVite(timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await pingVite()) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Vite did not become ready on port ${VITE_PORT}`)
}

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./e2e/**/*.spec.ts'],
  maxInstances: 1,

  services: [
    ['@wdio/tauri-service', {
      appBinaryPath,
      driverProvider: 'embedded',
    }],
  ],

  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      application: appBinaryPath,
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
    timeout: 180000,
    ...(process.env.E2E_GREP ? { grep: process.env.E2E_GREP, invert: process.env.E2E_INVERT === '1' } : {}),
  },

  reporters: ['spec'],

  onPrepare: async () => {
    if (await pingVite()) {
      console.log(`[e2e] reusing Vite already running on :${VITE_PORT}`)
    } else {
      viteServer = await createServer()
      await viteServer.listen()
      await waitForVite()
      console.log(`[e2e] started Vite on :${VITE_PORT}`)
    }
    // Give the sidecar a moment to cold-start after the app spawns.
    // The actual readiness is verified by the first spec's before hook.
  },

  onComplete: async () => {
    if (viteServer) {
      await viteServer.close()
      viteServer = undefined
      console.log('[e2e] stopped Vite')
    }
    // Cleanup isolated data dir unless the user provided one.
    if (!process.env.E2E_DATA_DIR && fs.existsSync(e2eDataDir)) {
      fs.rmSync(e2eDataDir, { recursive: true, force: true })
    }
  },
}
