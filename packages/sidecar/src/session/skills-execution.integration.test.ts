import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillMeta, ServerMessage } from '@hip/protocol'
import { readEnabledSkills, readSkillBody } from './skills/registry.js'
import { buildTools } from './tools.js'
import { skillsBlock, SkillUsageTracker } from './system-prompt.js'

let dirs: string[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'hip-sklex-'))
  dirs.push(d)
  return d
}

function yamlValue(v: unknown): string {
  if (typeof v === 'boolean' || v === null) return String(v)
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    // Array of objects (e.g. arguments) → YAML array of object mappings
    if (v.length > 0 && typeof v[0] === 'object' && v[0] !== null) {
      return '\n' + v.map((item) => {
        const entries = Object.entries(item as Record<string, unknown>)
        return '  - ' + entries.map(([sk, sv]) => `${sk}: ${sv}`).join('\n    ')
      }).join('\n')
    }
    // Simple array
    return '\n' + v.map((item) => `  - ${String(item)}`).join('\n')
  }
  return String(v)
}

function writeSkill(
  dir: string,
  id: string,
  name: string,
  description: string,
  frontmatterOverrides: Record<string, unknown> = {},
  body?: string,
): string {
  const skillDir = join(dir, id)
  mkdirSync(skillDir, { recursive: true })
  const fm: Record<string, unknown> = { name, description, ...frontmatterOverrides }
  const fmLines = Object.entries(fm)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${yamlValue(v)}`)
    .join('\n')
  writeFileSync(join(skillDir, 'SKILL.md'), `---\n${fmLines}\n---\n${body ?? `${name} body content`}`, 'utf8')
  return skillDir
}

function resetEnv() {
  delete process.env.HIP_SKILLS_DIR
  delete process.env.HIP_SKILLS_PATH
  delete process.env.HIP_MCP_SERVERS_PATH
  delete process.env.HIP_AGENTS_PATH
  delete process.env.HIP_CONFIG_PATH
}

beforeEach(resetEnv)
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ok */ }
  }
  resetEnv()
})

// ── 1. Skills block: autoInvoke=true appears, autoInvoke=false excluded ──

describe('skills block autoInvoke filtering', () => {
  it('autoInvoke: true (default) skill appears in skills block', () => {
    const base = tmpDir()
    writeSkill(base, 'auto-skill', 'Auto Skill', 'This skill auto-invokes')
    writeSkill(base, 'manual-skill', 'Manual Skill', 'This skill is manual', { autoInvoke: false })

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    // Skills block ONLY includes autoInvoke !== false skills
    const skills = readEnabledSkills()
    const autoSkill = skills.find((s) => s.id === 'auto-skill')!
    const manualSkill = skills.find((s) => s.id === 'manual-skill')!

    // Both are in the full list
    expect(autoSkill).toBeDefined()
    expect(manualSkill).toBeDefined()
    expect(manualSkill.autoInvoke).toBe(false)

    // But only auto-skill appears in the skills block
    const block = skillsBlock(skills)
    expect(block).toContain('Auto Skill')
    expect(block).toContain('This skill auto-invokes')
    expect(block).not.toContain('Manual Skill')
  })

  it('autoInvoke=false skill is in full skill list but NOT in skills block', () => {
    const base = tmpDir()
    writeSkill(base, 'only-manual', 'Only Manual', 'Never auto', { autoInvoke: false })

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    expect(skills.length).toBe(1)

    const block = skillsBlock(skills)
    expect(block).toBe('') // No eligible skills
  })
})

// ── 2. Skills block: budget overflow → LRU eviction ──

describe('skills block budget overflow → LRU eviction', () => {
  it('evicts least-recently-used skill when block exceeds budget', () => {
    const base = tmpDir()
    // Create 5 skills with long-ish descriptions so the block exceeds budget
    const skillNames = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
    for (const id of skillNames) {
      writeSkill(base, id, id.toUpperCase(), `${id} is a skill that does ${id} things and provides ${id} functionality for your project`)
    }

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    expect(skills.length).toBe(5)

    // Full block (no budget) includes all 5
    const fullBlock = skillsBlock(skills)
    expect(fullBlock).toContain('ALPHA')
    expect(fullBlock).toContain('BETA')

    // Budget-aware block: set very small budget so LRU eviction kicks in
    const tracker = new SkillUsageTracker()
    // Manually "use" some skills so they have higher invocation counts
    tracker.recordInvocation('alpha')
    tracker.recordInvocation('alpha')
    tracker.recordInvocation('beta')
    // gamma, delta, epsilon have 0 invocations — they'll be evicted first

    // Budget that fits ~2 skills (header ~160 + 2 lines ~140 = 300)
    const budgetBlock = skillsBlock(skills, undefined, { budget: 350, tracker })
    expect(budgetBlock).toContain('ALPHA')
    expect(budgetBlock).toContain('BETA')
    const evicted = ['GAMMA', 'DELTA', 'EPSILON'].filter((name) => !budgetBlock.includes(name))
    expect(evicted.length).toBeGreaterThan(0)
  })

  it('with very tight budget, only most-used skills survive', () => {
    const base = tmpDir()
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      writeSkill(base, id, `Skill ${id.toUpperCase()}`, `Description for skill ${id} with some extra text to make it longer`)
    }

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    expect(skills.length).toBe(8)

    const tracker = new SkillUsageTracker()
    // Only 'a' and 'b' are frequently used
    tracker.recordInvocation('a')
    tracker.recordInvocation('a')
    tracker.recordInvocation('b')

    // Very tight budget — only 1-2 skills should fit
    const budgetBlock = skillsBlock(skills, undefined, { budget: 300, tracker })
    expect(budgetBlock).toContain('A')
    expect(budgetBlock).toContain('B')
    const remainingCount = (budgetBlock.match(/- /g) ?? []).length
    expect(remainingCount).toBeLessThan(5)
  })

  it('empty block when budget is too small for any skill', () => {
    const base = tmpDir()
    writeSkill(base, 'x', 'X', 'A skill with a very long description that will not fit in a tiny budget')

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    const block = skillsBlock(skills, undefined, { budget: 50 })
    // Header alone is > 50 chars, so entire block is empty
    expect(block).toBe('')
  })
})

// ── 3. use_skill tool invocation (progressive disclosure) ──

describe('use_skill progressive disclosure', () => {
  it('use_skill returns skill body content (Level 2)', async () => {
    const base = tmpDir()
    writeSkill(base, 'test-skill', 'Test Skill', 'A test skill', {}, 'This is the full skill body with instructions.')

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills, sessionId: 's1' })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    const result = String(await useSkill.invoke({ name: 'Test Skill' }))
    expect(result).toContain('This is the full skill body with instructions.')
    expect(result).toContain('Skill dir:')
  })

  it('use_skill returns error for unknown skill', async () => {
    const base = tmpDir()
    writeSkill(base, 'known', 'Known', 'A known skill')

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    const result = String(await useSkill.invoke({ name: 'nonexistent' }))
    expect(result).toContain('Error: skill not found')
  })

  it('use_skill resolves by id as well as name', async () => {
    const base = tmpDir()
    writeSkill(base, 'my-id', 'My Display Name', 'Desc', {}, 'Content by id')

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    const byId = String(await useSkill.invoke({ name: 'my-id' }))
    expect(byId).toContain('Content by id')

    const byName = String(await useSkill.invoke({ name: 'My Display Name' }))
    expect(byName).toContain('Content by id')
  })

  it('use_skill includes file manifest (Level 3)', async () => {
    const base = tmpDir()
    const skillDir = writeSkill(base, 'with-files', 'With Files', 'Has bundled files', {}, 'Main instructions')
    // Add some bundled files
    mkdirSync(join(skillDir, 'references'), { recursive: true })
    writeFileSync(join(skillDir, 'references', 'api-docs.md'), '# API Docs', 'utf8')
    mkdirSync(join(skillDir, 'assets'), { recursive: true })
    writeFileSync(join(skillDir, 'assets', 'logo.svg'), '<svg></svg>', 'utf8')

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    const result = String(await useSkill.invoke({ name: 'With Files' }))
    expect(result).toContain('Main instructions')
    expect(result).toContain('Bundled resources')
    expect(result).toContain('references/api-docs.md')
    expect(result).toContain('assets/logo.svg')
  })
})

// ── 4. Skill argument substitution ──

describe('skill argument substitution', () => {
  it('substitutes positional $0/$1 and named $arg in skill body', async () => {
    const base = tmpDir()
    writeSkill(base, 'greet', 'Greeter', 'Greets someone', {
      arguments: [
        { name: 'name', description: 'Who to greet' },
        { name: 'style', description: 'Greeting style' },
      ],
    }, 'Hello $name! Your style is $style. Positional: $0, $1')

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills, sessionId: 's-test' })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    // Positional args via arguments string
    const result = String(await useSkill.invoke({ name: 'Greeter', arguments: 'Alice casual' }))
    expect(result).toContain('Hello Alice!')
    expect(result).toContain('Your style is casual.')
    expect(result).toContain('Positional: Alice, casual')
  })

  it('substitutes $ARGUMENTS in skill body', async () => {
    const base = tmpDir()
    writeSkill(base, 'echo', 'Echo', 'Echoes arguments', {}, 'Arguments received: $ARGUMENTS')

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    const result = String(await useSkill.invoke({ name: 'Echo', arguments: 'foo bar baz' }))
    expect(result).toContain('Arguments received: foo bar baz')
  })

  it('substitutes ${HIP_SKILL_DIR} and ${HIP_SESSION_ID}', async () => {
    const base = tmpDir()
    const skillDir = writeSkill(base, 'ctx', 'Context', 'Context test', {}, 'Dir: ${HIP_SKILL_DIR}, Session: ${HIP_SESSION_ID}')

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills, sessionId: 'my-session-123' })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    const result = String(await useSkill.invoke({ name: 'Context' }))
    expect(result).toContain(`Dir: ${skillDir}`)
    expect(result).toContain('Session: my-session-123')
  })
})

// ── 5. Progressive disclosure: !`cmd` execution ──

describe('progressive disclosure: !`cmd` dynamic context', () => {
  it('resolves !`echo hello` inline command in skill body', async () => {
    const base = tmpDir()
    writeSkill(base, 'cmd-skill', 'Cmd Skill', 'Runs a command', {}, 'The result is: !`echo hello`')

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    const result = String(await useSkill.invoke({ name: 'Cmd Skill' }))
    expect(result).toContain('hello')
  })

  it('disableShellExecution prevents !`cmd` from executing', async () => {
    const base = tmpDir()
    writeSkill(base, 'no-cmd', 'No Cmd', 'Shell disabled', { disableShellExecution: true }, 'Result: !`echo executed_output`')

    const skillsCfg = join(base, 'skills.json')
    writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
    process.env.HIP_SKILLS_DIR = base
    process.env.HIP_SKILLS_PATH = skillsCfg

    const skills = readEnabledSkills()
    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    const result = String(await useSkill.invoke({ name: 'No Cmd' }))
    // Body returned as-is: !`cmd` is NOT executed, just literal text
    expect(result).toContain('!`echo executed_output`')
    expect(result).not.toContain('executed_output:') // Not command output format
  })
})

// ── 6. readSkillBody returns content without frontmatter ──

describe('readSkillBody stripping', () => {
  it('returns body without frontmatter', () => {
    const base = tmpDir()
    const skillDir = writeSkill(base, 'strip', 'Strip Test', 'Tests stripping', {}, 'Pure body content here')

    const body = readSkillBody(skillDir)
    expect(body).toBe('Pure body content here')
    expect(body).not.toContain('---')
    expect(body).not.toContain('name:')
  })

  it('returns empty string for missing SKILL.md', () => {
    const body = readSkillBody('/nonexistent/path/to/skill')
    expect(body).toBe('')
  })
})
