import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillMeta } from '@hip/protocol'
import { buildTools } from './tools.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-disc-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function byName(tools: ReturnType<typeof buildTools>, name: string) {
  return tools.find((t) => t.name === name)!
}

function makeSkill(id: string, name: string, body: string, extras?: { referencesFiles?: string[]; assetsFiles?: string[] }): SkillMeta {
  const dir = join(root, 'skills', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n${body}`, 'utf8')

  if (extras?.referencesFiles) {
    const refDir = join(dir, 'references')
    mkdirSync(refDir, { recursive: true })
    for (const f of extras.referencesFiles) {
      const fp = join(refDir, f)
      mkdirSync(join(fp, '..'), { recursive: true })
      writeFileSync(fp, 'ref content', 'utf8')
    }
  }

  if (extras?.assetsFiles) {
    const assetDir = join(dir, 'assets')
    mkdirSync(assetDir, { recursive: true })
    for (const f of extras.assetsFiles) {
      const fp = join(assetDir, f)
      mkdirSync(join(fp, '..'), { recursive: true })
      writeFileSync(fp, 'asset content', 'utf8')
    }
  }

  return {
    id,
    name,
    description: 'd',
    dir,
    hasScripts: false,
    hasReferences: !!extras?.referencesFiles?.length,
    hasAssets: !!extras?.assetsFiles?.length,
  }
}

// ── Progressive skill disclosure (Level 1-3) ──

describe('use_skill progressive disclosure', () => {
  it('discloses Level 3 resources: references/ paths in the file manifest', async () => {
    const skill = makeSkill('ref-skill', 'RefSkill', 'Instructions', {
      referencesFiles: ['guide.md', 'api/reference.json'],
    })
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'RefSkill' }))
    expect(out).toContain('Skill dir:')
    expect(out).toContain('Instructions')
    expect(out).toContain('guide.md')
    expect(out).toContain('api/reference.json')
  })

  it('discloses Level 3 resources: assets/ paths in the file manifest', async () => {
    const skill = makeSkill('asset-skill', 'AssetSkill', 'Instructions', {
      assetsFiles: ['logo.png', 'templates/layout.html'],
    })
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'AssetSkill' }))
    expect(out).toContain('Skill dir:')
    expect(out).toContain('logo.png')
    expect(out).toContain('templates/layout.html')
  })

  it('discloses both references/ and assets/ paths together', async () => {
    const skill = makeSkill('full-skill', 'FullSkill', 'Instructions', {
      referencesFiles: ['guide.md'],
      assetsFiles: ['icon.svg'],
    })
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'FullSkill' }))
    expect(out).toContain('guide.md')
    expect(out).toContain('icon.svg')
  })

  it('uses correct absolute paths for bundled files', async () => {
    const skill = makeSkill('path-skill', 'PathSkill', 'Instructions', {
      referencesFiles: ['data/config.json'],
    })
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'PathSkill' }))
    // File manifest should use absolute paths
    expect(out).toContain(join(skill.dir, 'references', 'data', 'config.json'))
  })

  it('explicitly calls out how to access bundled files', async () => {
    const skill = makeSkill('instr-skill', 'InstrSkill', 'Instructions', {
      referencesFiles: ['guide.md'],
    })
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'InstrSkill' }))
    // The file manifest header should mention read_file for bundled resources
    expect(out).toContain('Level 3')
    expect(out).toContain('read_file')
    expect(out).toContain('Bundled resources')
  })
})

// ── Level 1 metadata check (use_skill description) ──

describe('use_skill tool description (progressive levels)', () => {
  it('mentions progressive loading in tool description', () => {
    const skill = makeSkill('t', 'Test', 'body')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const useSkill = byName(tools, 'use_skill')
    const desc = useSkill.description
    expect(desc).toContain('Level 1')
    expect(desc).toContain('Level 2')
    expect(desc).toContain('Level 3')
  })

  it('describes Level 2 as the SKILL.md body', () => {
    const skill = makeSkill('t', 'Test', 'body')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const desc = byName(tools, 'use_skill').description
    expect(desc).toContain('SKILL.md')
  })

  it('describes Level 3 as bundled resources (references/ + assets/)', () => {
    const skill = makeSkill('t', 'Test', 'body')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const desc = byName(tools, 'use_skill').description
    expect(desc).toContain('references')
    expect(desc).toContain('assets')
  })
})
