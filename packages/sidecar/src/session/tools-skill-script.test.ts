import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillMeta } from '@hip/protocol'
import { buildTools, type ApprovalFn } from './tools.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-toolsx-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function byName(tools: ReturnType<typeof buildTools>, name: string) {
  return tools.find((t) => t.name === name)!
}

/** A skill living at <root>/skills/<id> with a SKILL.md body + one script file. */
function makeSkill(id: string, name: string, body: string): SkillMeta {
  const dir = join(root, 'skills', id)
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n${body}`, 'utf8')
  writeFileSync(join(dir, 'scripts', 'run.sh'), 'echo run', 'utf8')
  return { id, name, description: 'd', dir, hasScripts: true }
}

const allowApproval: ApprovalFn = async () => ({ optionId: 'allow_once' })
const rejectApproval: ApprovalFn = async () => ({ optionId: 'reject_once' })

describe('use_skill tool', () => {
  it('is absent when no skills are given', () => {
    const tools = buildTools(root, undefined, root, undefined, {})
    expect(tools.find((t) => t.name === 'use_skill')).toBeUndefined()
  })

  it('returns the SKILL.md body plus a file manifest', async () => {
    const skill = makeSkill('formatter', 'formatter', 'Run scripts/run.sh to format.')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'formatter' }))
    expect(out).toContain('Run scripts/run.sh to format.')
    expect(out).toContain('scripts/run.sh')
    expect(out).toContain('SKILL.md')
  })

  it('reports a missing skill by name', async () => {
    const skill = makeSkill('a', 'a', 'body')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'nope' }))
    expect(out).toMatch(/not found|不存在/i)
  })
})

describe('run_script tool', () => {
  it('is absent when no requestApproval is given', () => {
    const tools = buildTools(root, undefined, root, undefined, {})
    expect(tools.find((t) => t.name === 'run_script')).toBeUndefined()
  })

  it('executes after approval and returns exit code + stdout', async () => {
    const tools = buildTools(root, undefined, root, undefined, { requestApproval: allowApproval })
    const out = String(await byName(tools, 'run_script').invoke({ command: 'echo hi' }))
    expect(out).toContain('hi')
    expect(out).toMatch(/exit(Code)?\D*0/i)
  })

  it('does not execute and returns a refusal when rejected', async () => {
    const marker = join(root, 'should-not-exist.txt')
    const tools = buildTools(root, undefined, root, undefined, { requestApproval: rejectApproval })
    const out = String(await byName(tools, 'run_script').invoke({ command: `touch ${marker}` }))
    expect(out).toMatch(/拒绝|reject|declined/i)
    expect(existsSync(marker)).toBe(false)
  })

  it('passes a cancelled decision through as a refusal without executing', async () => {
    const cancel: ApprovalFn = async () => ({ cancelled: true })
    const marker = join(root, 'cancel-marker.txt')
    const tools = buildTools(root, undefined, root, undefined, { requestApproval: cancel })
    const out = String(await byName(tools, 'run_script').invoke({ command: `touch ${marker}` }))
    expect(out).toMatch(/拒绝|reject|declined|cancel/i)
    expect(existsSync(marker)).toBe(false)
  })

  it('truncates very large output to ~64KB', async () => {
    const tools = buildTools(root, undefined, root, undefined, { requestApproval: allowApproval })
    // emit ~200KB of x's instantly (portable, no slow shell loop)
    const out = String(await byName(tools, 'run_script').invoke({ command: 'head -c 200000 /dev/zero | tr "\\0" x' }))
    expect(out.length).toBeLessThan(70 * 1024)
    expect(out).toMatch(/truncat/i)
  }, 30_000)
})
