import { describe, it, expect } from 'vitest'
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { buildMultiAgentGraph } from './multi-agent-graph.js'
import type { MultiAgentCtx, MultiAgentApp } from './multi-agent-graph.js'
import type { AgentProfile } from './agent-profile.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { GraphEmit } from './graph.js'
import type { StructuredToolInterface } from '@langchain/core/tools'

const profiles: AgentProfile[] = [
  { id: 'supervisor', name: 'Supervisor', mode: 'primary', systemPrompt: 'You are the supervisor.' },
  { id: 'worker', name: 'Worker', mode: 'primary', systemPrompt: 'You are the worker.', allowedTools: ['read'] },
]

const readTool = tool(
  async ({ path }) => `contents of ${path}`,
  {
    name: 'read',
    description: 'Read a file',
    schema: z.object({ path: z.string() }),
  },
)

const noopEmit: GraphEmit = {
  token: () => {},
  reasoning: () => {},
  toolStarted: () => {},
  toolFinished: () => {},
  usage: () => {},
  planDelta: () => {},
  compaction: () => {},
}

function handoffRunner(): ModelRunner {
  let step = 0
  return {
    async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      step++
      if (step === 1) {
        // Supervisor hands off to worker.
        opts.onText('handing off')
        return new AIMessage({
          content: '',
          tool_calls: [{ name: 'handoff_to_worker', args: {}, id: 'h1', type: 'tool_call' }],
        })
      }
      if (step === 2) {
        // Worker reads a file.
        opts.onText('reading')
        return new AIMessage({
          content: '',
          tool_calls: [{ name: 'read', args: { path: '/tmp/file.txt' }, id: 't1', type: 'tool_call' }],
        })
      }
      // Worker finishes.
      opts.onText('done')
      return new AIMessage('done')
    },
  }
}

function buildGraph(): MultiAgentApp {
  return buildMultiAgentGraph({
    profiles,
    defaultProfileId: 'supervisor',
    runner: handoffRunner(),
    tools: [readTool as unknown as StructuredToolInterface],
    emit: noopEmit,
  }) as MultiAgentApp
}

describe('Multi-agent handoff integration', () => {
  it('supervisor hands off to worker, worker uses a tool, and returns', async () => {
    const graph = buildGraph()
    const ctx: MultiAgentCtx = {
      runner: handoffRunner(),
      tools: [readTool as unknown as StructuredToolInterface],
      emit: noopEmit,
      profiles,
      defaultProfileId: 'supervisor',
      maxSteps: 5,
    }

    const result = await graph.invoke(
      { messages: [new HumanMessage('do work')] },
      { configurable: { ctx } },
    )

    expect(result.messages.length).toBeGreaterThanOrEqual(4)
    expect(result.activeAgent).toBe('worker')

    const toolMessages = result.messages.filter((m) => m instanceof ToolMessage)
    expect(toolMessages.length).toBeGreaterThanOrEqual(2)
    expect(toolMessages.some((m) => (m.content as string).includes('Handing off to worker.'))).toBe(true)
    expect(toolMessages.some((m) => (m.content as string).includes('contents of /tmp/file.txt'))).toBe(true)

    const last = result.messages[result.messages.length - 1]
    expect(last).toBeInstanceOf(AIMessage)
    expect(last.content).toBe('done')
  })

  it('rejects handoff to an unknown agent and stays on supervisor', async () => {
    let step = 0
    const runner: ModelRunner = {
      async run(_messages, opts): Promise<AIMessage> {
        step++
        if (step === 1) {
          opts.onText('bad handoff')
          return new AIMessage({
            content: '',
            tool_calls: [{ name: 'handoff_to_ghost', args: {}, id: 'h2', type: 'tool_call' }],
          })
        }
        opts.onText('fallback')
        return new AIMessage('fallback')
      },
    }

    const graph = buildMultiAgentGraph({
      profiles,
      defaultProfileId: 'supervisor',
      runner,
      tools: [readTool as unknown as StructuredToolInterface],
      emit: noopEmit,
    }) as MultiAgentApp
    const ctx: MultiAgentCtx = {
      runner,
      tools: [readTool as unknown as StructuredToolInterface],
      emit: noopEmit,
      profiles,
      defaultProfileId: 'supervisor',
      maxSteps: 5,
    }

    const result = await graph.invoke(
      { messages: [new HumanMessage('do work')] },
      { configurable: { ctx } },
    )

    const toolMessages = result.messages.filter((m) => m instanceof ToolMessage)
    expect(toolMessages.some((m) => (m.content as string).includes('unknown agent'))).toBe(true)
    expect(result.activeAgent).toBe('supervisor')
  })
})
