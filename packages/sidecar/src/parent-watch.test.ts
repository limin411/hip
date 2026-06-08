import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { watchParentViaStdin } from './parent-watch.js'

// A minimal stand-in for process.stdin: an EventEmitter with a resume() spy.
function fakeStdin(): NodeJS.ReadStream {
  const s = new EventEmitter() as unknown as NodeJS.ReadStream & { resume: ReturnType<typeof vi.fn> }
  s.resume = vi.fn().mockReturnValue(s)
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

  it("calls onParentExit when stdin emits 'error' (broken pipe = parent gone)", () => {
    const stdin = fakeStdin()
    const onExit = vi.fn()
    watchParentViaStdin(onExit, stdin)
    stdin.emit('error', new Error('EPIPE'))
    expect(onExit).toHaveBeenCalledTimes(1)
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
