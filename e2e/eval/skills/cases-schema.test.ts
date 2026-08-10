// e2e/eval/skills/cases-schema.test.ts
// Free (no-LLM) validation of the skill eval case files under cases/.
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SkillCase } from './types.js'

const CASES_DIR = path.join(import.meta.dirname, 'cases')

function loadCases(): Array<{ file: string; data: SkillCase }> {
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      file: f,
      data: JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), 'utf8')) as SkillCase,
    }))
}

describe('skill eval cases', () => {
  const cases = loadCases()
  it('has at least one case file', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  for (const { file, data } of cases) {
    describe(file, () => {
      it('has schemaVersion 1 and a skill id', () => {
        expect(data.schemaVersion).toBe(1)
        expect(typeof data.skill).toBe('string')
        expect(data.skill.length).toBeGreaterThan(0)
      })

      it('has non-empty positive and negative triggers', () => {
        expect(data.trigger.positive.length).toBeGreaterThan(0)
        expect(data.trigger.negative.length).toBeGreaterThan(0)
        for (const p of data.trigger.positive) expect(p.length).toBeGreaterThan(10)
        for (const n of data.trigger.negative) expect(n.length).toBeGreaterThan(10)
      })

      it('evals have valid ids, prompts and expectations', () => {
        for (const ev of data.evals ?? []) {
          expect(ev.id.length).toBeGreaterThan(0)
          expect(ev.prompt.length).toBeGreaterThan(10)
          expect(ev.expectations.length).toBeGreaterThan(0)
          if (ev.kind !== undefined) {
            expect(['execution', 'dialogue']).toContain(ev.kind)
          }
        }
      })

      it('eval ids are unique within the case', () => {
        const ids = (data.evals ?? []).map((e) => e.id)
        expect(new Set(ids).size).toBe(ids.length)
      })
    })
  }
})
