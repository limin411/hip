import { describe, it, expect } from 'vitest'
import type { SkillMeta } from '@hip/protocol'
import {
  badgeForAutoInvoke,
  badgeForContext,
  refCountLabel,
  toolAllowlistPreview,
} from './SkillConfig'

function baseSkill(overrides: Partial<SkillMeta> = {}): SkillMeta {
  return {
    id: 'test-skill',
    name: 'Test Skill',
    description: 'A test skill',
    dir: '/tmp/skills/test',
    hasScripts: false,
    ...overrides,
  }
}

describe('badgeForAutoInvoke', () => {
  it('returns null when autoInvoke is true (default)', () => {
    expect(badgeForAutoInvoke(baseSkill({ autoInvoke: true }))).toBeNull()
  })

  it('returns null when autoInvoke is undefined', () => {
    expect(badgeForAutoInvoke(baseSkill())).toBeNull()
  })

  it('returns Manual badge when autoInvoke is false', () => {
    const result = badgeForAutoInvoke(baseSkill({ autoInvoke: false }))
    expect(result).toEqual({ label: 'Manual', variant: 'manual' })
  })
})

describe('badgeForContext', () => {
  it('returns Fork badge when context is fork', () => {
    const result = badgeForContext(baseSkill({ context: 'fork' }))
    expect(result).toEqual({ label: 'Fork' })
  })

  it('returns null when context is inline', () => {
    expect(badgeForContext(baseSkill({ context: 'inline' }))).toBeNull()
  })

  it('returns null when context is undefined', () => {
    expect(badgeForContext(baseSkill())).toBeNull()
  })
})

describe('refCountLabel', () => {
  it('returns null when neither refs nor assets exist', () => {
    expect(refCountLabel(baseSkill())).toBeNull()
  })

  it('returns null when hasReferences and hasAssets are false', () => {
    expect(refCountLabel(baseSkill({ hasReferences: false, hasAssets: false }))).toBeNull()
  })

  it('returns "refs" when only hasReferences is true', () => {
    expect(refCountLabel(baseSkill({ hasReferences: true, hasAssets: false }))).toBe('refs')
  })

  it('returns "assets" when only hasAssets is true', () => {
    expect(refCountLabel(baseSkill({ hasReferences: false, hasAssets: true }))).toBe('assets')
  })

  it('returns "refs, assets" when both are true', () => {
    expect(refCountLabel(baseSkill({ hasReferences: true, hasAssets: true }))).toBe('refs, assets')
  })
})

describe('toolAllowlistPreview', () => {
  it('returns null when allowedTools is undefined', () => {
    expect(toolAllowlistPreview(baseSkill())).toBeNull()
  })

  it('returns null when allowedTools is empty', () => {
    expect(toolAllowlistPreview(baseSkill({ allowedTools: [] }))).toBeNull()
  })

  it('shows all tools when count <= max (default 3)', () => {
    const result = toolAllowlistPreview(baseSkill({
      allowedTools: ['read_file', 'write_file'],
    }))
    expect(result).toBe('read_file, write_file')
  })

  it('shows truncated preview with +N when count > max', () => {
    const result = toolAllowlistPreview(baseSkill({
      allowedTools: ['read_file', 'write_file', 'bash', 'glob', 'grep'],
    }))
    expect(result).toBe('read_file, write_file, bash +2')
  })

  it('respects custom max parameter', () => {
    const result = toolAllowlistPreview(
      baseSkill({ allowedTools: ['read_file', 'write_file', 'bash', 'glob'] }),
      2,
    )
    expect(result).toBe('read_file, write_file +2')
  })
})
