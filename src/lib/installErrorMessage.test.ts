import { describe, it, expect } from 'vitest'
import { classifyInstallError, installErrorI18nKey } from './installErrorMessage'

describe('installErrorMessage', () => {
  it('classifies allowlist / permission / structure / network', () => {
    expect(classifyInstallError('command not on allowlist; copy to ~/.hip/bin')).toBe('allowlist')
    expect(classifyInstallError('EACCES: permission denied')).toBe('permission')
    expect(classifyInstallError('Invalid skill: missing SKILL.md')).toBe('structure')
    expect(classifyInstallError('connect ECONNREFUSED 127.0.0.1')).toBe('network')
    expect(classifyInstallError('boom')).toBe('generic')
  })

  it('maps kinds to i18n keys', () => {
    expect(installErrorI18nKey('allowlist')).toBe('settings.installErrors.allowlist')
  })
})
