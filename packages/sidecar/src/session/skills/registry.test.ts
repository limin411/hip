// packages/sidecar/src/session/skills/registry.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readEnabledSkills, readProjectSkills, mergeSkills, readSkillBody, listSkillFiles } from './registry.js'

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

/** Make a temp project root with .hip/skills/ subdirectory. */
function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hip-project-'))
  dirs.push(root)
  return root
}
function addProjectSkill(root: string, folder: string, skillMd: string): string {
  const skillsDir = join(root, '.hip', 'skills')
  mkdirSync(skillsDir, { recursive: true })
  const dir = join(skillsDir, folder)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), skillMd)
  return dir
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.HIP_SKILLS_DIR
  delete process.env.HIP_CONFIG_PATH
})

/** Write a global hip.toml with the given skill enablement map. */
function setGlobalSkillsConfig(enabled: Record<string, boolean>) {
  const cfgDir = mkdtempSync(join(tmpdir(), 'hip-skills-cfg-'))
  dirs.push(cfgDir)
  const entries = Object.entries(enabled).map(([id, on]) => ({ id, enabled: on }))
  const toml = `version = 1\n\n[[skills]]\n${entries.map((e) => `id = "${e.id}"\nenabled = ${e.enabled}`).join('\n\n[[skills]]\n')}`
  writeFileSync(join(cfgDir, 'hip.toml'), toml)
  process.env.HIP_CONFIG_PATH = join(cfgDir, 'hip.toml')
}

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
    expect(skills[0]).toMatchObject({
      id: 'pdf-filler',
      name: 'PDF Filler',
      description: 'Fill PDF forms.',
      dir,
      hasScripts: false,
      scope: 'global',
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
    setGlobalSkillsConfig({})
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['a'])
  })

  it('excludes a skill explicitly disabled in the enabled map', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'a', fm('A', 'da'))
    addSkill(root, 'b', fm('B', 'db'))
    process.env.HIP_SKILLS_DIR = root
    setGlobalSkillsConfig({ b: false })
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['a'])
  })

  it('ignores a corrupt config and treats all skills as enabled', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'a', fm('A', 'da'))
    process.env.HIP_SKILLS_DIR = root
    const cfgDir = mkdtempSync(join(tmpdir(), 'hip-skills-cfg-'))
    dirs.push(cfgDir)
    writeFileSync(join(cfgDir, 'hip.toml'), 'not valid toml {{{')
    process.env.HIP_CONFIG_PATH = join(cfgDir, 'hip.toml')
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['a'])
  })

  it('returns skills sorted by id for stable ordering', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'zebra', fm('Zebra', 'dz'))
    addSkill(root, 'alpha', fm('Alpha', 'da'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['alpha', 'zebra'])
  })

  it('tags global skills with scope: global', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'test', fm('Test', 'desc'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].scope).toBe('global')
  })

  it('backward compat: no cwd → returns global only', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'a', fm('A', 'da'))
    process.env.HIP_SKILLS_DIR = root
    const skills = readEnabledSkills()
    expect(skills.map((s) => s.id)).toEqual(['a'])
    expect(skills[0].scope).toBe('global')
  })

  it('merges project skills over global with same id', () => {
    const globalRoot = makeSkillsRoot()
    addSkill(globalRoot, 'my-skill', fm('Global Skill', 'global desc'))
    process.env.HIP_SKILLS_DIR = globalRoot

    const projectRoot = makeProjectRoot()
    addProjectSkill(projectRoot, 'my-skill', fm('Project Skill', 'project desc'))
    const cwd = join(projectRoot, 'src')

    const skills = readEnabledSkills(cwd)
    expect(skills).toHaveLength(1)
    expect(skills[0].id).toBe('my-skill')
    expect(skills[0].name).toBe('Project Skill')
    expect(skills[0].description).toBe('project desc')
    expect(skills[0].scope).toBe('project')
  })

  it('no project dir → falls back to global only', () => {
    const globalRoot = makeSkillsRoot()
    addSkill(globalRoot, 'a', fm('A', 'da'))
    process.env.HIP_SKILLS_DIR = globalRoot

    const emptyDir = makeProjectRoot()
    // No .hip/skills/ dir at all
    const skills = readEnabledSkills(emptyDir)
    expect(skills).toHaveLength(1)
    expect(skills[0].id).toBe('a')
    expect(skills[0].scope).toBe('global')
  })

  it('project dir has no SKILL.md → falls back to global', () => {
    const globalRoot = makeSkillsRoot()
    addSkill(globalRoot, 'a', fm('A', 'da'))
    process.env.HIP_SKILLS_DIR = globalRoot

    const projectRoot = makeProjectRoot()
    // Create .hip/skills/a/ but no SKILL.md
    const emptySkillDir = join(projectRoot, '.hip', 'skills', 'a')
    mkdirSync(emptySkillDir, { recursive: true })

    const skills = readEnabledSkills(projectRoot)
    expect(skills).toHaveLength(1)
    expect(skills[0].id).toBe('a')
    expect(skills[0].scope).toBe('global')
  })

  it('global + project skills with different ids → both appear', () => {
    const globalRoot = makeSkillsRoot()
    addSkill(globalRoot, 'global-1', fm('Global 1', 'g1'))
    process.env.HIP_SKILLS_DIR = globalRoot

    const projectRoot = makeProjectRoot()
    addProjectSkill(projectRoot, 'project-1', fm('Project 1', 'p1'))

    const skills = readEnabledSkills(projectRoot)
    expect(skills.map((s) => s.id)).toEqual(['global-1', 'project-1'])
    const g = skills.find((s) => s.id === 'global-1')!
    const p = skills.find((s) => s.id === 'project-1')!
    expect(g.scope).toBe('global')
    expect(p.scope).toBe('project')
  })

  it('project skill overrides same id with same enabled map', () => {
    const globalRoot = makeSkillsRoot()
    addSkill(globalRoot, 'x', fm('Global X', 'gx'))
    process.env.HIP_SKILLS_DIR = globalRoot

    const projectRoot = makeProjectRoot()
    addProjectSkill(projectRoot, 'x', fm('Project X', 'px'))

    const skills = readEnabledSkills(projectRoot)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('Project X')
    expect(skills[0].scope).toBe('project')
  })

  it('applies default autoInvoke=true when absent', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', fm('S', 'd'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].autoInvoke).toBe(true)
  })

  it('reads autoInvoke: false from frontmatter', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', ['---', 'name: S', 'description: d', 'autoInvoke: false', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].autoInvoke).toBe(false)
  })

  it('applies default userInvocable=true when absent', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', fm('S', 'd'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].userInvocable).toBe(true)
  })

  it('reads userInvocable: false from frontmatter', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', ['---', 'name: S', 'description: d', 'userInvocable: false', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].userInvocable).toBe(false)
  })

  it('parses allowedTools as string array', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', ['---', 'name: S', 'description: d', 'allowedTools:', '  - read_file', '  - write_file', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].allowedTools).toEqual(['read_file', 'write_file'])
  })

  it('allowedTools absent → undefined', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', fm('S', 'd'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].allowedTools).toBeUndefined()
  })

  it('parses disallowedTools as string array', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', ['---', 'name: S', 'description: d', 'disallowedTools:', '  - bash', '  - git_commit', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].disallowedTools).toEqual(['bash', 'git_commit'])
  })

  it('context defaults to inline', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', fm('S', 'd'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].context).toBe('inline')
  })

  it('reads context: fork from frontmatter', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', ['---', 'name: S', 'description: d', 'context: fork', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].context).toBe('fork')
  })

  it('parses paths as string array', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', ['---', 'name: S', 'description: d', 'paths:', '  - "src/**"', '  - "packages/*"', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].paths).toEqual(['src/**', 'packages/*'])
  })

  it('reads model string from frontmatter', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', ['---', 'name: S', 'description: d', 'model: gpt-4o', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].model).toBe('gpt-4o')
  })

  it('reads effort from frontmatter', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', ['---', 'name: S', 'description: d', 'effort: high', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].effort).toBe('high')
  })

  it('ignores invalid effort value', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', ['---', 'name: S', 'description: d', 'effort: super-high', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].effort).toBeUndefined()
  })

  it('reads shell from frontmatter', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', ['---', 'name: S', 'description: d', 'shell: powershell', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].shell).toBe('powershell')
  })

  it('parses arguments from frontmatter', () => {
    const root = makeSkillsRoot()
    const yaml = [
      '---',
      'name: S', 'description: d',
      'arguments:',
      '  - name: target',
      '    description: The target path',
      '    required: true',
      '  - name: verbose',
      '    description: Enable verbose output',
      '---', 'body',
    ].join('\n')
    addSkill(root, 's', yaml)
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].arguments).toEqual([
      { name: 'target', description: 'The target path', required: true },
      { name: 'verbose', description: 'Enable verbose output', required: undefined },
    ])
  })

  it('disableShellExecution defaults to false', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', fm('S', 'd'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].disableShellExecution).toBe(false)
  })

  it('reads disableShellExecution: true from frontmatter', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', ['---', 'name: S', 'description: d', 'disableShellExecution: true', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].disableShellExecution).toBe(true)
  })

  it('detects hasReferences when references/ dir exists', () => {
    const root = makeSkillsRoot()
    const dir = join(root, 's')
    mkdirSync(dir, { recursive: true })
    mkdirSync(join(dir, 'references'), { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), fm('S', 'd'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].hasReferences).toBe(true)
  })

  it('hasReferences defaults to false when no references/ dir', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', fm('S', 'd'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].hasReferences).toBe(false)
  })

  it('detects hasAssets when assets/ dir exists', () => {
    const root = makeSkillsRoot()
    const dir = join(root, 's')
    mkdirSync(dir, { recursive: true })
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), fm('S', 'd'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].hasAssets).toBe(true)
  })

  it('hasAssets defaults to false when no assets/ dir', () => {
    const root = makeSkillsRoot()
    addSkill(root, 's', fm('S', 'd'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].hasAssets).toBe(false)
  })

  it('populates all defaults for a minimal frontmatter', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'min', fm('Minimal', 'Just a description'))
    process.env.HIP_SKILLS_DIR = root
    const s = readEnabledSkills()[0]
    expect(s.autoInvoke).toBe(true)
    expect(s.userInvocable).toBe(true)
    expect(s.context).toBe('inline')
    expect(s.disableShellExecution).toBe(false)
    expect(s.hasReferences).toBe(false)
    expect(s.hasAssets).toBe(false)
    expect(s.allowedTools).toBeUndefined()
    expect(s.disallowedTools).toBeUndefined()
    expect(s.paths).toBeUndefined()
    expect(s.model).toBeUndefined()
    expect(s.effort).toBeUndefined()
    expect(s.shell).toBeUndefined()
    expect(s.arguments).toBeUndefined()
  })
})

describe('readSkillBody', () => {
  it('returns the SKILL.md body with frontmatter stripped', () => {
    const root = makeSkillsRoot()
    const dir = addSkill(
      root,
      'doc',
      ['---', 'name: Doc', 'description: d', '---', '', '# Heading', 'paragraph'].join('\n'),
    )
    expect(readSkillBody(dir)).toBe('# Heading\nparagraph')
  })

  it('returns the whole file when there is no frontmatter', () => {
    const root = makeSkillsRoot()
    const dir = join(root, 'plain')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '# Just a heading\nno frontmatter')
    expect(readSkillBody(dir)).toBe('# Just a heading\nno frontmatter')
  })

  it('returns "" when SKILL.md is missing', () => {
    const root = makeSkillsRoot()
    const dir = join(root, 'ghost')
    mkdirSync(dir, { recursive: true })
    expect(readSkillBody(dir)).toBe('')
  })
})

describe('readProjectSkills', () => {
  it('returns [] when cwd has no project root with .hip/skills', () => {
    const emptyDir = makeProjectRoot()
    const skills = readProjectSkills(emptyDir)
    expect(skills).toEqual([])
  })

  it('returns skills from .hip/skills/ with scope: project', () => {
    const root = makeProjectRoot()
    addProjectSkill(root, 'foo', fm('Foo', 'project skill'))
    const skills = readProjectSkills(root)
    expect(skills).toHaveLength(1)
    expect(skills[0].id).toBe('foo')
    expect(skills[0].scope).toBe('project')
  })

  it('walks up from subdirectory to find project root', () => {
    const root = makeProjectRoot()
    addProjectSkill(root, 'bar', fm('Bar', 'deep'))
    const subdir = join(root, 'src', 'lib', 'deep')
    mkdirSync(subdir, { recursive: true })
    const skills = readProjectSkills(subdir)
    expect(skills).toHaveLength(1)
    expect(skills[0].id).toBe('bar')
    expect(skills[0].scope).toBe('project')
  })

  it('finds git root as project root when .hip/skills is at git root', () => {
    const root = makeProjectRoot()
    mkdirSync(join(root, '.git'), { recursive: true })
    addProjectSkill(root, 'baz', fm('Baz', 'git project'))
    const subdir = join(root, 'src')
    mkdirSync(subdir, { recursive: true })
    const skills = readProjectSkills(subdir)
    expect(skills).toHaveLength(1)
    expect(skills[0].id).toBe('baz')
  })

  it('skips folder without SKILL.md in project dir', () => {
    const root = makeProjectRoot()
    addProjectSkill(root, 'good', fm('Good', 'desc'))
    const skillsDir = join(root, '.hip', 'skills')
    mkdirSync(join(skillsDir, 'empty'), { recursive: true })
    const skills = readProjectSkills(root)
    expect(skills.map((s) => s.id)).toEqual(['good'])
  })

  it('respects enabled map for project skills', () => {
    const root = makeProjectRoot()
    addProjectSkill(root, 'a', fm('A', 'da'))
    addProjectSkill(root, 'b', fm('B', 'db'))
    setGlobalSkillsConfig({ a: false })
    const skills = readProjectSkills(root)
    expect(skills.map((s) => s.id)).toEqual(['b'])
  })
})

describe('mergeSkills', () => {
  function makeMeta(id: string, scope: 'global' | 'project') {
    return { id, scope, name: id, description: '', dir: `/tmp/${id}`, hasScripts: false }
  }

  it('project overrides global when same id', () => {
    const global = [makeMeta('a', 'global')]
    const project = [makeMeta('a', 'project')]
    const merged = mergeSkills(global, project)
    expect(merged).toHaveLength(1)
    expect(merged[0].scope).toBe('project')
  })

  it('combines skills with different ids', () => {
    const global = [makeMeta('g1', 'global')]
    const project = [makeMeta('p1', 'project')]
    const merged = mergeSkills(global, project)
    expect(merged.map((s) => s.id).sort()).toEqual(['g1', 'p1'])
  })

  it('returns project-only when global is empty', () => {
    const project = [makeMeta('p', 'project')]
    const merged = mergeSkills([], project)
    expect(merged).toHaveLength(1)
    expect(merged[0].scope).toBe('project')
  })

  it('returns global-only when project is empty', () => {
    const global = [makeMeta('g', 'global')]
    const merged = mergeSkills(global, [])
    expect(merged).toHaveLength(1)
    expect(merged[0].scope).toBe('global')
  })

  it('returns sorted by id', () => {
    const global = [makeMeta('z', 'global'), makeMeta('a', 'global')]
    const merged = mergeSkills(global, [])
    expect(merged.map((s) => s.id)).toEqual(['a', 'z'])
  })

  it('empty both → empty', () => {
    expect(mergeSkills([], [])).toEqual([])
  })
})

describe('listSkillFiles', () => {
  it('lists files relative to the skill dir, recursively, with forward slashes', () => {
    const root = makeSkillsRoot()
    const dir = join(root, 'multi')
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    mkdirSync(join(dir, 'references'), { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), 'body')
    writeFileSync(join(dir, 'scripts', 'run.sh'), 'echo')
    writeFileSync(join(dir, 'references', 'guide.md'), 'g')
    const files = listSkillFiles(dir).sort()
    expect(files).toEqual(['SKILL.md', 'references/guide.md', 'scripts/run.sh'])
  })

  it('returns [] when the dir does not exist', () => {
    expect(listSkillFiles(join(tmpdir(), 'hip-skills-no-such-dir-zzz'))).toEqual([])
  })

  it('returns [] for an empty dir', () => {
    const root = makeSkillsRoot()
    const dir = join(root, 'empty')
    mkdirSync(dir, { recursive: true })
    expect(listSkillFiles(dir)).toEqual([])
  })
})
