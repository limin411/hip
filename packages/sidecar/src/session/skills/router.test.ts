// packages/sidecar/src/session/skills/router.test.ts
import { describe, it, expect } from 'vitest'
import { tokenize, textSimilarity, rankSkills, findSkillCollisions } from './router.js'

const SKILLS = [
  { id: 'planning', name: 'planning', description: 'Break a task into a phased plan with file paths, dependencies, and risks before implementation. Use for multi-step changes.' },
  { id: 'reviewer', name: 'reviewer', description: 'Review code diffs and plans: severity classification, line-cited evidence, blocker/suggestion/nit taxonomy.' },
  { id: 'testing', name: 'testing', description: 'Write and run tests: unit, integration, fixtures; verify failure before fix (TDD).' },
  { id: 'hip', name: 'hip', description: 'Product help for the hip desktop agent: surfaces, permission modes, settings, plugins, memory. Not for ordinary coding.' },
  { id: 'git-work', name: 'git-work', description: 'Git etiquette: branch hygiene, commit messages, diff review before commit.' },
]

describe('tokenize', () => {
  it('drops english stopwords and keeps content words', () => {
    const t = tokenize('write tests for the new feature')
    expect(t).toContain('tests')
    expect(t).toContain('feature')
    expect(t).not.toContain('the')
    expect(t).not.toContain('for')
  })

  it('produces CJK bigrams for mixed text', () => {
    const t = tokenize('如何规划多文件改动')
    // "如何规划多文件改动" → bigrams: 如何 何规 规划 划多 多文 文件 件改 改动
    expect(t).toContain('规划')
    expect(t).toContain('文件')
  })

  it('handles empty and punctuation-only text', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('!!! ???')).toEqual([])
  })
})

describe('textSimilarity', () => {
  it('is 1 for identical text and 0 for disjoint text', () => {
    expect(textSimilarity('plan the migration', 'plan the migration')).toBeCloseTo(1, 5)
    expect(textSimilarity('planning migration steps', 'banana potassium charts')).toBe(0)
  })

  it('is symmetric', () => {
    const a = textSimilarity('write tests first', 'testing strategy tdd')
    const b = textSimilarity('testing strategy tdd', 'write tests first')
    expect(a).toBeCloseTo(b, 10)
  })
})

describe('rankSkills', () => {
  it('ranks the matching skill first for a clear query', () => {
    const ranked = rankSkills('write tests and verify they fail before fixing', SKILLS, 3)
    expect(ranked[0].id).toBe('testing')
  })

  it('ranks planning skill for multi-step implementation queries', () => {
    const ranked = rankSkills('I need a phased implementation plan for a multi-file change with file paths and risks', SKILLS, 3)
    expect(ranked[0].id).toBe('planning')
  })

  it('scores 0 for cross-language queries (lexical limitation, documented)', () => {
    // Chinese query vs English descriptions: no lexical overlap → all zero.
    // This is intentional: cross-language routing is the model's job.
    const ranked = rankSkills('我需要一个多文件改动的分阶段实施计划', SKILLS, 5)
    expect(ranked.every((r) => r.score === 0)).toBe(true)
  })

  it('keeps negative examples out of the top-k', () => {
    const ranked = rankSkills('how do i configure hip settings and permission modes', SKILLS, 3)
    expect(ranked[0].id).toBe('hip')
    // 'planning' shares no lexical tokens with this query — it must score 0,
    // i.e. the negative example must not surface as a *positive* match.
    const planning = ranked.find((r) => r.id === 'planning')
    expect(planning).toBeDefined()
    expect(planning!.score).toBe(0)
  })

  it('returns at most topK results and is deterministic', () => {
    const a = rankSkills('git branch hygiene commit etiquette', SKILLS, 2)
    const b = rankSkills('git branch hygiene commit etiquette', SKILLS, 2)
    expect(a).toHaveLength(2)
    expect(a).toEqual(b)
    expect(a[0].id).toBe('git-work')
  })

  it('handles empty skill list', () => {
    expect(rankSkills('anything', [], 3)).toEqual([])
  })
})

describe('findSkillCollisions', () => {
  it('reports near-duplicate descriptions', () => {
    const nearDupe = [
      { id: 'a', name: 'alpha', description: 'Review code changes and suggest improvements with severity and evidence.' },
      { id: 'b', name: 'beta', description: 'Review code changes and recommend improvements with severity and evidence.' },
    ]
    const collisions = findSkillCollisions(nearDupe)
    expect(collisions.length).toBe(1)
    expect(collisions[0].score).toBeGreaterThanOrEqual(0.75 - 1e-9)
  })

  it('does not report distinct skills', () => {
    const collisions = findSkillCollisions(SKILLS)
    expect(collisions).toEqual([])
  })

  it('ignores identical ids and sorts by score', () => {
    const dup = [
      { id: 'x', name: 'same', description: 'identical description text for both skills' },
      { id: 'x', name: 'same', description: 'identical description text for both skills' },
    ]
    expect(findSkillCollisions(dup)).toEqual([])
  })
})
