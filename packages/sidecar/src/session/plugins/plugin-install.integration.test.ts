import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerMessage } from '@hip/protocol'

// ── Mock prepareStaging to bypass real git clone ───────────────────────

const { mockPrepareStaging, renameShouldThrow } = vi.hoisted(() => ({
  mockPrepareStaging: vi.fn(),
  renameShouldThrow: { value: false },
}))

vi.mock('../plugin-install.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../plugin-install.js')>()
  return {
    ...actual,
    prepareStaging: mockPrepareStaging,
  }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (renameShouldThrow.value) {
        throw Object.assign(new Error('ENOTEMPTY: directory not empty'), { code: 'ENOTEMPTY' })
      }
      return actual.renameSync(...args)
    },
  }
})

import { SessionManager } from '../session-manager.js'

// ── Helpers ───────────────────────────────────────────────────────────

let pluginsDir: string
let pluginsPath: string
let scratchRoot: string
const prevEnv: Record<string, string | undefined> = {}

function setEnv(k: string, v: string) {
  prevEnv[k] = process.env[k]
  process.env[k] = v
}

function mkManager() {
  return new SessionManager(undefined, undefined, scratchRoot)
}

/** Create `.plugin/plugin.json` inside `dir` with the given JSON. */
function makePluginDir(dir: string, manifest: Record<string, unknown>): void {
  const pluginDir = join(dir, '.plugin')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

/** Create a SKILL.md at `skills/<name>/SKILL.md` inside `dir`. */
function makeSkill(dir: string, name: string, content: string = `# ${name}`): void {
  const skillDir = join(dir, 'skills', name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf8')
}

/** Read and parse hip-plugins.json from the test plugins dir. */
function readPluginsJson(): { plugins: string[] } {
  return JSON.parse(readFileSync(pluginsPath, 'utf8')) as { plugins: string[] }
}

// ── Test lifecycle ────────────────────────────────────────────────────

beforeEach(() => {
  pluginsDir = mkdtempSync(join(tmpdir(), 'hip-pi-int-'))
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

  mockPrepareStaging.mockReset()
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
// Happy path tests
// ═══════════════════════════════════════════════════════════════════════

describe('plugin:install:url — happy path', () => {
  it('installs a plugin with existing .plugin/plugin.json, 3 skills + 1 inline MCP', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-pi-happy1-'))
    try {
      // ── Build a realistic plugin directory ──────────────────────────
      makePluginDir(stagingDir, {
        id: 'my-plugin',
        name: 'My Plugin',
        version: '1.0.0',
        skills: ['./skills/skill-a', './skills/skill-b', './skills/skill-c'],
        mcpServers: [
          {
            id: 'inline_mcp',
            name: 'Inline MCP Server',
            transport: 'stdio' as const,
            command: 'node',
            args: ['server.js'],
            enabled: true,
          },
        ],
      })
      makeSkill(stagingDir, 'skill-a', '# Skill A')
      makeSkill(stagingDir, 'skill-b', '# Skill B')
      makeSkill(stagingDir, 'skill-c', '# Skill C')

      mockPrepareStaging.mockReturnValue({ stagingDir, owned: true })

      const mgr = mkManager()
      const sent: ServerMessage[] = []
      const send = (m: ServerMessage) => { sent.push(m) }

      await mgr.handleAsync({ type: 'plugin:install:url', url: 'https://github.com/user/repo.git' }, send)

      // ── Progress messages fire in order ────────────────────────────
      const progressMsgs = sent.filter((m) => m.type === 'plugin:install:progress')
      expect(progressMsgs.length).toBeGreaterThanOrEqual(4)
      expect(progressMsgs[0]!.status).toBe('cloning')
      expect(progressMsgs[1]!.status).toBe('scanning')
      expect(progressMsgs[2]!.status).toBe('registering')
      expect(progressMsgs[3]!.status).toBe('done')

      // ── Result is ok: true ──────────────────────────────────────────
      const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
      expect(resultMsg).toBeDefined()
      if (resultMsg?.type === 'plugin:install:result') {
        expect(resultMsg.ok).toBe(true)
        expect(resultMsg.pluginId).toBe('my-plugin')
      }

      // ── Done progress has correct component counts ──────────────────
      const doneMsg = progressMsgs.find((m) => m.status === 'done')
      expect(doneMsg?.type).toBe('plugin:install:progress')
      if (doneMsg?.type === 'plugin:install:progress') {
        expect(doneMsg.components).toEqual({
          skills: 3,
          mcpServers: 1,
          agents: 0,
          hooks: 0,
        })
        expect(doneMsg.pluginId).toBe('my-plugin')
      }

      // ── hip-plugins.json contains the plugin directory path string ──
      const config = readPluginsJson()
      expect(config.plugins.length).toBe(1)
      expect(config.plugins[0]).toBe(join(pluginsDir, 'my-plugin'))

      // ── Plugin directory was created at the expected path ───────────
      expect(existsSync(join(pluginsDir, 'my-plugin'))).toBe(true)
      expect(existsSync(join(pluginsDir, 'my-plugin', '.plugin', 'plugin.json'))).toBe(true)

      // ── Progress messages appear before result ──────────────────────
      const lastProgressIdx = sent.map((m) => m.type).lastIndexOf('plugin:install:progress')
      const resultIdx = sent.findIndex((m) => m.type === 'plugin:install:result')
      expect(resultIdx).toBeGreaterThan(lastProgressIdx)
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })

  it('installs a repo without plugin.json — auto-generates manifest from skills + .mcp.json', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-pi-autogen-'))
    try {
      // ── Bare repo: no .plugin/, but has skills/ and .mcp.json ─────────
      mkdirSync(stagingDir, { recursive: true })
      writeFileSync(join(stagingDir, 'README.md'), '# Auto Gen Plugin', 'utf8')
      makeSkill(stagingDir, 'auto-a', '# Auto Skill A')
      makeSkill(stagingDir, 'auto-b', '# Auto Skill B')
      writeFileSync(
        join(stagingDir, '.mcp.json'),
        JSON.stringify([{ id: 'gen_mcp', name: 'Gen MCP', transport: 'stdio', command: 'node', args: ['srv.js'], enabled: true }]),
        'utf8',
      )

      mockPrepareStaging.mockReturnValue({ stagingDir, owned: false })

      const mgr = mkManager()
      const sent: ServerMessage[] = []
      const send = (m: ServerMessage) => { sent.push(m) }

      await mgr.handleAsync({ type: 'plugin:install:url', url: 'https://github.com/user/auto.git' }, send)

      const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
      expect(resultMsg).toBeDefined()
      if (resultMsg?.type === 'plugin:install:result') {
        expect(resultMsg.ok).toBe(true)
      }

      expect(existsSync(join(stagingDir, '.plugin', 'plugin.json'))).toBe(true)

      // ── Done progress reports correct counts ────────────────────────
      const doneMsg = sent.find(
        (m) => m.type === 'plugin:install:progress' && m.status === 'done',
      )
      expect(doneMsg).toBeDefined()
      if (doneMsg?.type === 'plugin:install:progress') {
        expect(doneMsg.components?.skills).toBe(2)
        // .mcp.json has one inline server
        expect(doneMsg.components?.mcpServers).toBe(1)
      }

      // ── hip-plugins.json updated ────────────────────────────────────
      const config = readPluginsJson()
      expect(config.plugins.length).toBe(1)
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })

  it('sends progress messages in correct order (cloning → scanning → registering → done)', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-pi-order-'))
    try {
      makePluginDir(stagingDir, { id: 'order-test', name: 'Order Test', version: '1.0.0' })
      mockPrepareStaging.mockReturnValue({ stagingDir, owned: true })

      const mgr = mkManager()
      const sent: ServerMessage[] = []
      const send = (m: ServerMessage) => { sent.push(m) }

      await mgr.handleAsync({ type: 'plugin:install:url', url: 'https://github.com/user/order.git' }, send)

      const progressMsgs = sent.filter((m) => m.type === 'plugin:install:progress')
      const statuses = progressMsgs.map((m) => (m as { status: string }).status)
      expect(statuses).toEqual(['cloning', 'scanning', 'registering', 'done'])

      // No error progress
      const errorMsgs = progressMsgs.filter((m) => (m as { status: string }).status === 'error')
      expect(errorMsgs.length).toBe(0)
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Failure mode tests
// ═══════════════════════════════════════════════════════════════════════

describe('plugin:install:url — failure modes', () => {
  it('rejects duplicate install of the same plugin ID', async () => {
    // ── First install: register a plugin at the slugified dir ──────────
    const stagingDir1 = mkdtempSync(join(tmpdir(), 'hip-pi-dup1-'))
    try {
      makePluginDir(stagingDir1, { id: 'dup-plugin', name: 'Duplicate Plugin', version: '1.0.0' })
      mockPrepareStaging.mockReturnValue({ stagingDir: stagingDir1, owned: true })

      const mgr = mkManager()
      let sent: ServerMessage[] = []
      const send1 = (m: ServerMessage) => { sent.push(m) }

      await mgr.handleAsync({ type: 'plugin:install:url', url: 'https://github.com/user/dup.git' }, send1)

      const firstResult = sent.find((m) => m.type === 'plugin:install:result')
      expect(firstResult).toBeDefined()
      if (firstResult?.type === 'plugin:install:result') {
        expect(firstResult.ok).toBe(true)
      }

      // The first install created pluginsDir/duplicate-plugin (from slugifying "Duplicate Plugin")
      expect(existsSync(join(pluginsDir, 'duplicate-plugin'))).toBe(true)
      expect(existsSync(join(pluginsDir, 'duplicate-plugin', '.plugin', 'plugin.json'))).toBe(true)

      // ── Second install: try the same plugin name ────────────────────
      const stagingDir2 = mkdtempSync(join(tmpdir(), 'hip-pi-dup2-'))
      try {
        makePluginDir(stagingDir2, { id: 'dup-plugin-2', name: 'Duplicate Plugin', version: '2.0.0' })
  mockPrepareStaging.mockReset()
  renameShouldThrow.value = false
        mockPrepareStaging.mockReturnValue({ stagingDir: stagingDir2, owned: true })

        sent = []
        const send2 = (m: ServerMessage) => { sent.push(m) }
        await mgr.handleAsync({ type: 'plugin:install:url', url: 'https://github.com/user/dup-v2.git' }, send2)

        const secondResult = sent.find((m) => m.type === 'plugin:install:result')
        expect(secondResult).toBeDefined()
        if (secondResult?.type === 'plugin:install:result') {
          expect(secondResult.ok).toBe(false)
          expect(secondResult.error).toBeDefined()
          expect(secondResult.error!).toMatch(/already installed/i)
        }

        // Error progress emitted
        const errorProgress = sent.find(
          (m) => m.type === 'plugin:install:progress' && (m as { status: string }).status === 'error',
        )
        expect(errorProgress).toBeDefined()

        // hip-plugins.json still has exactly one entry
        const config = readPluginsJson()
        expect(config.plugins.length).toBe(1)
      } finally {
        rmSync(stagingDir2, { recursive: true, force: true })
      }
    } finally {
      rmSync(stagingDir1, { recursive: true, force: true })
    }
  })

  it('returns ok: false for an invalid manifest and keeps config unchanged', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-pi-invalid-'))
    try {
      // ── Corrupt manifest ─────────────────────────────────────────────
      const manifestDir = join(stagingDir, '.plugin')
      mkdirSync(manifestDir, { recursive: true })
      writeFileSync(join(manifestDir, 'plugin.json'), '{ corrupt json', 'utf8')

      mockPrepareStaging.mockReturnValue({ stagingDir, owned: true })

      const mgr = mkManager()
      const sent: ServerMessage[] = []
      const send = (m: ServerMessage) => { sent.push(m) }

      await mgr.handleAsync({ type: 'plugin:install:url', url: 'https://github.com/user/bad.git' }, send)

      // ── Result is ok: false ──────────────────────────────────────────
      const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
      expect(resultMsg).toBeDefined()
      if (resultMsg?.type === 'plugin:install:result') {
        expect(resultMsg.ok).toBe(false)
        expect(resultMsg.error).toBeDefined()
      }

      // ── Error progress emitted ───────────────────────────────────────
      const errorProgress = sent.find(
        (m) => m.type === 'plugin:install:progress' && (m as { status: string }).status === 'error',
      )
      expect(errorProgress).toBeDefined()

      // ── hip-plugins.json unchanged (still empty) ─────────────────────
      const config = readPluginsJson()
      expect(config.plugins.length).toBe(0)
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })

  it('returns ok: false for manifest missing required field (name)', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-pi-noname-'))
    try {
      // ── Manifest with no "name" field ────────────────────────────────
      const manifestDir = join(stagingDir, '.plugin')
      mkdirSync(manifestDir, { recursive: true })
      writeFileSync(join(manifestDir, 'plugin.json'), JSON.stringify({ version: '1.0.0' }), 'utf8')

      mockPrepareStaging.mockReturnValue({ stagingDir, owned: true })

      const mgr = mkManager()
      const sent: ServerMessage[] = []
      const send = (m: ServerMessage) => { sent.push(m) }

      await mgr.handleAsync({ type: 'plugin:install:url', url: 'https://github.com/user/noname.git' }, send)

      const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
      expect(resultMsg).toBeDefined()
      if (resultMsg?.type === 'plugin:install:result') {
        expect(resultMsg.ok).toBe(false)
        expect(resultMsg.error).toBeDefined()
        expect(resultMsg.error!).toMatch(/name/i)
      }

      // ── hip-plugins.json unchanged ───────────────────────────────────
      const config = readPluginsJson()
      expect(config.plugins.length).toBe(0)
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })

  it('returns ok: false for non-HTTPS URL without invoking the tool', async () => {
    const mgr = mkManager()
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => { sent.push(m) }

    await mgr.handleAsync({ type: 'plugin:install:url', url: 'file:///etc/passwd' }, send)

    const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
    expect(resultMsg).toBeDefined()
    if (resultMsg?.type === 'plugin:install:result') {
      expect(resultMsg.ok).toBe(false)
      expect(resultMsg.error).toMatch(/https/i)
    }

    // prepareStaging was never called
    expect(mockPrepareStaging).not.toHaveBeenCalled()

    // No progress messages
    const progressMsgs = sent.filter((m) => m.type === 'plugin:install:progress')
    expect(progressMsgs.length).toBe(0)
  })

  it('returns ok: false for empty URL', async () => {
    const mgr = mkManager()
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => { sent.push(m) }

    await mgr.handleAsync({ type: 'plugin:install:url', url: '' }, send)

    const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
    expect(resultMsg).toBeDefined()
    if (resultMsg?.type === 'plugin:install:result') {
      expect(resultMsg.ok).toBe(false)
      expect(resultMsg.error).toMatch(/required/i)
    }

    // prepareStaging was never called
    expect(mockPrepareStaging).not.toHaveBeenCalled()
  })

  it('returns ok: false when renameSync fails and rolls back config', async () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'hip-pi-rename-fail-'))
    try {
      makePluginDir(stagingDir, { id: 'rename-test', name: 'Rename Test', version: '1.0.0' })

      mockPrepareStaging.mockReturnValue({ stagingDir, owned: true })
      renameShouldThrow.value = true

      const mgr = mkManager()
      const sent: ServerMessage[] = []
      const send = (m: ServerMessage) => { sent.push(m) }

      await mgr.handleAsync({ type: 'plugin:install:url', url: 'https://github.com/user/rename.git' }, send)

      const resultMsg = sent.find((m) => m.type === 'plugin:install:result')
      expect(resultMsg).toBeDefined()
      if (resultMsg?.type === 'plugin:install:result') {
        expect(resultMsg.ok).toBe(false)
        expect(resultMsg.error).toMatch(/move/i)
      }

      const config = readPluginsJson()
      expect(config.plugins.length).toBe(0)
    } finally {
      rmSync(stagingDir, { recursive: true, force: true })
    }
  })
})
