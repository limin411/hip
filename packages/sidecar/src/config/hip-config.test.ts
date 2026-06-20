import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HipConfig } from '@hip/protocol'
import { readHipConfig, resolveEffectiveConfig } from './hip-config.js'

let dirs: string[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'hip-config-'))
  dirs.push(d)
  return d
}

function writeToml(dir: string, name: string, content: string): string {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

function writeJson(dir: string, name: string, obj: unknown): string {
  const p = join(dir, name)
  writeFileSync(p, JSON.stringify(obj))
  return p
}

function setupProjectDir(): { root: string; hipDir: string } {
  const root = tmpDir()
  const hipDir = join(root, '.hip')
  mkdirSync(hipDir)
  return { root, hipDir }
}

beforeEach(() => {
  dirs = []
  delete process.env.HIP_CONFIG_PATH
  delete process.env.HIP_MCP_SERVERS_PATH
  delete process.env.HIP_AGENTS_PATH
  delete process.env.HIP_PROVIDERS_PATH
  delete process.env.HIP_SKILLS_PATH
})

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ok */ }
  }
})

// ──────────────────────────────────────────────────────────────
// readHipConfig
// ──────────────────────────────────────────────────────────────

describe('readHipConfig', () => {
  it('returns default config when HIP_CONFIG_PATH is unset', () => {
    delete process.env.HIP_CONFIG_PATH
    expect(readHipConfig()).toEqual({ version: 1 })
  })

  it('returns default config when the file does not exist', () => {
    process.env.HIP_CONFIG_PATH = '/tmp/does-not-exist-hip-config.toml'
    expect(readHipConfig()).toEqual({ version: 1 })
  })

  it('returns default config when TOML is invalid', () => {
    const dir = tmpDir()
    const p = writeToml(dir, 'hip.toml', 'this is not valid toml {{{')
    process.env.HIP_CONFIG_PATH = p
    expect(readHipConfig()).toEqual({ version: 1 })
  })

  it('returns default config when version field is missing', () => {
    const dir = tmpDir()
    const p = writeToml(dir, 'hip.toml', '[providers]\n[[providers.list]]\nid = "openai"\n')
    process.env.HIP_CONFIG_PATH = p
    expect(readHipConfig()).toEqual({ version: 1 })
  })

  it('parses a valid TOML with all sections', () => {
    const dir = tmpDir()
    const p = writeToml(dir, 'hip.toml', `version = 1

[[providers]]
id = "deepseek"
name = "DeepSeek"
baseUrl = "https://api.deepseek.com/v1"

[[mcpServers]]
id = "mcp1"
name = "Filesystem"
transport = "stdio"
command = "npx"
args = ["-y", "@anthropic/mcp-filesystem"]
enabled = true

[[skills]]
id = "my-skill"
enabled = true

[permissions]
coarseMode = "edit"
`)
    process.env.HIP_CONFIG_PATH = p

    const cfg = readHipConfig()
    expect(cfg.version).toBe(1)
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.providers![0]).toMatchObject({ id: 'deepseek', name: 'DeepSeek' })
    expect(cfg.mcpServers).toHaveLength(1)
    expect(cfg.mcpServers![0]).toMatchObject({ id: 'mcp1', name: 'Filesystem' })
    expect(cfg.skills).toHaveLength(1)
    expect(cfg.skills![0]).toMatchObject({ id: 'my-skill', enabled: true })
    expect(cfg.permissions).toMatchObject({ coarseMode: 'edit' })
  })

  it('accepts an explicit configPath parameter', () => {
    const dir = tmpDir()
    const p = writeToml(dir, 'custom.toml', 'version = 1\n')
    // Don't set HIP_CONFIG_PATH — use the explicit path
    const cfg = readHipConfig(p)
    expect(cfg.version).toBe(1)
  })

  it('parses TOML with only mcpServers section', () => {
    const dir = tmpDir()
    const p = writeToml(dir, 'hip.toml', `version = 1

[[mcpServers]]
id = "srv"
name = "Test"
transport = "http"
url = "https://example.test/mcp"
enabled = true
`)
    process.env.HIP_CONFIG_PATH = p

    const cfg = readHipConfig()
    expect(cfg.version).toBe(1)
    expect(cfg.mcpServers).toHaveLength(1)
    expect(cfg.providers).toBeUndefined()
    expect(cfg.skills).toBeUndefined()
  })
})

// ──────────────────────────────────────────────────────────────
// snake_case → camelCase normalization
// ──────────────────────────────────────────────────────────────

