/**
 * Session-level e2e for Anthropic-compatible catalog hosts (MiniMax etc.).
 *
 * Unit tests cover pure helpers + RealModelRunner in isolation. These tests
 * wire Session → graph → RealModelRunner → protocol events so regressions in
 * message assembly or event emission are caught.
 *
 * Covered regressions:
 *  - MiniMax embeds CoT as <think>…</think> in text → UI must get reasoning:delta
 *  - OpenAI/DeepSeek plain text (incl. "a < b") must not be false-split
 *  - ChatAnthropic path coalesces multi system messages before stream (turn-2 context)
 *  - OpenAI path must NOT coalesce (multiple systems stay separate)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AIMessageChunk, SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import type { ServerMessage } from '@hip/protocol'
import { Session } from './session.js'
import { RealModelRunner, isAnthropicChatModel } from './model-runner.js'
import { mcpManager } from './mcp/manager.js'
import { coalesceSystemMessages } from './anthropic-messages.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockMcpEmpty() {
  vi.spyOn(mcpManager, 'reconcile').mockResolvedValue()
  vi.spyOn(mcpManager, 'toolCatalog').mockReturnValue('')
  vi.spyOn(mcpManager, 'tools').mockReturnValue([])
  vi.spyOn(mcpManager, 'connectionStatuses').mockReturnValue([])
}

/** Chunked stream model: yields string content pieces as AIMessageChunks. */
function makeChunkModel(chunks: string[]) {
  const model: {
    bindTools: () => typeof model
    stream: (msgs: BaseMessage[]) => Promise<AsyncGenerator<AIMessageChunk>>
    lastInput?: BaseMessage[]
  } = {
    bindTools() {
      return model
    },
    async stream(msgs: BaseMessage[]) {
      model.lastInput = msgs
      return (async function* () {
        for (const c of chunks) {
          yield new AIMessageChunk({ content: c })
        }
      })()
    },
  }
  return model
}

/**
 * Named ChatAnthropic so isAnthropicChatModel matches constructor.name
 * (same detection path RealModelRunner uses for LangChain ChatAnthropic).
 */
class ChatAnthropic {
  lastInput: BaseMessage[] | undefined
  private readonly chunks: string[]
  constructor(chunks: string[] = ['ok']) {
    this.chunks = chunks
  }
  bindTools() {
    return this
  }
  async stream(msgs: BaseMessage[]) {
    this.lastInput = msgs
    const chunks = this.chunks
    return (async function* () {
      for (const c of chunks) {
        yield new AIMessageChunk({ content: c })
      }
    })()
  }
}

function tokenText(events: ServerMessage[]): string {
  return events
    .filter((e): e is Extract<ServerMessage, { type: 'token:stream' }> => e.type === 'token:stream')
    .map((e) => e.delta)
    .join('')
}

