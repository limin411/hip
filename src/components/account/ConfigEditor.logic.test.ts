import { describe, it, expect } from 'vitest'
import { configToToml, parseConfigToml } from './ConfigEditor.js'
import type { HipConfig } from '@hip/protocol'

const SAMPLE_CONFIG: HipConfig = {
  version: 1,
  providers: [
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test' },
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  ],
  mcpServers: [
    {
      id: 'abc123',
      name: 'My MCP',
      transport: 'stdio',
      command: '/usr/local/bin/my-mcp',
      args: ['--port', '1234'],
      env: { KEY: 'val' },
      enabled: true,
    },
  ],
  skills: [
    { id: 'skill-1', enabled: true },
    { id: 'skill-2', enabled: false },
  ],
  agents: [
    {
      id: 'agent-1',
      name: 'Test Agent',
      kind: 'internal',
      command: '',
      args: [],
      enabled: true,
      description: 'A test agent',
      prompt: 'You are a helpful agent',
      allowedSkills: ['skill-1'],
      allowedMcpServers: ['abc123'],
    },
  ],
}

describe('configToToml', () => {
  it('includes version at the top', () => {
    const toml = configToToml(SAMPLE_CONFIG)
    expect(toml).toContain('version = 1')
  })

  it('produces valid TOML that round-trips through parseConfigToml', () => {
    const toml = configToToml(SAMPLE_CONFIG)
    const result = parseConfigToml(toml)
    expect('config' in result).toBe(true)
    if (!('config' in result)) return
    expect(result.config.version).toBe(1)
    expect(result.config.providers?.length).toBe(2)
    expect(result.config.providers![0].id).toBe('deepseek')
    expect(result.config.providers![0].name).toBe('DeepSeek')
    expect(result.config.providers![0].apiKey).toBe('sk-test')
    expect(result.config.mcpServers?.length).toBe(1)
    expect(result.config.mcpServers![0].name).toBe('My MCP')
    expect(result.config.skills?.length).toBe(2)
    expect(result.config.agents?.length).toBe(1)
    expect(result.config.agents![0].allowedSkills).toEqual(['skill-1'])
    expect(result.config.agents![0].allowedMcpServers).toEqual(['abc123'])
  })

  it('handles empty config gracefully', () => {
    const toml = configToToml({ version: 1 })
    expect(toml).toContain('version = 1')
    expect(toml.trim()).toBe('# hip config — edit and click "Parse & Validate" to save\nversion = 1')
  })

  it('produces mcp_servers section with correct fields', () => {
    const toml = configToToml(SAMPLE_CONFIG)
    expect(toml).toContain('[[mcp_servers]]')
    expect(toml).toContain('transport = "stdio"')
    expect(toml).toContain('enabled = true')
    expect(toml).toContain('args = ["--port", "1234"]')
    expect(toml).toContain('env = { "KEY" = "val" }')
  })

  it('produces providers section with api_key when present', () => {
    const toml = configToToml(SAMPLE_CONFIG)
    expect(toml).toContain('[[providers]]')
    expect(toml).toContain('api_key = "sk-test"')
  })

  it('produces agents section with all fields', () => {
    const toml = configToToml(SAMPLE_CONFIG)
    expect(toml).toContain('[[agents]]')
    expect(toml).toContain('kind = "internal"')
    expect(toml).toContain('allowed_skills = ["skill-1"]')
    expect(toml).toContain('allowed_mcp_servers = ["abc123"]')
  })

})

