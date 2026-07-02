import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'

let pluginsDir: string
let pluginsPath: string
let configPath: string
let scratchRoot: string
const prevEnv: Record<string, string | undefined> = {}

function setEnv(k: string, v: string) {
  prevEnv[k] = process.env[k]
  process.env[k] = v
}

function makePluginDir(dir: string, manifest: Record<string, unknown>): void {
  const pluginDir = join(dir, '.plugin')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

function makeSkill(dir: string, name: string, content: string = `# ${name}`): void {
  const skillDir = join(dir, 'skills', name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf8')
}

function mkManager() {
  return new SessionManager(undefined, undefined, scratchRoot)
}

describe('plugin:delete handler', () => {
  beforeEach(() => {
    pluginsDir = mkdtempSync(join(tmpdir(), 'hip-pd-'))
    scratchRoot = mkdtempSync(join(tmpdir(), 'hip-pd-scratch-'))
    pluginsPath = join(pluginsDir, 'hip-plugins.json')
    writeFileSync(pluginsPath, JSON.stringify({ plugins: [] }), 'utf8')

    configPath = join(pluginsDir, 'hip.toml')
    writeFileSync(configPath, 'version = 1\n', 'utf8')

    setEnv('HIP_PLUGINS_DIR', pluginsDir)
    setEnv('HIP_PLUGINS_PATH', pluginsPath)
    setEnv('HIP_CONFIG_PATH', configPath)
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    rmSync(pluginsDir, { recursive: true, force: true })
    rmSync(scratchRoot, { recursive: true, force: true })
  })

  it('reloads plugin components in all sessions after a plugin is deleted', async () => {
    // ── Set up a plugin with one skill ──────────────────────────────────
    const pluginDir = join(pluginsDir, 'my-plugin')
    makePluginDir(pluginDir, {
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      skills: ['./skills/my-skill'],
    })
    makeSkill(pluginDir, 'my-skill', '---\nname: My Skill\ndescription: A plugin skill\n---\nBody')
    writeFileSync(pluginsPath, JSON.stringify({ plugins: [pluginDir] }), 'utf8')

    // ── Create a session that loads the plugin skill ────────────────────
    const mgr = mkManager()
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => { sent.push(m) }

    await mgr.handleAsync({
      type: 'session:create',
      id: 'test-session',
      config: { llmProvider: 'deepseek', model: '', tools: [] },
    }, send)

    const session = mgr.getSessionForTest('test-session')
    expect(session).toBeDefined()
    expect(session!.configMgr.skills.some((s) => s.id === 'my-skill')).toBe(true)

    // ── Simulate uninstall: remove plugin dir and registry entry ────────
    rmSync(pluginDir, { recursive: true, force: true })
    writeFileSync(pluginsPath, JSON.stringify({ plugins: [] }), 'utf8')

    // ── Notify sidecar that the plugin is gone ──────────────────────────
    sent.length = 0
    await mgr.handleAsync({ type: 'plugin:delete', pluginId: 'my-plugin' }, send)

    // ── Session no longer exposes the deleted plugin's skill ────────────
    expect(session!.configMgr.skills.some((s) => s.id === 'my-skill')).toBe(false)

    // ── Acknowledgement is sent ─────────────────────────────────────────
    const result = sent.find((m) => m.type === 'plugin:delete:result')
    expect(result).toBeDefined()
    if (result?.type === 'plugin:delete:result') {
      expect(result.pluginId).toBe('my-plugin')
      expect(result.ok).toBe(true)
    }
  })

  it('returns an error result when pluginId is missing', async () => {
    const mgr = mkManager()
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => { sent.push(m) }

    await mgr.handleAsync({ type: 'plugin:delete', pluginId: '' }, send)

    const result = sent.find((m) => m.type === 'plugin:delete:result')
    expect(result).toBeDefined()
    if (result?.type === 'plugin:delete:result') {
      expect(result.pluginId).toBe('')
      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    }
  })
})
