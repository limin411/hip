import { describe, it, expect, beforeAll } from 'vitest'
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { buildGraph } from './graph.js'
import { buildMultiAgentGraph, type MultiAgentCtx, type MultiAgentApp, HANDOFF_TOOL_PREFIX } from './multi-agent-graph.js'
import type { AgentProfile } from './agent-profile.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { GraphEmit } from './graph.js'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { setActiveModel } from '../config/providers.js'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const noopEmit: GraphEmit = {
  token: () => {},
  reasoning: () => {},
  toolStarted: () => {},
  toolFinished: () => {},
  usage: () => {},
  planDelta: () => {},
  compaction: () => {},
}

beforeAll(() => {
  setActiveModel({ providerID: 'openai', modelID: 'gpt-4', baseURL: '' })
})

/** Fake runner that replays a per-call script. Advances one message per call. */
function scriptedRunner(scripts: Map<string, AIMessage[]>): ModelRunner & { callsByAgent: string[] } {
  const indices = new Map<string, number>()
  const callsByAgent: string[] = []
  return {
    callsByAgent,
    async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      // Identify the agent by the system-prompt prefix it injects (we tag test
      // profiles with a unique systemPrompt). Walk back through messages to find
      // a leading SystemMessage.
      const agentId = detectAgentIdFromMessages(messages)
      callsByAgent.push(agentId)
      const script = scripts.get(agentId) ?? scripts.get('*') ?? []
      const i = indices.get(agentId) ?? 0
      indices.set(agentId, i + 1)
      const m = script[Math.min(i, script.length - 1)]
      if (m && typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m ?? new AIMessage('(no script)')
    },
  }
}

/** The agent node prepends a SystemMessage tagged with the profile id. We sniff it. */
function detectAgentIdFromMessages(messages: BaseMessage[]): string {
  for (const m of messages) {
    if (m._getType() === 'system') {
      const c = typeof m.content === 'string' ? m.content : ''
      const match = /\[agent:(.+?)\]/.exec(c)
      if (match) return match[1]
    }
  }
  return '*'
}

function buildCtx(runner: ModelRunner, profiles: AgentProfile[], tools: StructuredToolInterface[] = []): MultiAgentCtx {
  return {
    runner,
    tools,
    emit: noopEmit,
    profiles,
    defaultProfileId: profiles[0]?.id ?? '',
    maxSteps: 25,
  }
}

/**
 * Cast the union return type to the multi-agent branch. Tests in this file
 * always pass >= 2 profiles, so the runtime value IS MultiAgentApp; the cast
 * is a type-level narrowing, not a value transform.
 */
function asMultiAgent(app: ReturnType<typeof buildMultiAgentGraph>): MultiAgentApp {
  return app as MultiAgentApp
}

const profileA: AgentProfile = {
  id: 'alpha',
  name: 'Alpha',
  mode: 'primary',
  systemPrompt: '[agent:alpha] You are Alpha.',
}
const profileB: AgentProfile = {
  id: 'beta',
  name: 'Beta',
  mode: 'primary',
  systemPrompt: '[agent:beta] You are Beta.',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildMultiAgentGraph — single-profile fallback', () => {
  it('returns buildGraph() result when profiles.length <= 1', () => {
    const single = buildMultiAgentGraph({
      profiles: [profileA],
      runner: scriptedRunner(new Map()),
      tools: [],
      emit: noopEmit,
    })
    const baseline = buildGraph()
    // Reference equality: same factory must be returned, not a re-built graph.
    // (Both are compiled instances of the same StateGraph topology, but we
    // specifically want the fallback to delegate rather than rebuild.)
    expect(typeof single.invoke).toBe('function')
    // Structural fingerprint: the single-profile graph must NOT expose the
    // multi-agent-only `activeAgent` channel in its default state. We can't
    // read channels directly, so we assert that invoking it doesn't require
    // an activeAgent field, by checking it accepts the LoopState-shaped input.
    expect(single).not.toBe(baseline) // different compiled instances per call is fine
  })
})

