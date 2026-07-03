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

function writeHipToml(skills: Array<{ id: string; enabled: boolean }>): void {
  let body = 'version = 1\n'
  for (const s of skills) {
    body += `[[skills]]\nid = "${s.id}"\nenabled = ${s.enabled}\n`
  }
  writeFileSync(configPath, body, 'utf8')
}

describe('plugin skill enable/disable', () => {
  beforeEach(() => {
    pluginsDir = mkdtempSync(join(tmpdir(), 'hip-ps-'))
    scratchRoot = mkdtempSync(join(tmpdir(), 'hip-ps-scratch-'))
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

  it('loads only plugin skills that are enabled in hip.toml', async () => {
    const pluginDir = join(pluginsDir, 'my-plugin')
    makePluginDir(pluginDir, {
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      skills: ['./skills/enabled-skill', './skills/disabled-skill'],
    })
    makeSkill(pluginDir, 'enabled-skill', '---\nname: Enabled Skill\ndescription: On\n---\nBody')
    makeSkill(pluginDir, 'disabled-skill', '---\nname: Disabled Skill\ndescription: Off\n---\nBody')
    writeFileSync(pluginsPath, JSON.stringify({ plugins: [pluginDir] }), 'utf8')

    // Disable one of the plugin skills.
    writeHipToml([{ id: 'disabled-skill', enabled: false }])

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

    const skillIds = session!.configMgr.skills.map((s) => s.id)
    expect(skillIds).toContain('enabled-skill')
    expect(skillIds).not.toContain('disabled-skill')
  })

  it('loads all plugin skills by default when hip.toml has no skills section', async () => {
    const pluginDir = join(pluginsDir, 'my-plugin')
    makePluginDir(pluginDir, {
      id: 'my-plugin',
      name: 'My Plugin',
      version: '1.0.0',
      skills: ['./skills/skill-a'],
    })
    makeSkill(pluginDir, 'skill-a', '---\nname: Skill A\ndescription: A\n---\nBody')
    writeFileSync(pluginsPath, JSON.stringify({ plugins: [pluginDir] }), 'utf8')

    const mgr = mkManager()
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => { sent.push(m) }

    await mgr.handleAsync({
      type: 'session:create',
      id: 'test-session',
      config: { llmProvider: 'deepseek', model: '', tools: [] },
    }, send)

    const session = mgr.getSessionForTest('test-session')
    expect(session!.configMgr.skills.some((s) => s.id === 'skill-a')).toBe(true)
  })
})
