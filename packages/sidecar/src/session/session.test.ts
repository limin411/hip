// packages/sidecar/src/session/session.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ChatOpenAI } from '@langchain/openai'
import { Session } from './session.js'
import { NetworkPolicy } from './network-policy.js'
import { writeFileSync, existsSync, readFileSync, unlinkSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const apiKey = process.env.HIP_MODEL_DEEPSEEK_API_KEY
const hasKey = !!apiKey

function createModel() {
  return new ChatOpenAI({
    model: 'deepseek-chat',
    apiKey: apiKey!,
    configuration: {
      baseURL: 'https://api.deepseek.com/v1',
    },
    temperature: 0,
    maxTokens: 64,
  })
}

type AnyServerMessage = { type: string; [k: string]: unknown }

async function collectEvents(session: Session, content: string): Promise<AnyServerMessage[]> {
  const events: AnyServerMessage[] = []
  await session.sendMessage(content, (msg) => events.push(msg as AnyServerMessage))
  return events
}

describe.skipIf(!hasKey)('Session with real DeepSeek API', () => {
  it('streams a single-turn response and emits complete protocol events', async () => {
    const session = new Session(
      'test-single',
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
      createModel(),
    )

    const events = await collectEvents(session, '1+1等于几？只回答数字')

    expect(events[0]?.type).toBe('agent:started')
    expect(events.some((e) => e.type === 'token:stream')).toBe(true)
    expect(events.some((e) => e.type === 'agent:finished')).toBe(true)

    const complete = events.find((e) => e.type === 'message:complete')
    expect(complete).toBeDefined()
    expect(String((complete as any).message.content)).toContain('2')
  })

  it('remembers conversation history across multiple turns', async () => {
    const session = new Session(
      'test-history',
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
      createModel(),
    )

    const events1 = await collectEvents(session, '我的名字是小明，请记住。')
    expect(events1.some((e) => e.type === 'message:complete')).toBe(true)

    const events2 = await collectEvents(session, '我刚才说了什么名字？只回答名字。')
    const complete2 = events2.find((e) => e.type === 'message:complete')
    expect(complete2).toBeDefined()
    expect(String((complete2 as any).message.content)).toMatch(/小明/)
  })

  it('emits error when canceled during streaming', async () => {
    const session = new Session(
      'test-cancel',
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
      createModel(),
    )

    const events: AnyServerMessage[] = []
    const promise = session.sendMessage('讲一个非常非常长的故事', (msg) =>
      events.push(msg as AnyServerMessage),
    )

    // Cancel as soon as the first token arrives
    const checkInterval = setInterval(() => {
      if (events.some((e) => e.type === 'token:stream')) {
        session.cancel()
        clearInterval(checkInterval)
      }
    }, 50)

    await promise
    clearInterval(checkInterval)

    // Task 6: on cancel with a non-empty partial, we persist + emit message:complete (stopped=true)
    // rather than an error. An empty partial (no tokens yet) still emits CANCELLED.
    const hasPartial = events.some((e) => e.type === 'token:stream')
    if (hasPartial) {
      const complete = events.find((e) => e.type === 'message:complete') as (AnyServerMessage & { message?: { stopped?: boolean } }) | undefined
      expect(complete).toBeDefined()
      expect(complete?.message?.stopped).toBe(true)
    } else {
      expect(events.some((e) => e.type === 'error')).toBe(true)
    }
  })
})

describe('Session profile delegation', () => {
  const testConfig = { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }

  it('setAgentProfile returns true for valid builtin profile id', () => {
    const session = new Session('test-profile', testConfig)
    expect(session.setAgentProfile('worker')).toBe(true)
    expect(session.getActiveProfile().id).toBe('worker')
  })

  it('setAgentProfile returns false for unknown profile id', () => {
    const session = new Session('test-profile', testConfig)
    expect(session.setAgentProfile('nonexistent')).toBe(false)
  })

  it('getActiveProfile defaults to supervisor', () => {
    const session = new Session('test-profile', testConfig)
    const profile = session.getActiveProfile()
    expect(profile.id).toBe('supervisor')
    expect(profile.mode).toBe('primary')
  })
})

describe('backgroundTaskMeta cap', () => {
  const testConfig = { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }

  it('caps retained metadata at 50 when 55 completed tasks finish', () => {
    const session = new Session('test-cap', testConfig)
    const meta = (session as any).backgroundTaskMeta as Map<string, { description: string; status: string }>

    for (let i = 0; i < 55; i++) {
      meta.set(`task-${i}`, { description: `task ${i}`, status: 'completed' })
      ;(session as any).trimBackgroundTaskMeta()
    }

    expect(meta.size).toBe(50)
  })

  it('never evicts running tasks even when size exceeds threshold', () => {
    const session = new Session('test-running-cap', testConfig)
    const meta = (session as any).backgroundTaskMeta as Map<string, { description: string; status: string }>

    const runningIds = ['run-1', 'run-2', 'run-3', 'run-4', 'run-5']
    for (const id of runningIds) {
      meta.set(id, { description: id, status: 'running' })
    }

    for (let i = 0; i < 50; i++) {
      meta.set(`done-${i}`, { description: `done ${i}`, status: 'completed' })
      ;(session as any).trimBackgroundTaskMeta()
    }

    for (const id of runningIds) {
      expect(meta.has(id)).toBe(true)
    }
    expect(meta.size).toBeLessThanOrEqual(50)
  })
})

describe('NetworkPolicy session persistence', () => {
  const testConfig = { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }

  it('shares the same NetworkPolicy instance across the session lifetime', () => {
    const session = new Session('test-netpol', testConfig)
    const np = (session as any).networkPolicy as NetworkPolicy
    expect(np).toBeInstanceOf(NetworkPolicy)
    expect((session as any).networkPolicy).toBe(np)
  })
})

describe.skipIf(!hasKey)('NetworkPolicy config reload between turns', () => {
  const networkJsonPath = join(homedir(), '.hip', 'config', 'network.json')
  const testConfig = { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }

  let savedContent: string | null = null

  function saveOriginal() {
    if (existsSync(networkJsonPath)) {
      savedContent = readFileSync(networkJsonPath, 'utf8')
    } else {
      savedContent = null
    }
  }

  function restoreOriginal() {
    if (savedContent !== null) {
      mkdirSync(join(homedir(), '.hip', 'config'), { recursive: true })
      writeFileSync(networkJsonPath, savedContent, 'utf8')
    } else if (existsSync(networkJsonPath)) {
      unlinkSync(networkJsonPath)
    }
  }

  function writeConfig(cfg: Record<string, unknown>) {
    mkdirSync(join(homedir(), '.hip', 'config'), { recursive: true })
    writeFileSync(networkJsonPath, JSON.stringify(cfg), 'utf8')
  }

  beforeEach(() => saveOriginal())
  afterEach(() => restoreOriginal())

  it('reloads network.json config between turns', async () => {
    writeConfig({
      allowlist: ['example.com'],
      denylist: ['blocked.com'],
      maxRequestsPerMinute: 5,
      maxResponseBytes: 5000,
    })

    const session = new Session('test-reload', testConfig, createModel())
    const np = (session as any).networkPolicy as NetworkPolicy

    // Turn 1 — should pick up initial config
    await collectEvents(session, 'hello')

    expect(np.checkUrl('https://example.com/path').allowed).toBe(true)
    expect(np.checkUrl('https://other.com/path').allowed).toBe(false)
    expect(np.checkUrl('https://blocked.com/path').allowed).toBe(false)
    expect(np.getResponseSizeCap()).toBe(5000)

    // Write new config: flip allowlist/denylist, remove allowlist
    // restriction so previously-denied domains become allowed.
    writeConfig({
      allowlist: [],
      denylist: ['example.com'],
      maxRequestsPerMinute: 99,
      maxResponseBytes: 9999,
    })

    // Turn 2 — should reload and pick up new config
    await collectEvents(session, 'hello again')

    expect(np.checkUrl('https://example.com/path').allowed).toBe(false)
    expect(np.checkUrl('https://other.com/path').allowed).toBe(true)
    expect(np.checkUrl('https://blocked.com/path').allowed).toBe(true)
    expect(np.getResponseSizeCap()).toBe(9999)
  })

  it('does not crash when network.json is missing', async () => {
    if (existsSync(networkJsonPath)) unlinkSync(networkJsonPath)

    const session = new Session('test-missing', testConfig, createModel())
    const events = await collectEvents(session, 'hi')

    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('does not crash when network.json is malformed', async () => {
    writeConfig({ __malformed: true })
    writeFileSync(networkJsonPath, 'not valid json {{{', 'utf8')

    const session = new Session('test-malformed', testConfig, createModel())
    const events = await collectEvents(session, 'hi')

    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('resets to defaults when network.json is deleted after being loaded', async () => {
    // Ensure no leftover config
    if (existsSync(networkJsonPath)) unlinkSync(networkJsonPath)

    // Write initial config
    writeConfig({
      allowlist: ['only.example'],
      maxResponseBytes: 5000,
    })

    const session = new Session('test-reset-on-delete', testConfig, createModel())
    const np = (session as any).networkPolicy as NetworkPolicy

    // Turn 1 — picks up custom config
    await collectEvents(session, 'hello')
    expect(np.checkUrl('https://only.example/path').allowed).toBe(true)
    expect(np.checkUrl('https://other.example/path').allowed).toBe(false)
    expect(np.getResponseSizeCap()).toBe(5000)

    // Delete the config file
    unlinkSync(networkJsonPath)

    // Turn 2 — should reset to defaults
    await collectEvents(session, 'hello again')
    expect(np.checkUrl('https://only.example/path').allowed).toBe(true)
    expect(np.checkUrl('https://other.example/path').allowed).toBe(true)
    expect(np.getResponseSizeCap()).toBe(10 * 1024 * 1024)
  })
})
