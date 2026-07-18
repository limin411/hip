import { describe, it, expect } from 'vitest'
import { HipWsClient } from '../client/ws-client.js'
import { waitForServerMessage } from './connect.js'

describe('waitForServerMessage', () => {
  it('resolves on matching type', async () => {
    const client = new HipWsClient()
    const p = waitForServerMessage(client, 'session:list:result', { timeoutMs: 1000 })
    await Promise.resolve()
    client.emit({ type: 'session:list:result', sessions: [] })
    const res = await p
    expect(res.type).toBe('session:list:result')
    expect(res.sessions).toEqual([])
  })

  it('rejects on unicast error frame (no sessionId)', async () => {
    const client = new HipWsClient()
    const p = waitForServerMessage(client, 'session:list:result', { timeoutMs: 1000 })
    await Promise.resolve()
    client.emit({ type: 'error', code: 'X', message: 'boom' })
    await expect(p).rejects.toMatchObject({ code: 'X', message: 'boom' })
  })

  it('ignores foreign session-scoped errors while waiting for list', async () => {
    const client = new HipWsClient()
    const p = waitForServerMessage(client, 'session:list:result', { timeoutMs: 1000 })
    await Promise.resolve()
    client.emit({ type: 'error', sessionId: 'other', code: 'TURN_FAIL', message: 'gui turn failed' })
    client.emit({ type: 'session:list:result', sessions: [] })
    const res = await p
    expect(res.sessions).toEqual([])
  })
})
