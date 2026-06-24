import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HipConfig } from '@hip/protocol'
import { readHipConfig, resolveEffectiveConfig } from './hip-config.js'

let dirs: string[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'hip-int-'))
  dirs.push(d)
  return d
}

function writeToml(dir: string, name: string, content: string): string {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

function setupProjectDir(): { root: string; hipDir: string } {
  const root = tmpDir()
  const hipDir = join(root, '.hip')
  mkdirSync(hipDir)
  return { root, hipDir }
}

function resetEnv() {
  delete process.env.HIP_CONFIG_PATH
}

beforeEach(resetEnv)
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ok */ }
  }
  resetEnv()
})

// ── Wave 1: Write TOML → sidecar reads → verify sections match ──

describe('hip.toml read-back (end-to-end shape)', () => {
  it('writes full hip.toml and reads all sections back intact', () => {
    const dir = tmpDir()
    const toml = `version = 1

[[providers]]
id = "openai"
name = "OpenAI"
baseUrl = "https://api.openai.com/v1"
apiKey = "sk-test"

[[providers]]
id = "anthropic"
name = "Anthropic"
baseUrl = "https://api.anthropic.com/v1"

[[mcpServers]]
id = "filesystem"
name = "Filesystem MCP"
transport = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem"]
enabled = true

[[skills]]
id = "code-formatter"
enabled = true

[[skills]]
id = "linter"
enabled = false
`
    const configPath = writeToml(dir, 'hip.toml', toml)
    const cfg = readHipConfig(configPath)

    expect(cfg.version).toBe(1)
    expect(cfg.providers).toHaveLength(2)
    expect(cfg.providers![0]).toMatchObject({ id: 'openai', name: 'OpenAI' })
    expect(cfg.providers![1]).toMatchObject({ id: 'anthropic', name: 'Anthropic' })
    expect(cfg.mcpServers).toHaveLength(1)
    expect(cfg.mcpServers![0]).toMatchObject({ id: 'filesystem', name: 'Filesystem MCP' })
    expect(cfg.skills).toHaveLength(2)
    expect(cfg.skills![0]).toMatchObject({ id: 'code-formatter', enabled: true })
    expect(cfg.skills![1]).toMatchObject({ id: 'linter', enabled: false })
  })

  it('reads a minimal TOML with only version', () => {
    const dir = tmpDir()
    const configPath = writeToml(dir, 'hip.toml', 'version = 1\n')
    const cfg = readHipConfig(configPath)
    expect(cfg).toEqual({ version: 1 })
  })
})

// ── Wave 1: Config hot-reload ──

describe('config hot-reload', () => {
  it('picks up config changes on next read (re-read picks up modified file)', () => {
    const dir = tmpDir()
    const configPath = writeToml(dir, 'hip.toml', 'version = 1\n[[skills]]\nid = "skill-a"\nenabled = true\n')

    const cfg1 = readHipConfig(configPath)
    expect(cfg1.skills).toHaveLength(1)
    expect(cfg1.skills![0]).toMatchObject({ id: 'skill-a', enabled: true })

    writeFileSync(configPath, 'version = 1\n[[skills]]\nid = "skill-b"\nenabled = false\n')
    const cfg2 = readHipConfig(configPath)
    expect(cfg2.skills).toHaveLength(1)
    expect(cfg2.skills![0]).toMatchObject({ id: 'skill-b', enabled: false })
  })

  it('resolveEffectiveConfig re-reads on each call (fresh merge)', () => {
    const { root } = setupProjectDir()
    const projectTomlPath = join(root, '.hip', 'hip.toml')

    writeFileSync(projectTomlPath, `version = 1
[[skills]]
id = "v1-skill"
enabled = true
`)

    const cfg1 = resolveEffectiveConfig(root)
    expect(cfg1.skills).toHaveLength(1)
    expect(cfg1.skills![0]).toMatchObject({ id: 'v1-skill' })

    writeFileSync(projectTomlPath, `version = 1
[[skills]]
id = "v2-skill"
enabled = false
`)

    const cfg2 = resolveEffectiveConfig(root)
    expect(cfg2.skills).toHaveLength(1)
    expect(cfg2.skills![0]).toMatchObject({ id: 'v2-skill', enabled: false })
  })
})

// ── Combined config merging ──

describe('global + project config merge', () => {
  it('project providers REPLACE global providers', () => {
    const dir = tmpDir()
    const globalFile = writeToml(dir, 'global.toml', `version = 1
[[providers]]
id = "global-prov"
name = "Global Provider"
baseUrl = "https://global.api/v1"
`)
    process.env.HIP_CONFIG_PATH = globalFile

    const { root } = setupProjectDir()
    writeToml(join(root, '.hip'), 'hip.toml', `version = 1
[[providers]]
id = "project-prov"
name = "Project Provider"
baseUrl = "https://project.api/v1"
`)

    const cfg = resolveEffectiveConfig(root)
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.providers![0]).toMatchObject({ id: 'project-prov', name: 'Project Provider' })
  })

  it('project skills REPLACE global skills', () => {
    const dir = tmpDir()
    const globalFile = writeToml(dir, 'global.toml', `version = 1
[[skills]]
id = "global-skill"
enabled = true
`)
    process.env.HIP_CONFIG_PATH = globalFile

    const { root } = setupProjectDir()
    writeToml(join(root, '.hip'), 'hip.toml', `version = 1
[[skills]]
id = "project-skill"
enabled = true
`)

    const cfg = resolveEffectiveConfig(root)
    expect(cfg.skills).toHaveLength(1)
    expect(cfg.skills![0]).toMatchObject({ id: 'project-skill' })
  })
})