describe('snake_case TOML normalization', () => {
  it('normalizes provider base_url and api_key to camelCase', () => {
    const dir = tmpDir()
    const p = writeToml(dir, 'hip.toml', `version = 1
[[providers]]
id = "deepseek"
name = "DeepSeek"
base_url = "https://api.deepseek.com/v1"
api_key = "sk-test"
`)
    process.env.HIP_CONFIG_PATH = p
    const cfg = readHipConfig()
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.providers![0]).toMatchObject({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
    })
  })

  it('normalizes mcpServer enabled_tools and disabled_tools to camelCase', () => {
    const dir = tmpDir()
    const p = writeToml(dir, 'hip.toml', `version = 1
[[mcpServers]]
id = "srv"
name = "Test MCP"
transport = "stdio"
command = "npx"
enabled_tools = ["read", "write"]
disabled_tools = ["delete"]
enabled = true
`)
    process.env.HIP_CONFIG_PATH = p
    const cfg = readHipConfig()
    expect(cfg.mcpServers).toHaveLength(1)
    expect(cfg.mcpServers![0]).toMatchObject({
      id: 'srv',
      enabledTools: ['read', 'write'],
      disabledTools: ['delete'],
    })
  })

  it('normalizes agent bound_model, allowed_skills, allowed_mcp_servers, allowed_tools', () => {
    const dir = tmpDir()
    const p = writeToml(dir, 'hip.toml', `version = 1
[[agents]]
id = "agent1"
name = "Test Agent"
kind = "internal"
command = ""
args = []
bound_model = "deepseek-reasoner"
allowed_skills = ["code-review"]
allowed_mcp_servers = ["filesystem"]
allowed_tools = ["read_file", "write_file"]
enabled = true
`)
    process.env.HIP_CONFIG_PATH = p
    const cfg = readHipConfig()
    expect(cfg.agents).toHaveLength(1)
    expect(cfg.agents![0]).toMatchObject({
      id: 'agent1',
      boundModel: 'deepseek-reasoner',
      allowedSkills: ['code-review'],
      allowedMcpServers: ['filesystem'],
      allowedTools: ['read_file', 'write_file'],
    })
  })

  it('normalizes permission coarse_mode, tool_permissions, and nested default_mode', () => {
    const dir = tmpDir()
    const p = writeToml(dir, 'hip.toml', `version = 1
[permissions]
coarse_mode = "edit"
[permissions.tool_permissions]
default_mode = "ask"
`)
    process.env.HIP_CONFIG_PATH = p
    const cfg = readHipConfig()
    expect(cfg.permissions).toMatchObject({
      coarseMode: 'edit',
      toolPermissions: {
        defaultMode: 'ask',
      },
    })
  })

  it('accepts snake_case top-level key mcp_servers as alias for mcpServers', () => {
    const dir = tmpDir()
    const p = writeToml(dir, 'hip.toml', `version = 1
[[mcp_servers]]
id = "srv"
name = "Snake MCP"
transport = "http"
url = "https://example.test/mcp"
enabled = true
`)
    process.env.HIP_CONFIG_PATH = p
    const cfg = readHipConfig()
    expect(cfg.mcpServers).toHaveLength(1)
    expect(cfg.mcpServers![0]).toMatchObject({ id: 'srv', name: 'Snake MCP' })
  })

  it('camelCase TOML still works unchanged (backward compatibility)', () => {
    const dir = tmpDir()
    const p = writeToml(dir, 'hip.toml', `version = 1
[[providers]]
id = "openai"
name = "OpenAI"
baseUrl = "https://api.openai.com/v1"
apiKey = "sk-original"

[[mcpServers]]
id = "cam1"
name = "Camel MCP"
transport = "stdio"
command = "cam-cmd"
enabledTools = ["tool-a"]
disabledTools = ["tool-b"]
enabled = true

[permissions]
coarseMode = "full"
toolPermissions = { defaultMode = "allow" }

[[agents]]
id = "ag-camel"
name = "Camel Agent"
kind = "internal"
command = ""
args = []
boundModel = "gpt-4"
allowedSkills = ["refactor"]
allowedMcpServers = ["cam1"]
enabled = true
`)
    process.env.HIP_CONFIG_PATH = p
    const cfg = readHipConfig()

    expect(cfg.providers![0]).toMatchObject({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-original',
    })
    expect(cfg.mcpServers![0]).toMatchObject({
      enabledTools: ['tool-a'],
      disabledTools: ['tool-b'],
    })
    expect(cfg.permissions).toMatchObject({
      coarseMode: 'full',
      toolPermissions: { defaultMode: 'allow' },
    })
    expect(cfg.agents![0]).toMatchObject({
      boundModel: 'gpt-4',
      allowedSkills: ['refactor'],
      allowedMcpServers: ['cam1'],
    })
  })

  it('when both camelCase and snake_case are present, camelCase wins', () => {
    const dir = tmpDir()
    const p = writeToml(dir, 'hip.toml', `version = 1
[[providers]]
id = "test"
name = "Test"
baseUrl = "https://camel.example.com"
base_url = "https://snake.example.com"
apiKey = "camel-key"
api_key = "snake-key"

[[mcpServers]]
id = "both"
name = "Both"
transport = "http"
url = "https://example.test/mcp"
enabledTools = ["camel-tool"]
enabled_tools = ["snake-tool"]
enabled = true
`)
    process.env.HIP_CONFIG_PATH = p
    const cfg = readHipConfig()

    expect(cfg.providers![0]).toMatchObject({
      baseUrl: 'https://camel.example.com',
      apiKey: 'camel-key',
    })
    expect(cfg.mcpServers![0]).toMatchObject({
      enabledTools: ['camel-tool'],
    })
  })

  it('snake_case and camelCase TOML produce identical HipConfig objects', () => {
    const dir = tmpDir()
    const snakeFile = writeToml(dir, 'snake.toml', `version = 1
[[providers]]
id = "p1"
name = "Provider"
base_url = "https://api.test.com"
api_key = "key-123"

[[mcpServers]]
id = "m1"
name = "MCP"
transport = "http"
url = "https://mcp.test.com"
enabled_tools = ["t1"]
disabled_tools = ["t2"]
enabled = true

[[agents]]
id = "a1"
name = "Agent"
kind = "internal"
command = ""
args = []
bound_model = "model-1"
allowed_skills = ["s1"]
allowed_mcp_servers = ["m1"]
enabled = true

[permissions]
coarse_mode = "edit"
tool_permissions = { default_mode = "ask" }
`)

    const camelFile = writeToml(dir, 'camel.toml', `version = 1
[[providers]]
id = "p1"
name = "Provider"
baseUrl = "https://api.test.com"
apiKey = "key-123"

[[mcpServers]]
id = "m1"
name = "MCP"
transport = "http"
url = "https://mcp.test.com"
enabledTools = ["t1"]
disabledTools = ["t2"]
enabled = true

[[agents]]
id = "a1"
name = "Agent"
kind = "internal"
command = ""
args = []
boundModel = "model-1"
allowedSkills = ["s1"]
allowedMcpServers = ["m1"]
enabled = true

[permissions]
coarseMode = "edit"
toolPermissions = { defaultMode = "ask" }
`)

    const snakeCfg = readHipConfig(snakeFile)
    const camelCfg = readHipConfig(camelFile)
    expect(snakeCfg).toEqual(camelCfg)
  })
})

