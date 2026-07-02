import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillMeta } from '@hip/protocol'
import { buildTools } from './tools.js'
import { parsePluginManifest, PluginManifestError } from './plugins/parser.js'
import { synthesizePlugin } from './plugins/synthesizer.js'
import { readPluginsConfig } from '../config/plugins.js'
import { parseFrontmatter } from './skills/frontmatter.js'
import { extractSkillMetaFromData } from './skills/registry.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePluginDir = join(here, '..', '..', '..', '..', 'e2e', 'fixtures', 'sample-plugin')

let dirs: string[] = []
let originalPluginsPath: string | undefined

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'hip-plugin-skill-'))
  dirs.push(d)
  return d
}

function loadPluginSkills(pluginDir: string): SkillMeta[] {
  const manifest = parsePluginManifest(pluginDir)
  const synth = synthesizePlugin(manifest)
  const skills: SkillMeta[] = []
  for (const se of synth.skills) {
    const skillMd = join(se.dir, 'SKILL.md')
    const raw = readFileSync(skillMd, 'utf8')
    const { data } = parseFrontmatter(raw)
    const name = typeof data.name === 'string' ? data.name.trim() : undefined
    if (!name) continue
    skills.push({
      id: se.id,
      name,
      description: typeof data.description === 'string' ? data.description.trim() : '',
      dir: se.dir,
      pluginId: manifest.id,
      ...extractSkillMetaFromData(se.dir, data),
    })
  }
  return skills
}

beforeEach(() => {
  originalPluginsPath = process.env.HIP_PLUGINS_PATH
  const dir = tmpDir()
  const pluginsJson = join(dir, 'plugins.json')
  writeFileSync(pluginsJson, JSON.stringify({ plugins: [fixturePluginDir] }), 'utf8')
  process.env.HIP_PLUGINS_PATH = pluginsJson
})

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ok */ }
  }
  if (originalPluginsPath === undefined) {
    delete process.env.HIP_PLUGINS_PATH
  } else {
    process.env.HIP_PLUGINS_PATH = originalPluginsPath
  }
})

describe('fixture plugin skills load through use_skill', () => {
  it('use_skill returns sample-greet body and skill dir', async () => {
    const pluginDirs = readPluginsConfig().plugins
    expect(pluginDirs).toContain(fixturePluginDir)

    const skills = pluginDirs.flatMap((dir) => loadPluginSkills(dir))
    expect(skills.some((s) => s.name === 'sample-greet')).toBe(true)

    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills, sessionId: 'test-session' })
    const useSkill = tools.find((t) => t.name === 'use_skill')!
    expect(useSkill).toBeDefined()

    const result = String(await useSkill.invoke({ name: 'sample-greet' }))
    expect(result).toContain('Hello! Greet the user.')
    expect(result).toContain('Skill dir:')
  })

  it('use_skill returns sample-format manifest with references/style-guide.md', async () => {
    const pluginDirs = readPluginsConfig().plugins
    const skills = pluginDirs.flatMap((dir) => loadPluginSkills(dir))
    expect(skills.some((s) => s.name === 'sample-format')).toBe(true)

    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills, sessionId: 'test-session' })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    const result = String(await useSkill.invoke({ name: 'sample-format' }))
    expect(result).toContain('references/style-guide.md')
  })

  it('use_skill returns error for missing skill', async () => {
    const pluginDirs = readPluginsConfig().plugins
    const skills = pluginDirs.flatMap((dir) => loadPluginSkills(dir))

    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills, sessionId: 'test-session' })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    const result = String(await useSkill.invoke({ name: 'missing-skill' }))
    expect(result).toContain('Error: skill not found')
  })

  it('parsePluginManifest throws PluginManifestError for invalid plugin', () => {
    expect(() => parsePluginManifest(join(tmpdir(), 'nonexistent-plugin-' + Date.now()))).toThrow(PluginManifestError)
  })
})

describe('fixture skill argument substitution', () => {
  it('substitutes $file, $style, $0, $1, and $ARGUMENTS for sample-format', async () => {
    const pluginDirs = readPluginsConfig().plugins
    const skills = pluginDirs.flatMap((dir) => loadPluginSkills(dir))
    expect(skills.some((s) => s.name === 'sample-format')).toBe(true)

    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills, sessionId: 'test-session' })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    const result = String(
      await useSkill.invoke({ name: 'sample-format', arguments: 'src/index.ts prettier' }),
    )

    expect(result).toContain('File: src/index.ts')
    expect(result).toContain('Style: prettier')
    expect(result).toContain('Positional: src/index.ts, prettier')
    expect(result).toContain('Arguments: src/index.ts prettier')
  })

  it('loads sample-format with no arguments, leaving placeholders unsubstituted', async () => {
    const pluginDirs = readPluginsConfig().plugins
    const skills = pluginDirs.flatMap((dir) => loadPluginSkills(dir))

    const tools = buildTools('/tmp', undefined, undefined, undefined, { skills, sessionId: 'test-session' })
    const useSkill = tools.find((t) => t.name === 'use_skill')!

    const result = String(await useSkill.invoke({ name: 'sample-format' }))

    expect(result).toContain('Skill dir:')
    expect(result).toContain('File: $file')
    expect(result).toContain('Style: $style')
    expect(result).toContain('Positional: $0, $1')
    expect(result).toContain('Arguments:')
    expect(result).not.toContain('Arguments: src/index.ts prettier')
  })
})
