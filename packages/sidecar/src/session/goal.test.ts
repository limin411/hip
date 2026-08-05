import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { GoalManager } from './goal.js'
import { buildGoalTools } from './tools/goal.js'
import { Session } from './session.js'
import { setActiveModel } from '../config/providers.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'

function fakeRunner(responses: Array<AIMessage | string>): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      const m = responses[Math.min(i, responses.length - 1)]
      i++
      const content = typeof m === 'string' ? m : m.content
      if (typeof content === 'string' && content) opts.onText(content)
      if (typeof m === 'string') {
        return new AIMessage({ content: m })
      }
      return new AIMessage({
        content: m.content,
        tool_calls: m.tool_calls?.map((tc) => ({ ...tc, type: 'tool_call' as const })),
      })
    },
  }
}

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'hip-goal-'))
}

function cleanupTmp(root: string): void {
  rmSync(root, { recursive: true, force: true })
}

beforeAll(() => {
  setActiveModel({ providerID: 'openai', modelID: 'gpt-4', baseURL: '' })
})

// ── GoalManager unit tests ────────────────────────────────────────────────

describe('GoalManager', () => {
  it('createGoal returns a goal with correct fields', () => {
    const gm = new GoalManager()
    const goal = gm.createGoal('Fix all lint errors', { maxTurns: 10, maxTokens: 50_000 })

    expect(goal.description).toBe('Fix all lint errors')
    expect(goal.status).toBe('active')
    expect(goal.budget.maxTurns).toBe(10)
    expect(goal.budget.maxTokens).toBe(50_000)
    expect(goal.usage.turns).toBe(0)
    expect(goal.usage.tokens).toBe(0)
    expect(goal.id).toMatch(/^goal-\d+-/)
    expect(goal.createdAt).toBeGreaterThan(0)
  })

  it('createGoal uses defaults when budget is omitted', () => {
    const gm = new GoalManager()
    const goal = gm.createGoal('Test')

    expect(goal.budget.maxTurns).toBe(25)
    expect(goal.budget.maxTokens).toBe(200_000)
  })

  it('getStatus returns null when no goal exists', () => {
    const gm = new GoalManager()
    expect(gm.getStatus()).toBeNull()
  })

  it('getStatus returns the active goal', () => {
    const gm = new GoalManager()
    const created = gm.createGoal('Test')
    const status = gm.getStatus()

    expect(status).not.toBeNull()
    expect(status!.id).toBe(created.id)
    expect(status!.status).toBe('active')
  })

  it('drive returns null when no goal exists', () => {
    const gm = new GoalManager()
    expect(gm.drive()).toBeNull()
  })

  it('drive returns continuation prompt when goal is active', () => {
    const gm = new GoalManager()
    gm.createGoal('Build the feature')

    const result = gm.drive()
    expect(result).not.toBeNull()
    expect(result!.prompt).toContain('Build the feature')
    expect(result!.prompt).toContain('Auto-continuing')
  })

  it('drive auto-pauses when maxTurns exhausted', () => {
    const gm = new GoalManager()
    gm.createGoal('Short goal', { maxTurns: 2, maxTokens: 100_000 })

    gm.recordTurn() // turn 1
    expect(gm.drive()).not.toBeNull() // still active, prompts for turn 3

    gm.recordTurn() // turn 2 → now usage.turns === 2 === maxTurns → auto-pause
    expect(gm.getStatus()!.status).toBe('paused')
    expect(gm.drive()).toBeNull() // paused → no drive
  })

  it('drive auto-pauses when maxTokens exhausted', () => {
    const gm = new GoalManager()
    gm.createGoal('Token goal', { maxTurns: 100, maxTokens: 500 })

    gm.recordTokens(300)
    expect(gm.getStatus()!.status).toBe('active')

    gm.recordTokens(250) // total 550 > 500 → auto-pause
    expect(gm.getStatus()!.status).toBe('paused')
    expect(gm.drive()).toBeNull()
  })

  it('recordTurn increments turn count', () => {
    const gm = new GoalManager()
    gm.createGoal('Turn goal')

    gm.recordTurn()
    gm.recordTurn()
    expect(gm.getStatus()!.usage.turns).toBe(2)
  })

  it('recordTokens increments token count', () => {
    const gm = new GoalManager()
    gm.createGoal('Token goal')

    gm.recordTokens(100)
    gm.recordTokens(200)
    expect(gm.getStatus()!.usage.tokens).toBe(300)
  })

  it('updateGoal changes status', () => {
    const gm = new GoalManager()
    gm.createGoal('Status goal')

    gm.updateGoal('paused')
    expect(gm.getStatus()!.status).toBe('paused')
  })

  it('completeAndClear clears the goal', () => {
    const gm = new GoalManager()
    gm.createGoal('Done')
    expect(gm.completeAndClear()).toBe(true)
    expect(gm.getStatus()).toBeNull()
  })

  it('updateGoal returns false when no goal exists', () => {
    const gm = new GoalManager()
    expect(gm.updateGoal('paused')).toBe(false)
  })

  it('resumePausedGoal resumes a paused goal', () => {
    const gm = new GoalManager()
    gm.createGoal('Paused goal')
    gm.updateGoal('paused')
    expect(gm.getStatus()!.status).toBe('paused')

    const resumed = gm.resumePausedGoal()
    expect(resumed).toBe(true)
    expect(gm.getStatus()!.status).toBe('active')
  })

  it('resumePausedGoal returns false when goal is not paused', () => {
    const gm = new GoalManager()
    gm.createGoal('Active goal')
    expect(gm.resumePausedGoal()).toBe(false)

    gm.updateGoal('completed')
    expect(gm.resumePausedGoal()).toBe(false)

    const gm2 = new GoalManager()
    expect(gm2.resumePausedGoal()).toBe(false)
  })

  it('recordTurn and recordTokens do nothing when goal is not active', () => {
    const gm = new GoalManager()
    gm.createGoal('Non-active record')
    gm.updateGoal('paused')

    gm.recordTurn()
    gm.recordTokens(100)
    expect(gm.getStatus()!.usage.turns).toBe(0)
    expect(gm.getStatus()!.usage.tokens).toBe(0)
  })
})

