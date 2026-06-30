import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { buildTools } from './tools.js'
import { buildGraph, type GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import type { PlanMode } from './plan-mode.js'
import type { AIMessage as AIMsg } from '@langchain/core/messages'
import { setActiveModel } from '../config/providers.js'

function capturingRunner(response: string = 'ok'): ModelRunner & { capturedInputs: BaseMessage[][] } {
  const capturedInputs: BaseMessage[][] = []
  return {
    capturedInputs,
    async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      capturedInputs.push([...messages])
      const m = new AIMessage(response)
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

function mockPlanMode(overrides: {
  isActive?: boolean
  planFilePath?: string | null
  readPlan?: () => Promise<string>
} = {}): PlanMode {
  return {
    get isActive() { return overrides.isActive ?? false },
    get planFilePath() { return overrides.planFilePath ?? null },
    readPlan: overrides.readPlan ?? (async () => ''),
  } as unknown as PlanMode
}

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {}, compaction: () => {} }
const noopSummarizer: Summarizer = { async summarize() { return '' } }

const withTmp = async (fn: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'hip-plan-inj-'))
  try { await fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

beforeAll(() => {
  setActiveModel({ providerID: 'openai', modelID: 'gpt-4', baseURL: '' })
})

function findSystemMessageWith(messages: BaseMessage[], substring: string): SystemMessage | undefined {
  return messages
    .filter((m): m is SystemMessage => m instanceof SystemMessage)
    .find((m) => typeof m.content === 'string' && m.content.includes(substring))
}

describe('plan-mode injection in agent node', () => {
  it('injects a full reminder on first turn (plan file empty, counter=0)', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(1)
      const runner = capturingRunner('ok')
      const out = await app.invoke(
        {
          messages: [new HumanMessage('hi')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          planStepsSinceInjection: 0,
        },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools: buildTools(root),
              emit: noopEmit,
              summarizer: noopSummarizer,
              planMode: mockPlanMode({ isActive: true, planFilePath: '/fake/plan.md', readPlan: async () => '' }),
            },
          },
        },
      )

      expect(runner.capturedInputs.length).toBe(1)
      const modelInput = runner.capturedInputs[0]
      const fullMsg = findSystemMessageWith(modelInput, 'Plan mode is active. You MUST NOT make any edits')
      expect(fullMsg).toBeDefined()
      const content = typeof fullMsg!.content === 'string' ? fullMsg!.content : ''
      expect(content).toContain('Plan file: /fake/plan.md')
      expect(content).toContain('Workflow:')
      expect(content).toContain('ExitPlanMode')
      expect(out.planStepsSinceInjection).toBe(1)
    })
  })

  it('injects a sparse reminder at counter=2', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(1)
      const runner = capturingRunner('ok')
      const out = await app.invoke(
        {
          messages: [new HumanMessage('hi')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          planStepsSinceInjection: 2,
        },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools: buildTools(root),
              emit: noopEmit,
              summarizer: noopSummarizer,
              planMode: mockPlanMode({ isActive: true, planFilePath: '/fake/plan.md' }),
            },
          },
        },
      )

      const modelInput = runner.capturedInputs[0]
      const sparseMsg = findSystemMessageWith(modelInput, 'Plan mode still active')
      expect(sparseMsg).toBeDefined()
      const content = typeof sparseMsg!.content === 'string' ? sparseMsg!.content : ''
      expect(content).toContain('Plan file: /fake/plan.md')
      expect(content).toContain('read-only tools')
      expect(out.planStepsSinceInjection).toBe(3)
    })
  })

  it('injects a sparse reminder at counter=4', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(1)
      const runner = capturingRunner('ok')
      const out = await app.invoke(
        {
          messages: [new HumanMessage('hi')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          planStepsSinceInjection: 4,
        },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools: buildTools(root),
              emit: noopEmit,
              summarizer: noopSummarizer,
              planMode: mockPlanMode({ isActive: true, planFilePath: '/fake/plan.md' }),
            },
          },
        },
      )

      const modelInput = runner.capturedInputs[0]
      const sparseMsg = findSystemMessageWith(modelInput, 'Plan mode still active')
      expect(sparseMsg).toBeDefined()
      expect(out.planStepsSinceInjection).toBe(5)
    })
  })

  it('injects a full reminder at counter=5', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(1)
      const runner = capturingRunner('ok')
      const out = await app.invoke(
        {
          messages: [new HumanMessage('hi')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          planStepsSinceInjection: 5,
        },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools: buildTools(root),
              emit: noopEmit,
              summarizer: noopSummarizer,
              planMode: mockPlanMode({ isActive: true, planFilePath: '/fake/plan.md' }),
            },
          },
        },
      )

      const modelInput = runner.capturedInputs[0]
      const fullMsg = findSystemMessageWith(modelInput, 'You MUST NOT make any edits')
      expect(fullMsg).toBeDefined()
      const content = typeof fullMsg!.content === 'string' ? fullMsg!.content : ''
      expect(content).toContain('Workflow:')
      expect(out.planStepsSinceInjection).toBe(6)
    })
  })

  it('does not inject any reminder when planMode.isActive is false', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(1)
      const runner = capturingRunner('ok')
      const out = await app.invoke(
        {
          messages: [new HumanMessage('hi')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          planStepsSinceInjection: 0,
        },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools: buildTools(root),
              emit: noopEmit,
              summarizer: noopSummarizer,
              planMode: mockPlanMode({ isActive: false }),
            },
          },
        },
      )

      const modelInput = runner.capturedInputs[0]
      const planMsgs = modelInput.filter((m) => m instanceof SystemMessage && typeof m.content === 'string' && (m.content.includes('Plan mode is active') || m.content.includes('Plan mode still active')))
      expect(planMsgs).toHaveLength(0)
      expect(out.planStepsSinceInjection).toBe(0)
    })
  })

  it('injects a reentry reminder when counter=0 and plan file has existing content', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(1)
      const runner = capturingRunner('ok')
      const out = await app.invoke(
        {
          messages: [new HumanMessage('hi')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          planStepsSinceInjection: 0,
        },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools: buildTools(root),
              emit: noopEmit,
              summarizer: noopSummarizer,
              planMode: mockPlanMode({
                isActive: true,
                planFilePath: '/fake/plan.md',
                readPlan: async () => '# Existing Plan\n- Step 1\n- Step 2',
              }),
            },
          },
        },
      )

      const modelInput = runner.capturedInputs[0]
      const reentryMsg = findSystemMessageWith(modelInput, 'A plan file already exists')
      expect(reentryMsg).toBeDefined()
      const content = typeof reentryMsg!.content === 'string' ? reentryMsg!.content : ''
      expect(content).toContain('Read the existing plan file')
      expect(content).toContain('Plan file: /fake/plan.md')
      expect(out.planStepsSinceInjection).toBe(1)
    })
  })

  it('does not inject a reminder when planningMode is fast even if planMode.isActive', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(1)
      const runner = capturingRunner('ok')
      const out = await app.invoke(
        {
          messages: [new HumanMessage('hi')],
          steps: 0,
          planningMode: 'fast',
          planStepsSinceInjection: 0,
        },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools: buildTools(root),
              emit: noopEmit,
              summarizer: noopSummarizer,
              planMode: mockPlanMode({ isActive: true, planFilePath: '/fake/plan.md' }),
            },
          },
        },
      )

      const modelInput = runner.capturedInputs[0]
      const planMsgs = modelInput.filter((m) => m instanceof SystemMessage && typeof m.content === 'string' && (m.content.includes('Plan mode is active') || m.content.includes('Plan mode still active')))
      expect(planMsgs).toHaveLength(0)
      expect(out.planStepsSinceInjection).toBe(0)
    })
  })

  it('does not inject a reminder on odd non-multiple-of-5 counter (counter=1)', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(1)
      const runner = capturingRunner('ok')
      const out = await app.invoke(
        {
          messages: [new HumanMessage('hi')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          planStepsSinceInjection: 1,
        },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools: buildTools(root),
              emit: noopEmit,
              summarizer: noopSummarizer,
              planMode: mockPlanMode({ isActive: true, planFilePath: '/fake/plan.md' }),
            },
          },
        },
      )

      const modelInput = runner.capturedInputs[0]
      const planMsgs = modelInput.filter((m) => m instanceof SystemMessage && typeof m.content === 'string' && (m.content.includes('Plan mode is active') || m.content.includes('Plan mode still active')))
      expect(planMsgs).toHaveLength(0)
      expect(out.planStepsSinceInjection).toBe(1)
    })
  })

  it('handles null planFilePath gracefully with "not set" fallback', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(1)
      const runner = capturingRunner('ok')
      await app.invoke(
        {
          messages: [new HumanMessage('hi')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          planStepsSinceInjection: 0,
        },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools: buildTools(root),
              emit: noopEmit,
              summarizer: noopSummarizer,
              planMode: mockPlanMode({ isActive: true, planFilePath: null }),
            },
          },
        },
      )

      const modelInput = runner.capturedInputs[0]
      const fullMsg = findSystemMessageWith(modelInput, 'You MUST NOT make any edits')
      expect(fullMsg).toBeDefined()
      const content = typeof fullMsg!.content === 'string' ? fullMsg!.content : ''
      expect(content).toContain('Plan file: not set')
    })
  })

  it('preserves an existing SystemMessage (system prompt) alongside the plan-mode reminder', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(1)
      const runner = capturingRunner('ok')
      await app.invoke(
        {
          messages: [new HumanMessage('hi')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          planStepsSinceInjection: 0,
        },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools: buildTools(root),
              emit: noopEmit,
              summarizer: noopSummarizer,
              systemPrompt: 'You are a helpful assistant.',
              planMode: mockPlanMode({ isActive: true, planFilePath: '/fake/plan.md', readPlan: async () => '' }),
            },
          },
        },
      )

      const modelInput = runner.capturedInputs[0]
      const systemMessages = modelInput.filter((m) => m instanceof SystemMessage)
      expect(systemMessages.length).toBeGreaterThanOrEqual(2)

      const planReminder = systemMessages.find((m) => typeof m.content === 'string' && m.content.includes('You MUST NOT make any edits'))
      expect(planReminder).toBeDefined()

      const sysPrompt = systemMessages.find((m) => typeof m.content === 'string' && m.content === 'You are a helpful assistant.')
      expect(sysPrompt).toBeDefined()

      // Plan-mode reminder should come before system prompt
      const planIdx = modelInput.indexOf(planReminder!)
      const promptIdx = modelInput.indexOf(sysPrompt!)
      expect(planIdx).toBeLessThan(promptIdx)
    })
  })
})
