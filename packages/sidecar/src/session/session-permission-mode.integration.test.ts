import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage, SessionConfig, PermissionMode } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { Session } from './session.js'

let cwd: string
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'hip-pm-int-')) })
afterEach(() => { rmSync(cwd, { recursive: true, force: true }) })

/** A runner that on its FIRST call invokes one tool (by name, with the given args) for its side-effect,
 *  then finishes the turn with a text answer (no tool_calls). Records the tool names it was offered. */
class OneToolThenDone implements ModelRunner {
  public offered: string[][] = []
  constructor(private readonly toolName: string, private readonly args: Record<string, unknown>) {}
  async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.offered.push(opts.tools.map((t) => t.name))
    const target = opts.tools.find((t) => t.name === this.toolName)
    if (target) await target.invoke(this.args as never)
    opts.onText('done')
    return new AIMessage('done')
  }
}

// Session ctor: (id, config, model?, store?, titleGenerator?, idleTimeoutMs?, runner?). Passing a runner
// (and no model) means usesEnvModel === false → NO real model is built → paid-free.
function run(config: SessionConfig, runner: ModelRunner): Promise<ServerMessage[]> {
  const events: ServerMessage[] = []
  const session = new Session('pm-int', config, undefined, undefined, undefined, undefined, runner)
  return session.sendMessage('go', (m) => events.push(m)).then(() => events)
}

const base = (permissionMode?: PermissionMode): SessionConfig => ({
  llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd, permissionMode,
})

describe('permission mode end-to-end through runTurn', () => {
  it('full mode runs run_script WITHOUT emitting a permission:request', async () => {
    const marker = join(cwd, 'full-marker.txt')
    const runner = new OneToolThenDone('run_script', { command: `touch ${marker}`, reason: 'integration probe' })
    const events = await run(base('full'), runner)
    // run_script was offered (full passes an auto-approve closure → buildTools registers it).
    expect(runner.offered[0]).toContain('run_script')
    // Auto-approve: no HITL modal was ever requested.
    expect(events.some((e) => e.type === 'permission:request')).toBe(false)
    // The script actually ran (auto-approved).
    expect(existsSync(marker)).toBe(true)
  })

  it('chat mode never offers run_script / write_file / edit_file to the model', async () => {
    const runner = new OneToolThenDone('read_file', { path: '/nope.txt' })
    await run(base('chat'), runner)
    expect(runner.offered[0]).not.toContain('run_script')
    expect(runner.offered[0]).not.toContain('write_file')
    expect(runner.offered[0]).not.toContain('edit_file')
    expect(runner.offered[0]).toContain('read_file')
  })

  it('edit mode (default) offers run_script (HITL-gated), write_file and edit_file', async () => {
    const runner = new OneToolThenDone('read_file', { path: '/nope.txt' })
    await run(base(), runner)
    expect(runner.offered[0]).toContain('run_script')
    expect(runner.offered[0]).toContain('write_file')
    expect(runner.offered[0]).toContain('edit_file')
  })
})
