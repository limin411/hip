import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage, McpServerConfig, PermissionMode } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from '../model-runner.js'

// ── Mock mcpManager singleton ──────────────────────────────────────────
// The module-level mcpManager in mcp/manager.ts is imported directly by Session.
// Replace it with a fake that records reconciled configs and returns canned tools,
// so no real process/network is spawned.

const reconciledConfigs: McpServerConfig[] = []
const fakeMcpTools: Array<{ name: string; description: string }> = []

vi.mock('../mcp/manager.js', () => ({
  mcpManager: {
    async reconcile(servers: McpServerConfig[]) {
      reconciledConfigs.length = 0
      reconciledConfigs.push(...servers)
    },
    tools() {
      return fakeMcpTools as any
    },
    connectionStatuses() {
      return []
    },
    toolCatalog() {
      return ''
    },
    registerWithRegistry(registry: any, scope: any) {
      for (const t of fakeMcpTools) {
        registry.register(t, scope)
      }
    },
    deregisterScope() {},
  },
}))

import { Session } from '../session.js'

// ── Test harness ───────────────────────────────────────────────────────

let root: string
let pluginDir: string
let pluginsJsonPath: string
let configPath: string
const prevEnv: Record<string, string | undefined> = {}

function setEnv(k: string, v: string) {
  prevEnv[k] = process.env[k]
  process.env[k] = v
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hip-psynth-'))
  // ── Plugin directory ─────────────────────────────────────────────
  pluginDir = join(root, 'test-plugin')
  const dotPlugin = join(pluginDir, '.plugin')
  mkdirSync(dotPlugin, { recursive: true })

  // ── Plugin manifest ──────────────────────────────────────────────
  const manifestPath = join(dotPlugin, 'plugin.json')
  writeFileSync(
    manifestPath,
    JSON.stringify({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      skills: 'skills/my-formatter',
      mcpServers: [
        {
          id: 'test_mcp',
          name: 'Test MCP Server',
          transport: 'stdio' as const,
          command: 'node',
          args: ['fake.js'],
          enabled: true,
        },
      ],
    }),
    'utf8',
  )

  // ── Skill inside plugin ──────────────────────────────────────────
  const skillDir = join(pluginDir, 'skills', 'my-formatter')
  mkdirSync(skillDir, { recursive: true })
  mkdirSync(join(skillDir, 'scripts'), { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: my-formatter\ndescription: Format code with style\n---\n# My Formatter\n\nUse `scripts/run.sh` to format.',
    'utf8',
  )
  writeFileSync(join(skillDir, 'scripts', 'run.sh'), 'echo formatted', 'utf8')

  // ── External config files (empty — plugin source is the only supply) ──
  pluginsJsonPath = join(root, 'plugins.json')
  configPath = join(root, 'hip.toml')

  // Start with the plugin enabled
  writeFileSync(pluginsJsonPath, JSON.stringify({ plugins: [pluginDir] }), 'utf8')
  // Empty unified config (no skills section → plugin skills enabled by default)
  writeFileSync(configPath, 'version = 1\n', 'utf8')

  setEnv('HIP_PLUGINS_PATH', pluginsJsonPath)
  setEnv('HIP_CONFIG_PATH', configPath)
  setEnv('HIP_SKILLS_DIR', join(root, 'no-real-skills'))

  // Reset mock state
  reconciledConfigs.length = 0
  fakeMcpTools.length = 0
})

afterEach(() => {
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(root, { recursive: true, force: true })
})

// ── Fake model runner ──────────────────────────────────────────────────
// On its first call it checks tool names; on the second it returns text (turn over).

class SkillCheckRunner implements ModelRunner {
  calls = 0
  systemSeen = ''
  toolNamesSeen: string[] = []
  async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.calls++
    this.systemSeen = String(_messages[0]?.content ?? '')
    this.toolNamesSeen = opts.tools.map((t) => t.name)
    opts.onText('ok')
    return new AIMessage('ok')
  }
}

class OneShotRunner implements ModelRunner {
  systemSeen = ''
  toolNamesSeen: string[] = []
  async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.systemSeen = String(_messages[0]?.content ?? '')
    this.toolNamesSeen = opts.tools.map((t) => t.name)
    opts.onText('done')
    return new AIMessage('done')
  }
}

