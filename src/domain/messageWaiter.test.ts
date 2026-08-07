// src/domain/messageWaiter.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ServerMessage } from '@hip/protocol'
import { MessageWaiter } from './messageWaiter'

afterEach(() => {
  vi.useRealTimers()
})

function msg(type: ServerMessage['type'], extra: Record<string, unknown> = {}): ServerMessage {
  return { type, ...extra } as ServerMessage
}

describe('MessageWaiter', () => {
  it('resolves when a matching message is fulfilled', async () => {
    const w = new MessageWaiter()
    const p = w.wait('memory:config')
    w.fulfill(msg('memory:config'))
    await expect(p).resolves.toMatchObject({ type: 'memory:config' })
  })

  it('leaves the waiter intact when a non-matching message of the same type arrives', async () => {
    const w = new MessageWaiter()
    const p = w.waitWhere('config:testProvider:result', (m) => m.requestId === 'r1')
    w.fulfill(msg('config:testProvider:result', { requestId: 'r2' }))
    // Still pending after the non-matching message.
    await expect(Promise.race([p.then(() => 'resolved'), Promise.resolve('pending')])).resolves.toBe(
      'pending',
    )
    w.fulfill(msg('config:testProvider:result', { requestId: 'r1' }))
    await expect(p).resolves.toMatchObject({ requestId: 'r1' })
  })

  it('rejects on timeout and drops the waiter', async () => {
    vi.useFakeTimers()
    const w = new MessageWaiter()
    const p = w.wait('memory:config', 1000)
    const assertion = expect(p).rejects.toThrow('Timeout waiting for memory:config')
    vi.advanceTimersByTime(1001)
    await assertion
  })

  it('waitFirst resolves on the first matching type and cancels siblings', async () => {
    const w = new MessageWaiter()
    const p = w.waitFirst(['memory:config', 'error'])
    w.fulfill(msg('error'))
    await expect(p).resolves.toMatchObject({ type: 'error' })
    // A later matching message finds no waiter left (siblings were cleaned up).
    const q = w.waitFirst(['memory:config', 'error'])
    w.fulfill(msg('memory:config'))
    await expect(q).resolves.toMatchObject({ type: 'memory:config' })
  })

  it('dispose rejects all pending waiters', async () => {
    const w = new MessageWaiter()
    const p = w.wait('memory:config')
    const assertion = expect(p).rejects.toThrow('MessageWaiter disposed')
    w.dispose()
    await assertion
  })

  it('fulfill with no matching waiter is a no-op', () => {
    const w = new MessageWaiter()
    expect(() => w.fulfill(msg('memory:config'))).not.toThrow()
  })
})
