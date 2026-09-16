// packages/sidecar/src/session/sandbox/sandbox.test.ts
import { describe, it, expect } from 'vitest'
import { deriveSandboxPolicy } from './policy.js'
import { renderSeatbeltProfile, renderBwrapArgv, buildSandboxArgv } from './launcher.js'
import { classifySandboxViolation } from './violation.js'
import { decideSandbox, sandboxCommand, sandboxWrapperArgv } from './index.js'

describe('deriveSandboxPolicy', () => {
  it('edit mode: cwd writable, everything else read-only', () => {
    const p = deriveSandboxPolicy({ permissionMode: 'edit', cwd: '/work/proj' })
    expect(p.writeRoots).toEqual(['/work/proj'])
    expect(p.allowNetwork).toBe(false)
  })

  it('full mode: writes anywhere', () => {
    const p = deriveSandboxPolicy({ permissionMode: 'full', cwd: '/work/proj' })
    expect(p.writeRoots).toEqual(['/'])
  })

  it('defaults to edit when permissionMode is undefined', () => {
    const p = deriveSandboxPolicy({ cwd: '/x' })
    expect(p.writeRoots).toEqual(['/x'])
  })

  it('carries read-only roots and network flag', () => {
    const p = deriveSandboxPolicy({ cwd: '/x', readOnlyRoots: ['/a', '/b'], allowNetwork: true })
    expect(p.readOnlyRoots).toEqual(['/a', '/b'])
    expect(p.allowNetwork).toBe(true)
  })
})

describe('renderSeatbeltProfile', () => {
  it('denies by default and allows the writable root', () => {
    const p = deriveSandboxPolicy({ permissionMode: 'edit', cwd: '/work/proj' })
    const profile = renderSeatbeltProfile(p)
    expect(profile).toContain('(deny default)')
    expect(profile).toContain('(allow file-write* (subpath "/work/proj"))')
    expect(profile).toContain('(deny network*)')
  })

  it('allows network when requested', () => {
    const p = deriveSandboxPolicy({ cwd: '/x', allowNetwork: true })
    const profile = renderSeatbeltProfile(p)
    expect(profile).toContain('(allow network*')
    expect(profile).not.toContain('(deny network*)')
  })

  it('full mode allows writes anywhere', () => {
    const p = deriveSandboxPolicy({ permissionMode: 'full', cwd: '/x' })
    const profile = renderSeatbeltProfile(p)
    expect(profile).toContain('(allow file-write*)')
  })

  it('escapes double quotes in paths', () => {
    const p = deriveSandboxPolicy({ cwd: '/work/"quoted"' })
    const profile = renderSeatbeltProfile(p)
    expect(profile).toContain('/work/\\"quoted\\"')
  })
})

describe('buildSandboxArgv', () => {
  it('wraps with pinned sandbox-exec on macOS', () => {
    const p = deriveSandboxPolicy({ cwd: '/x' })
    const r = buildSandboxArgv('ls -la', p, 'darwin')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.argv[0]).toBe('/usr/bin/sandbox-exec')
      expect(r.argv).toContain('/bin/sh')
      expect(r.argv[r.argv.length - 1]).toBe('ls -la')
    }
  })

  it('renders bubblewrap argv on linux', () => {
    const p = deriveSandboxPolicy({ cwd: '/x' })
    const r = buildSandboxArgv('ls', p, 'linux')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.argv[0]).toBe('bwrap')
      expect(r.argv).toContain('--unshare-net')
      expect(r.argv[r.argv.length - 1]).toBe('ls')
    }
  })

  it('unsupported on windows (never crashes)', () => {
    const p = deriveSandboxPolicy({ cwd: '/x' })
    const r = buildSandboxArgv('ls', p, 'win32')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unsupported-platform')
  })
})

