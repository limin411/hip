import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { watchParentViaStdin } from './parent-watch.js'

// A minimal stand-in for process.stdin: an EventEmitter with a resume() spy.
function fakeStdin(opts?: { readableEnded?: boolean; destroyed?: boolean }): NodeJS.ReadStream {
  const s = new EventEmitter() as unknown as NodeJS.ReadStream & { resume: ReturnType<typeof vi.fn> }
  s.resume = vi.fn().mockReturnValue(s)
  Object.defineProperty(s, 'readableEnded', { value: opts?.readableEnded ?? false, configurable: true })
  Object.defineProperty(s, 'destroyed', { value: opts?.destroyed ?? false, configurable: true })
  return s
}

describe('watchParentViaStdin', () => {
  it('resumes stdin so an EOF (parent death) is actually observed', () => {
    const stdin = fakeStdin()
    watchParentViaStdin(() => {}, stdin)
    // Paused streams never emit 'end'; we must put it in flowing mode.
    expect((stdin as unknown as { resume: ReturnType<typeof vi.fn> }).resume).toHaveBeenCalled()
  })

  it("calls onParentExit when stdin emits 'end' (parent closed the pipe)", () => {
    const stdin = fakeStdin()
    const onExit = vi.fn()
    watchParentViaStdin(onExit, stdin)
    stdin.emit('end')
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it("calls onParentExit when stdin emits 'close'", () => {
    const stdin = fakeStdin()
    const onExit = vi.fn()
    watchParentViaStdin(onExit, stdin)
    stdin.emit('close')
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it("calls onParentExit when stdin emits 'error' with EPIPE (broken pipe = parent gone)", () => {
    const stdin = fakeStdin()
    const onExit = vi.fn()
    watchParentViaStdin(onExit, stdin)
    const err = Object.assign(new Error('EPIPE'), { code: 'EPIPE' })
    stdin.emit('error', err)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('does not treat unrelated stdin errors as parent death', () => {
    const stdin = fakeStdin()
    const onExit = vi.fn()
    watchParentViaStdin(onExit, stdin)
    stdin.emit('error', new Error('weird'))
    expect(onExit).not.toHaveBeenCalled()
  })

  it('does not exit when stdin is already closed (broken inherit on Windows)', () => {
    const stdin = fakeStdin({ readableEnded: true })
    const onExit = vi.fn()
    watchParentViaStdin(onExit, stdin)
    expect(onExit).not.toHaveBeenCalled()
    expect((stdin as unknown as { resume: ReturnType<typeof vi.fn> }).resume).not.toHaveBeenCalled()
  })

  it('invokes onParentExit at most once even if end then close both fire', () => {
    const stdin = fakeStdin()
    const onExit = vi.fn()
    watchParentViaStdin(onExit, stdin)
    stdin.emit('end')
    stdin.emit('close')
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
