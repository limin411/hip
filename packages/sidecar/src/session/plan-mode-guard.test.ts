import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { buildTools } from './tools.js'
import { buildGraph, type GraphEmit } from './graph.js'
import type { ModelRunner } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import { setActiveModel } from '../config/providers.js'

function fakeRunner(script: AIMessage[]): ModelRunner {
  let i = 0
  return {
    async run() {
      return script[Math.min(i++, script.length - 1)]
    },
  }
}

const noopEmit: GraphEmit = {
  token: () => {},
  reasoning: () => {},
  toolStarted: () => {},
  toolFinished: () => {},
  usage: () => {},
  planDelta: () => {},
  compaction: () => {},
}
const noopSummarizer: Summarizer = { async summarize() { return '' } }

const withTmp = async (fn: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'hip-plan-guard-'))
  try {
    await fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const PLAN_FILE = '/fake/.hip/plans/session123.md'
const activePlanMode = { isActive: true, planFilePath: PLAN_FILE }
const inactivePlanMode = { isActive: false, planFilePath: null }

function hasBlockedToolMsg(messages: unknown[], toolName: string, contentSubstring: string): boolean {
  return messages.some(
    (m) =>
      m instanceof ToolMessage &&
      m.name === toolName &&
      typeof m.content === 'string' &&
      m.content.includes(contentSubstring),
  )
}

setActiveModel({ providerID: 'openai', modelID: 'gpt-4', baseURL: '' })

describe('plan-mode guard', () => {
  it('blocks write_file to a non-plan path when plan mode is active', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: '/src/other.ts', content: 'x' }, id: 'c1' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        { messages: [new HumanMessage('write')], steps: 0 },
        { configurable: { ctx: { sessionId: 'test', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer, planMode: activePlanMode } } },
      )
      expect(hasBlockedToolMsg(out.messages, 'write_file', 'Plan mode is active')).toBe(true)
    })
  })

  it('allows write_file to the plan file path when plan mode is active', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: PLAN_FILE, content: '# plan' }, id: 'c2' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        { messages: [new HumanMessage('write plan')], steps: 0 },
        { configurable: { ctx: { sessionId: 'test', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer, planMode: activePlanMode } } },
      )
      expect(hasBlockedToolMsg(out.messages, 'write_file', 'Plan mode is active')).toBe(false)
    })
  })

  it('blocks edit_file to a non-plan path when plan mode is active', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'edit_file', args: { path: '/src/other.ts', oldString: 'a', newString: 'b' }, id: 'c3' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        { messages: [new HumanMessage('edit')], steps: 0 },
        { configurable: { ctx: { sessionId: 'test', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer, planMode: activePlanMode } } },
      )
      expect(hasBlockedToolMsg(out.messages, 'edit_file', 'Plan mode is active')).toBe(true)
    })
  })

  it('allows read_file when plan mode is active', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'read_file', args: { path: '/src/any.ts' }, id: 'c4' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        { messages: [new HumanMessage('read')], steps: 0 },
        { configurable: { ctx: { sessionId: 'test', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer, planMode: activePlanMode } } },
      )
      expect(hasBlockedToolMsg(out.messages, 'read_file', 'Plan mode is active')).toBe(false)
    })
  })

  it('allows grep when plan mode is active', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'grep', args: { pattern: 'foo' }, id: 'c5' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        { messages: [new HumanMessage('grep')], steps: 0 },
        { configurable: { ctx: { sessionId: 'test', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer, planMode: activePlanMode } } },
      )
      expect(hasBlockedToolMsg(out.messages, 'grep', 'Plan mode is active')).toBe(false)
    })
  })

  it('allows write_todos when plan mode is active', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'write_todos', args: { todos: [{ content: 'step 1', status: 'pending' }] }, id: 'c6' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        { messages: [new HumanMessage('plan')], steps: 0 },
        { configurable: { ctx: { sessionId: 'test', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer, planMode: activePlanMode } } },
      )
      expect(hasBlockedToolMsg(out.messages, 'write_todos', 'Plan mode is active')).toBe(false)
    })
  })

  it('blocks git_commit when plan mode is active', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'git_commit', args: { message: 'wip' }, id: 'c7' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        { messages: [new HumanMessage('commit')], steps: 0 },
        { configurable: { ctx: { sessionId: 'test', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer, planMode: activePlanMode } } },
      )
      expect(hasBlockedToolMsg(out.messages, 'git_commit', 'Plan mode is active')).toBe(true)
    })
  })

  it('blocks run_script when plan mode is active', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'run_script', args: { command: 'echo hi' }, id: 'c8' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        { messages: [new HumanMessage('run')], steps: 0 },
        { configurable: { ctx: { sessionId: 'test', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer, planMode: activePlanMode } } },
      )
      expect(hasBlockedToolMsg(out.messages, 'run_script', 'Plan mode is active')).toBe(true)
    })
  })

  it('allows all tools when plan mode is inactive', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: '/index.html', content: '<h1>hi</h1>' }, id: 'c9' }] }),
        new AIMessage('done'),
      ])
      const started: string[] = []
      const out = await app.invoke(
        { messages: [new HumanMessage('write')], steps: 0 },
        { configurable: { ctx: { sessionId: 'test', runner, tools: buildTools(root), emit: { ...noopEmit, toolStarted: (n: string) => started.push(n) }, summarizer: noopSummarizer, planMode: inactivePlanMode } } },
      )
      expect(hasBlockedToolMsg(out.messages, 'write_file', 'Plan mode is active')).toBe(false)
      expect(started).toContain('write_file')
      expect(readFileSync(join(root, 'index.html'), 'utf8')).toBe('<h1>hi</h1>')
    })
  })
})