describe('classifySandboxViolation', () => {
  it('classifies write denials with guidance', () => {
    const v = classifySandboxViolation('deny file-write-data /etc/hosts\nOperation not permitted')
    expect(v.kind).toBe('file_write')
    expect(v.guidance).toContain('workspace root')
  })

  it('classifies read denials', () => {
    const v = classifySandboxViolation('sandbox-exec: deny file-read-data /Users/secret')
    expect(v.kind).toBe('file_read')
    expect(v.guidance).toContain('read-only roots')
  })

  it('classifies network denials', () => {
    const v = classifySandboxViolation('deny network-outbound eth0')
    expect(v.kind).toBe('network')
    expect(v.guidance).toContain('network policy')
  })

  it('falls back to unknown', () => {
    const v = classifySandboxViolation('some unrelated error: 42')
    expect(v.kind).toBe('unknown')
  })
})

// A real OS sandbox only exists for macOS (seatbelt) and Linux (bwrap). On
// other platforms every decision degrades to inactive by design, so the
// "activates" assertions below self-skip instead of reporting false red.
const SANDBOX_SUPPORTED = process.platform === 'darwin' || process.platform === 'linux'

describe('decideSandbox', () => {
  it('off mode never sandboxes', () => {
    const d = decideSandbox({ cwd: '/x', unattended: true, mode: 'off' })
    expect(d.active).toBe(false)
  })

  it.skipIf(!SANDBOX_SUPPORTED)('auto mode sandboxes only unattended runs', () => {
    expect(decideSandbox({ cwd: '/x', unattended: false, mode: 'auto' }).active).toBe(false)
    expect(decideSandbox({ cwd: '/x', unattended: true, mode: 'auto' }).active).toBe(true)
  })

  it.skipIf(!SANDBOX_SUPPORTED)('require mode sandboxes interactive runs too', () => {
    expect(decideSandbox({ cwd: '/x', unattended: false, mode: 'require' }).active).toBe(true)
  })

  it.skipIf(!SANDBOX_SUPPORTED)('defaults to auto', () => {
    expect(decideSandbox({ cwd: '/x', unattended: true }).active).toBe(true)
  })

  it.skipIf(SANDBOX_SUPPORTED)('degrades to inactive where no launcher exists', () => {
    const d = decideSandbox({ cwd: '/x', unattended: true, mode: 'require' })
    expect(d.active).toBe(false)
    if (!d.active) expect(d.reason).toBe('unsupported')
  })
})

describe('sandboxCommand', () => {
  it('passes through when inactive', () => {
    expect(sandboxCommand('echo hi', { active: false, reason: 'off' })).toBe('echo hi')
  })

  it('wraps the command when active', () => {
    const d = decideSandbox({ cwd: '/x', unattended: true, mode: 'auto' })
    const wrapped = sandboxCommand('echo hi', d)
    if (process.platform === 'darwin') {
      expect(wrapped).toContain('sandbox-exec')
      expect(wrapped).toContain('echo hi')
    } else {
      // Windows has no supported launcher; the command must still survive intact.
      expect(wrapped).toBe('echo hi')
    }
  })
})

describe('sandboxWrapperArgv', () => {
  it('bakes the CALLER command into argv, not a probe command', () => {
    const d = decideSandbox({ cwd: '/x', unattended: true, mode: 'auto' })
    if (!d.active) return // unsupported platform (e.g. Windows)
    const argv = sandboxWrapperArgv('echo real-command', d)
    expect(argv).toBeDefined()
    // Regression: decideSandbox used to return argv built from the literal
    // `'true'` probe. Any caller using that argv as a spawn wrapper silently
    // ran `true` and dropped the real command.
    expect(argv).toContain('echo real-command')
    expect(argv).not.toContain('true')
    expect(argv![argv!.length - 1]).toBe('echo real-command')
  })

  it('returns undefined when inactive or the command is empty', () => {
    expect(sandboxWrapperArgv('echo hi', { active: false, reason: 'off' })).toBeUndefined()
    const d = decideSandbox({ cwd: '/x', unattended: true, mode: 'auto' })
    if (d.active) expect(sandboxWrapperArgv('', d)).toBeUndefined()
  })
})