// ── Goal tool tests ───────────────────────────────────────────────────────

describe('buildGoalTools', () => {
  it('goal_create tool creates a goal and returns formatted status', async () => {
    const gm = new GoalManager()
    const [goalCreate] = buildGoalTools(gm)

    const result = await goalCreate.invoke({
      description: 'Implement goal mode',
      max_turns: 5,
      max_tokens: 10_000,
    })

    expect(result).toContain('Goal created')
    expect(result).toContain('Implement goal mode')
    expect(result).toContain('5 turns')
    expect(result).toContain('10,000 tokens')
    expect(result).toContain('active')

    const goal = gm.getStatus()
    expect(goal).not.toBeNull()
    expect(goal!.description).toBe('Implement goal mode')
    expect(goal!.budget.maxTurns).toBe(5)
    expect(goal!.budget.maxTokens).toBe(10_000)
  })

  it('goal_create tool uses defaults when budget params omitted', async () => {
    const gm = new GoalManager()
    const [goalCreate] = buildGoalTools(gm)

    const result = await goalCreate.invoke({
      description: 'Default budget goal',
    })

    expect(result).toContain('25 turns')
    expect(result).toContain('200,000 tokens')
  })

  it('goal_status tool returns goal info when goal exists', async () => {
    const gm = new GoalManager()
    gm.createGoal('Status test', { maxTurns: 3, maxTokens: 5_000 })
    gm.recordTurn()
    const [, goalStatus] = buildGoalTools(gm)

    const result = await goalStatus.invoke({})

    expect(result).toContain('Status test')
    expect(result).toContain('active')
    expect(result).toContain('3 turns')
    expect(result).toContain('5,000 tokens')
    expect(result).toMatch(/1\/3 turns/)
  })

  it('goal_status tool returns no-goal message when none exists', async () => {
    const gm = new GoalManager()
    const [, goalStatus] = buildGoalTools(gm)

    const result = await goalStatus.invoke({})
    expect(result).toContain('No goal is currently set')
  })

  it('goal_update tool pauses and resumes a goal', async () => {
    const gm = new GoalManager()
    gm.createGoal('Toggle test')
    const [, , goalUpdate] = buildGoalTools(gm)

    const pauseResult = await goalUpdate.invoke({ status: 'paused' })
    expect(pauseResult).toContain('paused')
    expect(gm.getStatus()!.status).toBe('paused')

    const resumeResult = await goalUpdate.invoke({ status: 'active' })
    expect(resumeResult).toContain('resumed')
    expect(gm.getStatus()!.status).toBe('active')
  })

  it('goal_update tool completes a goal', async () => {
    const gm = new GoalManager()
    gm.createGoal('Complete test')
    const [, , goalUpdate] = buildGoalTools(gm)

    const result = await goalUpdate.invoke({ status: 'completed' })
    expect(result).toContain('completed')
    expect(gm.getStatus()).toBeNull()
  })

  it('goal_update tool returns error when no goal exists', async () => {
    const gm = new GoalManager()
    const [, , goalUpdate] = buildGoalTools(gm)

    const result = await goalUpdate.invoke({ status: 'paused' })
    expect(result).toContain('No goal currently exists')
  })
})