function makeConfig(cwd: string, permissionMode?: PermissionMode) {
  return { llmProvider: 'deepseek', model: '', tools: [], cwd, permissionMode } as any
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe('plugin synthesis integration', () => {
  it('enable plugin with skills → skills appear in turn (system prompt + use_skill tool)', async () => {
    const runner = new SkillCheckRunner()
    const session = new Session(
      'ps-skills',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    const sent: ServerMessage[] = []
    await session.sendMessage('format my code', (m) => sent.push(m))

    // System prompt advertises the skill
    expect(runner.systemSeen).toMatch(/Skills/)
    expect(runner.systemSeen).toContain('my-formatter')

    // use_skill tool is in the toolset
    expect(runner.toolNamesSeen).toContain('use_skill')

    // Turn completed cleanly
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)
  }, 30_000)

  it('enable plugin with MCP → MCP configs reconciled and MCP tools in turn', async () => {
    // Pre-load fake MCP tools that the mocked mcpManager.tools() will return
    fakeMcpTools.push(
      { name: 'mcp__test_mcp__hello', description: 'Say hello' },
      { name: 'mcp__test_mcp__search', description: 'Search docs' },
    )

    const runner = new OneShotRunner()
    const session = new Session(
      'ps-mcp',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    const sent: ServerMessage[] = []
    await session.sendMessage('use MCP', (m) => sent.push(m))

    // The plugin's MCP config was reconciled
    expect(reconciledConfigs.some((c) => c.id === 'test_mcp')).toBe(true)
    expect(reconciledConfigs.some((c) => c.name === 'Test MCP Server')).toBe(true)

    // MCP tools were offered to the model
    expect(runner.toolNamesSeen).toContain('mcp__test_mcp__hello')
    expect(runner.toolNamesSeen).toContain('mcp__test_mcp__search')

    // Turn completed cleanly
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)
  }, 30_000)

  it('disable plugin → skills and MCP tools are excluded', async () => {
    // ── Turn 1: plugin enabled → skills + MCP present ──────────────────
    fakeMcpTools.push({ name: 'mcp__test_mcp__hello', description: 'Say hello' })

    const runner = new SkillCheckRunner()
    const session = new Session(
      'ps-toggle',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    let sent: ServerMessage[] = []
    await session.sendMessage('first turn', (m) => sent.push(m))

    expect(runner.systemSeen).toContain('my-formatter')
    expect(runner.toolNamesSeen).toContain('use_skill')
    expect(runner.toolNamesSeen).toContain('mcp__test_mcp__hello')
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)

    // ── Disable plugin: overwrite plugins.json to empty list ───────────
    // The plugin is excluded from the next turn (new config read every turn).
    writeFileSync(pluginsJsonPath, JSON.stringify({ plugins: [] }), 'utf8')

    // Clear mock state so we can assert fresh
    reconciledConfigs.length = 0
    fakeMcpTools.length = 0

    const runner2 = new OneShotRunner()
    const session2 = new Session(
      'ps-toggle-2',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      runner2,
    )

    sent = []
    await session2.sendMessage('second turn', (m) => sent.push(m))

    // System prompt must NOT contain the plugin's skill
    expect(runner2.systemSeen).not.toContain('my-formatter')

    // use_skill may still appear when product/global skills exist; the plugin skill itself is gone.
    // (Do not require empty skill inventory — only plugin exclusion.)

    // No MCP configs were reconciled (only empty base config)
    expect(reconciledConfigs.every((c) => c.id !== 'test_mcp')).toBe(true)

    // MCP tools must NOT be offered
    expect(runner2.toolNamesSeen).not.toContain('mcp__test_mcp__hello')

    // Turn completed cleanly
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)
  }, 30_000)

  // ═════════════════════════════════════════════════════════════════════
  // Plugin hook lifecycle tests
  // ═════════════════════════════════════════════════════════════════════

  function writeHooksModule(hooksDir: string, content: string): string {
    const p = join(hooksDir, 'hooks.cjs')
    writeFileSync(p, content, 'utf8')
    return p
  }

  function readHookModuleState(hooksPath: string): { getTurnStartCalls(): number } {
    const req = createRequire(import.meta.url)
    // Re-require returns the cached module — the sidecar's synthesizeHooks
    // loaded it into the shared Node.js Module._cache, so we see live state.
    return req(hooksPath) as { getTurnStartCalls(): number }
  }

  function overwriteManifestWithHooks(hooksValue: string) {
    const manifestPath = join(pluginDir, '.plugin', 'plugin.json')
    writeFileSync(
      manifestPath,
      JSON.stringify({
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        skills: 'skills/my-formatter',
        mcpServers: [
          {
            id: 'test_mcp',
            name: 'Test MCP Server',
            transport: 'stdio' as const,
            command: 'node',
            args: ['fake.js'],
            enabled: true,
          },
        ],
        hooks: hooksValue,
      }),
      'utf8',
    )
  }

  it('valid TurnStart hook from plugin CJS module fires during turn', async () => {
    const hooksPath = writeHooksModule(
      pluginDir,
      [
        'let turnStartCalls = 0;',
        'module.exports = [',
        '  {',
        '    event: "TurnStart",',
        '    handler: async function(ctx) {',
        '      turnStartCalls++;',
        '      return { kind: "allow" };',
        '    },',
        '  },',
        '];',
        'module.exports.getTurnStartCalls = function() { return turnStartCalls; };',
      ].join('\n'),
    )

    overwriteManifestWithHooks('./hooks.cjs')

    const runner = new SkillCheckRunner()
    const session = new Session(
      'ps-hook-valid',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    const sent: ServerMessage[] = []
    await session.sendMessage('test hook fire', (m) => sent.push(m))

    // Turn completed cleanly (hook returned 'allow')
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)

    // Skills still loaded from the plugin
    expect(runner.systemSeen).toContain('my-formatter')

    // Hook was called exactly once
    const state = readHookModuleState(hooksPath)
    expect(state.getTurnStartCalls()).toBe(1)
  }, 30_000)

  it('non-function handler in hook entry → skipped gracefully, skills still load', async () => {
    writeHooksModule(
      pluginDir,
      [
        'module.exports = [',
        '  {',
        '    event: "TurnStart",',
        '    handler: "not-a-function",',
        '  },',
        '];',
      ].join('\n'),
    )

    overwriteManifestWithHooks('./hooks.cjs')

    const runner = new SkillCheckRunner()
    const session = new Session(
      'ps-hook-nonfn',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    const sent: ServerMessage[] = []
    await session.sendMessage('test nonfn handler', (m) => sent.push(m))

    // Turn completed cleanly — no crash from invalid handler
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)

    // Skills still loaded despite invalid hook handler
    expect(runner.systemSeen).toContain('my-formatter')
  }, 30_000)

  it('bad/missing hook file → no crash, plugin skills and MCP still load', async () => {
    // Hook file referenced in manifest does not exist on disk
    overwriteManifestWithHooks('./nonexistent-hooks.cjs')

    fakeMcpTools.push({ name: 'mcp__test_mcp__hello', description: 'Say hello' })

    const runner = new SkillCheckRunner()
    const session = new Session(
      'ps-hook-missing',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    const sent: ServerMessage[] = []
    await session.sendMessage('test missing hook file', (m) => sent.push(m))

    // Turn completed cleanly
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)

    // Skills still loaded
    expect(runner.systemSeen).toContain('my-formatter')

    // MCP tools still loaded
    expect(runner.toolNamesSeen).toContain('mcp__test_mcp__hello')
  }, 30_000)

  it('reloadPlugins() clears old hook registrations and re-registers exactly once', async () => {
    const hooksPath = writeHooksModule(
      pluginDir,
      [
        'let turnStartCalls = 0;',
        'module.exports = [',
        '  {',
        '    event: "TurnStart",',
        '    handler: async function(ctx) {',
        '      turnStartCalls++;',
        '      return { kind: "allow" };',
        '    },',
        '  },',
        '];',
        'module.exports.getTurnStartCalls = function() { return turnStartCalls; };',
      ].join('\n'),
    )

    overwriteManifestWithHooks('./hooks.cjs')

    // A runner that always returns a simple text response.
    const makeSimpleRunner = (): ModelRunner => ({
      async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        opts.onText('done')
        return new AIMessage('done')
      },
    })

    const session = new Session(
      'ps-hook-reload',
      makeConfig(root),
      undefined,
      undefined,
      undefined,
      undefined,
      makeSimpleRunner(),
    )

    // ── Turn 1 ────────────────────────────────────────────────────────
    let sent: ServerMessage[] = []
    await session.sendMessage('turn 1', (m) => sent.push(m))
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)

    let state = readHookModuleState(hooksPath)
    expect(state.getTurnStartCalls()).toBe(1)

    // ── Reload plugins on the same session ────────────────────────────
    session.reloadPlugins()

    // Counter unchanged — reload doesn't execute turns
    state = readHookModuleState(hooksPath)
    expect(state.getTurnStartCalls()).toBe(1)

    // ── Turn 2 on the same session ────────────────────────────────────
    sent = []
    await session.sendMessage('turn 2', (m) => sent.push(m))
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)

    // Counter = 2: one call per turn, no duplicates from re-registration
    state = readHookModuleState(hooksPath)
    expect(state.getTurnStartCalls()).toBe(2)
  }, 30_000)
})