describe('parseConfigToml', () => {
  it('parses valid TOML to HipConfig', () => {
    const result = parseConfigToml(`
version = 1

[[providers]]
id = "deepseek"
name = "DeepSeek"
base_url = "https://api.deepseek.com/v1"

[[skills]]
id = "my-skill"
enabled = true
`)
    expect('config' in result).toBe(true)
    if (!('config' in result)) return
    expect(result.config.version).toBe(1)
    expect(result.config.providers![0].id).toBe('deepseek')
    expect(result.config.providers![0].baseUrl).toBe('https://api.deepseek.com/v1')
    expect(result.config.skills![0].id).toBe('my-skill')
    expect(result.config.skills![0].enabled).toBe(true)
  })

  it('parses JSON input', () => {
    const result = parseConfigToml(JSON.stringify({ version: 1, skills: [{ id: 's1', enabled: true }] }))
    expect('config' in result).toBe(true)
    if (!('config' in result)) return
    expect(result.config.version).toBe(1)
    expect(result.config.skills![0].id).toBe('s1')
  })

  it('returns errors for empty input', () => {
    const result = parseConfigToml('')
    expect('errors' in result).toBe(true)
    if ('errors' in result) {
      expect(result.errors).toContain('Config is empty')
    }
  })

  it('returns errors for invalid JSON', () => {
    const result = parseConfigToml('{invalid json}')
    expect('errors' in result).toBe(true)
  })

  it('returns errors for invalid TOML shape', () => {
    const result = parseConfigToml(`
version = "not_a_number"

[[providers]]
id = 123
name = true
`)
    expect('errors' in result).toBe(true)
    if ('errors' in result) {
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })

  it('returns errors when version is not a number', () => {
    const result = parseConfigToml(`
version = "one"

[[skills]]
id = "s"
enabled = true
`)
    expect('errors' in result).toBe(true)
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('version'))).toBe(true)
    }
  })

  it('returns errors for malformed TOML with unresolvable keys', () => {
    const result = parseConfigToml('not valid toml content here')
    expect('errors' in result).toBe(true)
  })

  it('parses TOML with comments and blank lines', () => {
    const result = parseConfigToml(`
# This is a comment
version = 2

# provider section
[[providers]]
id = "test"
name = "Test"
base_url = "https://test.com"

`)
    expect('config' in result).toBe(true)
    if (!('config' in result)) return
    expect(result.config.version).toBe(2)
    expect(result.config.providers![0].id).toBe('test')
  })

  it('normalizes snake_case to camelCase keys', () => {
    const result = parseConfigToml(`
version = 1

[[mcp_servers]]
id = "m1"
name = "My MCP"
transport = "stdio"
enabled = true
enabled_tools = ["tool-a"]
disabled_tools = ["tool-b"]

[[agents]]
id = "a1"
name = "Agent"
kind = "internal"
command = ""
args = []
enabled = true
allowed_skills = ["s1"]
allowed_mcp_servers = ["m1"]
bound_model = "{\\"provider\\":\\"openai\\"}"
`)
    expect('config' in result).toBe(true)
    if (!('config' in result)) return
    expect(result.config.mcpServers![0].enabledTools).toEqual(['tool-a'])
    expect(result.config.mcpServers![0].disabledTools).toEqual(['tool-b'])
    expect(result.config.agents![0].allowedSkills).toEqual(['s1'])
    expect(result.config.agents![0].allowedMcpServers).toEqual(['m1'])
  })

  it('round-trips empty config (version only)', () => {
    const empty: HipConfig = { version: 1 }
    const toml = configToToml(empty)
    const result = parseConfigToml(toml)
    expect('config' in result).toBe(true)
    if (!('config' in result)) return
    expect(result.config.version).toBe(1)
    // No extra sections
    expect(result.config.providers).toBeUndefined()
    expect(result.config.mcpServers).toBeUndefined()
    expect(result.config.skills).toBeUndefined()
    expect(result.config.agents).toBeUndefined()
  })

  it('round-trips config with all sections populated', () => {
    const toml = configToToml(SAMPLE_CONFIG)
    const result = parseConfigToml(toml)
    expect('config' in result).toBe(true)
    if (!('config' in result)) return

    const parsed = result.config
    expect(parsed.version).toBe(1)
    expect(parsed.providers).toEqual(SAMPLE_CONFIG.providers)
    expect(parsed.skills).toEqual(SAMPLE_CONFIG.skills)
    // mcpServers round-trip
    expect(parsed.mcpServers?.length).toBe(1)
    expect(parsed.mcpServers![0].id).toBe('abc123')
    expect(parsed.mcpServers![0].name).toBe('My MCP')
    expect(parsed.mcpServers![0].transport).toBe('stdio')
    expect(parsed.mcpServers![0].command).toBe('/usr/local/bin/my-mcp')
    expect(parsed.mcpServers![0].args).toEqual(['--port', '1234'])
    expect(parsed.mcpServers![0].env).toEqual({ KEY: 'val' })
    expect(parsed.mcpServers![0].enabled).toBe(true)
    // agents round-trip
    expect(parsed.agents![0].allowedSkills).toEqual(['skill-1'])
    expect(parsed.agents![0].allowedMcpServers).toEqual(['abc123'])
  })

  it('returns errors for providers with missing required fields', () => {
    const result = parseConfigToml(`
version = 1

[[providers]]
name = "No ID"
`)
    expect('errors' in result).toBe(true)
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('id'))).toBe(true)
    }
  })

  it('returns errors for mcpServers with missing required fields', () => {
    const result = parseConfigToml(`
version = 1

[[mcp_servers]]
id = "no-transport"
`)
    expect('errors' in result).toBe(true)
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('transport'))).toBe(true)
    }
  })

  it('accepts null for optional arrays', () => {
    const result = parseConfigToml(JSON.stringify({
      version: 1,
      providers: null,
      mcpServers: null,
      skills: null,
      agents: null,
    }))
    expect('config' in result).toBe(true)
    if (!('config' in result)) return
    expect(result.config.version).toBe(1)
  })

  it('returns errors when top-level is not an object', () => {
    const result = parseConfigToml(JSON.stringify('not an object'))
    expect('errors' in result).toBe(true)
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('object'))).toBe(true)
    }
  })
})
