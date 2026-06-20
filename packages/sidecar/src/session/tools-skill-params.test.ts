import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillMeta } from '@hip/protocol'
import { buildTools, substituteSkillBody } from './tools.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-toolsx-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function byName(tools: ReturnType<typeof buildTools>, name: string) {
  return tools.find((t) => t.name === name)!
}

function makeSkill(
  id: string,
  name: string,
  body: string,
  skillArgs?: SkillMeta['arguments'],
): SkillMeta {
  const dir = join(root, 'skills', id)
  mkdirSync(dir, { recursive: true })
  const argsYaml = skillArgs
    ? `arguments:\n${skillArgs.map((a) => `  - name: ${a.name}`).join('\n')}\n`
    : ''
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n${argsYaml}description: d\n---\n${body}`, 'utf8')
  return { id, name, description: 'd', dir, hasScripts: false, arguments: skillArgs }
}

describe('substituteSkillBody', () => {
  it('leaves body unchanged when no arguments provided', () => {
    const result = substituteSkillBody('Hello $0 world', undefined, undefined, '/tmp/skill', undefined)
    expect(result).toBe('Hello $0 world')
  })

  it('replaces $0, $1 with positional arguments', () => {
    const result = substituteSkillBody('Format $0 with $1', 'hello world', undefined, '/tmp/skill', undefined)
    expect(result).toContain('Format hello with world')
  })

  it('replaces $ARGUMENTS with full arguments string', () => {
    const result = substituteSkillBody('Args: $ARGUMENTS', 'a b c', undefined, '/tmp/skill', undefined)
    expect(result).toContain('Args: a b c')
  })

  it('handles named arguments from skillArgs via positional ordering', () => {
    const skillArgs = [
      { name: 'file', description: 'File to process' },
      { name: 'style', description: 'Style guide' },
    ]
    const result = substituteSkillBody('Process $file using $style', 'src/index.ts prettier', skillArgs, '/tmp/skill', undefined)
    expect(result).toContain('Process src/index.ts using prettier')
  })

  it('handles named arguments from skillArgs via key=value pairs', () => {
    const skillArgs = [
      { name: 'file', description: 'File to process' },
      { name: 'style', description: 'Style guide' },
    ]
    const result = substituteSkillBody('Process $file using $style', 'file=src/app.ts style=eslint', skillArgs, '/tmp/skill', undefined)
    expect(result).toContain('Process src/app.ts using eslint')
  })

  it('preserves quoted multi-word arguments as single tokens', () => {
    const result = substituteSkillBody('$0 then $1', '"hello world" goodbye', undefined, '/tmp/skill', undefined)
    expect(result).toContain('hello world then goodbye')
  })

  it('preserves quoted multi-word with $0 and $1', () => {
    const result = substituteSkillBody('Msg: $0', '"hello world"', undefined, '/tmp/skill', undefined)
    expect(result).toContain('Msg: hello world')
  })

  it('escapes \\$ to literal $ (no args, no substitution)', () => {
    const result = substituteSkillBody('Cost: \\$5.00', undefined, undefined, '/tmp/skill', undefined)
    // \\$ becomes literal $, and $5 is NOT substituted since no args
    expect(result).toBe('Cost: $5.00')
  })

  it('escapes \\$ to literal $ with args (auto-append still fires)', () => {
    const result = substituteSkillBody('Cost: \\$5.00', 'ignored', undefined, '/tmp/skill', undefined)
    // \\$ becomes literal $5.00, auto-append fires because $ARGUMENTS is not in body
    expect(result).toContain('Cost: $5.00')
    expect(result).toContain('Arguments: ignored')
  })

  it('auto-appends arguments when no $ARGUMENTS reference exists', () => {
    const result = substituteSkillBody('Do something with inputs', 'hello world', undefined, '/tmp/skill', undefined)
    expect(result).toContain('Do something with inputs')
    expect(result).toContain('\n\nArguments: hello world')
  })

  it('does not auto-append when $ARGUMENTS is present', () => {
    const result = substituteSkillBody('Args: $ARGUMENTS', 'hello world', undefined, '/tmp/skill', undefined)
    expect(result).toContain('Args: hello world')
    expect(result).not.toContain('\n\nArguments:')
  })

  it('substitutes ${HIP_SKILL_DIR} context variable', () => {
    const result = substituteSkillBody('Dir: ${HIP_SKILL_DIR}', undefined, undefined, '/path/to/my-skill', undefined)
    expect(result).toContain('Dir: /path/to/my-skill')
  })

  it('substitutes ${HIP_SESSION_ID} context variable', () => {
    const result = substituteSkillBody('Session: ${HIP_SESSION_ID}', undefined, undefined, '/tmp/skill', 'ses_abc123')
    expect(result).toContain('Session: ses_abc123')
  })

  it('leaves unknown ${VAR} context variables as-is', () => {
    const result = substituteSkillBody('${UNKNOWN_VAR}', undefined, undefined, '/tmp/skill', undefined)
    expect(result).toBe('${UNKNOWN_VAR}')
  })

  it('leaves out-of-range positional $N as-is', () => {
    const result = substituteSkillBody('First: $0, Second: $1, Third: $2', 'only-one', undefined, '/tmp/skill', undefined)
    expect(result).toContain('First: only-one')
    expect(result).toContain('Second: $1')
    expect(result).toContain('Third: $2')
  })

  it('leaves body unchanged when arguments is empty string', () => {
    const result = substituteSkillBody('Unchanged $0 text', '', undefined, '/tmp/skill', undefined)
    expect(result).toBe('Unchanged $0 text')
  })

  it('handles empty body gracefully', () => {
    const result = substituteSkillBody('', 'some args', undefined, '/tmp/skill', undefined)
    expect(result).toContain('\n\nArguments: some args')
  })
})

describe('use_skill tool (integration)', () => {
  it('substitutes $0, $1 when arguments provided', async () => {
    const skill = makeSkill('fmt', 'fmt', 'Format $0 with $1')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'fmt', arguments: 'hello world' }))
    expect(out).toContain('Format hello with world')
  })

  it('returns skill body unchanged when no arguments provided', async () => {
    const skill = makeSkill('fmt', 'fmt', 'Unmodified $0 body')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'fmt' }))
    expect(out).toContain('Unmodified $0 body')
    expect(out).not.toContain('Arguments:')
  })

  it('backward compat: call without arguments field works', async () => {
    const skill = makeSkill('fmt', 'fmt', 'Plain body')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'fmt' }))
    expect(out).toContain('Plain body')
  })

  it('substitutes $ARGUMENTS with full arguments string', async () => {
    const skill = makeSkill('fmt', 'fmt', 'Args: $ARGUMENTS')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'fmt', arguments: 'a b c' }))
    expect(out).toContain('Args: a b c')
  })

  it('auto-appends arguments when body has no $ARGUMENTS reference', async () => {
    const skill = makeSkill('fmt', 'fmt', 'Plain instructions')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'fmt', arguments: 'hello' }))
    expect(out).toContain('Plain instructions')
    expect(out).toContain('\n\nArguments: hello')
  })

  it('handles quoted multi-word arguments', async () => {
    const skill = makeSkill('fmt', 'fmt', 'First: $0, Second: $1')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'fmt', arguments: '"hello world" simple' }))
    expect(out).toContain('First: hello world')
    expect(out).toContain('Second: simple')
  })

  it('handles named arguments from skill frontmatter', async () => {
    const skill = makeSkill('fmt', 'fmt', 'Process $file with $style', [
      { name: 'file', description: 'Target file' },
      { name: 'style', description: 'Style format' },
    ])
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'fmt', arguments: 'src/main.ts gofmt' }))
    expect(out).toContain('Process src/main.ts with gofmt')
  })

  it('escapes \\$ to literal $', async () => {
    const skill = makeSkill('fmt', 'fmt', 'Cost: \\$5.00 for $0')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'fmt', arguments: 'burger' }))
    expect(out).toContain('Cost: $5.00 for burger')
  })

  it('substitutes ${HIP_SKILL_DIR} context variable', async () => {
    const skill = makeSkill('fmt', 'fmt', 'Skill at ${HIP_SKILL_DIR}')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'fmt' }))
    expect(out).toContain(`Skill at ${skill.dir}`)
  })

  it('substitutes ${HIP_SESSION_ID} when sessionId is provided', async () => {
    const skill = makeSkill('fmt', 'fmt', 'Session: ${HIP_SESSION_ID}')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill], sessionId: 'ses_test123' })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'fmt' }))
    expect(out).toContain('Session: ses_test123')
  })

  it('reports error for unknown skill by name', async () => {
    const skill = makeSkill('fmt', 'fmt', 'body')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'nope', arguments: 'stuff' }))
    expect(out).toMatch(/not found|不存在/i)
  })

  it('discloses absolute skill dir even with substituted body', async () => {
    const skill = makeSkill('fmt', 'fmt', 'Hello $0', [{ name: 'target', description: 'Target' }])
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'fmt', arguments: 'world' }))
    expect(out).toContain(skill.dir)
  })

  it('single-quote wrapped arguments are also supported', async () => {
    const skill = makeSkill('fmt', 'fmt', 'First: $0, Second: $1')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'fmt', arguments: "'hello world' simple" }))
    expect(out).toContain('First: hello world')
    expect(out).toContain('Second: simple')
  })
})
