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

// Decisions carry the SEMANTIC kind (mirrors PermissionOption.kind / PermissionModal), not an
// opaque optionId — so the allow-vs-reject seam can't be fooled by an agent/UI optionId like 'once'.
const allowApproval: ApprovalFn = async () => ({ kind: 'allow_once' })
const rejectApproval: ApprovalFn = async () => ({ kind: 'reject_once' })

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

describe('use_skill + read_file bundled files (skill dir OUTSIDE the project root)', () => {
  // Regression: enabled skills live at HIP_SKILLS_DIR/<id> = ~/.hip/skills/<id>, DISJOINT from the
  // session project root. use_skill must disclose the ABSOLUTE skill dir + absolute file paths, and
  // read_file must reach bundled reference files there — even though it is jailed to the project root
  // for everything else.
  let skillRoot: string
  beforeEach(() => { skillRoot = mkdtempSync(join(tmpdir(), 'hip-skilldir-')) })
  afterEach(() => { rmSync(skillRoot, { recursive: true, force: true }) })

  function makeExternalSkill(id: string, name: string, body: string): SkillMeta {
    const dir = join(skillRoot, id)
    mkdirSync(join(dir, 'references'), { recursive: true })
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n${body}`, 'utf8')
    writeFileSync(join(dir, 'references', 'note.md'), 'BUNDLED NOTE CONTENT', 'utf8')
    writeFileSync(join(dir, 'scripts', 'run.sh'), 'echo run', 'utf8')
    return { id, name, description: 'd', dir, hasScripts: true }
  }

  it('use_skill discloses the absolute skill dir and absolute file paths', async () => {
    const skill = makeExternalSkill('ref', 'ref', 'See references/note.md.')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'ref' }))
    expect(out).toContain(skill.dir)
    expect(out).toContain(join(skill.dir, 'references', 'note.md'))
  })

  it('read_file reads a bundled reference file via its absolute path (outside the project root)', async () => {
    const skill = makeExternalSkill('ref', 'ref', 'body')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const abs = join(skill.dir, 'references', 'note.md')
    const out = String(await byName(tools, 'read_file').invoke({ path: abs }))
    expect(out).toBe('BUNDLED NOTE CONTENT')
  })

  it('read_file still rejects an absolute path that is neither under a skill dir nor the project root', async () => {
    const skill = makeExternalSkill('ref', 'ref', 'body')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    // A sibling temp file outside both skillRoot/<id> and the project root.
    const outside = mkdtempSync(join(tmpdir(), 'hip-outside-'))
    try {
      const secret = join(outside, 'secret.txt')
      writeFileSync(secret, 'TOP SECRET', 'utf8')
      const out = String(await byName(tools, 'read_file').invoke({ path: secret }))
      expect(out).not.toContain('TOP SECRET')
      expect(out).toMatch(/not found|escapes|Error/i)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
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

  it('executes for any allow_* kind regardless of the opaque optionId', async () => {
    // Regression: the agent/UI optionId is opaque (e.g. the mock ACP agent advertises 'once');
    // the allow-vs-reject semantic lives in kind. A real Allow click must still run the script —
    // keying off optionId literals ('allow_once') would silently treat this as a rejection.
    const realRoundTrip: ApprovalFn = async () => ({ kind: 'allow_always' })
    const tools = buildTools(root, undefined, root, undefined, { requestApproval: realRoundTrip })
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
