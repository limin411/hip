import { describe, it, expect } from 'vitest'
import {
  emptyHostFormValues,
  formValuesToHost,
  hostToFormValues,
  isHostFormValid,
  mintGroupId,
  mintHostId,
  validateHostForm,
  type HostFormValues,
} from './hostFormDraft'
import type { TerminalHost } from '@/ipc/terminalHosts'

function base(over: Partial<HostFormValues> = {}): HostFormValues {
  return {
    ...emptyHostFormValues(),
    label: 'ops',
    hostname: 'example.com',
    port: '22',
    username: 'root',
    authMethod: 'password',
    password: 's3cret',
    ...over,
  }
}

describe('validateHostForm', () => {
  it('accepts a complete password create form', () => {
    expect(validateHostForm(base(), { mode: 'create', passwordSaved: false })).toEqual({})
    expect(isHostFormValid(base(), { mode: 'create', passwordSaved: false })).toBe(true)
  })

  it('requires label, hostname, username', () => {
    const errors = validateHostForm(
      base({ label: '  ', hostname: '', username: '' }),
      { mode: 'create', passwordSaved: false },
    )
    expect(errors.label).toBe('terminals.form.labelRequired')
    expect(errors.hostname).toBe('terminals.form.hostnameRequired')
    expect(errors.username).toBe('terminals.form.usernameRequired')
  })

  it('rejects invalid ports', () => {
    for (const port of ['', '0', '65536', '22.5', 'abc', '-1']) {
      const errors = validateHostForm(base({ port }), {
        mode: 'create',
        passwordSaved: false,
      })
      expect(errors.port).toBe('terminals.form.portInvalid')
    }
  })

  it('requires password on create when auth is password', () => {
    const errors = validateHostForm(base({ password: '' }), {
      mode: 'create',
      passwordSaved: false,
    })
    expect(errors.password).toBe('terminals.form.passwordRequired')
  })

  it('allows empty password on edit when password is already saved', () => {
    const errors = validateHostForm(base({ password: '' }), {
      mode: 'edit',
      passwordSaved: true,
    })
    expect(errors.password).toBeUndefined()
    expect(isHostFormValid(base({ password: '' }), { mode: 'edit', passwordSaved: true })).toBe(
      true,
    )
  })

  it('requires password on edit when nothing is saved', () => {
    const errors = validateHostForm(base({ password: '' }), {
      mode: 'edit',
      passwordSaved: false,
    })
    expect(errors.password).toBe('terminals.form.passwordRequired')
  })

  it('requires private key path for privateKey auth', () => {
    const errors = validateHostForm(
      base({ authMethod: 'privateKey', privateKeyPath: '', password: '' }),
      { mode: 'create', passwordSaved: false },
    )
    expect(errors.privateKeyPath).toBe('terminals.form.privateKeyPathRequired')
    expect(errors.password).toBeUndefined()
  })

  it('accepts privateKey with path and no password', () => {
    const values = base({
      authMethod: 'privateKey',
      privateKeyPath: '~/.ssh/id_ed25519',
      password: '',
    })
    expect(validateHostForm(values, { mode: 'create', passwordSaved: false })).toEqual({})
  })
})

describe('hostToFormValues / formValuesToHost', () => {
  const host: TerminalHost = {
    id: 'hst_1',
    label: 'ops-1',
    groupId: 'grp_1',
    hostname: '10.0.0.1',
    port: 2222,
    username: 'deploy',
    authMethod: 'privateKey',
    privateKeyPath: '/home/u/.ssh/id_ed25519',
    remotePath: '/var/www',
    updatedAt: 100,
  }

  it('round-trips meta fields (password fields stay empty)', () => {
    const form = hostToFormValues(host)
    expect(form.password).toBe('')
    expect(form.passphrase).toBe('')
    expect(form.groupId).toBe('grp_1')
    expect(form.port).toBe('2222')
    expect(form.privateKeyPath).toBe('/home/u/.ssh/id_ed25519')

    const back = formValuesToHost(form, host.id, 200)
    expect(back).toEqual({
      id: 'hst_1',
      label: 'ops-1',
      groupId: 'grp_1',
      hostname: '10.0.0.1',
      port: 2222,
      username: 'deploy',
      authMethod: 'privateKey',
      privateKeyPath: '/home/u/.ssh/id_ed25519',
      remotePath: '/var/www',
      updatedAt: 200,
    })
  })

  it('omits optional fields when empty', () => {
    const hostOut = formValuesToHost(
      base({ groupId: '', remotePath: '', authMethod: 'password', privateKeyPath: '/x' }),
      'hst_x',
      1,
    )
    expect(hostOut.groupId).toBeUndefined()
    expect(hostOut.remotePath).toBeUndefined()
    expect(hostOut.privateKeyPath).toBeUndefined()
  })
})

describe('mint ids', () => {
  it('prefixes hst_ / grp_', () => {
    expect(mintHostId(() => 'abc')).toBe('hst_abc')
    expect(mintGroupId(() => 'xyz')).toBe('grp_xyz')
  })
})
