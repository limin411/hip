import { describe, it, expect } from 'vitest'
import { parseHandshakeLine, parseHandshakeFromLog, resolveSidecarEntry } from './resolve-entry.js'

describe('parseHandshakeLine', () => {
  it('parses valid line', () => {
    expect(parseHandshakeLine('{"port":1234,"token":"abc"}')).toEqual({ port: 1234, token: 'abc' })
  })

  it('ignores garbage', () => {
    expect(parseHandshakeLine('starting…')).toBeNull()
    expect(parseHandshakeLine('{"port":"x","token":"t"}')).toBeNull()
  })
})

describe('parseHandshakeFromLog', () => {
  it('takes last valid handshake', () => {
    const log = `noise\n{"port":1,"token":"a"}\nmore\n{"port":2,"token":"b"}\n`
    expect(parseHandshakeFromLog(log)).toEqual({ port: 2, token: 'b' })
  })
})

describe('resolveSidecarEntry', () => {
  it('resolves monorepo or ncc entry from workspace', () => {
    const entry = resolveSidecarEntry()
    expect(['ncc', 'tsx-dev', 'bin']).toContain(entry.kind)
    expect(entry.command).toBeTruthy()
  })
})
