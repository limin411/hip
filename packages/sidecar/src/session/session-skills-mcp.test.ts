import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { Session } from './session.js'

let root: string
let skillsDir: string
const prevEnv: Record<string, string | undefined> = {}
function setEnv(k: string, v: string) { prevEnv[k] = process.env[k]; process.env[k] = v }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hip-sess-sk-'))
  skillsDir = join(root, 'skills')
  const fmt = join(skillsDir, 'formatter')
  mkdirSync(join(fmt, 'scripts'), { recursive: true })
  writeFileSync(join(fmt, 'SKILL.md'), '---\nname: formatter\ndescription: Format code\n---\nUse scripts/run.sh', 'utf8')
  writeFileSync(join(fmt, 'scripts', 'run.sh'), 'echo formatted', 'utf8')
  // empty MCP config so mcpManager.reconcile([]) is a clean no-op
  const mcpPath = join(root, 'mcp.json')
  writeFileSync(mcpPath, JSON.stringify({ servers: [] }), 'utf8')
  // empty skills enabled map → all enabled by default
  const skillsCfg = join(root, 'skills.json')
  writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
  setEnv('HIP_SKILLS_DIR', skillsDir)
  setEnv('HIP_SKILLS_PATH', skillsCfg)
  setEnv('HIP_MCP_SERVERS_PATH', mcpPath)
  setEnv('HIP_AGENTS_PATH', '') // no external/internal agents in this test
})
afterEach(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  rmSync(root, { recursive: true, force: true })
})

/** A runner that, on its FIRST call, emits a run_script tool call, then on the SECOND call returns text.
 *  It also records the system prompt + tool names it received so the test can assert wiring. */
class ScriptThenTextRunner implements ModelRunner {
  calls = 0
  systemSeen = ''
  toolNamesSeen: string[] = []
  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.calls++
    this.systemSeen = String(messages[0]?.content ?? '')
    this.toolNamesSeen = opts.tools.map((t) => t.name)
    if (this.calls === 1) {
      return new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'run_script', args: { command: 'echo formatted', reason: 'format' } }] })
    }
    opts.onText('all done')
    return new AIMessage('all done')
  }
}

describe('Session wires skills, MCP reconcile, and the run_script HITL closure', () => {
  it('advertises skills in the system prompt and grants use_skill + run_script', async () => {
    const runner = new ScriptThenTextRunner()
    const session = new Session('s1', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, 60_000, runner)
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => {
      sent.push(m)
      if (m.type === 'permission:request') {
        // auto-approve the run_script HITL request the same way the UI's permission:respond would
        session.respondPermission((m as { requestId: string }).requestId, { optionId: 'allow_once' })
      }
    }
    await session.sendMessage('please format', send, 'u1')

    expect(runner.systemSeen).toMatch(/可用 Skills/)
    expect(runner.systemSeen).toContain('formatter')
    expect(runner.toolNamesSeen).toContain('use_skill')
    expect(runner.toolNamesSeen).toContain('run_script')

    // a permission:request was emitted for the run_script call
    expect(sent.some((m) => m.type === 'permission:request')).toBe(true)
    // the run_script tool result must reflect the executed command
    const toolFinished = sent.find((m) => m.type === 'tool:finished' && (m as { output?: string }).output?.includes('formatted'))
    expect(toolFinished).toBeTruthy()
  }, 30_000)

  it('fails CLOSED: an unrecognized permission optionId never approves the script', async () => {
    // Security regression: if the UI returns an optionId that maps to no advertised option, the
    // closure must resolve to a REJECT kind (not echo the opaque id, which isApproved would have to
    // re-interpret). The script must not run.
    const runner = new ScriptThenTextRunner()
    const session = new Session('s2', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, 60_000, runner)
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => {
      sent.push(m)
      if (m.type === 'permission:request') {
        // an optionId that is NOT among the advertised options (allow_once / reject_once) yet starts
        // with 'allow' — the old `?? choice.optionId` fallback would echo it and isApproved (kind
        // .startsWith('allow')) would APPROVE. Failing closed (?? 'reject_once') rejects it.
        session.respondPermission((m as { requestId: string }).requestId, { optionId: 'allow-but-unadvertised' })
      }
    }
    await session.sendMessage('please format', send, 'u2')

    expect(sent.some((m) => m.type === 'permission:request')).toBe(true)
    // the command must NOT have executed
    const ranIt = sent.find((m) => m.type === 'tool:finished' && (m as { output?: string }).output?.includes('formatted'))
    expect(ranIt).toBeFalsy()
    // the run_script tool result must reflect a refusal
    const refused = sent.find((m) => m.type === 'tool:finished' && (m as { output?: string }).output && /拒绝|reject|declined/i.test((m as { output: string }).output))
    expect(refused).toBeTruthy()
  }, 30_000)
})
