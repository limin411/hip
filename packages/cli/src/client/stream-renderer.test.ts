import { describe, it, expect } from 'vitest'
import { StreamRenderer } from './stream-renderer.js'
import { Writable } from 'node:stream'

function capture() {
  let data = ''
  const w = new Writable({
    write(chunk, _enc, cb) {
      data += chunk.toString()
      cb()
    },
  })
  return { w, get: () => data }
}

describe('StreamRenderer', () => {
  it('text mode writes only text to textOut', () => {
    const text = capture()
    const meta = capture()
    const r = new StreamRenderer({
      mode: 'text',
      jsonForcesTextToStderr: false,
      textStream: text.w,
      metaStream: meta.w,
    })
    r.onTextDelta('hi')
    r.onTool({ callId: '1', name: 'read_file', phase: 'start' })
    r.endText()
    expect(text.get()).toBe('hi\n')
    expect(meta.get()).toBe('')
  })

  it('tools mode writes tools to meta only', () => {
    const text = capture()
    const meta = capture()
    const r = new StreamRenderer({
      mode: 'tools',
      jsonForcesTextToStderr: false,
      textStream: text.w,
      metaStream: meta.w,
    })
    r.onTextDelta('secret')
    r.onTool({ callId: '1', name: 'read_file', phase: 'start' })
    expect(text.get()).toBe('')
    expect(meta.get()).toContain('read_file')
  })

  it('none mode is silent', () => {
    const text = capture()
    const meta = capture()
    const r = new StreamRenderer({
      mode: 'none',
      jsonForcesTextToStderr: false,
      textStream: text.w,
      metaStream: meta.w,
    })
    r.onTextDelta('x')
    r.onTool({ callId: '1', name: 't', phase: 'finish' })
    r.onAgent({ phase: 'start', agentId: 'a' })
    expect(text.get() + meta.get()).toBe('')
  })
})
