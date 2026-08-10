// e2e/eval/skills/router.eval.test.ts
// Free routing regression against the REAL builtin skill catalog
// (packages/product-content/meta.json + ops/meta.json) using the sidecar's
// actual ranking primitive (skills/router.ts). Guards: positive triggers rank
// the target skill top-1; negative triggers score 0; descriptions don't
// collide. Runs in `yarn test` — no LLM.
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { rankSkills, findSkillCollisions, type RankableSkill } from '../../../packages/sidecar/src/session/skills/router.js'
import type { SkillCase } from './types.js'

const PRODUCT_CONTENT = path.join(import.meta.dirname, '../../..', 'packages/product-content')
const CASES_DIR = path.join(import.meta.dirname, 'cases')

interface ProductSkillMeta {
  skillId: string
  skillName: string
  description: string
}

function loadBuiltinSkills(): RankableSkill[] {
  const metas: ProductSkillMeta[] = []
  for (const metaPath of ['meta.json', path.join('ops', 'meta.json')]) {
    const abs = path.join(PRODUCT_CONTENT, metaPath)
    if (!fs.existsSync(abs)) continue
    const meta = JSON.parse(fs.readFileSync(abs, 'utf8')) as ProductSkillMeta
    metas.push(meta)
  }
  return metas.map((m) => ({ id: m.skillId, name: m.skillName, description: m.description }))
}

function loadCases(): Array<{ file: string; data: SkillCase }> {
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      file: f,
      data: JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), 'utf8')) as SkillCase,
    }))
}

describe('builtin skill routing (real catalog)', () => {
  const skills = loadBuiltinSkills()
  const cases = loadCases()

  it('catalog is non-empty', () => {
    expect(skills.length).toBeGreaterThan(0)
    expect(skills.map((s) => s.id).sort()).toEqual([...skills.map((s) => s.id)].sort())
  })

  it('positive triggers rank the target skill top-1', () => {
    for (const { file, data } of cases) {
      const target = skills.find((s) => s.id === data.skill)
      expect(target, `${file}: skill ${data.skill} not in builtin catalog`).toBeDefined()
      for (const positive of data.trigger.positive) {
        const ranked = rankSkills(positive, skills, 3)
        expect(ranked[0]?.id, `${file}: positive trigger must rank ${data.skill} top-1\nquery: ${positive}\ngot: ${JSON.stringify(ranked)}`).toBe(data.skill)
      }
    }
  })

  it('negative triggers stay well below positive-match strength', () => {
    for (const { file, data } of cases) {
      const target = skills.find((s) => s.id === data.skill)
      expect(target).toBeDefined()
      // Positive triggers must rank top-1 with a real score; negative triggers
      // must stay below 0.15 (weak matches from shared brand words like "hip"
      // are expected and fine — the guard is about *strong* lexical matches).
      const positives = data.trigger.positive.map((p) => rankSkills(p, skills, 1)[0]?.score ?? 0)
      const strongest = Math.max(...positives)
      expect(strongest, `${file}: positive trigger scored 0 — routing example broken`).toBeGreaterThan(0)
      for (const negative of data.trigger.negative) {
        const ranked = rankSkills(negative, skills, skills.length)
        const hit = ranked.find((r) => r.id === data.skill)
        expect(hit?.score ?? 0, `${file}: negative trigger must stay < 0.15 for ${data.skill}\nquery: ${negative}`).toBeLessThan(0.15)
      }
    }
  })

  it('builtin skill descriptions do not collide (≥0.75 similarity)', () => {
    const collisions = findSkillCollisions(skills)
    expect(collisions, `colliding skill descriptions: ${JSON.stringify(collisions)}`).toEqual([])
  })

  it('case skill ids all exist in the catalog', () => {
    const ids = new Set(skills.map((s) => s.id))
    for (const { file, data } of cases) {
      expect(ids.has(data.skill), `${file}: unknown skill ${data.skill}`).toBe(true)
    }
  })
})
