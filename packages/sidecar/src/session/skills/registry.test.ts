// packages/sidecar/src/session/skills/registry.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readEnabledSkills } from './registry.js'

const dirs: string[] = []

/** Make a temp ~/.hip/skills root with one skill folder + SKILL.md content. */
function makeSkillsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hip-skills-'))
  dirs.push(root)
  return root
}
function addSkill(root: string, folder: string, skillMd: string, extra?: { scripts?: boolean }): string {
  const dir = join(root, folder)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), skillMd)
  if (extra?.scripts) {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'run.sh'), 'echo hi\n')
  }
  return dir
}
function fm(name: string, description: string): string {
  return ['---', `name: ${name}`, `description: ${description}`, '---', '', 'Body text.'].join('\n')
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.HIP_SKILLS_DIR
  delete process.env.HIP_SKILLS_PATH
})

describe('readEnabledSkills', () => {
  it('returns [] when HIP_SKILLS_DIR is unset', () => {
    delete process.env.HIP_SKILLS_DIR
    expect(readEnabledSkills()).toEqual([])
  })

  it('returns [] when the skills dir does not exist', () => {
    process.env.HIP_SKILLS_DIR = join(tmpdir(), 'hip-skills-does-not-exist-xyz')
    expect(readEnabledSkills()).toEqual([])
  })

  it('parses a skill with frontmatter into a SkillMeta', () => {
    const root = makeSkillsRoot()
    const dir = addSkill(root, 'pdf-filler', fm('PDF Filler', 'Fill PDF forms.'))
    process.env.HIP_SKILLS_DIR = root
    const skills = readEnabledSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0]).toEqual({
      id: 'pdf-filler',
      name: 'PDF Filler',
      description: 'Fill PDF forms.',
      dir,
      hasScripts: false,
    })
  })

  it('uses the folder name as the id', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'my-cool-skill', fm('Totally Different Name', 'desc'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].id).toBe('my-cool-skill')
  })

  it('detects hasScripts when a scripts/ subdir exists', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'with-scripts', fm('With Scripts', 'desc'), { scripts: true })
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].hasScripts).toBe(true)
  })

  it('skips folders without a SKILL.md', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'good', fm('Good', 'desc'))
    mkdirSync(join(root, 'empty-folder'), { recursive: true })
    process.env.HIP_SKILLS_DIR = root
    const skills = readEnabledSkills()
    expect(skills.map((s) => s.id)).toEqual(['good'])
  })

  it('skips a SKILL.md whose frontmatter has no name', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'good', fm('Good', 'desc'))
    addSkill(root, 'nameless', ['---', 'description: no name here', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['good'])
  })

  it('treats a skill missing from the enabled map as enabled', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'a', fm('A', 'da'))
    process.env.HIP_SKILLS_DIR = root
    const cfgDir = mkdtempSync(join(tmpdir(), 'hip-skills-cfg-'))
    dirs.push(cfgDir)
    const cfgPath = join(cfgDir, 'hip-skills.json')
    writeFileSync(cfgPath, JSON.stringify({ enabled: {} }))
    process.env.HIP_SKILLS_PATH = cfgPath
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['a'])
  })

  it('excludes a skill explicitly disabled in the enabled map', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'a', fm('A', 'da'))
    addSkill(root, 'b', fm('B', 'db'))
    process.env.HIP_SKILLS_DIR = root
    const cfgDir = mkdtempSync(join(tmpdir(), 'hip-skills-cfg-'))
    dirs.push(cfgDir)
    const cfgPath = join(cfgDir, 'hip-skills.json')
    writeFileSync(cfgPath, JSON.stringify({ enabled: { b: false } }))
    process.env.HIP_SKILLS_PATH = cfgPath
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['a'])
  })

  it('ignores a corrupt enabled map and treats all skills as enabled', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'a', fm('A', 'da'))
    process.env.HIP_SKILLS_DIR = root
    const cfgDir = mkdtempSync(join(tmpdir(), 'hip-skills-cfg-'))
    dirs.push(cfgDir)
    const cfgPath = join(cfgDir, 'hip-skills.json')
    writeFileSync(cfgPath, 'not-json{{')
    process.env.HIP_SKILLS_PATH = cfgPath
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['a'])
  })

  it('returns skills sorted by id for stable ordering', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'zebra', fm('Zebra', 'dz'))
    addSkill(root, 'alpha', fm('Alpha', 'da'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['alpha', 'zebra'])
  })
})
