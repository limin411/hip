import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadExtensions, listResolvedHipMcpServers } from './load.js'

function tmpDir(): string {
  const d = join(tmpdir(), `hip-ext-load-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(d, { recursive: true })
  return d
}

describe('loadExtensions / ExtensionRegistry integration', () => {
  const dirs: string[] = []
  const prev: Record<string, string | undefined> = {}

  function setEnv(k: string, v: string) {
    if (!(k in prev)) prev[k] = process.env[k]
    process.env[k] = v
  }

  beforeEach(() => {
    /* env set per test */
  })

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

  it('project skill wins over plugin skill with same id', () => {
    const root = tmpDir()
    dirs.push(root)
    const cwd = join(root, 'proj')
    mkdirSync(join(cwd, '.hip', 'skills', 'formatter'), { recursive: true })
    writeFileSync(
      join(cwd, '.hip', 'skills', 'formatter', 'SKILL.md'),
      '---\nname: Project Formatter\ndescription: project\n---\nbody\n',
    )

    const pluginDir = join(root, 'plug')
    mkdirSync(join(pluginDir, '.plugin'), { recursive: true })
    mkdirSync(join(pluginDir, 'skills', 'formatter'), { recursive: true })
    writeFileSync(
      join(pluginDir, '.plugin', 'plugin.json'),
      JSON.stringify({
        id: 'my-plug',
        name: 'My Plug',
        version: '1.0.0',
        skills: ['./skills/formatter'],
      }),
    )
    writeFileSync(
      join(pluginDir, 'skills', 'formatter', 'SKILL.md'),
      '---\nname: Plugin Formatter\ndescription: plugin\n---\nbody\n',
    )

    const pluginsPath = join(root, 'hip-plugins.json')
    writeFileSync(pluginsPath, JSON.stringify({ plugins: [pluginDir] }))
    const configPath = join(root, 'hip.toml')
    writeFileSync(configPath, 'version = 1\n')
    setEnv('HIP_PLUGINS_PATH', pluginsPath)
    setEnv('HIP_CONFIG_PATH', configPath)
    setEnv('HIP_SKILLS_DIR', join(root, 'empty-skills'))
    mkdirSync(join(root, 'empty-skills'), { recursive: true })
    setEnv('HIP_DATA_DIR', root)

    const loaded = loadExtensions(cwd)
    const fmt = loaded.skills.find((s) => s.id === 'formatter')
    expect(fmt).toBeDefined()
    expect(fmt!.name).toBe('Project Formatter')
    expect(fmt!.scope).toBe('project')
    expect(loaded.conflicts.some((c) => c.kind === 'skill_id_shadow')).toBe(true)
  })

  it('stamps pluginId and scope on plugin skills', () => {
    const root = tmpDir()
    dirs.push(root)
    const cwd = join(root, 'proj')
    mkdirSync(cwd, { recursive: true })

    const pluginDir = join(root, 'plug')
    mkdirSync(join(pluginDir, '.plugin'), { recursive: true })
    mkdirSync(join(pluginDir, 'skills', 'only-plugin'), { recursive: true })
    writeFileSync(
      join(pluginDir, '.plugin', 'plugin.json'),
      JSON.stringify({
        id: 'my-plug',
        name: 'My Plug',
        version: '1.0.0',
        skills: ['./skills/only-plugin'],
      }),
    )
    writeFileSync(
      join(pluginDir, 'skills', 'only-plugin', 'SKILL.md'),
      '---\nname: Only Plugin\ndescription: x\n---\nbody\n',
    )

    const pluginsPath = join(root, 'hip-plugins.json')
    writeFileSync(pluginsPath, JSON.stringify({ plugins: [pluginDir] }))
    writeFileSync(join(root, 'hip.toml'), 'version = 1\n')
    setEnv('HIP_PLUGINS_PATH', pluginsPath)
    setEnv('HIP_CONFIG_PATH', join(root, 'hip.toml'))
    setEnv('HIP_SKILLS_DIR', join(root, 'empty-skills'))
    mkdirSync(join(root, 'empty-skills'), { recursive: true })
    setEnv('HIP_DATA_DIR', root)

    const loaded = loadExtensions(cwd)
    const sk = loaded.skills.find((s) => s.id === 'only-plugin')
    expect(sk).toBeDefined()
    expect(sk!.scope).toBe('plugin')
    expect(sk!.pluginId).toBe('my-plug')
  })

  it('user mcp id shadows plugin mcp; stamps pluginId on free plugin mcp', () => {
    const root = tmpDir()
    dirs.push(root)
    const cwd = join(root, 'proj')
    mkdirSync(cwd, { recursive: true })

    const pluginDir = join(root, 'plug')
    mkdirSync(join(pluginDir, '.plugin'), { recursive: true })
    writeFileSync(
      join(pluginDir, '.plugin', 'plugin.json'),
      JSON.stringify({
        id: 'my-plug',
        name: 'My Plug',
        version: '1.0.0',
        mcpServers: [
          {
            id: 'shared',
            name: 'Plugin Shared',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', 'chrome-devtools-mcp@1'],
            enabled: true,
          },
          {
            id: 'plugin-only',
            name: 'Plugin Only',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', 'some-other-mcp'],
            enabled: true,
          },
        ],
      }),
    )

    writeFileSync(
      join(root, 'hip.toml'),
      `version = 1

[[mcpServers]]
id = "shared"
name = "User Shared"
transport = "stdio"
command = "npx"
args = ["-y", "chrome-devtools-mcp@2"]
enabled = true
`,
    )
    writeFileSync(join(root, 'hip-plugins.json'), JSON.stringify({ plugins: [pluginDir] }))
    setEnv('HIP_PLUGINS_PATH', join(root, 'hip-plugins.json'))
    setEnv('HIP_CONFIG_PATH', join(root, 'hip.toml'))
    setEnv('HIP_SKILLS_DIR', join(root, 'empty-skills'))
    mkdirSync(join(root, 'empty-skills'), { recursive: true })
    setEnv('HIP_DATA_DIR', root)

    const servers = listResolvedHipMcpServers(cwd)
    const shared = servers.find((s) => s.id === 'shared')
    expect(shared?.name).toBe('User Shared')
    expect(shared?.pluginId).toBeUndefined()

    const only = servers.find((s) => s.id === 'plugin-only')
    expect(only).toBeDefined()
    expect(only!.pluginId).toBe('my-plug')
  })

  it('falls back to HIP_DATA_DIR/skills when HIP_SKILLS_DIR unset', () => {
    const root = tmpDir()
    dirs.push(root)
    const skillsDir = join(root, 'skills', 'from-data')
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(
      join(skillsDir, 'SKILL.md'),
      '---\nname: From Data\ndescription: via HIP_DATA_DIR\n---\nbody\n',
    )
    const cwd = join(root, 'proj')
    mkdirSync(cwd, { recursive: true })
    writeFileSync(join(root, 'hip.toml'), 'version = 1\n')
    writeFileSync(join(root, 'hip-plugins.json'), JSON.stringify({ plugins: [] }))

    setEnv('HIP_DATA_DIR', root)
    setEnv('HIP_CONFIG_PATH', join(root, 'hip.toml'))
    setEnv('HIP_PLUGINS_PATH', join(root, 'hip-plugins.json'))
    // Explicitly clear HIP_SKILLS_DIR so fallback path is used
    if (!( 'HIP_SKILLS_DIR' in prev)) prev.HIP_SKILLS_DIR = process.env.HIP_SKILLS_DIR
    delete process.env.HIP_SKILLS_DIR

    const loaded = loadExtensions(cwd)
    expect(loaded.skills.some((s) => s.id === 'from-data' && s.name === 'From Data')).toBe(true)
  })
})
