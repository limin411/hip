import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

import {
  isHostKeyMismatchError,
  parseSshInvokeError,
  sshClose,
  sshOpen,
  sshTrustHost,
} from './ssh'

describe('parseSshInvokeError', () => {
  it('detects structured host_key_mismatch JSON', () => {
    const payload = {
      code: 'host_key_mismatch',
      hostname: 'example.com',
      port: 22,
      fingerprint: 'SHA256:abc',
      publicKey: 'ssh-ed25519 AAAA',
      previousFingerprint: 'SHA256:old',
    }
    const r = parseSshInvokeError(JSON.stringify(payload))
    expect(r.hostKeyMismatch).toEqual(payload)
    expect(isHostKeyMismatchError(r.hostKeyMismatch)).toBe(true)
  })

  it('returns plain message when not mismatch', () => {
    const r = parseSshInvokeError(new Error('auth failed'))
    expect(r.message).toContain('auth failed')
    expect(r.hostKeyMismatch).toBeUndefined()
  })
})

describe('ssh ipc wrappers', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('sshOpen invokes with camelCase args', async () => {
    invoke.mockResolvedValue({ reused: false, generation: 1 })
    await sshOpen('tm_1', 'hst_1', 80, 24)
    expect(invoke).toHaveBeenCalledWith('ssh_open', {
      terminalId: 'tm_1',
      hostId: 'hst_1',
      cols: 80,
      rows: 24,
    })
  })

  it('sshClose / sshTrustHost invoke names', async () => {
    invoke.mockResolvedValue(undefined)
    await sshClose('tm_1')
    expect(invoke).toHaveBeenCalledWith('ssh_close', { terminalId: 'tm_1' })
    await sshTrustHost('h', 22, 'ssh-ed25519 AAAA', 'SHA256:x')
    expect(invoke).toHaveBeenCalledWith('ssh_trust_host', {
      hostname: 'h',
      port: 22,
      publicKey: 'ssh-ed25519 AAAA',
      fingerprintSha256: 'SHA256:x',
    })
  })
})
