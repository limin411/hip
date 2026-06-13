import { describe, it, expect } from 'vitest'
import { withRetry, isRetryable, parseRetryAfter } from './retry.js'

const instant = async () => {}
const noJitter = () => 0

describe('isRetryable', () => {
  it('retries 429 / 5xx / overload', () => {
    expect(isRetryable({ status: 429 })).toBe(true)
    expect(isRetryable({ status: 503 })).toBe(true)
    expect(isRetryable({ status: 529 })).toBe(true)
  })
  it('does not retry 4xx auth/bad-request/context-overflow', () => {
    expect(isRetryable({ status: 400 })).toBe(false)
    expect(isRetryable({ status: 401 })).toBe(false)
    expect(isRetryable({ status: 403 })).toBe(false)
  })
  it('retries known network codes only', () => {
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true)
    expect(isRetryable(new Error('boom'))).toBe(false)
  })
})

describe('parseRetryAfter', () => {
  it('parses integer seconds to ms', () => {
    expect(parseRetryAfter({ headers: { 'retry-after': '2' } })).toBe(2000)
  })
  it('is undefined when absent', () => {
    expect(parseRetryAfter({ headers: {} })).toBeUndefined()
  })
})

describe('withRetry', () => {
  it('succeeds after transient failures', async () => {
    let calls = 0
    const out = await withRetry(async () => { calls++; if (calls < 3) throw { status: 503 }; return 'ok' }, { sleep: instant, random: noJitter })
    expect(out).toBe('ok')
    expect(calls).toBe(3)
  })
  it('gives up after maxRetries and rethrows', async () => {
    let calls = 0
    await expect(withRetry(async () => { calls++; throw { status: 503 } }, { maxRetries: 2, sleep: instant, random: noJitter }))
      .rejects.toEqual({ status: 503 })
    expect(calls).toBe(3)
  })
  it('does not retry a non-retryable error', async () => {
    let calls = 0
    await expect(withRetry(async () => { calls++; throw { status: 400 } }, { sleep: instant })).rejects.toEqual({ status: 400 })
    expect(calls).toBe(1)
  })
  it('stops retrying once the signal is aborted', async () => {
    const ac = new AbortController()
    let calls = 0
    await expect(withRetry(async () => { calls++; ac.abort(); throw { status: 503 } }, { signal: ac.signal, sleep: instant }))
      .rejects.toEqual({ status: 503 })
    expect(calls).toBe(1)
  })
})