function reasoningText(events: ServerMessage[]): string {
  return events
    .filter((e): e is Extract<ServerMessage, { type: 'reasoning:delta' }> => e.type === 'reasoning:delta')
    .map((e) => e.delta)
    .join('')
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Session + think-tag UI path ──────────────────────────────────────────────

describe('E2E anthropic-compat: MiniMax <think> through Session protocol', () => {
  it('emits reasoning:delta for CoT and token:stream for the answer only', async () => {
    mockMcpEmpty()
    const model = makeChunkModel([
      '<think>The user asks 12*13. ',
      '12*13 = 156.</think>\n\n',
      '156',
    ])
    const runner = new RealModelRunner(model as never)
    const session = new Session(
      'e2e-think-split',
      { llmProvider: 'minimax-cn-coding-plan', model: 'MiniMax-M3', tools: [], cwd: process.cwd() },
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    const events: ServerMessage[] = []
    await session.sendMessage('What is 12*13? Brief.', (msg) => {
      events.push(msg)
    })

    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    expect(events.some((e) => e.type === 'error')).toBe(false)

    const reasoning = reasoningText(events)
    const text = tokenText(events)

    expect(reasoning).toContain('The user asks 12*13')
    expect(reasoning).toContain('12*13 = 156')
    // Answer text must not include raw tags or CoT
    expect(text).toBe('\n\n156')
    expect(text).not.toContain('<think>')
    expect(text).not.toContain('</think>')
    expect(text).not.toContain('The user asks')

    // Protocol ordering: first reasoning before final answer tokens is ideal;
    // at minimum both streams must appear before agent:finished.
    const types = events.map((e) => e.type)
    const firstReason = types.indexOf('reasoning:delta')
    const firstToken = types.indexOf('token:stream')
    const finished = types.indexOf('agent:finished')
    expect(firstReason).toBeGreaterThanOrEqual(0)
    expect(firstToken).toBeGreaterThanOrEqual(0)
    expect(firstReason).toBeLessThan(finished)
    expect(firstToken).toBeLessThan(finished)
  })

  it('does not leak think tags into token:stream when think spans many chunks', async () => {
    mockMcpEmpty()
    // Tag open/close split across chunk boundaries (stream partial tags).
    const model = makeChunkModel(['<thi', 'nk>partial ', 'cot</th', 'ink>\nanswer'])
    const runner = new RealModelRunner(model as never)
    const session = new Session(
      'e2e-think-boundary',
      { llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() },
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    const events: ServerMessage[] = []
    await session.sendMessage('hi', (msg) => {
      events.push(msg)
    })

    expect(reasoningText(events)).toBe('partial cot')
    expect(tokenText(events)).toBe('\nanswer')
    expect(tokenText(events)).not.toMatch(/<\/?think/)
  })
})

// ── OpenAI / DeepSeek regression ─────────────────────────────────────────────

describe('E2E anthropic-compat: OpenAI-compatible path unchanged', () => {
  it('streams plain text without reasoning:delta and keeps less-than signs', async () => {
    mockMcpEmpty()
    const model = makeChunkModel(['Hello ', 'world. a < b is fine.'])
    const runner = new RealModelRunner(model as never)
    const session = new Session(
      'e2e-openai-plain',
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd: process.cwd() },
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    const events: ServerMessage[] = []
    await session.sendMessage('hi', (msg) => {
      events.push(msg)
    })

    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    expect(reasoningText(events)).toBe('')
    expect(tokenText(events)).toBe('Hello world. a < b is fine.')
  })

  it('still surfaces native reasoning_content / reasoning blocks as reasoning:delta', async () => {
    mockMcpEmpty()
    const model: {
      bindTools: () => typeof model
      stream: () => Promise<AsyncGenerator<AIMessageChunk>>
    } = {
      bindTools() {
        return model
      },
      async stream() {
        return (async function* () {
          yield new AIMessageChunk({
            content: [
              { type: 'reasoning', reasoning: 'step A', index: 7 },
              { type: 'text', text: 'final', index: 0 },
            ] as never,
          })
        })()
      },
    }
    const runner = new RealModelRunner(model as never)
    const session = new Session(
      'e2e-native-reasoning',
      { llmProvider: 'deepseek', model: 'deepseek-reasoner', tools: [], cwd: process.cwd() },
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    const events: ServerMessage[] = []
    await session.sendMessage('hi', (msg) => {
      events.push(msg)
    })

    expect(reasoningText(events)).toBe('step A')
    expect(tokenText(events)).toBe('final')
  })
})

// ── Multi-system coalesce (MiniMax strict host) ──────────────────────────────

describe('E2E anthropic-compat: multi system coalesce on ChatAnthropic', () => {
  it('detects ChatAnthropic by constructor name', () => {
    expect(isAnthropicChatModel(new ChatAnthropic())).toBe(true)
    expect(isAnthropicChatModel(makeChunkModel(['x']))).toBe(false)
  })

  it('coalesces multiple systems before stream when model is ChatAnthropic', async () => {
    const anthropic = new ChatAnthropic(['pong'])
    const runner = new RealModelRunner(anthropic as never)

    // Mimic turn-2 graph input: main system + context SystemMessage + history + human.
    await runner.run(
      [
        new SystemMessage('main system prompt'),
        new SystemMessage('session context delta'),
        new HumanMessage('first'),
        new AIMessage('hello'),
        new HumanMessage('second'),
      ],
      {
        tools: [],
        bindTools: true,
        onText: () => {},
        onReasoning: () => {},
      },
    )

    expect(anthropic.lastInput).toBeDefined()
    const types = anthropic.lastInput!.map((m) => m.getType())
    expect(types[0]).toBe('system')
    // Exactly one system at the front (merged)
    expect(types.filter((t) => t === 'system')).toHaveLength(1)
    // Content may be string or text-blocks (cache_control breakpoints, PR-7b).
    const sysText = (() => {
      const c = anthropic.lastInput![0].content
      if (typeof c === 'string') return c
      if (Array.isArray(c)) {
        return c
          .map((b) =>
            b && typeof b === 'object' && (b as { type?: string }).type === 'text'
              ? String((b as { text?: string }).text ?? '')
              : '',
          )
          .join('')
      }
      return String(c)
    })()
    expect(sysText).toContain('main system prompt')
    expect(sysText).toContain('session context delta')
    expect(types).toEqual(['system', 'human', 'ai', 'human'])
  })

  it('does not coalesce on OpenAI-compatible models (multiple systems preserved)', async () => {
    const model = makeChunkModel(['ok'])
    const runner = new RealModelRunner(model as never)

    await runner.run(
      [
        new SystemMessage('main'),
        new SystemMessage('ctx'),
        new HumanMessage('hi'),
      ],
      {
        tools: [],
        bindTools: true,
        onText: () => {},
        onReasoning: () => {},
      },
    )

    expect(model.lastInput).toBeDefined()
    const systems = model.lastInput!.filter((m) => m.getType() === 'system')
    expect(systems).toHaveLength(2)
  })

  it('session turn with ChatAnthropic completes when graph supplies a system prompt', async () => {
    mockMcpEmpty()
    const anthropic = new ChatAnthropic(['session-ok'])
    const runner = new RealModelRunner(anthropic as never)
    const session = new Session(
      'e2e-anth-session',
      {
        llmProvider: 'minimax-cn-coding-plan',
        model: 'MiniMax-M3',
        tools: [],
        cwd: process.cwd(),
        systemPrompt: 'You are concise.',
      },
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )

    const events: ServerMessage[] = []
    await session.sendMessage('ping', (msg) => {
      events.push(msg)
    })

    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    expect(tokenText(events)).toContain('session-ok')
    // Graph always injects at least one system; after coalesce stream sees a single leading system.
    expect(anthropic.lastInput).toBeDefined()
    const systems = anthropic.lastInput!.filter((m) => m.getType() === 'system')
    expect(systems.length).toBeLessThanOrEqual(1)
    if (systems.length === 1) {
      const c = systems[0].content
      const len =
        typeof c === 'string'
          ? c.length
          : Array.isArray(c)
            ? c.reduce(
                (n, b) =>
                  n +
                  (b && typeof b === 'object' && (b as { type?: string }).type === 'text'
                    ? String((b as { text?: string }).text ?? '').length
                    : 0),
                0,
              )
            : String(c).length
      expect(len).toBeGreaterThan(0)
    }
  })

  it('coalesceSystemMessages matches the MiniMax multi-system failure shape from production', () => {
    // Production failure: "Error: System message must be at the beginning ... only one system message"
    // when turn-2 injects context as a second SystemMessage.
    const input = [
      new SystemMessage('You are a coding assistant.'),
      new SystemMessage('[Session context]\nfiles: a.ts'),
      new HumanMessage('fix bug'),
      new AIMessage('ok'),
      new HumanMessage('still broken?'),
    ]
    const out = coalesceSystemMessages(input)
    expect(out).toHaveLength(4)
    expect(out[0].getType()).toBe('system')
    expect(out.map((m) => m.getType()).filter((t) => t === 'system')).toHaveLength(1)
    expect(out.map((m) => m.getType())).toEqual(['system', 'human', 'ai', 'human'])
  })
})
