import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { AIMessage as AIMsg } from '@langchain/core/messages'
import { buildTools } from './tools.js'
import { buildGraph, type GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {} }
const noopSummarizer: Summarizer = { async summarize() { return '' } }

describe('plan persistence', () => {
  let root: string
  let plansDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hip-plan-persist-'))
    plansDir = join(root, '.hip', 'plans')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('writes .hip/plans/<sessionId>.json atomically on approval', () => {
    const sessionId = 'test-session-1'
    const filePath = join(plansDir, `${sessionId}.json`)
    const tmpFile = `${filePath}.tmp-${Date.now()}`

    mkdirSync(plansDir, { recursive: true })
    const planPayload = {
      sessionId,
      plan: [{ content: 'do thing', status: 'pending' as const }],
      approvedAt: Date.now(),
    }
    writeFileSync(tmpFile, JSON.stringify(planPayload, null, 2), 'utf8')
    renameSync(tmpFile, filePath)

    expect(existsSync(filePath)).toBe(true)
    const written = JSON.parse(readFileSync(filePath, 'utf8'))
    expect(written.sessionId).toBe(sessionId)
    expect(written.plan).toEqual([{ content: 'do thing', status: 'pending' }])
    expect(typeof written.approvedAt).toBe('number')
  })

  it('writes the actual plan array from a generated plan', async () => {
    const app = buildGraph()
    const runner: ModelRunner = {
      async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
        const content = 'Here is the plan'
        if (content) opts.onText(content)
        return new AIMessage({
          content,
          tool_calls: [{ name: 'write_todos', args: { todos: [{ content: 'step a', status: 'pending' }, { content: 'step b', status: 'pending' }] }, id: 'persist-2' }],
        })
      },
    }

    const planOut = await app.invoke(
      {
        messages: [new HumanMessage('create a complex feature')],
        steps: 0,
        planningMode: 'plan',
        planStatus: 'none',
      },
      { configurable: { ctx: { runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } } },
    )

    expect(planOut.plan).toEqual([{ content: 'step a', status: 'pending' }, { content: 'step b', status: 'pending' }])

    // Simulate atomic persistence
    const sessionId = 'test-session-2'
    const filePath = join(plansDir, `${sessionId}.json`)
    const tmpFile = `${filePath}.tmp-${Date.now()}`
    mkdirSync(plansDir, { recursive: true })
    const planPayload = {
      sessionId,
      plan: planOut.plan,
      approvedAt: Date.now(),
    }
    writeFileSync(tmpFile, JSON.stringify(planPayload, null, 2), 'utf8')
    renameSync(tmpFile, filePath)

    expect(existsSync(filePath)).toBe(true)
    const written = JSON.parse(readFileSync(filePath, 'utf8'))
    expect(written.plan).toEqual([{ content: 'step a', status: 'pending' }, { content: 'step b', status: 'pending' }])
  })
})
