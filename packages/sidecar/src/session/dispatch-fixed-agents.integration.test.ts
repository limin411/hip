import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeToolCallingModel, makeSession, collect, type StubInvoke } from './__testutils__/dispatch-harness.js'

// ── Config helpers ──────────────────────────────────────────────────

const tmpDirs: string[] = []

/**
 * Write a hip.toml with [[agents]] (so dispatch_agent exists) and
 * [fixedAgents] (the toggle map for coder/explore/plan) into a temp dir.
 * HIP_CONFIG_PATH is set to the new file so resolveEffectiveConfig picks
 * it up inside runTurn.
 */
function setupFixedAgentConfig(fixedAgents: Record<string, boolean>): void {
  const dir = mkdtempSync(join(tmpdir(), 'hip-fixed-agent-'))
  tmpDirs.push(dir)

  const lines = [
    'version = 1',
    '',
    '[[agents]]',
    'id = "noop"',
    'name = "Noop"',
    'kind = "acp"',
    'command = "true"',
    'args = []',
    'enabled = true',
    '',
    '[fixedAgents]',
  ]
  for (const [id, enabled] of Object.entries(fixedAgents)) {
    lines.push(`${id} = ${enabled}`)
  }

  writeFileSync(join(dir, 'hip.toml'), lines.join('\n') + '\n', 'utf8')
  process.env.HIP_CONFIG_PATH = join(dir, 'hip.toml')
}

function cleanup(): void {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.HIP_CONFIG_PATH
}

afterEach(cleanup)

// ── Tests ───────────────────────────────────────────────────────────

describe('dispatch_agent with fixed agents (TDD red phase)', () => {
  it('resolves enabled fixed agent "coder" via dispatchAgent', async () => {
    setupFixedAgentConfig({ coder: true, explore: false, plan: false })

    const calls: Array<{ agentId: string; task: string }> = []
    const stub: StubInvoke = async (agentId, task) => {
      calls.push({ agentId, task })
      return `done:${agentId}`
    }

    const model = makeToolCallingModel(
      { agent: 'coder', task: 'write a test' },
      'all done',
    )
    const session = makeSession('s-fixed-coder', model, stub)
    const events = await collect(session, 'delegate to coder')

    // DESIRED: the invoker is called with agentId='coder'
    // RED: fails because 'coder' is NOT in enabledAgents (only 'noop' is).
    //      dispatchAgent returns "Error: unknown or disabled agent coder"
    //      → the stub is never invoked → calls.length === 0.
    expect(calls.length).toBe(1)
    expect(calls[0].agentId).toBe('coder')
    expect(calls[0].task).toBe('write a test')

    // DESIRED: the dispatch_agent tool was invoked and completed.
    const toolStarted = events.find(
      (e: any) => e.type === 'tool:started' && e.name === 'dispatch_agent',
    )
    expect(toolStarted).toBeDefined()
  })

  it('rejects disabled fixed agent "explore"', async () => {
    setupFixedAgentConfig({ coder: true, explore: false, plan: true })

    const calls: Array<{ agentId: string; task: string }> = []
    const stub: StubInvoke = async (agentId, task) => {
      calls.push({ agentId, task })
      return `done:${agentId}`
    }

    const model = makeToolCallingModel(
      { agent: 'explore', task: 'explore the codebase' },
      'all done',
    )
    const session = makeSession('s-fixed-explore-disabled', model, stub)
    const events = await collect(session, 'delegate to explore')

    // DESIRED: a disabled fixed agent is rejected with a clear message.
    // Currently this *happens* to pass — but for the wrong reason: explore
    // is never added to enabledAgents at all. Once fixed agents are properly
    // integrated, this test ensures disabled agents stay rejected.
    const toolStarted = events.find(
      (e: any) => e.type === 'tool:started' && e.name === 'dispatch_agent',
    )
    expect(toolStarted).toBeDefined()

    // The invoker must NOT be called for a disabled agent.
    expect(calls.length).toBe(0)
  })

  it('enabled fixed agents appear in dispatch roster (verifying "plan")', async () => {
    setupFixedAgentConfig({ coder: true, explore: true, plan: true })

    const calls: Array<{ agentId: string; task: string }> = []
    const stub: StubInvoke = async (agentId, task) => {
      calls.push({ agentId, task })
      return `done:${agentId}`
    }

    const model = makeToolCallingModel(
      { agent: 'plan', task: 'create an architecture plan' },
      'all done',
    )
    const session = makeSession('s-fixed-plan', model, stub)
    const events = await collect(session, 'delegate to plan')

    // DESIRED: 'plan' is resolvable when enabled in fixedAgents config.
    // RED: fails for the same reason as the 'coder' test — plan is not
    //      in enabledAgents.
    expect(calls.length).toBe(1)
    expect(calls[0].agentId).toBe('plan')

    // Also verify the dispatch_agent tool was invoked.
    const toolStarted = events.find(
      (e: any) => e.type === 'tool:started' && e.name === 'dispatch_agent',
    )
    expect(toolStarted).toBeDefined()
  })
})
