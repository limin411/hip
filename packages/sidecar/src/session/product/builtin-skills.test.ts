import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PRODUCT_SKILL_VERSION,
  HIP_SKILL_ID,
  HIP_SKILL_MD,
  MEMORY_REFERENCE_MD,
} from './content.js'
import {
  PRODUCT_HELP_GUIDANCE,
  builtinSkillsRoot,
  ensureHipProductSkillDir,
  getBuiltinSkills,
} from './builtin-skills.js'
import { buildSystemPrompt, skillsBlock } from '../system-prompt.js'
import { mergeSkills } from '../skills/registry.js'
import { readSkillBody } from '../skills/registry.js'

describe('builtin product skill materialization', () => {
  const prevDataDir = process.env.HIP_DATA_DIR
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'hip-builtin-skills-'))
    process.env.HIP_DATA_DIR = dataDir
  })

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.HIP_DATA_DIR
    else process.env.HIP_DATA_DIR = prevDataDir
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('materializes SKILL.md + L3 references under HIP_DATA_DIR', () => {
    const dir = ensureHipProductSkillDir()
    expect(dir).toBe(join(dataDir, 'builtin-skills', HIP_SKILL_ID))
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, 'references', 'memory.md'))).toBe(true)
    expect(existsSync(join(dir, 'references', 'config-and-data.md'))).toBe(true)
    expect(readFileSync(join(dir, '.version'), 'utf8').trim()).toBe(PRODUCT_SKILL_VERSION)
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe(HIP_SKILL_MD)
    expect(readFileSync(join(dir, 'references', 'memory.md'), 'utf8')).toBe(MEMORY_REFERENCE_MD)
  })

  it('is idempotent at the same version', () => {
    const a = ensureHipProductSkillDir()
    const b = ensureHipProductSkillDir()
    expect(a).toBe(b)
    expect(getBuiltinSkills()).toHaveLength(1)
  })

  it('getBuiltinSkills returns hip meta with absolute dir and L3 flag', () => {
    const skills = getBuiltinSkills()
    expect(skills).toHaveLength(1)
    const hip = skills[0]!
    expect(hip.id).toBe('hip')
    expect(hip.name).toBe('hip')
    expect(hip.autoInvoke).toBe(true)
    expect(hip.hasReferences).toBe(true)
    expect(hip.dir).toBe(join(builtinSkillsRoot(), 'hip'))
    expect(hip.description.toLowerCase()).toMatch(/product|settings|memory|skill/)
    // use_skill body is progressive Level 2
    const body = readSkillBody(hip.dir)
    expect(body).toMatch(/Progressive disclosure/i)
    expect(body).toMatch(/Level 3/i)
    expect(body).not.toMatch(/^---/) // frontmatter stripped
  })
})

describe('product progressive disclosure in system prompt', () => {
  it('always injects a compact product help pointer (not the full skill body)', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).toContain(PRODUCT_HELP_GUIDANCE)
    expect(s).toMatch(/use_skill\(\{ name: "hip" \}\)/)
    // Full Level-2 body stays out of the base prompt
    expect(s).not.toMatch(/## Progressive disclosure/)
    expect(s).not.toContain(MEMORY_REFERENCE_MD.slice(0, 40))
  })

  it('lists hip at Level 1 when builtin skill is in the skills list', () => {
    const prev = process.env.HIP_DATA_DIR
    const dataDir = mkdtempSync(join(tmpdir(), 'hip-prompt-skills-'))
    process.env.HIP_DATA_DIR = dataDir
    try {
      const skills = getBuiltinSkills()
      const s = buildSystemPrompt({ cwd: '/tmp/proj', skills })
      expect(s).toMatch(/^## Skills$/m)
      expect(s).toContain('hip')
      expect(s).toMatch(/Product help for the hip desktop agent/i)
      // Still not dumping L3
      expect(s).not.toMatch(/HIP_DATA_DIR/)
    } finally {
      if (prev === undefined) delete process.env.HIP_DATA_DIR
      else process.env.HIP_DATA_DIR = prev
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('user/global skill with same id overrides builtin via mergeSkills', () => {
    const prev = process.env.HIP_DATA_DIR
    const dataDir = mkdtempSync(join(tmpdir(), 'hip-merge-skills-'))
    process.env.HIP_DATA_DIR = dataDir
    try {
      const builtin = getBuiltinSkills()
      const override = {
        ...builtin[0]!,
        description: 'User-overridden hip skill',
        dir: '/tmp/user-hip-skill',
      }
      const merged = mergeSkills(builtin, [override])
      expect(merged).toHaveLength(1)
      expect(merged[0]!.description).toBe('User-overridden hip skill')
      expect(merged[0]!.dir).toBe('/tmp/user-hip-skill')
    } finally {
      if (prev === undefined) delete process.env.HIP_DATA_DIR
      else process.env.HIP_DATA_DIR = prev
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('skillsBlock omits full SKILL body (L1 only)', () => {
    const prev = process.env.HIP_DATA_DIR
    const dataDir = mkdtempSync(join(tmpdir(), 'hip-l1-only-'))
    process.env.HIP_DATA_DIR = dataDir
    try {
      const block = skillsBlock(getBuiltinSkills(), '/tmp/proj')
      expect(block).toContain('hip')
      expect(block).toMatch(/use_skill/)
      expect(block).not.toMatch(/Permission modes/)
      expect(block).not.toMatch(/~\/\.hip\/db/)
    } finally {
      if (prev === undefined) delete process.env.HIP_DATA_DIR
      else process.env.HIP_DATA_DIR = prev
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
