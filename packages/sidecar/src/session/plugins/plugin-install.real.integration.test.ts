/**
 * T9 — Real-network integration tests for the agent-driven plugin install
 * lifecycle.  Exercises `SessionManager.handleAsync` with a `plugin:install:url`
 * message, which triggers a real `git clone --depth 1` through `prepareStaging`.
 *
 * These tests require:
 *  - Network access to github.com (gated by `hasNetwork`)
 *  - `git` on PATH
 *  - Public HTTPS repos only (no auth, no private repos)
 *
 * The happy case uses a tiny, well-known public test repo.  Because the repo has
 * no `.plugin/plugin.json`, the auto-generation path in `readOrGenerateManifest`
 * produces a valid manifest and the install succeeds with zero components.
 * Maintainers: if you have a public repo WITH a `.plugin/plugin.json` that
 * declares skills or MCP servers, substitute HAPPY_REPO_URL below for richer
 * assertions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promises as dns } from 'node:dns'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from '../session-manager.js'

// ── Network gating ─────────────────────────────────────────────────────

async function checkNetwork(): Promise<boolean> {
  if (process.env.CI === 'true') return false
  try {
    await dns.lookup('github.com', { family: 4 })
    return true
  } catch {
    return false
  }
}

const hasNetwork = await checkNetwork()

// ── Constants ──────────────────────────────────────────────────────────

/**
 * Happy-path repo: a tiny, stable, public GitHub test repository.
 *
 * `octocat/Spoon-Knife` is GitHub's classic "fork me" demo repo — a few KB,
 * always available, and perfect for lightweight clone tests.
 *
 * If you have a real plugin repo with `.plugin/plugin.json` and at least one
 * skill or MCP server, replace this URL to get richer component-count assertions.
 */
const HAPPY_REPO_URL = 'https://github.com/octocat/Spoon-Knife.git'

/** A URL guaranteed to return 404 from git clone. */
const MISSING_REPO_URL = 'https://github.com/hip/nonexistent-plugin-12345.git'

// ── Helpers ────────────────────────────────────────────────────────────

let pluginsDir: string
let pluginsPath: string
let scratchRoot: string
const prevEnv: Record<string, string | undefined> = {}

function setEnv(k: string, v: string): void {
  prevEnv[k] = process.env[k]
  process.env[k] = v
}

function mkManager(): SessionManager {
  return new SessionManager(undefined, undefined, scratchRoot)
}

function readPluginsJson(): { plugins: string[] } {
  return JSON.parse(readFileSync(pluginsPath, 'utf8')) as { plugins: string[] }
}

/** List all entries inside pluginsDir, returning their basenames. */
function listPluginsDir(): string[] {
  try {
    return readdirSync(pluginsDir)
  } catch {
    return []
  }
}

/** True when any `.staging-*` directory remains inside pluginsDir. */
function hasStagingDirs(): boolean {
  return listPluginsDir().some((e) => e.startsWith('.staging-'))
}

// ── Test lifecycle ─────────────────────────────────────────────────────

beforeEach(() => {
  pluginsDir = mkdtempSync(join(tmpdir(), 'hip-pi-real-'))
  scratchRoot = mkdtempSync(join(tmpdir(), 'hip-pi-scratch-'))
  pluginsPath = join(pluginsDir, 'hip-plugins.json')
  writeFileSync(pluginsPath, JSON.stringify({ plugins: [] }), 'utf8')

  setEnv('HIP_PLUGINS_DIR', pluginsDir)
  setEnv('HIP_PLUGINS_PATH', pluginsPath)
  // Session construction loads plugin components — these env vars keep it quiet.
  setEnv('HIP_SKILLS_PATH', join(pluginsDir, 'skills.json'))
  setEnv('HIP_MCP_SERVERS_PATH', join(pluginsDir, 'mcp.json'))
  setEnv('HIP_AGENTS_PATH', '')
  writeFileSync(join(pluginsDir, 'skills.json'), JSON.stringify({ enabled: {} }), 'utf8')
  writeFileSync(join(pluginsDir, 'mcp.json'), JSON.stringify({ servers: [] }), 'utf8')
})

afterEach(() => {
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(pluginsDir, { recursive: true, force: true })
  rmSync(scratchRoot, { recursive: true, force: true })
})

// ═══════════════════════════════════════════════════════════════════════
// Happy path — real git clone
// ═══════════════════════════════════════════════════════════════════════

