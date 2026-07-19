import { describe, it, expect } from 'vitest'
import type { AgentRole } from '@hip/protocol'
import { ROLE_COLOR, ROLE_NAME_KEY, agentDisplayName } from './roleColor'

// One literal per AgentRole member. If a role is added/removed, this array (typed as the
// full union) forces a compile error here until updated — a deliberate exhaustiveness tripwire.
const ALL_ROLES: AgentRole[] = ['supervisor', 'planner', 'coder', 'reviewer', 'worker', 'subagent']

describe('roleColor maps cover every AgentRole', () => {
  it('ROLE_COLOR has a CSS var for every role', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_COLOR[role]).toMatch(/^var\(--role-/)
    }
  })
  it('ROLE_NAME_KEY has an i18n key for every role', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_NAME_KEY[role]).toMatch(/^artifact\.roles\./)
    }
  })
  it('maps the new worker role', () => {
    expect(ROLE_COLOR.worker).toBe('var(--role-worker)')
    expect(ROLE_NAME_KEY.worker).toBe('artifact.roles.worker')
  })
})

describe('agentDisplayName', () => {
  // Mimic i18n: return the key (translated label). defaultValue is only for unknown keys.
  const t = (key: string, _opts?: { defaultValue?: string }) => key

  it('prefers a concrete agent name over the role label', () => {
    expect(agentDisplayName({ role: 'subagent', name: 'Coder' }, t)).toBe('Coder')
  })

  it('falls back to the role i18n key when name is missing', () => {
    expect(agentDisplayName({ role: 'subagent' }, t)).toBe('artifact.roles.subagent')
  })

  it('ignores blank names', () => {
    expect(agentDisplayName({ role: 'worker', name: '  ' }, t)).toBe('artifact.roles.worker')
  })
})
