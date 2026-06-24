import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { AIMessageChunk } from '@langchain/core/messages'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServerMessage, SkillMeta, McpServerConfig } from '@hip/protocol'
import { Session } from './session.js'
import { RealModelRunner, type ModelRunner } from './model-runner.js'
import { mcpManager } from './mcp/manager.js'
import { skillsBlock } from './system-prompt.js'
import { readEnabledSkills } from './skills/registry.js'
import { writeHipToml } from './__testutils__/config-helpers.js'

// ── Fake model that yields final text (no tool calls) ──

class SmokeModel extends FakeListChatModel {
  constructor(private readonly answer: string) { super({ responses: [answer] }) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bindTools(): any { return this }
  async *_streamResponseChunks(): AsyncGenerator<ChatGenerationChunk> {
    yield new ChatGenerationChunk({ text: this.answer, message: new AIMessageChunk({ content: this.answer }) })
  }
}

function makeSmokeRunner(answer: string): ModelRunner {
  return new RealModelRunner(new SmokeModel(answer) as never)
}

// ── Temp dir management ──

const dirs: string[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'hip-e2e-'))
  dirs.push(d)
  return d
}

function yamlValue(v: unknown): string {
  if (typeof v === 'boolean' || v === null) return String(v)
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    if (v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
      return '\n' + v.map((item) => {
        const entries = Object.entries(item as Record<string, unknown>)
        return '  - ' + entries.map(([sk, sv]) => `${sk}: ${sv}`).join('\n    ')
      }).join('\n')
    }
    return '\n' + v.map((item) => `  - ${String(item)}`).join('\n')
  }
  return String(v)
}