// ── Session integration: goal-driven auto-continuation ────────────────────

describe('Session goal-mode auto-continuation', () => {
  it('auto-continues until budget exhausted, then pauses', async () => {
    const root = makeTmp()
    try {
      // Give the agent: 1 tool-call turn → 1 final text → 1 tool-call turn → 1 final text
      // With maxTurns: 2, it should auto-continue once then pause
      const doLs = new AIMessage({
        content: '',
        tool_calls: [{ name: 'ls', args: { path: root }, id: 'goal-ls-1' }],
      })
      const firstDone = new AIMessage('done turn 1')
      const alsoLs = new AIMessage({
        content: '',
        tool_calls: [{ name: 'ls', args: { path: root }, id: 'goal-ls-2' }],
      })
      const secondDone = new AIMessage('done turn 2')

      const runner = fakeRunner([doLs, firstDone, alsoLs, secondDone])
      const session = new Session(
        't-goal-auto',
        { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd: root },
        undefined,
        undefined,
        undefined,
        10_000,
        runner,
      )

      // Create a goal with 2 turns max
      session.goalManager.createGoal('auto-continue test', { maxTurns: 2, maxTokens: 1_000_000 })

      // Start with a user message that triggers a tool call
      session.enqueueInput({ type: 'message', content: 'do something' })
      await session.drainInputQueue(() => {})

      // Goal should be paused because maxTurns (2) reached
      const goal = session.goalManager.getStatus()
      expect(goal).not.toBeNull()
      expect(goal!.status).toBe('paused')
      expect(goal!.usage.turns).toBe(2)
    } finally {
      cleanupTmp(root)
    }
  })

  it('does not auto-continue when no active goal', async () => {
    const root = makeTmp()
    try {
      const runner = fakeRunner([new AIMessage('just one turn')])
      const session = new Session(
        't-goal-none',
        { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd: root },
        undefined,
        undefined,
        undefined,
        10_000,
        runner,
      )

      session.enqueueInput({ type: 'message', content: 'hi' })
      await session.drainInputQueue(() => {})

      // No goal → no auto-continuation, just one turn
      expect(session.goalManager.getStatus()).toBeNull()
    } finally {
      cleanupTmp(root)
    }
  })

  it('does not auto-continue when paused by budget exhaustion', async () => {
    const root = makeTmp()
    try {
      const runner = fakeRunner([new AIMessage('single turn')])
      const session = new Session(
        't-goal-single',
        { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd: root },
        undefined,
        undefined,
        undefined,
        10_000,
        runner,
      )

      session.goalManager.createGoal('single goal', { maxTurns: 1, maxTokens: 100_000 })

      session.enqueueInput({ type: 'message', content: 'hi' })
      await session.drainInputQueue(() => {})

      const goal = session.goalManager.getStatus()
      expect(goal!.status).toBe('paused')
      expect(goal!.usage.turns).toBe(1)
      // Only one turn — no auto-continuation since budget of 1 was consumed
    } finally {
      cleanupTmp(root)
    }
  })

  it('goal_create tool is available and creates a goal during a turn', async () => {
    const root = makeTmp()
    try {
      // Agent calls goal_create to set up a multi-turn goal
      const goalCreateCall = new AIMessage({
        content: '',
        tool_calls: [{
          name: 'goal_create',
          args: { description: 'Create goal from tool', max_turns: 3 },
          id: 'goal-create-1',
        }],
      })
      const afterCreate = new AIMessage('Goal created, ready to work')

      const runner = fakeRunner([goalCreateCall, afterCreate])
      const session = new Session(
        't-goal-tool',
        { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd: root },
        undefined,
        undefined,
        undefined,
        10_000,
        runner,
      )

      session.enqueueInput({ type: 'message', content: 'create a goal' })
      await session.drainInputQueue(() => {})

      const goal = session.goalManager.getStatus()
      expect(goal).not.toBeNull()
      expect(goal!.description).toBe('Create goal from tool')
    } finally {
      cleanupTmp(root)
    }
  })

  it('auto-continues for precisely maxTurns turns and no more', async () => {
    const root = makeTmp()
    try {
      // Each turn: one tool-call message followed by a text completion
      // maxTurns: 2 → 1 user turn + 1 auto-continuation
      const t0 = new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: root }, id: 'ls-1' }] })
      const t0done = new AIMessage('0')
      const t1 = new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: root }, id: 'ls-2' }] })
      const t1done = new AIMessage('1')

      const runner = fakeRunner([t0, t0done, t1, t1done])
      const session = new Session(
        't-goal-exact',
        { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd: root },
        undefined,
        undefined,
        undefined,
        10_000,
        runner,
      )

      session.goalManager.createGoal('exact turns', { maxTurns: 2, maxTokens: 1_000_000 })

      session.enqueueInput({ type: 'message', content: 'go' })
      await session.drainInputQueue(() => {})

      const goal = session.goalManager.getStatus()
      expect(goal!.usage.turns).toBe(2)
      expect(goal!.status).toBe('paused')
    } finally {
      cleanupTmp(root)
    }
  })
})

describe('GoalManager budget edge cases', () => {
  it('pause on exact turn count match', () => {
    const gm = new GoalManager()
    gm.createGoal('exact', { maxTurns: 1, maxTokens: 100_000 })

    gm.recordTurn() // turn reaches 1 exactly
    expect(gm.getStatus()!.status).toBe('paused')
  })

  it('pause on exact token count match', () => {
    const gm = new GoalManager()
    gm.createGoal('exact', { maxTurns: 100, maxTokens: 100 })

    gm.recordTokens(100) // tokens reaches 100 exactly
    expect(gm.getStatus()!.status).toBe('paused')
  })

  it('resume after pause allows drive again', () => {
    const gm = new GoalManager()
    gm.createGoal('resume', { maxTurns: 5, maxTokens: 100_000 })

    gm.recordTurn() // turn 1
    gm.recordTurn() // turn 2 → 2 < 5, still active
    gm.updateGoal('paused')
    expect(gm.getStatus()!.status).toBe('paused')
    expect(gm.drive()).toBeNull()

    // Resume with turns still within budget
    const resumed = gm.resumePausedGoal()
    expect(resumed).toBe(true)
    expect(gm.getStatus()!.status).toBe('active')
    expect(gm.drive()).not.toBeNull()
  })
})

