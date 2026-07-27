import { describe, it, expect } from 'vitest'
import type { PluginMeta, SkillMeta } from '@hip/protocol'
import {
  badgeForAutoInvoke,
  badgeForContext,
  refCountLabel,
  toolAllowlistPreview,
  derivePluginSkills,
  isPluginManagedSkill,
  isBuiltinSkill,
  partitionSkillsForSettings,
  effectivePluginSkillEnabled,
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

function basePlugin(overrides: Partial<PluginMeta> = {}): PluginMeta {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    dir: '/tmp/plugins/test-plugin',
    skills: [],
    mcpServers: [],
    agents: [],
    hookCount: 0,
    hookEvents: [],
    enabled: true,
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

describe('derivePluginSkills', () => {
  it('maps plugin skill ids to read-only SkillMeta entries', () => {
    const plugins = [basePlugin({ skills: ['skill-a', 'skill-b'] })]
    const result = derivePluginSkills(plugins, new Set())
    expect(result).toHaveLength(2)
    expect(result[0].skill.id).toBe('skill-a')
    expect(result[0].skill.name).toBe('skill-a')
    expect(result[0].skill.hasScripts).toBe(false)
    expect(result[0].skill.pluginId).toBe('test-plugin')
    expect(result[0].skill.scope).toBe('plugin')
    expect(result[0].pluginName).toBe('Test Plugin')
    expect(result[1].skill.id).toBe('skill-b')
  })

  it('hides plugin skills whose id matches a standalone skill', () => {
    const plugins = [basePlugin({ skills: ['skill-a', 'skill-b'] })]
    const result = derivePluginSkills(plugins, new Set(['skill-a']))
    expect(result).toHaveLength(1)
    expect(result[0].skill.id).toBe('skill-b')
  })

  it('lets the first plugin win when two plugins export the same skill id', () => {
    const plugins = [
      basePlugin({ id: 'plugin-a', name: 'Plugin A', skills: ['shared'] }),
      basePlugin({ id: 'plugin-b', name: 'Plugin B', skills: ['shared'] }),
    ]
    const result = derivePluginSkills(plugins, new Set())
    expect(result).toHaveLength(1)
    expect(result[0].skill.pluginId).toBe('plugin-a')
    expect(result[0].pluginName).toBe('Plugin A')
  })

  it('ignores standalone match precedence across plugins', () => {
    const plugins = [
      basePlugin({ id: 'plugin-a', skills: ['shared'] }),
      basePlugin({ id: 'plugin-b', skills: ['shared', 'unique'] }),
    ]
    const result = derivePluginSkills(plugins, new Set(['shared']))
    expect(result).toHaveLength(1)
    expect(result[0].skill.id).toBe('unique')
    expect(result[0].skill.pluginId).toBe('plugin-b')
  })
})

describe('isBuiltinSkill', () => {
  it('detects scope=builtin', () => {
    expect(isBuiltinSkill(baseSkill({ scope: 'builtin' }))).toBe(true)
  })

  it('detects builtin-skills path fallback', () => {
    expect(
      isBuiltinSkill(
        baseSkill({ scope: 'global', dir: '/Users/x/.hip/builtin-skills/hip' }),
      ),
    ).toBe(true)
  })

  it('is false for normal user skills', () => {
    expect(isBuiltinSkill(baseSkill({ scope: 'global', dir: '/Users/x/.hip/skills/pdf' }))).toBe(
      false,
    )
  })
})

describe('isPluginManagedSkill / partitionSkillsForSettings', () => {
  it('detects plugin-managed skills by scope or pluginId', () => {
    expect(isPluginManagedSkill(baseSkill())).toBe(false)
    expect(isPluginManagedSkill(baseSkill({ scope: 'plugin' }))).toBe(true)
    expect(isPluginManagedSkill(baseSkill({ pluginId: 'p1' }))).toBe(true)
  })

  it('keeps plugin-scoped list_skills out of standalone and out of delete path', () => {
    const skills = [
      baseSkill({ id: 'local', name: 'Local' }),
      baseSkill({
        id: 'from-plugin',
        name: 'From Plugin',
        scope: 'plugin',
        pluginId: 'test-plugin',
      }),
    ]
    const plugins = [basePlugin({ skills: ['from-plugin', 'manifest-only'] })]
    const { standalone, builtin, pluginEntries } = partitionSkillsForSettings(skills, plugins)
    expect(standalone.map((s) => s.id)).toEqual(['local'])
    expect(builtin).toEqual([])
    expect(pluginEntries.map((e) => e.skill.id).sort()).toEqual(['from-plugin', 'manifest-only'])
    expect(pluginEntries.find((e) => e.skill.id === 'from-plugin')?.pluginName).toBe('Test Plugin')
    expect(pluginEntries.every((e) => e.pluginEnabled)).toBe(true)
  })

  it('splits product built-ins out of standalone', () => {
    const skills = [
      baseSkill({ id: 'local', name: 'Local' }),
      baseSkill({
        id: 'hip',
        name: 'hip',
        scope: 'builtin',
        dir: '/Users/x/.hip/builtin-skills/hip',
      }),
    ]
    const { standalone, builtin, pluginEntries } = partitionSkillsForSettings(skills, [])
    expect(standalone.map((s) => s.id)).toEqual(['local'])
    expect(builtin.map((s) => s.id)).toEqual(['hip'])
    expect(pluginEntries).toEqual([])
  })

  it('marks skills disabled when parent plugin is off', () => {
    const skills = [
      baseSkill({
        id: 'from-plugin',
        scope: 'plugin',
        pluginId: 'test-plugin',
      }),
    ]
    const plugins = [basePlugin({ skills: ['from-plugin'], enabled: false })]
    const { pluginEntries } = partitionSkillsForSettings(skills, plugins)
    expect(pluginEntries).toHaveLength(1)
    expect(pluginEntries[0].pluginEnabled).toBe(false)
    expect(effectivePluginSkillEnabled(true, false)).toBe(false)
    expect(effectivePluginSkillEnabled(true, true)).toBe(true)
  })
})
