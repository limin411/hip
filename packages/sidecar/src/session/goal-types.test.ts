import { describe, it, expect } from 'vitest'
import {
  formatGoalProtectedBlock,
  goalToWire,
  mapPlanTodoStatus,
} from './goal-types.js'
import { GoalManager } from './goal.js'
import { appendProtectedStructures } from './compaction.js'
import { detectVerificationRecipe } from './verification.js'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('goal-types', () => {
  it('mapPlanTodoStatus maps completed→done', () => {
    expect(mapPlanTodoStatus('completed')).toBe('done')
    expect(mapPlanTodoStatus('in_progress')).toBe('in_progress')
    expect(mapPlanTodoStatus('pending')).toBe('pending')
  })

  it('formatGoalProtectedBlock includes criteria', () => {
    const gm = new GoalManager()
    gm.create({
      description: 'Ship watchlist',
      successCriteria: ['migration', 'tests green'],
    })
    const block = formatGoalProtectedBlock(gm.getStatus())
    expect(block).toContain('## Active goal (do not drop)')
    expect(block).toContain('migration')
    expect(block).toContain('tests green')
  })

  it('goalToWire exposes criteria counts', () => {
    const gm = new GoalManager()
    gm.create({ description: 'x', successCriteria: ['a', 'b'] })
    gm.addEvidence(0, 'manual', 'note')
    const w = goalToWire(gm.getStatus())!
    expect(w.criteriaTotal).toBe(2)
    expect(w.criteriaDone).toBe(1)
  })
})

describe('GoalManager durable fields', () => {
  it('persists via onPersist', () => {
    const snaps: string[] = []
    const gm = new GoalManager()
    gm.setPersist((g) => snaps.push(g ? g.description : 'null'))
    gm.create({ description: 'd', successCriteria: ['c1'] })
    expect(snaps.at(-1)).toBe('d')
    gm.setTodosFromPlan([{ content: 't1', status: 'pending' }])
    expect(gm.getStatus()!.phases[0].todos[0].content).toBe('t1')
  })

  it('tryComplete blocks without verification pass', () => {
    const gm = new GoalManager()
    gm.create({
      description: 'd',
      successCriteria: ['c'],
      verification: { commands: [{ id: 't', cmd: 'false' }] },
    })
    expect(gm.tryComplete()).toBe(false)
    expect(gm.getStatus()!.status).toBe('blocked')
    gm.recordVerification({ ok: true, at: Date.now(), results: [] })
    expect(gm.tryComplete()).toBe(true)
    expect(gm.getStatus()).toBeNull()
  })

  it('drive includes criteria checklist', () => {
    const gm = new GoalManager()
    gm.create({ description: 'Build feature', successCriteria: ['tests pass'] })
    const d = gm.drive()!
    expect(d.prompt).toContain('Build feature')
    expect(d.prompt).toContain('tests pass')
    expect(d.prompt).toContain('Auto-continuing')
  })

  it('hydrate restores goal', () => {
    const gm = new GoalManager()
    const g = gm.create({ description: 'h', successCriteria: ['x'] })
    const gm2 = new GoalManager()
    gm2.hydrate(structuredClone(g))
    expect(gm2.getStatus()?.description).toBe('h')
  })
})

describe('appendProtectedStructures', () => {
  it('appends block once', () => {
    const body = 'summary body'
    const block = '## Active goal (do not drop)\nid: g1'
    const once = appendProtectedStructures(body, block)
    expect(once).toContain('summary body')
    expect(once).toContain('Active goal')
    expect(appendProtectedStructures(once, block)).toBe(once)
  })
})

describe('detectVerificationRecipe', () => {
  it('detects cargo tauri layout', () => {
    const root = mkdtempSync(join(tmpdir(), 'hip-ver-'))
    mkdirSync(join(root, 'src-tauri'))
    writeFileSync(join(root, 'src-tauri', 'Cargo.toml'), '[package]\nname="x"\n')
    const r = detectVerificationRecipe(root)
    expect(r?.commands[0]?.cmd).toContain('cargo test')
  })
})