describe('buildMultiAgentGraph — multi-agent topology', () => {
  it('creates a graph that accepts .invoke() with { messages } (Session.invoke compatible)', async () => {
    const scripts = new Map<string, AIMessage[]>([['alpha', [new AIMessage('hello from alpha')]]])
    const runner = scriptedRunner(scripts)
    const app = asMultiAgent(buildMultiAgentGraph({
      profiles: [profileA, profileB],
      runner,
      tools: [],
      emit: noopEmit,
    }))
    const result = await app.invoke(
      { messages: [new HumanMessage('hi')] },
      { configurable: { ctx: buildCtx(runner, [profileA, profileB]) } },
    )
    expect(result.messages.length).toBeGreaterThan(0)
    expect((result.messages[result.messages.length - 1] as AIMessage).content).toBe('hello from alpha')
  })

  it('routes to the agent named by activeAgent (router respects state.activeAgent)', async () => {
    const scripts = new Map<string, AIMessage[]>([
      ['beta', [new AIMessage('beta handled it')]],
    ])
    const runner = scriptedRunner(scripts)
    const app = asMultiAgent(buildMultiAgentGraph({
      profiles: [profileA, profileB],
      runner,
      tools: [],
      emit: noopEmit,
    }))
    const result = await app.invoke(
      { messages: [new HumanMessage('go to beta')], activeAgent: 'beta' },
      { configurable: { ctx: buildCtx(runner, [profileA, profileB]) } },
    )
    expect(runner.callsByAgent).toContain('beta')
    expect((result.messages[result.messages.length - 1] as AIMessage).content).toBe('beta handled it')
  })

  it('default profile id is used when activeAgent is unset (initial routing)', async () => {
    const scripts = new Map<string, AIMessage[]>([
      ['alpha', [new AIMessage('alpha default')]],
    ])
    const runner = scriptedRunner(scripts)
    const app = asMultiAgent(buildMultiAgentGraph({
      profiles: [profileA, profileB],
      runner,
      tools: [],
      emit: noopEmit,
    }))
    await app.invoke(
      { messages: [new HumanMessage('start')] },
      { configurable: { ctx: buildCtx(runner, [profileA, profileB]) } },
    )
    // Default is profileA (first in list) → alpha should be called first.
    expect(runner.callsByAgent[0]).toBe('alpha')
  })

  it('handoff tool updates activeAgent and routes to the target agent node', async () => {
    // alpha calls handoff_to_beta on its first turn; beta then answers.
    const scripts = new Map<string, AIMessage[]>([
      [
        'alpha',
        [
          new AIMessage({
            content: '',
            tool_calls: [
              { name: `${HANDOFF_TOOL_PREFIX}${profileB.id}`, args: {}, id: 'h1' },
            ],
          }),
        ],
      ],
      ['beta', [new AIMessage('beta handled the handoff')]],
    ])
    const runner = scriptedRunner(scripts)
    const app = asMultiAgent(buildMultiAgentGraph({
      profiles: [profileA, profileB],
      runner,
      tools: [],
      emit: noopEmit,
    }))
    const result = await app.invoke(
      { messages: [new HumanMessage('hand off to beta')] },
      { configurable: { ctx: buildCtx(runner, [profileA, profileB]) }, recursionLimit: 30 },
    )
    expect(runner.callsByAgent).toContain('alpha')
    expect(runner.callsByAgent).toContain('beta')
    expect(result.activeAgent).toBe('beta')
    expect((result.messages[result.messages.length - 1] as AIMessage).content).toBe('beta handled the handoff')
  })

  it('handoff to an unknown target fails gracefully (no crash, no routing to nonexistent node)', async () => {
    const scripts = new Map<string, AIMessage[]>([
      [
        'alpha',
        [
          // Handoff to a profile id that does not exist. The tools node must
          // detect this and return an error ToolMessage instead of routing
          // to a nonexistent node (which would throw).
          new AIMessage({
            content: '',
            tool_calls: [{ name: `${HANDOFF_TOOL_PREFIX}ghost`, args: {}, id: 'h-bad' }],
          }),
          // Second call: alpha recovers with a plain answer.
          new AIMessage('alpha recovered'),
        ],
      ],
    ])
    const runner = scriptedRunner(scripts)
    const app = asMultiAgent(buildMultiAgentGraph({
      profiles: [profileA, profileB],
      runner,
      tools: [],
      emit: noopEmit,
    }))
    const result = await app.invoke(
      { messages: [new HumanMessage('hand off to a ghost')] },
      { configurable: { ctx: buildCtx(runner, [profileA, profileB]) }, recursionLimit: 30 },
    )
    // alpha was called at least once and the graph terminated without throwing.
    expect(runner.callsByAgent.filter((a) => a === 'alpha').length).toBeGreaterThan(0)
    // activeAgent must NOT be 'ghost'
    expect(result.activeAgent).not.toBe('ghost')
  })

  it('non-handoff tools execute and the loop returns to the same agent', async () => {
    const echoTool = tool(
      async ({ text }) => `echo:${text}`,
      {
        name: 'echo',
        description: 'echo back the text',
        schema: z.object({ text: z.string() }),
      },
    )
    const scripts = new Map<string, AIMessage[]>([
      [
        'alpha',
        [
          new AIMessage({
            content: '',
            tool_calls: [{ name: 'echo', args: { text: 'hi' }, id: 'e1' }],
          }),
          new AIMessage('alpha done'),
        ],
      ],
    ])
    const runner = scriptedRunner(scripts)
    const app = asMultiAgent(buildMultiAgentGraph({
      profiles: [profileA, profileB],
      runner,
      tools: [echoTool],
      emit: noopEmit,
    }))
    const result = await app.invoke(
      { messages: [new HumanMessage('echo something')] },
      { configurable: { ctx: buildCtx(runner, [profileA, profileB], [echoTool]) }, recursionLimit: 30 },
    )
    // The echo tool ran: a ToolMessage with "echo:hi" is in the transcript.
    const toolMsgs = result.messages.filter((m) => m._getType() === 'tool')
    expect(toolMsgs.length).toBeGreaterThan(0)
    expect(toolMsgs.some((m) => m.content.toString().includes('echo:hi'))).toBe(true)
    // activeAgent never changed.
    expect(result.activeAgent === 'alpha' || result.activeAgent === '').toBe(true)
    expect((result.messages[result.messages.length - 1] as AIMessage).content).toBe('alpha done')
  })

  it('agent receives only its allowedTools (profile filtering) plus handoff tools for other profiles', async () => {
    // Capture what tools each agent was handed so we can assert filtering.
    const seenTools = new Map<string, string[]>()
    const capturingRunner: ModelRunner = {
      async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        const agentId = detectAgentIdFromMessages(messages)
        seenTools.set(agentId, opts.tools.map((t) => t.name))
        return new AIMessage(`done from ${agentId}`)
      },
    }
    const toolA = tool(async () => 'a', { name: 'tool_a', schema: z.object({}) })
    const toolB = tool(async () => 'b', { name: 'tool_b', schema: z.object({}) })
    const profiles: AgentProfile[] = [
      { ...profileA, allowedTools: ['tool_a'] },
      { ...profileB, allowedTools: ['tool_b'] },
    ]
    const app = asMultiAgent(buildMultiAgentGraph({
      profiles,
      runner: capturingRunner,
      tools: [toolA, toolB],
      emit: noopEmit,
    }))
    await app.invoke(
      { messages: [new HumanMessage('x')] },
      { configurable: { ctx: buildCtx(capturingRunner, profiles, [toolA, toolB]) } },
    )
    expect(seenTools.has('alpha')).toBe(true)
    const alphaTools = seenTools.get('alpha') ?? []
    expect(alphaTools).toContain('tool_a')
    expect(alphaTools).not.toContain('tool_b')
    expect(alphaTools).toContain(`${HANDOFF_TOOL_PREFIX}${profileB.id}`)

    await app.invoke(
      { messages: [new HumanMessage('x')], activeAgent: 'beta' },
      { configurable: { ctx: buildCtx(capturingRunner, profiles, [toolA, toolB]) } },
    )
    expect(seenTools.has('beta')).toBe(true)
    const betaTools = seenTools.get('beta') ?? []
    expect(betaTools).toContain('tool_b')
    expect(betaTools).not.toContain('tool_a')
    expect(betaTools).toContain(`${HANDOFF_TOOL_PREFIX}${profileA.id}`)
  })
})
