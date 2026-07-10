import type { Options } from '@wdio/types'
import { createServer, type ViteDevServer } from 'vite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitForHipVite, isHipViteReady } from './e2e/helpers/vite-port'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const VITE_PORT = 1420
const DEFAULT_BINARY = './src-tauri/target/debug/hip'
const appBinaryPath = process.env.E2E_BINARY || DEFAULT_BINARY

// Fail fast at config load time if a foreign dev server is occupying the port
// the compiled Tauri binary will use. WDIO runs service onPrepare hooks in
// parallel with the config onPrepare hook, so an async check cannot prevent
// the Tauri service from spawning the app against the wrong frontend.
if (process.env.HIP_E2E_SKIP_PORT_GUARD !== '1') {
  const { execSync } = await import('node:child_process')
  try {
    const body = execSync(
      `node -e "fetch('http://localhost:${VITE_PORT}').then(r => r.text()).then(t => console.log(t)).catch(() => process.exit(1))"`,
      { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    if (!body.includes('<title>hip</title>')) {
      throw new Error(
        `Port ${VITE_PORT} is already occupied by a non-hip server. ` +
        `Stop the other dev server (e.g. from the stocker project) and try again.`,
      )
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('non-hip server')) {
      throw err
    }
    // No server running or fetch failed: safe to proceed.
  }
}

// Run-level isolated data dir. The embedded Tauri WebDriver provider spawns a
// single shared app process in its onPrepare hook, so per-worker dirs cannot be
// honored after the app is running. We create one fresh dir at suite start and
// use it for the entire run. The harness tracks it for cleanup in onComplete.
let e2eDataDir: string | undefined

let viteServer: ViteDevServer | undefined

const FIXTURE_PLUGIN_SRC = path.resolve(__dirname, 'e2e', 'fixtures', 'sample-plugin')
const USER_CONFIG_DIR = path.join(os.homedir(), '.hip', 'config')

function stageE2eData(e2eDataDir: string): void {
  const pluginsDir = path.join(e2eDataDir, 'plugins')
  const configDir = path.join(e2eDataDir, 'config')
  const fixtureDest = path.join(pluginsDir, 'sample-plugin')

  fs.mkdirSync(pluginsDir, { recursive: true })
  fs.mkdirSync(configDir, { recursive: true })

  if (!fs.existsSync(FIXTURE_PLUGIN_SRC)) {
    throw new Error(`Fixture plugin not found at ${FIXTURE_PLUGIN_SRC}`)
  }
  fs.cpSync(FIXTURE_PLUGIN_SRC, fixtureDest, { recursive: true, force: true })

  const userAuthPath = path.join(USER_CONFIG_DIR, 'auth.json')
  const destAuthPath = path.join(configDir, 'auth.json')
  if (fs.existsSync(userAuthPath)) {
    fs.copyFileSync(userAuthPath, destAuthPath)
    if (process.platform !== 'win32') {
      fs.chmodSync(destAuthPath, 0o600)
    }
  }

  const realPluginPaths = readUserPluginPaths(USER_CONFIG_DIR)
  const pluginsConfigPath = path.join(configDir, 'hip-plugins.json')
  fs.writeFileSync(
    pluginsConfigPath,
    JSON.stringify({ plugins: [fixtureDest, ...realPluginPaths] }, null, 2),
  )

  process.env.HIP_PLUGINS_PATH = pluginsConfigPath
}

function readUserPluginPaths(userConfigDir: string): string[] {
  for (const fileName of ['plugins.json', 'hip-plugins.json']) {
    const candidate = path.join(userConfigDir, fileName)
    if (!fs.existsSync(candidate)) continue
    try {
      const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      if (!Array.isArray(raw.plugins)) return []
      return raw.plugins.filter((entry: unknown): entry is string => typeof entry === 'string').map((entry) => path.resolve(entry))
    } catch (err) {
      console.warn(`[e2e] failed to parse ${candidate}:`, err instanceof Error ? err.message : String(err))
      return []
    }
  }
  return []
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

  // Flake governance: capture PNG on failure (default /tmp/hip-e2e-screenshots).
  afterTest: async (test, _context, { error }) => {
    if (!error) return
    try {
      const shotDir = process.env.E2E_SCREENSHOT_DIR || path.join(os.tmpdir(), 'hip-e2e-screenshots')
      fs.mkdirSync(shotDir, { recursive: true })
      const safeTitle = String(test.title ?? 'test').replace(/[^\w.-]+/g, '_').slice(0, 80)
      const file = path.join(shotDir, `${Date.now()}-${safeTitle}.png`)
      await browser.saveScreenshot(file)
      console.error(`[e2e] failure screenshot: ${file}`)
    } catch (shotErr) {
      console.error(
        '[e2e] failed to save screenshot:',
        shotErr instanceof Error ? shotErr.message : String(shotErr),
      )
    }
  },

  onWorkerStart: async (_cid, _caps, specs) => {
    // The embedded WebDriver provider spawns a single shared app process, so
    // per-worker data isolation is not possible. Log the active dir for debugging.
    fs.appendFileSync('/tmp/hip-e2e-worker.log', `onWorkerStart HIP_DATA_DIR=${process.env.HIP_DATA_DIR} for ${specs?.join(', ') || 'worker'}\n`)
    console.log(`[e2e] HIP_DATA_DIR=${process.env.HIP_DATA_DIR} for ${specs?.join(', ') || 'worker'}`)
  },

  beforeSession: async (_config, _capabilities, specs) => {
    fs.appendFileSync('/tmp/hip-e2e-worker.log', `beforeSession HIP_DATA_DIR=${process.env.HIP_DATA_DIR} for ${specs?.join(', ') || 'session'}\n`)
  },

  onPrepare: async () => {
    // Set up a fresh data directory BEFORE the Tauri service spawns the app in
    // its own onPrepare hook. The service inherits process.env and passes it to
    // the app, so this is the only point where run-level isolation is effective
    // with the embedded shared-driver mode.
    e2eDataDir = process.env.E2E_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-data-'))
    process.env.HIP_DATA_DIR = e2eDataDir
    console.log(`[e2e] HIP_DATA_DIR=${e2eDataDir}`)

    stageE2eData(e2eDataDir)

    if (await isHipViteReady()) {
      console.log(`[e2e] reusing hip Vite already running on :${VITE_PORT}`)
    } else {
      viteServer = await createServer()
      await viteServer.listen()
      await waitForHipVite()
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
    // Cleanup the run-level data dir unless the user provided a fixed one.
    if (!process.env.E2E_DATA_DIR && e2eDataDir && fs.existsSync(e2eDataDir)) {
      fs.rmSync(e2eDataDir, { recursive: true, force: true })
      console.log(`[e2e] cleaned up ${e2eDataDir}`)
    }
  },
}