// ──────────────────────────────────────────────────────────────
// resolveEffectiveConfig
// ──────────────────────────────────────────────────────────────

describe('resolveEffectiveConfig', () => {
  it('returns defaults when no config files exist anywhere', () => {
    delete process.env.HIP_CONFIG_PATH
    const dir = tmpDir()
    const cfg = resolveEffectiveConfig(dir)
    expect(cfg.version).toBe(1)
  })

  it('reads global config from HIP_CONFIG_PATH', () => {
    const dir = tmpDir()
    const globalFile = writeToml(dir, 'global.toml', `version = 1
[[providers]]
id = "openai"
name = "OpenAI"
baseUrl = "https://api.openai.com/v1"
`)
    process.env.HIP_CONFIG_PATH = globalFile

    const projDir = tmpDir()
    const cfg = resolveEffectiveConfig(projDir)
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.providers![0]).toMatchObject({ id: 'openai' })
  })

  it('merges project config over global config', () => {
    const dir = tmpDir()
    const globalFile = writeToml(dir, 'global.toml', `version = 1
[[providers]]
id = "openai"
name = "OpenAI"
baseUrl = "https://api.openai.com/v1"

[[mcpServers]]
id = "global-mcp"
name = "Global MCP"
transport = "stdio"
command = "global-cmd"
enabled = true
`)
    process.env.HIP_CONFIG_PATH = globalFile

    const { root } = setupProjectDir()
    const projectFile = writeToml(join(root, '.hip'), 'hip.toml', `version = 1
[[mcpServers]]
id = "project-mcp"
name = "Project MCP"
transport = "http"
url = "https://project.test/mcp"
enabled = true
`)

    const cfg = resolveEffectiveConfig(root)
    // Project mcpServers should REPLACE global (not merge by id)
    expect(cfg.mcpServers).toHaveLength(1)
    expect(cfg.mcpServers![0]).toMatchObject({ id: 'project-mcp', name: 'Project MCP' })
    // Global providers should survive (project didn't set providers)
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.providers![0]).toMatchObject({ id: 'openai' })
  })

  it('project permissions shallow-merge over global permissions', () => {
    const dir = tmpDir()
    const globalFile = writeToml(dir, 'global.toml', `version = 1
[permissions]
coarseMode = "chat"
`)
    process.env.HIP_CONFIG_PATH = globalFile

    const { root } = setupProjectDir()
    writeToml(join(root, '.hip'), 'hip.toml', `version = 1
[permissions]
coarseMode = "full"
`)

    const cfg = resolveEffectiveConfig(root)
    expect(cfg.permissions).toMatchObject({ coarseMode: 'full' })
  })

  it('falls back to legacy JSON readers when no TOML exists', () => {
    const dir = tmpDir()
    const mcpFile = writeJson(dir, 'hip-mcp-servers.json', {
      servers: [
        { id: 'legacy-mcp', name: 'Legacy', transport: 'stdio', command: 'cmd', enabled: true },
      ],
    })
    const agentsFile = writeJson(dir, 'hip-agents.json', {
      agents: [
        { id: 'legacy-agent', name: 'Legacy Agent', kind: 'custom', command: 'echo', args: [], enabled: true },
      ],
    })
    const providersFile = writeJson(dir, 'hip-providers.json', {
      providers: {
        deepseek: { enabled: true, baseURL: 'https://api.deepseek.com/v1' },
      },
    })
    const skillsFile = writeJson(dir, 'hip-skills.json', {
      enabled: { 'my-skill': true, 'other-skill': false },
    })

    process.env.HIP_MCP_SERVERS_PATH = mcpFile
    process.env.HIP_AGENTS_PATH = agentsFile
    process.env.HIP_PROVIDERS_PATH = providersFile
    process.env.HIP_SKILLS_PATH = skillsFile

    const projDir = tmpDir()
    const cfg = resolveEffectiveConfig(projDir)

    expect(cfg.version).toBe(1)
    expect(cfg.mcpServers).toHaveLength(1)
    expect(cfg.mcpServers![0]).toMatchObject({ id: 'legacy-mcp' })
    expect(cfg.agents).toHaveLength(1)
    expect(cfg.agents![0]).toMatchObject({ id: 'legacy-agent' })
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.providers![0]).toMatchObject({ id: 'deepseek' })
    expect(cfg.skills).toHaveLength(2)
    expect(cfg.skills!.find((s) => s.id === 'my-skill')).toMatchObject({ enabled: true })
    expect(cfg.skills!.find((s) => s.id === 'other-skill')).toMatchObject({ enabled: false })
  })

  it('global TOML wins over legacy JSON when HIP_CONFIG_PATH is set', () => {
    // Set up a legacy JSON MCP file
    const dir = tmpDir()
    const legacyMcp = writeJson(dir, 'hip-mcp-servers.json', {
      servers: [
        { id: 'legacy-mcp', name: 'Legacy', transport: 'stdio', command: 'cmd', enabled: true },
      ],
    })
    process.env.HIP_MCP_SERVERS_PATH = legacyMcp

    // Set up a global TOML file
    const tomlFile = writeToml(dir, 'hip.toml', `version = 1
[[mcpServers]]
id = "toml-mcp"
name = "TOML MCP"
transport = "http"
url = "https://toml.test/mcp"
enabled = true
`)
    process.env.HIP_CONFIG_PATH = tomlFile

    const projDir = tmpDir()
    const cfg = resolveEffectiveConfig(projDir)

    // TOML should win — no legacy fallback
    expect(cfg.mcpServers).toHaveLength(1)
    expect(cfg.mcpServers![0]).toMatchObject({ id: 'toml-mcp' })
  })

  it('empty legacy files produce empty arrays (no crash)', () => {
    // Corrupt legacy files
    const dir = tmpDir()
    const badMcp = writeToml(dir, 'hip-mcp-servers.json', '{ not json')
    const badAgents = writeToml(dir, 'hip-agents.json', '')
    const badProviders = writeToml(dir, 'hip-providers.json', 'null')
    const badSkills = writeToml(dir, 'hip-skills.json', '{}')

    process.env.HIP_MCP_SERVERS_PATH = badMcp
    process.env.HIP_AGENTS_PATH = badAgents
    process.env.HIP_PROVIDERS_PATH = badProviders
    process.env.HIP_SKILLS_PATH = badSkills

    const projDir = tmpDir()
    const cfg = resolveEffectiveConfig(projDir)

    expect(cfg.version).toBe(1)
    expect(cfg.mcpServers).toEqual([])
    expect(cfg.agents).toEqual([])
    expect(cfg.providers).toEqual([])
    expect(cfg.skills).toEqual([])
  })
})
