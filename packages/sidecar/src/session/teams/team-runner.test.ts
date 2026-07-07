import { describe, it, expect } from 'vitest'
import type { TeamConfig, TeamMember, TeamPipelineStep } from '@hip/protocol'
import { FakeAgentRunner, CollectingEventSink } from '../../orchestrator/ports.js'
import { TeamRunner } from './team-runner.js'

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function member(role: TeamMember['role'], agentId: string): TeamMember {
  return { role, agentId }
}

function step(role: string, inputTemplate: string, agentId?: string): TeamPipelineStep {
  return agentId ? { role, inputTemplate, agentId } : { role, inputTemplate }
}

function makeTeam(overrides: Partial<TeamConfig> = {}): TeamConfig {
  return {
    id: 'test-team',
    name: 'Test Team',
    description: 'A team for testing',
    members: [],
    pipeline: [],
    ...overrides,
  }
}

// ──────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────

describe('TeamRunner', () => {
  describe('3-role pipeline (architect → coder → reviewer)', () => {
    it('executes steps in order with correct cascading inputs', async () => {
      const team = makeTeam({
        id: 'dev-team',
        name: 'Dev Team',
        members: [
          member('architect', 'agent-arch'),
          member('coder', 'agent-code'),
          member('reviewer', 'agent-review'),
        ],
        pipeline: [
          step('architect', '{{input}}'),
          step('coder', 'Implement: {{architect}}'),
          step('reviewer', 'Review: {{coder}}'),
        ],
      })

      // Use a script that returns distinct outputs per step
      const runner = new FakeAgentRunner({
        'step-0': { text: 'ARCH: MVC architecture' },
        'step-1': { text: 'CODE: implemented MVC' },
        'step-2': { text: 'REVIEW: approved' },
      })

      const teamRunner = new TeamRunner()
      const result = await teamRunner.run(team, 'Build a todo app', {
        agentRunner: runner,
      })

      // Verify call order and agentId
      expect(runner.calls).toHaveLength(3)
      expect(runner.calls[0].agentId).toBe('agent-arch')
      expect(runner.calls[1].agentId).toBe('agent-code')
      expect(runner.calls[2].agentId).toBe('agent-review')

      // First step receives the raw team input
      expect(runner.calls[0].input.text).toBe('Build a todo app')

      // Second step receives the first step's output via {{architect}} → {{step-0}}
      expect(runner.calls[1].input.text).toBe('Implement: ARCH: MVC architecture')

      // Third step receives the second step's output via {{coder}} → {{step-1}}
      expect(runner.calls[2].input.text).toBe('Review: CODE: implemented MVC')

      // Verify result shape
      expect(result.success).toBe(true)
      expect(result.stepCount).toBe(3)
      expect(result.finalOutput).toBe('REVIEW: approved')
      expect(result.outputs).toHaveLength(3)
      expect(result.outputs[0].role).toBe('architect')
      expect(result.outputs[0].status).toBe('succeeded')
      expect(result.outputs[1].role).toBe('coder')
      expect(result.outputs[1].status).toBe('succeeded')
      expect(result.outputs[2].role).toBe('reviewer')
      expect(result.outputs[2].status).toBe('succeeded')
    })

    it('emits workflow events through the event sink', async () => {
      const team = makeTeam({
        id: 'dev-team',
        name: 'Dev Team',
        members: [member('architect', 'agent-a')],
        pipeline: [step('architect', '{{input}}')],
      })

      const runner = new FakeAgentRunner()
      const sink = new CollectingEventSink()

      const teamRunner = new TeamRunner()
      const result = await teamRunner.run(team, 'Hello', {
        agentRunner: runner,
        eventSink: sink,
      })

      expect(result.success).toBe(true)
      expect(result.stepCount).toBe(1)

      // Count events: run:started + node:started + node:succeeded + run:finished
      const started = sink.ofType('run:started')
      expect(started).toHaveLength(1)

      const finished = sink.ofType('run:finished')
      expect(finished).toHaveLength(1)
      expect(finished[0].status).toBe('succeeded')
    })
  })

  describe('single-role team', () => {
    it('runs a single pipeline step', async () => {
      const team = makeTeam({
        id: 'single',
        name: 'Single Role',
        members: [member('coder', 'agent-c')],
        pipeline: [step('coder', '{{input}}')],
      })

      const runner = new FakeAgentRunner({
        'step-0': { text: 'SINGLE: output' },
      })

      const teamRunner = new TeamRunner()
      const result = await teamRunner.run(team, 'Do one thing', {
        agentRunner: runner,
      })

      expect(runner.calls).toHaveLength(1)
      expect(runner.calls[0].agentId).toBe('agent-c')
      expect(runner.calls[0].input.text).toBe('Do one thing')

      expect(result.success).toBe(true)
      expect(result.stepCount).toBe(1)
      expect(result.finalOutput).toBe('SINGLE: output')
      expect(result.outputs[0].role).toBe('coder')
      expect(result.outputs[0].status).toBe('succeeded')
    })

    it('uses step-level agentId override when provided', async () => {
      const team = makeTeam({
        id: 'override',
        name: 'Override',
        members: [member('coder', 'agent-default')],
        pipeline: [step('coder', '{{input}}', 'agent-override')],
      })

      const runner = new FakeAgentRunner()

      const teamRunner = new TeamRunner()
      await teamRunner.run(team, 'test', { agentRunner: runner })

      expect(runner.calls).toHaveLength(1)
      // Should use the step-level override, not the member's agentId
      expect(runner.calls[0].agentId).toBe('agent-override')
    })
  })

  describe('custom role pipeline', () => {
    it('supports custom role names and templates', async () => {
      const team = makeTeam({
        id: 'custom-role-team',
        name: 'Custom Role Team',
        members: [
          { role: 'custom', agentId: 'agent-research', customRole: 'researcher' },
          { role: 'custom', agentId: 'agent-writer', customRole: 'writer' },
        ],
        pipeline: [
          step('custom', '{{input}}', 'agent-research'),
          step('custom', 'Write based on research: {{custom}}', 'agent-writer'),
        ],
      })

      const runner = new FakeAgentRunner({
        'step-0': { text: 'RESEARCH: findings' },
        'step-1': { text: 'WRITE: report' },
      })

      const teamRunner = new TeamRunner()
      const result = await teamRunner.run(team, 'Research AI agents', {
        agentRunner: runner,
      })

      expect(runner.calls).toHaveLength(2)
      expect(runner.calls[0].agentId).toBe('agent-research')
      expect(runner.calls[0].input.text).toBe('Research AI agents')
      expect(runner.calls[1].agentId).toBe('agent-writer')
      expect(runner.calls[1].input.text).toBe(
        'Write based on research: RESEARCH: findings',
      )

      expect(result.success).toBe(true)
      expect(result.stepCount).toBe(2)
      expect(result.finalOutput).toBe('WRITE: report')
    })
  })

  describe('error handling', () => {
    it('reports failure when a step fails', async () => {
      const team = makeTeam({
        id: 'fail-team',
        name: 'Fail Team',
        members: [member('coder', 'agent-c')],
        pipeline: [step('coder', '{{input}}')],
      })

      const runner = new FakeAgentRunner({
        'step-0': { throws: 'runtime error' },
      })

      const teamRunner = new TeamRunner()
      const result = await teamRunner.run(team, 'Do something', {
        agentRunner: runner,
      })

      expect(result.success).toBe(false)
      expect(result.stepCount).toBe(1)
      expect(result.outputs[0].status).toBe('failed')
      expect(result.outputs[0].error).toBe('runtime error')
      expect(result.finalOutput).toBe('')
    })

    it('throws when no agentId can be resolved for a pipeline step', async () => {
      const team = makeTeam({
        id: 'missing-agent',
        name: 'Missing Agent',
        // No member for role 'coder'
        members: [member('architect', 'agent-a')],
        pipeline: [step('coder', '{{input}}')],
      })

      const runner = new FakeAgentRunner()

      const teamRunner = new TeamRunner()
      await expect(
        teamRunner.run(team, 'test', { agentRunner: runner }),
      ).rejects.toThrow(/No agent found for role "coder"/)
    })
  })

  describe('pipeline with no steps', () => {
    it('completes with zero outputs', async () => {
      const team = makeTeam({
        id: 'empty',
        name: 'Empty Team',
        members: [],
        pipeline: [],
      })

      const runner = new FakeAgentRunner()

      const teamRunner = new TeamRunner()
      const result = await teamRunner.run(team, 'input', {
        agentRunner: runner,
      })

      expect(result.success).toBe(true)
      expect(result.stepCount).toBe(0)
      expect(result.outputs).toHaveLength(0)
      expect(result.finalOutput).toBe('')
    })
  })
})
