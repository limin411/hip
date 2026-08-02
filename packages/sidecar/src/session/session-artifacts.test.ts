import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  planMarkdownPath,
  removeSessionArtifacts,
  taskOutputDirFor,
  toolOutputDirFor,
  sanitizePlanMarkdownId,
} from './session-artifacts.js'
import { approvedPlanJsonPath } from './plan-persistence.js'

describe('session-artifacts', () => {
  let home: string
  let taskRoot: string
  let toolRoot: string

  beforeEach(() => {
    home = path.join(os.tmpdir(), `hip-artifacts-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    taskRoot = path.join(home, '.hip', 'task-output')
    toolRoot = path.join(home, '.hip', 'data', 'tool-output')
    mkdirSync(path.join(home, '.hip', 'plans'), { recursive: true })
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('sanitizePlanMarkdownId replaces hyphens (plan-mode formula)', () => {
    expect(sanitizePlanMarkdownId('abc-def')).toBe('abc_def')
  })

  it('removeSessionArtifacts deletes plans, task-output, tool-output', () => {
    const id = 'sess-1'
    const md = planMarkdownPath(id, home)
    const json = approvedPlanJsonPath(id, home)
    const taskDir = taskOutputDirFor(id, taskRoot)
    const toolDir = toolOutputDirFor(id, toolRoot)

    writeFileSync(md, '# plan')
    writeFileSync(json, '{}')
    mkdirSync(path.join(taskDir, 't1'), { recursive: true })
    writeFileSync(path.join(taskDir, 't1', 'output.log'), 'log')
    mkdirSync(toolDir, { recursive: true })
    writeFileSync(path.join(toolDir, 'tool_x'), 'spill')

    // other session must survive
    const otherTask = taskOutputDirFor('other', taskRoot)
    mkdirSync(otherTask, { recursive: true })
    writeFileSync(path.join(otherTask, 'keep'), 'y')

    removeSessionArtifacts(id, { home, taskOutputRoot: taskRoot, toolOutputRoot: toolRoot })

    expect(existsSync(md)).toBe(false)
    expect(existsSync(json)).toBe(false)
    expect(existsSync(taskDir)).toBe(false)
    expect(existsSync(toolDir)).toBe(false)
    expect(existsSync(path.join(otherTask, 'keep'))).toBe(true)
  })

  it('removeSessionArtifacts is no-op when absent and ignores bad ids', () => {
    expect(() => removeSessionArtifacts('never-existed', { home, taskOutputRoot: taskRoot, toolOutputRoot: toolRoot })).not.toThrow()
    expect(() => removeSessionArtifacts('../evil', { home })).not.toThrow()
    expect(() => removeSessionArtifacts('', { home })).not.toThrow()
  })

  it('deletes both sanitize variants for hyphenated session ids', () => {
    const id = 'abc-def'
    // plan-mode: abc_def.md ; plan-persistence: abc-def.json
    const md = planMarkdownPath(id, home)
    const json = approvedPlanJsonPath(id, home)
    writeFileSync(md, 'md')
    writeFileSync(json, '{}')
    removeSessionArtifacts(id, { home, taskOutputRoot: taskRoot, toolOutputRoot: toolRoot })
    expect(existsSync(md)).toBe(false)
    expect(existsSync(json)).toBe(false)
  })
})
