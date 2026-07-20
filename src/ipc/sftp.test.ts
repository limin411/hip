import { describe, expect, it } from 'vitest'
import { isAlreadyExistsError, isSessionClosedError, mintSftpOpId } from './sftp'

describe('sftp ipc helpers', () => {
  it('mintSftpOpId is unique and prefixed', () => {
    const a = mintSftpOpId()
    const b = mintSftpOpId()
    expect(a.startsWith('sftp_')).toBe(true)
    expect(b.startsWith('sftp_')).toBe(true)
    expect(a).not.toBe(b)
  })

  it('isAlreadyExistsError matches Rust overwrite gate', () => {
    expect(isAlreadyExistsError('AlreadyExists')).toBe(true)
    expect(isAlreadyExistsError(new Error('foo AlreadyExists bar'))).toBe(true)
    expect(isAlreadyExistsError('other')).toBe(false)
  })

  it('isSessionClosedError matches binding failures', () => {
    expect(isSessionClosedError('SSH session is closed')).toBe(true)
    expect(isSessionClosedError('no ssh session for tm_x')).toBe(true)
    expect(isSessionClosedError('SFTP ls failed')).toBe(false)
  })
})
