import { describe, it, expect } from 'vitest'
import {
  resolveAgentRuntimeProfile,
  filterSkillsForProfile,
  productCapabilityMapForSurface,
  renderCapabilityNarrative,
} from './agent-runtime-profile.js'
import { CODING_SKILL_ID } from './ops/content.js'
import { HIP_SKILL_ID } from './product/content.js'
import type { SkillMeta } from '@hip/protocol'

const skills: SkillMeta[] = [
  { id: HIP_SKILL_ID, name: 'hip', description: 'product', dir: '/s/hip', hasScripts: false, autoInvoke: true },
  { id: CODING_SKILL_ID, name: 'hip-coding', description: 'coding', dir: '/s/coding', hasScripts: false, autoInvoke: true },
  { id: 'other', name: 'other', description: 'x', dir: '/s/o', hasScripts: false, autoInvoke: true },
]

describe('resolveAgentRuntimeProfile', () => {
  it('Chat + default edit tools: chat body, sandbox writes, no git, excludes hip-coding', () => {
    const p = resolveAgentRuntimeProfile({ surface: 'chat', permissionMode: 'edit' })
    expect(p.promptBody).toBe('chat')
    expect(p.surface).toBe('chat')
    expect(p.toolPolicy.allowWrites).toBe(true)
    expect(p.toolPolicy.allowGit).toBe(false)
    expect(p.toolPolicy.allowPluginInstall).toBe(false)
    expect(p.includeGitGuidance).toBe(false)
    expect(p.skillPolicy.excludeIds).toContain(CODING_SKILL_ID)
    expect(p.capabilityNarrative).toMatch(/Chat/i)
    expect(p.capabilityNarrative).not.toMatch(/permission mode:\s*edit/i)
    expect(p.capabilityNarrative).toMatch(/not.*Code edit mode/i)
  })

  it('Chat never uses bare "edit" capability phrasing', () => {
    const n = renderCapabilityNarrative({ surface: 'chat', permissionMode: 'edit' })
    expect(n).not.toMatch(/Current permission mode/i)
    // May say "not … Code edit mode" (denial) — must not affirm "you are in edit mode"
    expect(n).not.toMatch(/you are in (?:Code )?edit mode/i)
    expect(n).toMatch(/not.*Code edit mode/i)
  })

  it('Code + edit: coding body, git, pin hip-coding, project sandbox narrative', () => {
    const p = resolveAgentRuntimeProfile({ surface: 'code', permissionMode: 'edit' })
    expect(p.promptBody).toBe('code')
    expect(p.includeGitGuidance).toBe(true)
    expect(p.toolPolicy.allowWrites).toBe(true)
    expect(p.toolPolicy.allowGit).toBe(true)
    expect(p.skillPolicy.pinIds).toContain(CODING_SKILL_ID)
    expect(p.capabilityNarrative).toMatch(/project sandbox/i)
    expect(p.capabilityNarrative).not.toMatch(/Current permission mode:\s*edit/)
  })

  it('Code + chat permission: coding body but read-only tools', () => {
    const p = resolveAgentRuntimeProfile({ surface: 'code', permissionMode: 'chat' })
    expect(p.promptBody).toBe('code')
    expect(p.toolPolicy.allowWrites).toBe(false)
    expect(p.toolPolicy.allowGit).toBe(false)
    expect(p.includeGitGuidance).toBe(false)
    expect(p.capabilityNarrative).toMatch(/read-only/i)
  })

  it('Terminal: terminal ops body, no local tool policy, excludes coding skill', () => {
    const p = resolveAgentRuntimeProfile({ surface: 'terminal', permissionMode: 'edit' })
    expect(p.surface).toBe('terminal')
    expect(p.promptBody).toBe('terminal')
    expect(p.includeGitGuidance).toBe(false)
    expect(p.toolPolicy.allowWrites).toBe(false)
    expect(p.toolPolicy.allowGit).toBe(false)
    expect(p.toolPolicy.allowRunScript).toBe(false)
    expect(p.toolPolicy.allowPluginInstall).toBe(false)
    expect(p.toolPolicy.pathJail).toBe('n/a')
    expect(p.skillPolicy.pinIds).toContain(HIP_SKILL_ID)
    expect(p.skillPolicy.excludeIds).toContain(CODING_SKILL_ID)
    expect(p.capabilityNarrative).toMatch(/SSH managed terminal/i)
  })

  it('Terminal capability map never claims local file editing', () => {
    const m = productCapabilityMapForSurface('terminal')
    expect(m).toMatch(/Terminal Ops/i)
    expect(m).not.toMatch(/You are the Code workbench agent/)
    expect(m).toMatch(/must not claim to edit local files/)
  })

  it('Code + full: un-jailed narrative', () => {
    const p = resolveAgentRuntimeProfile({ surface: 'code', permissionMode: 'full' })
    expect(p.toolPolicy.pathJail).toBe('none')
    expect(p.capabilityNarrative).toMatch(/full filesystem/i)
  })

  it('missing surface defaults to code (no sessionId)', () => {
    const p = resolveAgentRuntimeProfile({ permissionMode: 'edit' })
    expect(p.surface).toBe('code')
    expect(p.promptBody).toBe('code')
  })

  it('knowledge surface is reserved with knowledge body', () => {
    const p = resolveAgentRuntimeProfile({ surface: 'knowledge', permissionMode: 'edit' })
    expect(p.promptBody).toBe('knowledge')
    expect(p.skillPolicy.excludeIds).toContain(CODING_SKILL_ID)
  })
})

describe('filterSkillsForProfile', () => {
  it('drops hip-coding on Chat', () => {
    const p = resolveAgentRuntimeProfile({ surface: 'chat' })
    const filtered = filterSkillsForProfile(skills, p)
    expect(filtered.map((s) => s.id)).toEqual([HIP_SKILL_ID, 'other'])
  })

  it('keeps hip-coding on Code', () => {
    const p = resolveAgentRuntimeProfile({ surface: 'code' })
    expect(filterSkillsForProfile(skills, p).map((s) => s.id)).toEqual([
      HIP_SKILL_ID,
      CODING_SKILL_ID,
      'other',
    ])
  })
})

describe('productCapabilityMapForSurface', () => {
  it('Chat map forbids claiming Code edit mode', () => {
    const m = productCapabilityMapForSurface('chat')
    expect(m).toMatch(/Chat/)
    expect(m).toMatch(/not.*Code/i)
  })

  it('Code map still documents permission gates', () => {
    const m = productCapabilityMapForSurface('code')
    expect(m).toMatch(/project sandbox|Permission modes/i)
    expect(m).toMatch(/read-only|chat = read-only/i)
  })
})
