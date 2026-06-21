import { describe, it, expect } from 'vitest'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import {
  HANDOFF_TOOL_PREFIX,
  ctxOf,
  agentNodeName,
  buildHandoffTool,
  toolMessageContent,
  multiAgentToolsNode,
} from './multi-agent-handoff.js'
import type { MultiAgentCtx, MultiState } from './multi-agent-graph.js'
import type { AgentProfile } from './agent-profile.js'
import type { GraphEmit } from './graph.js'

const noopEmit: GraphEmit = {
  token: () => {},
  reasoning: () => {},
  toolStarted: () => {},
  toolFinished: () => {},
  usage: () => {},
  planDelta: () => {},
  compaction: () => {},
}

const profileA: AgentProfile = { id: 'alpha', name: 'Alpha', mode: 'primary' }
const profileB: AgentProfile = { id: 'beta', name: 'Beta', mode: 'primary' }

function fakeConfig(ctx: MultiAgentCtx) {
  return { configurable: { ctx } }
}

describe('multi-agent-handoff: ctxOf', () => {
  it('returns ctx from config.configurable', () => {
    const ctx = { runner: {} as unknown as MultiAgentCtx['runner'], tools: [], emit: noopEmit, profiles: [profileA], defaultProfileId: 'alpha' }
    expect(ctxOf(fakeConfig(ctx))).toBe(ctx)
  })

  it('throws when ctx is missing', () => {
    expect(() => ctxOf({ configurable: {} })).toThrow(/configurable.ctx/)
  })
})

describe('multi-agent-handoff: agentNodeName', () => {
  it('prefixes profile id with agent_', () => {
    expect(agentNodeName('alpha')).toBe('agent_alpha')
  })
})

describe('multi-agent-handoff: buildHandoffTool', () => {
  it('creates a tool with handoff prefix and description', () => {
    const t = buildHandoffTool(profileA)
    expect(t.name).toBe(`${HANDOFF_TOOL_PREFIX}alpha`)
    expect(t.description).toContain('Hand off')
    expect(t.description).toContain('Alpha')
  })

  it('uses fallback description when profile has no description', () => {
    const t = buildHandoffTool({ id: 'gamma', name: 'Gamma', mode: 'primary' })
    expect(t.description).toBe('Hand off the conversation to the Gamma agent.')
  })
})

describe('multi-agent-handoff: toolMessageContent', () => {
  it('returns string as-is', () => {
    expect(toolMessageContent('hello')).toBe('hello')
  })

  it('extracts content field from objects', () => {
    expect(toolMessageContent({ content: 'ok' })).toBe('ok')
  })

  it('serializes other values', () => {
    expect(toolMessageContent({ x: 1 })).toBe('{"x":1}')
  })
})

describe('multi-agent-handoff: multiAgentToolsNode', () => {
  const echoTool = tool(
    async ({ text }) => `echo:${text}`,
    { name: 'echo', description: 'echo', schema: z.object({ text: z.string() }) },
  )

  function makeCtx(tools: StructuredToolInterface[] = []): MultiAgentCtx {
    return {
      runner: {} as unknown as MultiAgentCtx['runner'],
      tools,
      emit: noopEmit,
      profiles: [profileA, profileB],
      defaultProfileId: 'alpha',
    }
  }

  function makeState(calls: Array<{ name: string; args?: Record<string, unknown>; id?: string }>): MultiState {
    return {
      messages: [
        new AIMessage({
          content: '',
          tool_calls: calls.map((c, i) => ({ name: c.name, args: c.args ?? {}, id: c.id ?? `c${i}` })),
        }),
      ],
      activeAgent: '',
      steps: 0,
    }
  }

  it('returns empty update when there are no tool calls', async () => {
    const state: MultiState = { messages: [new AIMessage('hi')], activeAgent: '', steps: 0 }
    const result = await multiAgentToolsNode(state, fakeConfig(makeCtx()))
    expect(result).toEqual({})
  })

  it('routes to target agent on handoff tool call', async () => {
    const state = makeState([{ name: `${HANDOFF_TOOL_PREFIX}beta`, id: 'h1' }])
    const result = await multiAgentToolsNode(state, fakeConfig(makeCtx()))

    expect(result).toBeInstanceOf(Command)
    const cmd = result as Command<unknown, { messages: ToolMessage[]; activeAgent: string }, string>
    expect(cmd.goto).toEqual(['agent_beta'])
    expect(cmd.update).toMatchObject({ activeAgent: 'beta' })
  })

  it('rejects handoff to unknown target and does not route', async () => {
    const state = makeState([{ name: `${HANDOFF_TOOL_PREFIX}ghost`, id: 'h1' }])
    const result = await multiAgentToolsNode(state, fakeConfig(makeCtx()))

    expect(result).not.toBeInstanceOf(Command)
    const update = result as { messages: ToolMessage[] }
    expect(update.messages[0]?.content).toContain('unknown agent')
  })

  it('last valid handoff wins when multiple handoffs are present', async () => {
    const state = makeState([
      { name: `${HANDOFF_TOOL_PREFIX}beta`, id: 'h1' },
      { name: `${HANDOFF_TOOL_PREFIX}alpha`, id: 'h2' },
    ])
    const result = await multiAgentToolsNode(state, fakeConfig(makeCtx()))

    const cmd = result as Command<unknown, { messages: ToolMessage[]; activeAgent: string }, string>
    expect(cmd.update).toMatchObject({ activeAgent: 'alpha' })
  })

  it('executes normal tools and returns ToolMessages', async () => {
    const state = makeState([{ name: 'echo', args: { text: 'hi' }, id: 'e1' }])
    const result = await multiAgentToolsNode(state, fakeConfig(makeCtx([echoTool])))

    const update = result as { messages: ToolMessage[] }
    expect(update.messages[0]?.content).toBe('echo:hi')
  })

  it('emits error ToolMessage for unavailable tools', async () => {
    const state = makeState([{ name: 'missing', id: 'm1' }])
    const result = await multiAgentToolsNode(state, fakeConfig(makeCtx()))

    const update = result as { messages: ToolMessage[] }
    expect(update.messages[0]?.content).toContain('not available')
  })

  it('captures tool invocation errors', async () => {
    const failTool = tool(
      async () => { throw new Error('boom') },
      { name: 'fail', description: 'fail', schema: z.object({}) },
    )
    const state = makeState([{ name: 'fail', id: 'f1' }])
    const result = await multiAgentToolsNode(state, fakeConfig(makeCtx([failTool])))

    const update = result as { messages: ToolMessage[] }
    expect(update.messages[0]?.content).toContain('boom')
  })
})
