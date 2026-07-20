import { describe, it, expect, vi } from 'vitest'
import { EnterPlanModeTool } from './enter-plan-mode.js'
import type { PlanMode } from '../plan-mode.js'

function mockPlanMode(overrides?: { isActive?: boolean; planFilePath?: string }): PlanMode {
  return {
    isActive: overrides?.isActive ?? false,
    planFilePath: overrides?.planFilePath ?? '/Users/test/.hip/plans/test-session.md',
    enter: vi.fn(),
    writePlan: vi.fn(),
    readPlan: vi.fn(),
    exit: vi.fn(),
    cancel: vi.fn(),
  } as unknown as PlanMode
}

describe('EnterPlanModeTool', () => {
  function makeTool(planMode?: PlanMode, sessionId?: string): EnterPlanModeTool {
    return new EnterPlanModeTool(planMode ?? mockPlanMode(), sessionId ?? 'test-session')
  }

  describe('invoke when plan mode is inactive', () => {
    it('enters plan mode and returns guidance with plan file path', async () => {
      const pm = mockPlanMode({ isActive: false, planFilePath: '/tmp/plan.md' })
      const tool = makeTool(pm)

      const result = await tool.invoke({})

      expect(pm.enter).toHaveBeenCalledWith('test-session')
      expect(result).toContain('Plan mode is now active')
      expect(result).toContain('/tmp/plan.md')
      expect(result).toContain('1. Use read-only tools')
      expect(result).toContain('5. When the plan is ready, call ExitPlanMode')
      expect(result).toContain('Do NOT edit files other than the plan file')
    })

    it('passes the correct sessionId to planMode.enter()', async () => {
      const pm = mockPlanMode({ isActive: false })
      const tool = makeTool(pm, 'my-session-123')

      await tool.invoke({})

      expect(pm.enter).toHaveBeenCalledWith('my-session-123')
    })
  })

  describe('invoke when plan mode is already active', () => {
    it('returns error without calling enter()', async () => {
      const pm = mockPlanMode({ isActive: true })
      const tool = makeTool(pm)

      const result = await tool.invoke({})

      expect(pm.enter).not.toHaveBeenCalled()
      expect(result).toBe('Error: Plan mode is already active. Use ExitPlanMode when the plan is ready.')
    })
  })

  describe('tool metadata', () => {
    it('has name "EnterPlanMode"', () => {
      const tool = makeTool()
      expect(tool.name).toBe('EnterPlanMode')
    })

    it('has a description mentioning plan mode and ExitPlanMode', () => {
      const tool = makeTool()
      expect(tool.description).toBeDefined()
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.description).toContain('plan mode')
      expect(tool.description).toContain('ExitPlanMode')
    })

    it('describes good vs not-appropriate triggers (when-to-use guidance)', () => {
      const tool = makeTool()
      expect(tool.description).toMatch(/ambiguity|ambiguous|multi-file|unclear/i)
      expect(tool.description).toMatch(/research|analysis/i)
      expect(tool.description).toMatch(/typo|obvious|single/i)
    })
  })

  describe('schema validation', () => {
    it('accepts empty input object', async () => {
      const pm = mockPlanMode({ isActive: false, planFilePath: '/tmp/plan.md' })
      const tool = makeTool(pm)

      const result = await tool.invoke({})

      expect(result).toContain('Plan mode is now active')
      expect(pm.enter).toHaveBeenCalled()
    })

    it('rejects input with extra fields via LangChain invoke', async () => {
      const tool = makeTool()

      // The .strict() schema should reject extra fields.
      await expect(tool.invoke({ extra: 'field' })).rejects.toThrow()
    })
  })
})
