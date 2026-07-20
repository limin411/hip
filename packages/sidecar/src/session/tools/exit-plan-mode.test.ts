import { describe, it, expect, vi } from 'vitest'
import { ExitPlanModeTool } from './exit-plan-mode.js'
import type { PlanMode } from '../plan-mode.js'

function mockPlanMode(overrides?: { isActive?: boolean; planFilePath?: string; readPlan?: () => Promise<string> }): PlanMode {
  return {
    isActive: overrides?.isActive ?? false,
    planFilePath: overrides?.planFilePath ?? '/Users/test/.hip/plans/test-session.md',
    enter: vi.fn(),
    writePlan: vi.fn(),
    readPlan: overrides?.readPlan ? vi.fn().mockImplementation(overrides.readPlan) : vi.fn(),
    exit: vi.fn(),
    cancel: vi.fn(),
  } as unknown as PlanMode
}

describe('ExitPlanModeTool', () => {
  function makeTool(planMode?: PlanMode): ExitPlanModeTool {
    return new ExitPlanModeTool(planMode ?? mockPlanMode())
  }

  describe('tool metadata', () => {
    it('has name "ExitPlanMode"', () => {
      const tool = makeTool()
      expect(tool.name).toBe('ExitPlanMode')
    })

    it('has a description', () => {
      const tool = makeTool()
      expect(tool.description).toBeDefined()
      expect(tool.description.length).toBeGreaterThan(0)
    })

    it('mentions plan content and research exclusion (when-to-use guidance)', () => {
      const tool = makeTool()
      expect(tool.description).toMatch(/write_todos|narrative|plan file/i)
      expect(tool.description).toMatch(/research|analysis/i)
      expect(tool.description).toMatch(/without plan content|rush/i)
    })
  })

  describe('schema validation', () => {
    it('accepts empty input object', async () => {
      const pm = mockPlanMode({ isActive: true, readPlan: async () => '# Plan\n- Step 1' })
      const tool = makeTool(pm)

      const result = await tool.invoke({})

      expect(result).toContain('Exited plan mode')
      expect(result).toContain('# Plan')
    })

    it('rejects input with extra fields via LangChain invoke', async () => {
      const tool = makeTool()

      await expect(tool.invoke({ extra: 'field' })).rejects.toThrow()
    })
  })

  describe('invoke when plan mode is active', () => {
    it('returns plan content when plan file has content', async () => {
      const pm = mockPlanMode({ isActive: true, readPlan: async () => '# Plan\n- Step 1' })
      const tool = makeTool(pm)

      const result = await tool.invoke({})

      expect(result).toContain('Exited plan mode. Plan ready for review.')
      expect(result).toContain('## Plan:')
      expect(result).toContain('# Plan\n- Step 1')
    })

    it('allows empty plan file (write_todos may be used instead of Write/Edit)', async () => {
      const pm = mockPlanMode({ isActive: true, readPlan: async () => '' })
      const tool = makeTool(pm)

      const result = await tool.invoke({})

      expect(result).toBe('Exited plan mode. Plan ready for review.')
    })

    it('allows whitespace-only plan file (write_todos may be used instead)', async () => {
      const pm = mockPlanMode({ isActive: true, readPlan: async () => '   \n\t\n  ' })
      const tool = makeTool(pm)

      const result = await tool.invoke({})

      expect(result).toBe('Exited plan mode. Plan ready for review.')
    })
  })

  describe('invoke when plan mode is NOT active', () => {
    it('returns error', async () => {
      const pm = mockPlanMode({ isActive: false })
      const tool = makeTool(pm)

      const result = await tool.invoke({})

      expect(result).toBe('Error: ExitPlanMode can only be called while plan mode is active. Use EnterPlanMode first.')
    })
  })
})
