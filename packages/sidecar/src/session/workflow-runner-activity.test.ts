import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage, WorkflowDef } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import type { TraceRun } from './tool-trace.js'
import { runWorkflowTurn, type WorkflowRunDeps } from './workflow-runner.js'
import { HookRegistry } from './hooks/registry.js'

function streamingRunner(text: string): ModelRunner {
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      opts.onText?.(text)
      return new AIMessage(text)
    },
  }
}

function makeDeps(overrides?: Partial<WorkflowRunDeps>): WorkflowRunDeps {
  const cwd = mkdtempSync(join(tmpdir(), 'hip-wf-act-'))
  return {
    id: 'wf-sess-1',
    config: { llmProvider: 'test', model: 'test', tools: [], cwd },
    modelRunner: () => streamingRunner('workflow node output'),
    summarizer: () => ({ async summarize() { return '' } }) as Summarizer,
    invokerFactory: (_cwd: string) => ({
      async invoke(_agentId: string, _task: string, _emit: unknown, _signal: AbortSignal) { return 'invoked' },
    }),
    store: undefined,
    idleTimeoutMs: 60_000,
    pendingPermissions: new Map(),
    hooks: new HookRegistry(),
    ...overrides,
  }
}

describe('runWorkflowTurn activity streaming', () => {
  it('streams worker node tokens through send', async () => {
    const def: WorkflowDef = {
      id: 'wf-stream',
      name: 'Stream Test',
      nodes: [{ id: 'n1', type: 'agent', agentId: 'worker', inputTemplate: 'Do the task' }],
      edges: [],
      entry: ['n1'],
    }

    const messages: ServerMessage[] = []
    const send = (msg: ServerMessage): void => { messages.push(msg) }
    const finalize = (
      _s: (msg: ServerMessage) => void,
      _turnId: string,
      text: string,
      _trajectory: Map<string, TraceRun>,
      _stopped: boolean,
    ): string => text

    await runWorkflowTurn(makeDeps(), def, send, finalize)

    const tokenMessages = messages.filter((m) => m.type === 'token:stream')
    expect(tokenMessages.length).toBeGreaterThan(0)
    expect(tokenMessages.some((m) => (m as { agentId?: string }).agentId === 'n1')).toBe(true)
    expect(tokenMessages.some((m) => (m as { delta?: string }).delta === 'workflow node output')).toBe(true)

    expect(messages.some((m) => m.type === 'agent:started' && (m as { agentId?: string }).agentId === 'n1')).toBe(true)
    expect(messages.some((m) => m.type === 'agent:finished' && (m as { agentId?: string }).agentId === 'n1')).toBe(true)
  })
})