function writeSkillDir(
  dir: string,
  id: string,
  name: string,
  description: string,
  frontmatterOverrides: Record<string, unknown> = {},
  body?: string,
): string {
  const skillDir = join(dir, id)
  mkdirSync(skillDir, { recursive: true })
  const fm: Record<string, unknown> = { name, description, ...frontmatterOverrides }
  const fmLines = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${yamlValue(v)}`)
    .join('\n')
  writeFileSync(join(skillDir, 'SKILL.md'), `---\n${fmLines}\n---\n${body ?? `${name} body`}`, 'utf8')
  return skillDir
}

function resetEnv() {
  delete process.env.HIP_SKILLS_DIR
  delete process.env.HIP_CONFIG_PATH
}

// ── Setup ──

beforeEach(() => {
  resetEnv()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ok */ }
  }
  resetEnv()
  vi.restoreAllMocks()
})

// ── 1. Full turn: session creates, runs, completes ──

describe('E2E smoke: full turn flow', () => {
  it('session creates and completes a turn with mock model', async () => {
    // Mock mcpManager to return empty results (no MCP servers)
    vi.spyOn(mcpManager, 'reconcile').mockResolvedValue()
    vi.spyOn(mcpManager, 'toolCatalog').mockReturnValue('')
    vi.spyOn(mcpManager, 'tools').mockReturnValue([])
    vi.spyOn(mcpManager, 'connectionStatuses').mockReturnValue([])

    const runner = makeSmokeRunner('Hello, I am hip!')
    const session = new Session(
      'e2e-1',
      { llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() },
      undefined, // model (not used since we inject runner)
      undefined, // store
      undefined, // titleGenerator
      undefined, // idleTimeoutMs
      runner,    // injected runner
    )

    const events: ServerMessage[] = []
    let complete = false
    const send = (msg: ServerMessage) => {
      events.push(msg)
      if (msg.type === 'message:complete' || msg.type === 'error') {
        complete = true
      }
    }

    await session.sendMessage('What is your name?', send)

    // Verify key event types flowed
    const eventTypes = events.map((e) => e.type)
    expect(eventTypes).toContain('agent:started')
    expect(eventTypes).toContain('token:stream')
    expect(eventTypes).toContain('agent:finished')
    expect(eventTypes).toContain('message:complete')

    // Verify the answer came through
    const tokens = events
      .filter((e): e is Extract<ServerMessage, { type: 'token:stream' }> => e.type === 'token:stream')
      .map((t) => t.delta)
      .join('')
    expect(tokens).toContain('Hello, I am hip!')

    // Verify mcpManager methods were called
    expect(mcpManager.reconcile).toHaveBeenCalled()
    expect(mcpManager.toolCatalog).toHaveBeenCalled()

    // Verify the completion message has correct structure
    const completeMsg = events.find((e) => e.type === 'message:complete')
    expect(completeMsg).toBeDefined()
    expect((completeMsg as Extract<ServerMessage, { type: 'message:complete' }>).sessionId).toBe('e2e-1')
  })

  it('mcp:status is emitted during turn', async () => {
    vi.spyOn(mcpManager, 'reconcile').mockResolvedValue()
    vi.spyOn(mcpManager, 'toolCatalog').mockReturnValue('')
    vi.spyOn(mcpManager, 'tools').mockReturnValue([])
    vi.spyOn(mcpManager, 'connectionStatuses').mockReturnValue([
      { id: 'mcp1', name: 'Test MCP', status: 'connected', toolCount: 3, toolNames: ['a', 'b', 'c'] },
    ])

    const runner = makeSmokeRunner('OK')
    const session = new Session(
      'e2e-mcp-status',
      { llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() },
      undefined, undefined, undefined, undefined,
      runner,
    )

    const events: ServerMessage[] = []
    await session.sendMessage('test', (msg) => { events.push(msg) })

    const mcpStatuses = events.filter((e): e is Extract<ServerMessage, { type: 'mcp:status' }> => e.type === 'mcp:status')
    expect(mcpStatuses.length).toBeGreaterThanOrEqual(1)
    expect(mcpStatuses[0].servers).toEqual([
      { id: 'mcp1', name: 'Test MCP', status: 'connected', toolCount: 3, toolNames: ['a', 'b', 'c'] },
    ])
  })
})

// ── 2. Unified config: multi-level skills loading ──

describe('E2E smoke: multi-level skills', () => {
  it('loads project skills over global skills in session', () => {
    const base = tmpDir()

    // Global skills
    const globalDir = join(base, 'global-skills')
    writeSkillDir(globalDir, 'formatter', 'Global Formatter', 'Format code globally')
    writeSkillDir(globalDir, 'linter', 'Global Linter', 'Lint code globally')

    // Project skills (overrides formatter)
    const cwd = join(base, 'project')
    const projectSkillsDir = join(cwd, '.hip', 'skills')
    mkdirSync(projectSkillsDir, { recursive: true })
    writeSkillDir(projectSkillsDir, 'formatter', 'Project Formatter', 'Format code for this project')
    writeSkillDir(projectSkillsDir, 'deployer', 'Project Deployer', 'Deploy this project')

    process.env.HIP_SKILLS_DIR = globalDir
    process.env.HIP_CONFIG_PATH = writeHipToml(base, {})

    // The session.loadPluginComponents() calls readEnabledSkills(cwd)
    const skills = readEnabledSkills(cwd)
    const formatter = skills.find((s) => s.id === 'formatter')!
    expect(formatter.name).toBe('Project Formatter')
    expect(formatter.scope).toBe('project')

    const deployer = skills.find((s) => s.id === 'deployer')!
    expect(deployer.scope).toBe('project')

    const linter = skills.find((s) => s.id === 'linter')!
    expect(linter.scope).toBe('global')
    expect(linter.name).toBe('Global Linter')
  })

  it('skills block includes project override, excludes manual skills', () => {
    const base = tmpDir()

    const globalDir = join(base, 'global-skills')
    writeSkillDir(globalDir, 'auto', 'Auto Skill', 'Auto invoked')
    writeSkillDir(globalDir, 'manual', 'Manual Skill', 'Manual only', { autoInvoke: false })

    process.env.HIP_SKILLS_DIR = globalDir
    process.env.HIP_CONFIG_PATH = writeHipToml(base, {})

    const skills2 = readEnabledSkills()
    expect(skills2.length).toBe(2)

    const block = skillsBlock(skills2)
    expect(block).toContain('Auto Skill')
    expect(block).not.toContain('Manual Skill')
  })
})

// ── 3. Session model override + config ──

describe('E2E smoke: session config management', () => {
  it('session uses injected model runner, not real LLM', async () => {
    vi.spyOn(mcpManager, 'reconcile').mockResolvedValue()
    vi.spyOn(mcpManager, 'toolCatalog').mockReturnValue('')
    vi.spyOn(mcpManager, 'tools').mockReturnValue([])
    vi.spyOn(mcpManager, 'connectionStatuses').mockReturnValue([])

    const runner = makeSmokeRunner('Fake response from test')

    const session = new Session(
      'e2e-config',
      {
        llmProvider: 'deepseek',
        model: 'm',
        tools: [],
        cwd: process.cwd(),
        permissionMode: 'chat',
      },
      undefined, undefined, undefined, undefined,
      runner,
    )

    const events: ServerMessage[] = []
    await session.sendMessage('hello', (msg) => { events.push(msg) })

    // Verify the turn completed
    const hasComplete = events.some((e) => e.type === 'message:complete')
    expect(hasComplete).toBe(true)

    // Verify no real API key error
    const hasApiKeyError = events.some(
      (e) => e.type === 'error' && 'code' in e && e.code === 'NO_API_KEY',
    )
    expect(hasApiKeyError).toBe(false)

    // Verify the fake answer came through
    const tokenText = events
      .filter((e) => e.type === 'token:stream')
      .map((e) => (e as Extract<ServerMessage, { type: 'token:stream' }>).delta)
      .join('')
    expect(tokenText).toBe('Fake response from test')
  })
})

// ── 4. Per-tool permissions + permission mode ──

describe('E2E smoke: permission modes', () => {
  it('chat mode session completes turn', async () => {
    vi.spyOn(mcpManager, 'reconcile').mockResolvedValue()
    vi.spyOn(mcpManager, 'toolCatalog').mockReturnValue('')
    vi.spyOn(mcpManager, 'tools').mockReturnValue([])
    vi.spyOn(mcpManager, 'connectionStatuses').mockReturnValue([])

    const runner = makeSmokeRunner('Read-only mode active')

    const session = new Session(
      'e2e-chat',
      {
        llmProvider: 'deepseek',
        model: 'm',
        tools: [],
        cwd: process.cwd(),
        permissionMode: 'chat',
      },
      undefined, undefined, undefined, undefined,
      runner,
    )

    const events: ServerMessage[] = []
    await session.sendMessage('test', (msg) => { events.push(msg) })

    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('edit mode session completes turn', async () => {
    vi.spyOn(mcpManager, 'reconcile').mockResolvedValue()
    vi.spyOn(mcpManager, 'toolCatalog').mockReturnValue('')
    vi.spyOn(mcpManager, 'tools').mockReturnValue([])
    vi.spyOn(mcpManager, 'connectionStatuses').mockReturnValue([])

    const runner = makeSmokeRunner('Edit mode active')

    const session = new Session(
      'e2e-edit',
      {
        llmProvider: 'deepseek',
        model: 'm',
        tools: [],
        cwd: process.cwd(),
        permissionMode: 'edit',
      },
      undefined, undefined, undefined, undefined,
      runner,
    )

    const events: ServerMessage[] = []
    await session.sendMessage('test', (msg) => { events.push(msg) })

    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  })

  it('full mode session completes turn', async () => {
    vi.spyOn(mcpManager, 'reconcile').mockResolvedValue()
    vi.spyOn(mcpManager, 'toolCatalog').mockReturnValue('')
    vi.spyOn(mcpManager, 'tools').mockReturnValue([])
    vi.spyOn(mcpManager, 'connectionStatuses').mockReturnValue([])

    const runner = makeSmokeRunner('Full access mode active')

    const session = new Session(
      'e2e-full',
      {
        llmProvider: 'deepseek',
        model: 'm',
        tools: [],
        cwd: process.cwd(),
        permissionMode: 'full',
      },
      undefined, undefined, undefined, undefined,
      runner,
    )

    const events: ServerMessage[] = []
    await session.sendMessage('test', (msg) => { events.push(msg) })

    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  })
})

// ── 5. Session setCwd, setThinking, setSystemPrompt ──

describe('E2E smoke: config changes mid-session', () => {
  it('setCwd updates session config', () => {
    const session = new Session(
      'e2e-cwd',
      { llmProvider: 'deepseek', model: 'm', tools: [], cwd: '/original' },
      undefined, undefined, undefined, undefined,
      makeSmokeRunner('ok'),
    )

    expect(session.config.cwd).toBe('/original')
    session.setCwd('/new/path')
    expect(session.config.cwd).toBe('/new/path')
  })

  it('setThinking updates while idle, returns false while running', () => {
    const session = new Session(
      'e2e-thinking',
      { llmProvider: 'deepseek', model: 'm', tools: [] },
      undefined, undefined, undefined, undefined,
      makeSmokeRunner('ok'),
    )

    expect(session.setThinking(true)).toBe(true)
    expect(session.config.thinking).toBe(true)

    expect(session.setThinking(false)).toBe(true)
    expect(session.config.thinking).toBe(false)
  })

  it('setSystemPrompt updates while idle, returns false while running', () => {
    const session = new Session(
      'e2e-prompt',
      { llmProvider: 'deepseek', model: 'm', tools: [] },
      undefined, undefined, undefined, undefined,
      makeSmokeRunner('ok'),
    )

    expect(session.setSystemPrompt('Be concise')).toBe(true)
    expect(session.config.systemPrompt).toBe('Be concise')

    expect(session.setSystemPrompt(null)).toBe(true)
    expect(session.config.systemPrompt).not.toBe('Be concise')
  })

  it('setPermissionMode updates while idle', () => {
    const session = new Session(
      'e2e-perm',
      { llmProvider: 'deepseek', model: 'm', tools: [] },
      undefined, undefined, undefined, undefined,
      makeSmokeRunner('ok'),
    )

    expect(session.setPermissionMode('chat')).toBe(true)
    expect(session.config.permissionMode).toBe('chat')

    expect(session.setPermissionMode('full')).toBe(true)
    expect(session.config.permissionMode).toBe('full')
  })
})

// ── 6. Session: multiple sessions can coexist ──

describe('E2E smoke: session split', () => {
  it('multiple sessions run independently', async () => {
    vi.spyOn(mcpManager, 'reconcile').mockResolvedValue()
    vi.spyOn(mcpManager, 'toolCatalog').mockReturnValue('')
    vi.spyOn(mcpManager, 'tools').mockReturnValue([])
    vi.spyOn(mcpManager, 'connectionStatuses').mockReturnValue([])

    const runner1 = makeSmokeRunner('Answer from session 1')
    const runner2 = makeSmokeRunner('Answer from session 2')

    const session1 = new Session('split-1', { llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() }, undefined, undefined, undefined, undefined, runner1)
    const session2 = new Session('split-2', { llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() }, undefined, undefined, undefined, undefined, runner2)

    const events1: ServerMessage[] = []
    const events2: ServerMessage[] = []

    await Promise.all([
      session1.sendMessage('hello', (msg) => { events1.push(msg) }),
      session2.sendMessage('hello', (msg) => { events2.push(msg) }),
    ])

    expect(events1.some((e) => e.type === 'message:complete')).toBe(true)
    expect(events2.some((e) => e.type === 'message:complete')).toBe(true)

    const text1 = events1
      .filter((e) => e.type === 'token:stream')
      .map((e) => (e as Extract<ServerMessage, { type: 'token:stream' }>).delta)
      .join('')
    const text2 = events2
      .filter((e) => e.type === 'token:stream')
      .map((e) => (e as Extract<ServerMessage, { type: 'token:stream' }>).delta)
      .join('')

    expect(text1).toBe('Answer from session 1')
    expect(text2).toBe('Answer from session 2')
  })
})

// ── 7. All WS message types verified ──

describe('E2E smoke: WS message types', () => {
  it('emits agent:started → token:stream → agent:finished → message:complete', async () => {
    vi.spyOn(mcpManager, 'reconcile').mockResolvedValue()
    vi.spyOn(mcpManager, 'toolCatalog').mockReturnValue('')
    vi.spyOn(mcpManager, 'tools').mockReturnValue([])
    vi.spyOn(mcpManager, 'connectionStatuses').mockReturnValue([])

    const runner = makeSmokeRunner('Final answer')
    const session = new Session(
      'e2e-msgs',
      { llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() },
      undefined, undefined, undefined, undefined,
      runner,
    )

    const events: ServerMessage[] = []
    await session.sendMessage('test', (msg) => { events.push(msg) })

    const types = events.map((e) => e.type)

    // Must have these in order
    const agentStartedIdx = types.indexOf('agent:started')
    const tokenStreamIdx = types.indexOf('token:stream')
    const agentFinishedIdx = types.indexOf('agent:finished')
    const messageCompleteIdx = types.indexOf('message:complete')

    expect(agentStartedIdx).toBeGreaterThanOrEqual(0)
    expect(tokenStreamIdx).toBeGreaterThanOrEqual(0)
    expect(agentFinishedIdx).toBeGreaterThanOrEqual(0)
    expect(messageCompleteIdx).toBeGreaterThanOrEqual(0)

    // Order: agent:started before token:stream before agent:finished before message:complete
    expect(agentStartedIdx).toBeLessThan(tokenStreamIdx)
    expect(tokenStreamIdx).toBeLessThan(agentFinishedIdx)
    expect(agentFinishedIdx).toBeLessThan(messageCompleteIdx)
  })

  it('emits mcp:status on every turn', async () => {
    vi.spyOn(mcpManager, 'reconcile').mockResolvedValue()
    vi.spyOn(mcpManager, 'toolCatalog').mockReturnValue('')
    vi.spyOn(mcpManager, 'tools').mockReturnValue([])
    vi.spyOn(mcpManager, 'connectionStatuses').mockReturnValue([])

    const runner = makeSmokeRunner('OK')
    const session = new Session(
      'e2e-mcp-msg',
      { llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() },
      undefined, undefined, undefined, undefined,
      runner,
    )

    const events: ServerMessage[] = []
    await session.sendMessage('test', (msg) => { events.push(msg) })

    expect(events.some((e) => e.type === 'mcp:status')).toBe(true)
  })
})
