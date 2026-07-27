import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  HIP_PRODUCT_VERSION,
  HIP_SKILL_ID,
  HIP_SKILL_MD,
  MEMORY_REFERENCE_MD,
  PRODUCT_SKILL_VERSION,
  TROUBLESHOOTING_REFERENCE_MD,
} from './content.js'
import {
  PRODUCT_CAPABILITY_MAP,
  PRODUCT_HELP_FALLBACK,
  PRODUCT_HELP_GUIDANCE,
  builtinSkillsRoot,
  ensureHipProductSkillDir,
  getBuiltinSkills,
  getProductBuiltinSkills,
  isHipProductSkillAvailable,
  productContentFingerprint,
  productHelpBlock,
  productStampValue,
} from './builtin-skills.js'
import { buildSystemPrompt, skillsBlock } from '../system-prompt.js'
import { mergeSkills, readSkillBody } from '../skills/registry.js'

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

  it('materializes SKILL.md + all L3 references under HIP_DATA_DIR', () => {
    const dir = ensureHipProductSkillDir()
    expect(dir).toBe(join(dataDir, 'builtin-skills', HIP_SKILL_ID))
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(dir, 'references', 'memory.md'))).toBe(true)
    expect(existsSync(join(dir, 'references', 'config-and-data.md'))).toBe(true)
    expect(existsSync(join(dir, 'references', 'troubleshooting.md'))).toBe(true)
    expect(existsSync(join(dir, 'references', 'agents-and-plugins.md'))).toBe(true)
    expect(readFileSync(join(dir, '.stamp'), 'utf8').trim()).toBe(productStampValue())
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe(HIP_SKILL_MD)
    expect(readFileSync(join(dir, 'references', 'memory.md'), 'utf8')).toBe(MEMORY_REFERENCE_MD)
    expect(readFileSync(join(dir, 'references', 'troubleshooting.md'), 'utf8')).toBe(
      TROUBLESHOOTING_REFERENCE_MD,
    )
  })

  it('rewrites dirty on-disk SKILL.md even when stamp was not updated', () => {
    const dir = ensureHipProductSkillDir()
    writeFileSync(join(dir, 'SKILL.md'), '# corrupted\n', 'utf8')
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('# corrupted\n')
    const again = ensureHipProductSkillDir()
    expect(again).toBe(dir)
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe(HIP_SKILL_MD)
  })

  it('is idempotent when stamp and files match', () => {
    const a = ensureHipProductSkillDir()
    const b = ensureHipProductSkillDir()
    expect(a).toBe(b)
    expect(productContentFingerprint().length).toBeGreaterThanOrEqual(16)
    expect(getProductBuiltinSkills()).toHaveLength(1)
  })

  it('getProductBuiltinSkills returns hip meta with L3 flag and progressive L2 body', () => {
    const skills = getProductBuiltinSkills()
    expect(skills).toHaveLength(1)
    const hip = skills[0]!
    expect(hip.id).toBe('hip')
    expect(hip.name).toBe('hip')
    expect(hip.autoInvoke).toBe(true)
    expect(hip.hasReferences).toBe(true)
    expect(hip.dir).toBe(join(builtinSkillsRoot(), 'hip'))
    const body = readSkillBody(hip.dir)
    expect(body).toMatch(/Progressive disclosure/i)
    expect(body).toContain(HIP_PRODUCT_VERSION)
    expect(body).toMatch(/troubleshooting/i)
    expect(body).not.toMatch(/^---/)
  })

  it('getBuiltinSkills includes product hip and operational hip-coding', () => {
    const skills = getBuiltinSkills()
    expect(skills.map((s) => s.id).sort()).toEqual(['hip', 'hip-coding'])
    expect(skills.every((s) => s.scope === 'builtin')).toBe(true)
  })
})

describe('product L0 help conditioning', () => {
  it('productHelpBlock switches on skill availability', () => {
    expect(productHelpBlock(true)).toBe(PRODUCT_HELP_GUIDANCE)
    expect(productHelpBlock(false)).toBe(PRODUCT_HELP_FALLBACK)
    expect(productHelpBlock(true)).toMatch(/use_skill\(\{ name: "hip" \}\)/)
    expect(productHelpBlock(false)).not.toMatch(/use_skill\(\{ name: "hip" \}\)/)
  })

  it('isHipProductSkillAvailable matches id or name', () => {
    expect(isHipProductSkillAvailable(undefined)).toBe(false)
    expect(isHipProductSkillAvailable([])).toBe(false)
    expect(
      isHipProductSkillAvailable([
        { id: 'hip', name: 'hip', description: 'x', dir: '/d', hasScripts: false },
      ]),
    ).toBe(true)
    expect(
      isHipProductSkillAvailable([
        { id: 'other', name: 'hip', description: 'x', dir: '/d', hasScripts: false },
      ]),
    ).toBe(true)
  })
})

describe('product progressive disclosure in system prompt', () => {
  it('always injects capability map; help guidance only when hip skill is listed', () => {
    const without = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(without).toContain(PRODUCT_CAPABILITY_MAP)
    expect(without).toContain(PRODUCT_HELP_FALLBACK)
    expect(without).not.toMatch(/use_skill\(\{ name: "hip" \}\)/)
    expect(without).toContain(HIP_PRODUCT_VERSION)
    expect(without).toMatch(/auth\.json/)
    expect(without).toMatch(/off by default/)
    expect(without).not.toMatch(/## Progressive disclosure/)

    const prev = process.env.HIP_DATA_DIR
    const dataDir = mkdtempSync(join(tmpdir(), 'hip-prompt-skills-'))
    process.env.HIP_DATA_DIR = dataDir
    try {
      const skills = getProductBuiltinSkills()
      const withHip = buildSystemPrompt({ cwd: '/tmp/proj', skills })
      expect(withHip).toContain(PRODUCT_HELP_GUIDANCE)
      expect(withHip).toMatch(/use_skill\(\{ name: "hip" \}\)/)
      expect(withHip).toMatch(/^## Skills$/m)
      expect(withHip).toContain('hip')
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
      const builtin = getProductBuiltinSkills()
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
      const block = skillsBlock(getProductBuiltinSkills(), '/tmp/proj')
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
