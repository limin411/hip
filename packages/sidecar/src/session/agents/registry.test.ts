import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentConfig } from '@hip/protocol'
import { readAgentsConfig, resolveAgentModel, selectImageAgent } from './registry.js'
import type { Catalog } from '../../config/catalog.js'

const visionCatalog: Catalog = {
  openai: { id: 'openai', name: 'OpenAI', env: [], models: { 'gpt-4o': { id: 'gpt-4o', attachment: true } } },
  deepseek: { id: 'deepseek', name: 'DeepSeek', env: [], models: { 'deepseek-chat': { id: 'deepseek-chat', attachment: false } } },
}

const tmps: string[] = []
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hip-agents-'))
  tmps.push(dir)
  return dir
}
function writeToml(dir: string, name: string, content: string): string {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}
function writeProjectToml(dir: string, content: string): string {
  const hipDir = join(dir, '.hip')
  mkdirSync(hipDir, { recursive: true })
  return writeToml(hipDir, 'hip.toml', content)
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.HIP_CONFIG_PATH
  delete process.env.HIP_MODEL_ACME_API_KEY
})

const baseAgent: AgentConfig = { id: 'a1', name: 'A', kind: 'acp', command: 'x', args: [], enabled: true }

describe('readAgentsConfig', () => {
  it('returns [] when no hip.toml exists', () => {
    const dir = tmpDir()
    expect(readAgentsConfig(dir)).toEqual([])
  })

  it('reads agents from global hip.toml (HIP_CONFIG_PATH)', () => {
    const dir = tmpDir()
    const toml = writeToml(dir, 'hip.toml', `version = 1\n[[agents]]\nid = "a1"\nname = "A"\nkind = "acp"\ncommand = "x"\nargs = []\nenabled = true\n`)
    process.env.HIP_CONFIG_PATH = toml
    expect(readAgentsConfig(tmpDir())).toEqual([baseAgent])
  })

  it('reads agents from project-level .hip/hip.toml', () => {
    const dir = tmpDir()
    const projectHipDir = join(dir, '.hip')
    mkdirSync(projectHipDir, { recursive: true })
    writeToml(projectHipDir, 'hip.toml', `version = 1\n[[agents]]\nid = "a2"\nname = "B"\nkind = "custom"\ncommand = "y"\nargs = []\nenabled = false\n`)
    expect(readAgentsConfig(dir)).toEqual([
      { id: 'a2', name: 'B', kind: 'custom', command: 'y', args: [], enabled: false },
    ])
  })
})

describe('resolveAgentModel', () => {
  it('returns null when the agent has no bound model', () => {
    expect(resolveAgentModel(baseAgent, tmpDir())).toBeNull()
  })
  it('resolves baseURL (global hip.toml) + apiKey (env) for the bound model', () => {
    const dir = tmpDir()
    const cfg = writeToml(dir, 'hip.toml', `version = 1
[[providers]]
id = "acme"
name = "Acme"
baseUrl = "https://acme.test/v1"
enabled = true
`)
    process.env.HIP_CONFIG_PATH = cfg
    process.env.HIP_MODEL_ACME_API_KEY = 'sk-acme'
    const agent: AgentConfig = { ...baseAgent, boundModel: { providerID: 'acme', modelID: 'acme-large' } }
    // cwd has no project .hip/hip.toml → effective config is the global file.
    expect(resolveAgentModel(agent, tmpDir())).toEqual({ providerID: 'acme', modelID: 'acme-large', baseURL: 'https://acme.test/v1', apiKey: 'sk-acme' })
  })
  it('prefers a project-level provider baseURL override (consistent with the agent list)', () => {
    // Only a project-level .hip/hip.toml exists (no global) — its provider override must win.
    const projectDir = tmpDir()
    const hipDir = join(projectDir, '.hip')
    mkdirSync(hipDir, { recursive: true })
    writeToml(hipDir, 'hip.toml', `version = 1
[[providers]]
id = "acme"
name = "Acme"
baseUrl = "https://acme.project/v1"
enabled = true
`)
    const agent: AgentConfig = { ...baseAgent, boundModel: { providerID: 'acme', modelID: 'acme-large' } }
    expect(resolveAgentModel(agent, projectDir)!.baseURL).toBe('https://acme.project/v1')
  })
})

describe('selectImageAgent', () => {
  it('returns null when no internal multimodal agent exists', () => {
    const dir = tmpDir()
    writeProjectToml(dir, `version = 1\n[[agents]]\nid = "a1"\nname = "A"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\n`)
    expect(selectImageAgent(dir, 'describe image', visionCatalog)).toBeNull()
  })

  it('returns the internal multimodal agent when only one exists', () => {
    const dir = tmpDir()
    writeProjectToml(dir, `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "vision expert"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`)
    const agent = selectImageAgent(dir, 'describe image', visionCatalog)
    expect(agent).not.toBeNull()
    expect(agent!.id).toBe('vis')
  })

  it('picks the agent whose prompt matches a user keyword', () => {
    const dir = tmpDir()
    writeProjectToml(dir, `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "analyze screenshots"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n\n[[agents]]\nid = "doc"\nname = "Doc"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "read documents"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`)
    const agent = selectImageAgent(dir, 'check this screenshot', visionCatalog)
    expect(agent!.id).toBe('vis')
  })

  it('falls back to the first internal multimodal agent when no keyword matches', () => {
    const dir = tmpDir()
    writeProjectToml(dir, `version = 1\n[[agents]]\nid = "doc"\nname = "Doc"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "read documents"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "analyze screenshots"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`)
    const agent = selectImageAgent(dir, 'hello world', visionCatalog)
    expect(agent!.id).toBe('doc')
  })

  it('ignores disabled, builtin, or non-internal agents', () => {
    const dir = tmpDir()
    writeProjectToml(dir, `version = 1\n[[agents]]\nid = "builtin"\nname = "Builtin"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "vision"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n\n[[agents]]\nid = "disabled"\nname = "Disabled"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = false\nprompt = "vision"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n\n[[agents]]\nid = "acp"\nname = "ACP"\nkind = "acp"\ncommand = "x"\nargs = []\nenabled = true\n`)
    expect(selectImageAgent(dir, 'describe image', visionCatalog)).toBeNull()
  })
})