describe.skipIf(!hasNetwork)('plugin:install:url — real-network happy path', () => {
  it(
    'clones a real public repo, installs it, and emits correct progress + result',
    async () => {
      const mgr = mkManager()
      const sent: ServerMessage[] = []
      const send = (m: ServerMessage): void => {
        sent.push(m)
      }

      await mgr.handleAsync({ type: 'plugin:install:url', url: HAPPY_REPO_URL }, send)

      // ── Result is ok: true ──────────────────────────────────────────
      const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
      expect(resultMsg).toBeDefined()
      if (resultMsg?.type === 'plugin:install:result') {
        expect(resultMsg.ok).toBe(true)
        expect(resultMsg.pluginId).toBeDefined()
        expect(typeof resultMsg.pluginId).toBe('string')
        expect((resultMsg.pluginId as string).length).toBeGreaterThan(0)
      }

      // ── Progress messages fire in the right order ───────────────────
      const progressMsgs = sent.filter((m) => m.type === 'plugin:install:progress')
      expect(progressMsgs.length).toBeGreaterThanOrEqual(4)
      expect(progressMsgs[0]!.status).toBe('cloning')
      expect(progressMsgs[1]!.status).toBe('scanning')
      expect(progressMsgs[2]!.status).toBe('registering')
      expect(progressMsgs[3]!.status).toBe('done')

      // ── Done progress has numeric, non-negative component counts ────
      const doneMsg = progressMsgs.find((m) => m.status === 'done')
      expect(doneMsg?.type).toBe('plugin:install:progress')
      if (doneMsg?.type === 'plugin:install:progress') {
        expect(doneMsg.components).toBeDefined()
        const c = doneMsg.components!
        expect(typeof c.skills).toBe('number')
        expect(typeof c.mcpServers).toBe('number')
        expect(typeof c.agents).toBe('number')
        expect(typeof c.hooks).toBe('number')
        expect(c.skills).toBeGreaterThanOrEqual(0)
        expect(c.mcpServers).toBeGreaterThanOrEqual(0)
        expect(c.agents).toBeGreaterThanOrEqual(0)
        expect(c.hooks).toBeGreaterThanOrEqual(0)
        expect(doneMsg.pluginId).toBeDefined()
      }

      // ── hip-plugins.json contains the plugin directory path string ──
      const config = readPluginsJson()
      expect(config.plugins.length).toBe(1)
      expect(typeof config.plugins[0]).toBe('string')
      expect(config.plugins[0]).toContain(pluginsDir)

      // ── Plugin directory exists at the configured path ──────────────
      expect(existsSync(config.plugins[0]!)).toBe(true)
      expect(existsSync(join(config.plugins[0]!, '.plugin', 'plugin.json'))).toBe(true)

      // ── No leftover .staging-* directories ──────────────────────────
      expect(hasStagingDirs()).toBe(false)

      // ── Progress messages appear before result ──────────────────────
      const lastProgressIdx = sent.map((m) => m.type).lastIndexOf('plugin:install:progress')
      const resultIdx = sent.findIndex((m) => m.type === 'plugin:install:result')
      expect(resultIdx).toBeGreaterThan(lastProgressIdx)
    },
    120_000,
  )
})

// ═══════════════════════════════════════════════════════════════════════
// Failure mode — real git clone of a nonexistent repo
// ═══════════════════════════════════════════════════════════════════════

describe.skipIf(!hasNetwork)('plugin:install:url — real-network failure modes', () => {
  it(
    'returns ok: false for a nonexistent repo (404), cleans up staging dir, and does not alter config',
    async () => {
      const mgr = mkManager()
      const sent: ServerMessage[] = []
      const send = (m: ServerMessage): void => {
        sent.push(m)
      }

      await mgr.handleAsync({ type: 'plugin:install:url', url: MISSING_REPO_URL }, send)

      // ── Result is ok: false ─────────────────────────────────────────
      const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
      expect(resultMsg).toBeDefined()
      if (resultMsg?.type === 'plugin:install:result') {
        expect(resultMsg.ok).toBe(false)
        expect(resultMsg.error).toBeDefined()
        expect(resultMsg.error!).toMatch(/clone/i)
      }

      // ── Error progress emitted ──────────────────────────────────────
      const errorProgress = sent.find(
        (m) => m.type === 'plugin:install:progress' && m.status === 'error',
      )
      expect(errorProgress).toBeDefined()

      // ── No .staging-* directory remains ─────────────────────────────
      expect(hasStagingDirs()).toBe(false)

      // ── hip-plugins.json unchanged (still empty) ────────────────────
      const config = readPluginsJson()
      expect(config.plugins.length).toBe(0)
    },
    120_000,
  )
})
