import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { preflightPluginEnable } from './preflight.js'

function tmpDir(): string {
  const d = join(tmpdir(), `hip-preflight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(d, { recursive: true })
  return d
}

describe('preflightPluginEnable', () => {
  const dirs: string[] = []
  const prev: Record<string, string | undefined> = {}

  function setEnv(k: string, v: string) {
    if (!(k in prev)) prev[k] = process.env[k]
    process.env[k] = v
  }

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true })
    }
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
      delete prev[k]
    }
  })

  it('flags capability conflict with existing user MCP package', () => {
    const root = tmpDir()
    dirs.push(root)
    const cwd = join(root, 'proj')
    mkdirSync(cwd, { recursive: true })

    writeFileSync(
      join(root, 'hip.toml'),
      `version = 1

[[mcpServers]]
id = "user-cdp"
name = "User CDP"
transport = "stdio"
command = "npx"
args = ["-y", "chrome-devtools-mcp@1.0.0"]
enabled = true
`,
    )
    writeFileSync(join(root, 'hip-plugins.json'), JSON.stringify({ plugins: [] }))
    setEnv('HIP_CONFIG_PATH', join(root, 'hip.toml'))
    setEnv('HIP_PLUGINS_PATH', join(root, 'hip-plugins.json'))
    setEnv('HIP_DATA_DIR', root)
    setEnv('HIP_SKILLS_DIR', join(root, 'empty-skills'))
    mkdirSync(join(root, 'empty-skills'), { recursive: true })

    const pluginDir = join(root, 'plug')
    mkdirSync(join(pluginDir, '.plugin'), { recursive: true })
    writeFileSync(
      join(pluginDir, '.plugin', 'plugin.json'),
      JSON.stringify({
        id: 'chrome-devtools',
        name: 'Chrome DevTools',
        version: '1.0.0',
        mcpServers: [
          {
            id: 'plugin-cdp',
            name: 'Plugin CDP',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', 'chrome-devtools-mcp@latest'],
            enabled: true,
          },
        ],
      }),
    )

    const pf = preflightPluginEnable(cwd, pluginDir)
    expect(pf.hasConflicts).toBe(true)
    expect(pf.capabilityConflicts.length).toBeGreaterThan(0)
    expect(pf.capabilityConflicts[0]!.fingerprint).toContain('chrome-devtools-mcp')
    expect(pf.recommendations).toContain('keep_user_mcp_skills_only')
  })

  it('flags skill id conflict with project skill', () => {
    const root = tmpDir()
    dirs.push(root)
    const cwd = join(root, 'proj')
    mkdirSync(join(cwd, '.hip', 'skills', 'formatter'), { recursive: true })
    writeFileSync(
      join(cwd, '.hip', 'skills', 'formatter', 'SKILL.md'),
      '---\nname: Project Formatter\ndescription: p\n---\n',
    )

    writeFileSync(join(root, 'hip.toml'), 'version = 1\n')
    writeFileSync(join(root, 'hip-plugins.json'), JSON.stringify({ plugins: [] }))
    setEnv('HIP_CONFIG_PATH', join(root, 'hip.toml'))
    setEnv('HIP_PLUGINS_PATH', join(root, 'hip-plugins.json'))
    setEnv('HIP_DATA_DIR', root)
    setEnv('HIP_SKILLS_DIR', join(root, 'empty-skills'))
    mkdirSync(join(root, 'empty-skills'), { recursive: true })

    const pluginDir = join(root, 'plug')
    mkdirSync(join(pluginDir, '.plugin'), { recursive: true })
    mkdirSync(join(pluginDir, 'skills', 'formatter'), { recursive: true })
    writeFileSync(
      join(pluginDir, '.plugin', 'plugin.json'),
      JSON.stringify({
        id: 'fmt-plug',
        name: 'Fmt',
        version: '1.0.0',
        skills: ['./skills/formatter'],
      }),
    )
    writeFileSync(
      join(pluginDir, 'skills', 'formatter', 'SKILL.md'),
      '---\nname: Plugin Formatter\ndescription: plug\n---\n',
    )

    const pf = preflightPluginEnable(cwd, pluginDir)
    expect(pf.hasConflicts).toBe(true)
    expect(pf.skillConflicts.some((c) => c.skillId === 'formatter')).toBe(true)
  })

  it('returns clean preflight when no overlap', () => {
    const root = tmpDir()
    dirs.push(root)
    const cwd = join(root, 'proj')
    mkdirSync(cwd, { recursive: true })
    writeFileSync(join(root, 'hip.toml'), 'version = 1\n')
    writeFileSync(join(root, 'hip-plugins.json'), JSON.stringify({ plugins: [] }))
    setEnv('HIP_CONFIG_PATH', join(root, 'hip.toml'))
    setEnv('HIP_PLUGINS_PATH', join(root, 'hip-plugins.json'))
    setEnv('HIP_DATA_DIR', root)
    setEnv('HIP_SKILLS_DIR', join(root, 'empty-skills'))
    mkdirSync(join(root, 'empty-skills'), { recursive: true })

    const pluginDir = join(root, 'plug')
    mkdirSync(join(pluginDir, '.plugin'), { recursive: true })
    mkdirSync(join(pluginDir, 'skills', 'unique-skill'), { recursive: true })
    writeFileSync(
      join(pluginDir, '.plugin', 'plugin.json'),
      JSON.stringify({
        id: 'unique-plug',
        name: 'Unique',
        version: '1.0.0',
        skills: ['./skills/unique-skill'],
      }),
    )
    writeFileSync(
      join(pluginDir, 'skills', 'unique-skill', 'SKILL.md'),
      '---\nname: Unique\ndescription: u\n---\n',
    )

    const pf = preflightPluginEnable(cwd, pluginDir)
    expect(pf.hasConflicts).toBe(false)
  })
})
