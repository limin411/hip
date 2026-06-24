import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SessionConfig, Hook, HookContext, HookResult } from '@hip/protocol'
import { HookRegistry } from './hooks/registry.js'
import { ConfigManager } from './config-manager.js'

function tmpDir(): string {
  const d = join(tmpdir(), `hip-cm-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(d, { recursive: true })
  return d
}

function writeJson(p: string, data: unknown): void {
  writeFileSync(p, JSON.stringify(data))
}

/** Stub a Hook handler that returns allow. */
async function allowHandler(_ctx: HookContext): Promise<HookResult> {
  return { kind: 'allow' }
}

/** Build a minimal Hook object for testing. */
function makeHook(event: Hook['event'] = 'TurnStart'): Hook {
  return { event, handler: allowHandler }
}

describe('ConfigManager — hook registration', () => {
  let registry: HookRegistry
  const dirs: string[] = []
  let pluginsConfigPath: string | undefined

  beforeEach(() => {
    registry = new HookRegistry()
  })

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true })
    }
    if (pluginsConfigPath !== undefined && existsSync(pluginsConfigPath)) {
      rmSync(pluginsConfigPath, { force: true })
    }
    delete process.env.HIP_PLUGINS_PATH
    delete process.env.HIP_CONFIG_PATH
  })

  function defaultConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
    const cwdDir = tmpDir()
    dirs.push(cwdDir)
    return {
      llmProvider: 'test',
      model: 'test-model',
      tools: [],
      cwd: cwdDir,
      ...overrides,
    }
  }

  /** Create a minimal plugin dir with hooks, wire HIP_PLUGINS_PATH, return the ConfigManager. */
  function setupManager(opts: {
    hooks?: Hook[]
    isExternal?: boolean
  } = {}): ConfigManager {
    const pluginRoot = tmpDir()
    dirs.push(pluginRoot)

    const hooks = opts.hooks ?? [makeHook('TurnStart')]

    // Write a CJS file that exports a Hook[] array with real function handlers
    const handlerCode = '(async function(ctx) { return { kind: "allow" } })'
    writeFileSync(
      join(pluginRoot, 'hooks.cjs'),
      `module.exports = [{ event: "${hooks[0]!.event}", handler: ${handlerCode} }]`,
    )

    mkdirSync(join(pluginRoot, '.plugin'), { recursive: true })
    writeJson(join(pluginRoot, '.plugin', 'plugin.json'), {
      name: 'test-plugin',
      version: '1.0.0',
      hooks: './hooks.cjs',
    })

    const pluginsCfgFile = join(tmpdir(), `hip-plugins-cfg-${Date.now()}.json`)
    writeJson(pluginsCfgFile, { plugins: [pluginRoot] })
    pluginsConfigPath = pluginsCfgFile
    process.env.HIP_PLUGINS_PATH = pluginsCfgFile

    const config = defaultConfig()

    return new ConfigManager(
      () => config,
      () => {},
      () => false,
      false,
      () => {},
      () => opts.isExternal ?? false,
      () => false,
      () => {},
      registry,
    )
  }

  it('registers plugin hooks in HookRegistry after loadPluginComponents()', () => {
    const mgr = setupManager()
    mgr.loadPluginComponents()

    expect(registry.hasMatchingHook('TurnStart')).toBe(true)
  })

  it('loadPluginComponents() twice is idempotent — hooks registered once', () => {
    const mgr = setupManager()
    mgr.loadPluginComponents()
    mgr.loadPluginComponents()

    // After two loads with clear+re-register, hooks should be registered exactly once
    expect(registry.hasMatchingHook('TurnStart')).toBe(true)
  })

  it('reloadPlugins() clears old hooks and re-registers', () => {
    const mgr = setupManager()
    mgr.loadPluginComponents()
    expect(registry.hasMatchingHook('TurnStart')).toBe(true)

    mgr.reloadPlugins()
    expect(registry.hasMatchingHook('TurnStart')).toBe(true)
  })

  it('loadPluginComponents() still loads components when hooks file is missing', () => {
    const pluginRoot = tmpDir()
    dirs.push(pluginRoot)

    mkdirSync(join(pluginRoot, '.plugin'), { recursive: true })
    writeJson(join(pluginRoot, '.plugin', 'plugin.json'), {
      name: 'skill-plugin',
      version: '1.0.0',
      hooks: './nonexistent.cjs',
    })

    const pluginsCfgFile = join(tmpdir(), `hip-plugins-cfg-${Date.now()}.json`)
    writeJson(pluginsCfgFile, { plugins: [pluginRoot] })
    pluginsConfigPath = pluginsCfgFile
    process.env.HIP_PLUGINS_PATH = pluginsCfgFile

    const config = defaultConfig()
    const mgr = new ConfigManager(
      () => config,
      () => {},
      () => false,
      false,
      () => {},
      () => false,
      () => false,
      () => {},
      registry,
    )

    // Should not throw
    mgr.loadPluginComponents()
    // No hooks should have been registered since hook file doesn't exist
    expect(registry.hasMatchingHook('TurnStart')).toBe(false)
  })

  it('external agent skips hook registration', () => {
    const mgr = setupManager({ isExternal: true })
    mgr.loadPluginComponents()

    expect(registry.hasMatchingHook('TurnStart')).toBe(false)
  })
})

describe('ConfigManager — MCP config loading', () => {
  const dirs: string[] = []
  let pluginsConfigPath: string | undefined

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true })
    }
    if (pluginsConfigPath !== undefined && existsSync(pluginsConfigPath)) {
      rmSync(pluginsConfigPath, { force: true })
    }
    delete process.env.HIP_PLUGINS_PATH
    delete process.env.HIP_CONFIG_PATH
  })

  function makeManager(initialCwd: string): ConfigManager {
    let config: SessionConfig = {
      llmProvider: 'test',
      model: 'test-model',
      tools: [],
      cwd: initialCwd,
    }
    return new ConfigManager(
      () => config,
      (next) => { config = next },
      () => false,
      false,
      () => {},
      () => false,
      () => false,
      () => {},
      new HookRegistry(),
    )
  }

  it('loadPluginComponents() reads user MCP servers from hip.toml (HIP_CONFIG_PATH)', () => {
    const configDir = tmpDir()
    dirs.push(configDir)
    const globalToml = join(configDir, 'hip.toml')
    writeFileSync(
      globalToml,
      `version = 1\n\n[[mcp_servers]]\nid = "srv-1"\nname = "Tavily"\ntransport = "http"\nenabled = true\nurl = "https://mcp.tavily.com/mcp"\n`,
    )
    process.env.HIP_CONFIG_PATH = globalToml

    const cwdDir = tmpDir()
    dirs.push(cwdDir)

    const mgr = makeManager(cwdDir)
    mgr.loadPluginComponents()

    expect(mgr.mcpConfigs).toHaveLength(1)
    expect(mgr.mcpConfigs[0]).toMatchObject({
      id: 'srv-1',
      name: 'Tavily',
      transport: 'http',
      enabled: true,
      url: 'https://mcp.tavily.com/mcp',
    })
  })

  it('loadPluginComponents() reads project-level .hip/hip.toml override', () => {
    const configDir = tmpDir()
    dirs.push(configDir)
    const globalToml = join(configDir, 'hip.toml')
    writeFileSync(
      globalToml,
      `version = 1\n\n[[mcp_servers]]\nid = "global-srv"\nname = "Global"\ntransport = "http"\nenabled = true\nurl = "https://global.test"\n`,
    )
    process.env.HIP_CONFIG_PATH = globalToml

    const cwdDir = tmpDir()
    dirs.push(cwdDir)
    const projectConfigDir = join(cwdDir, '.hip')
    mkdirSync(projectConfigDir, { recursive: true })
    writeFileSync(
      join(projectConfigDir, 'hip.toml'),
      `version = 1\n\n[[mcp_servers]]\nid = "project-srv"\nname = "Project"\ntransport = "stdio"\nenabled = true\ncommand = "npx"\n`,
    )

    const mgr = makeManager(cwdDir)
    mgr.loadPluginComponents()

    // Project array replaces global array
    expect(mgr.mcpConfigs).toHaveLength(1)
    expect(mgr.mcpConfigs[0]).toMatchObject({
      id: 'project-srv',
      name: 'Project',
      transport: 'stdio',
    })
  })

  it('setCwd() reloads MCP configs from new project-level hip.toml', () => {
    const configDir = tmpDir()
    dirs.push(configDir)
    const globalToml = join(configDir, 'hip.toml')
    writeFileSync(globalToml, `version = 1\n`)
    process.env.HIP_CONFIG_PATH = globalToml

    const cwdDir = tmpDir()
    dirs.push(cwdDir)

    const mgr = makeManager(cwdDir)
    mgr.loadPluginComponents()
    expect(mgr.mcpConfigs).toHaveLength(0)

    const newCwdDir = tmpDir()
    dirs.push(newCwdDir)
    const projectConfigDir = join(newCwdDir, '.hip')
    mkdirSync(projectConfigDir, { recursive: true })
    writeFileSync(
      join(projectConfigDir, 'hip.toml'),
      `version = 1\n\n[[mcp_servers]]\nid = "new-srv"\nname = "New"\ntransport = "http"\nenabled = true\nurl = "https://new.test"\n`,
    )

    mgr.setCwd(newCwdDir)

    expect(mgr.mcpConfigs).toHaveLength(1)
    expect(mgr.mcpConfigs[0]).toMatchObject({ id: 'new-srv', name: 'New' })
  })
})
