import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillMeta } from '@hip/protocol'
import { skillsBlock, getSkillsBudget, SkillUsageTracker } from './system-prompt.js'

let dirs: string[] = []

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'hip-sb-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ok */ }
  }
})

function makeSkill(
  id: string,
  name: string,
  description: string,
  overrides: Partial<SkillMeta> = {},
): SkillMeta {
  const dir = join(tmpDir(), id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\nbody`,
    'utf8',
  )
  return {
    id,
    name,
    description,
    dir,
    hasScripts: false,
    autoInvoke: true,
    scope: 'global',
    ...overrides,
  }
}

// ── getSkillsBudget ──

describe('getSkillsBudget', () => {
  it('returns 2000 for 128k tokens (1% = 1280 tokens * 4 chars = 5120, capped at 2000)', () => {
    expect(getSkillsBudget(128_000)).toBe(2000)
  })

  it('returns 400 for 100k tokens (1% = 1000 tokens * 4 = 4000, capped at 2000)', () => {
    expect(getSkillsBudget(100_000)).toBe(2000)
  })

  it('returns small budget for tiny context window', () => {
    const budget = getSkillsBudget(4_000) // 1% = 40 tokens * 4 = 160 chars
    expect(budget).toBe(160)
  })

  it('caps at 2000 even for enormous context windows', () => {
    expect(getSkillsBudget(1_000_000)).toBe(2000)
  })

  it('defaults to 128k tokens when no param provided', () => {
    expect(getSkillsBudget()).toBe(2000)
  })
})

// ── SkillUsageTracker ──

describe('SkillUsageTracker', () => {
  it('starts with zero counts', () => {
    const t = new SkillUsageTracker()
    expect(t.getCount('any')).toBe(0)
  })

  it('records invocations', () => {
    const t = new SkillUsageTracker()
    t.recordInvocation('a')
    t.recordInvocation('a')
    t.recordInvocation('b')
    expect(t.getCount('a')).toBe(2)
    expect(t.getCount('b')).toBe(1)
    expect(t.getCount('c')).toBe(0)
  })

  it('snapshot returns a readonly copy', () => {
    const t = new SkillUsageTracker()
    t.recordInvocation('x')
    const snap = t.snapshot()
    expect(snap.get('x')).toBe(1)
    // snapshot is a separate Map, not live
    t.recordInvocation('x')
    expect(snap.get('x')).toBe(1)
  })
})

// ── skillsBlock without budget (backward compat) ──

describe('skillsBlock (no budget)', () => {
  it('lists all eligible skills', () => {
    const skills = [
      makeSkill('a', 'Alpha', 'First skill'),
      makeSkill('b', 'Beta', 'Second skill'),
    ]
    const block = skillsBlock(skills)
    expect(block).toContain('Alpha')
    expect(block).toContain('Beta')
    expect(block).toContain('First skill')
    expect(block).toContain('Second skill')
  })

  it('omits autoInvoke=false skills', () => {
    const skills = [
      makeSkill('a', 'Alpha', 'First skill'),
      makeSkill('b', 'Beta', 'Second skill', { autoInvoke: false }),
    ]
    const block = skillsBlock(skills)
    expect(block).toContain('Alpha')
    expect(block).not.toContain('Beta')
  })

  it('returns empty string when no eligible skills', () => {
    const skills = [makeSkill('a', 'Alpha', 'd', { autoInvoke: false })]
    expect(skillsBlock(skills)).toBe('')
  })
})

// ── skillsBlock with budget ──

describe('skillsBlock (with budget)', () => {
  it('fits within budget when small enough', () => {
    const skills = [
      makeSkill('a', 'Alpha', 'A short description'),
      makeSkill('b', 'Beta', 'Another short description'),
    ]
    const block = skillsBlock(skills, undefined, { budget: 500 })
    expect(block.length).toBeLessThanOrEqual(500)
    expect(block).toContain('Alpha')
    expect(block).toContain('Beta')
  })

  it('truncates long descriptions to fit budget', () => {
    const longDesc = 'A'.repeat(200)
    const skills = [
      makeSkill('a', 'Alpha', longDesc),
      makeSkill('b', 'Beta', 'short'),
    ]
    const block = skillsBlock(skills, undefined, { budget: 400 })
    expect(block.length).toBeLessThanOrEqual(400)
    // Long description should be truncated (shown as ...)
    expect(block).toContain('...')
  })

  it('LRU-evicts least-used skills when over budget', () => {
    const tracker = new SkillUsageTracker()
    // skill a was used 3 times, b used 1 time, c never used
    tracker.recordInvocation('a')
    tracker.recordInvocation('a')
    tracker.recordInvocation('a')
    tracker.recordInvocation('b')

    const longDesc = 'A very long description that takes a lot of space in the block'
    const skills = [
      makeSkill('a', 'Alpha', longDesc),
      makeSkill('b', 'Beta', longDesc),
      makeSkill('c', 'Gamma', longDesc),
    ]

    // Tight budget: only 1 skill can fit (header ~148 chars, each tightened line ~62 chars)
    const block = skillsBlock(skills, undefined, { budget: 230, tracker })
    expect(block.length).toBeLessThanOrEqual(230)
    // c (never used) should be evicted first
    expect(block).not.toContain('Gamma')
    // b (used once) should also be evicted
    expect(block).not.toContain('Beta')
    // a (used 3 times) should survive
    expect(block).toContain('Alpha')
  })

  it('returns empty string when all skills evicted', () => {
    const skills = [
      makeSkill('a', 'Alpha', 'A somewhat longer description that takes space'),
    ]
    const block = skillsBlock(skills, undefined, { budget: 10 })
    expect(block).toBe('')
  })

  it('does not evict when budget is 0 or negative', () => {
    const skills = [
      makeSkill('a', 'Alpha', 'A description'),
    ]
    // budget <= 0 means no budget limit — same as no opts
    const block1 = skillsBlock(skills, undefined, { budget: 0 })
    expect(block1).toContain('Alpha')

    const block2 = skillsBlock(skills, undefined, { budget: -1 })
    expect(block2).toContain('Alpha')
  })

  it('maintains header text even with budget', () => {
    const skills = [makeSkill('a', 'Alpha', 'desc')]
    const block = skillsBlock(skills, undefined, { budget: 500 })
    expect(block).toContain('## Skills')
    expect(block).toContain('use_skill')
  })
})
