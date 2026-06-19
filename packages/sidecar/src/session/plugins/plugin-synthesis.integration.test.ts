import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
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
  },
}))

import { Session } from '../session.js'

// ── Test harness ───────────────────────────────────────────────────────

let root: string
let pluginDir: string
let pluginsJsonPath: string
let skillsCfgPath: string
let mcpCfgPath: string
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
  skillsCfgPath = join(root, 'skills.json')
  mcpCfgPath = join(root, 'mcp.json')

  // Start with the plugin enabled
  writeFileSync(pluginsJsonPath, JSON.stringify({ plugins: [pluginDir] }), 'utf8')
  writeFileSync(skillsCfgPath, JSON.stringify({ enabled: {} }), 'utf8')
  writeFileSync(mcpCfgPath, JSON.stringify({ servers: [] }), 'utf8')

  setEnv('HIP_PLUGINS_PATH', pluginsJsonPath)
  setEnv('HIP_SKILLS_PATH', skillsCfgPath)
  setEnv('HIP_SKILLS_DIR', join(root, 'no-real-skills'))
  setEnv('HIP_MCP_SERVERS_PATH', mcpCfgPath)
  setEnv('HIP_AGENTS_PATH', '')

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
    expect(runner.systemSeen).toMatch(/可用 Skills|Available Skills/)
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

    // use_skill tool must NOT be offered (no skills → no use_skill)
    expect(runner2.toolNamesSeen).not.toContain('use_skill')

    // No MCP configs were reconciled (only empty base config)
    expect(reconciledConfigs.every((c) => c.id !== 'test_mcp')).toBe(true)

    // MCP tools must NOT be offered
    expect(runner2.toolNamesSeen).not.toContain('mcp__test_mcp__hello')

    // Turn completed cleanly
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)
  }, 30_000)
})
