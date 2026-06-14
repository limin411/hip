import { describe, it, expect } from 'vitest'
import type { ToolCall } from '@hip/protocol'
import { extractRenderedArtifacts, type RenderedArtifact } from './renderedArtifacts'

function tc(over: Partial<ToolCall>): ToolCall {
  return { callId: 'c', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', seq: 0, ...over }
}

describe('extractRenderedArtifacts', () => {
  it('keeps finished write_file calls whose path is renderable', () => {
    const calls: ToolCall[] = [
      tc({ callId: 'c1', seq: 1, input: JSON.stringify({ path: '/p/page.html' }) }),
      tc({ callId: 'c2', seq: 2, input: JSON.stringify({ path: '/p/notes.md' }) }),
      tc({ callId: 'c3', seq: 3, input: JSON.stringify({ path: '/p/logo.png' }) }),
      tc({ callId: 'c4', seq: 4, input: JSON.stringify({ path: '/p/report.pdf' }) }),
      tc({ callId: 'c5', seq: 5, input: JSON.stringify({ path: '/p/icon.svg' }) }),
    ]
    expect(extractRenderedArtifacts(calls)).toEqual<RenderedArtifact[]>([
      { path: '/p/page.html', name: 'page.html', kind: 'html' },
      { path: '/p/notes.md', name: 'notes.md', kind: 'markdown' },
      { path: '/p/logo.png', name: 'logo.png', kind: 'image' },
      { path: '/p/report.pdf', name: 'report.pdf', kind: 'pdf' },
      { path: '/p/icon.svg', name: 'icon.svg', kind: 'image' },
    ])
  })

  it('skips source-code and unknown files (previewKind text/none)', () => {
    const calls: ToolCall[] = [
      tc({ callId: 'c1', seq: 1, input: JSON.stringify({ path: '/p/main.ts' }) }),
      tc({ callId: 'c2', seq: 2, input: JSON.stringify({ path: '/p/blob' }) }),
      tc({ callId: 'c3', seq: 3, input: JSON.stringify({ path: '/p/ok.md' }) }),
    ]
    expect(extractRenderedArtifacts(calls)).toEqual<RenderedArtifact[]>([
      { path: '/p/ok.md', name: 'ok.md', kind: 'markdown' },
    ])
  })

  it('ignores non-finished write_file and non-write_file calls', () => {
    const calls: ToolCall[] = [
      tc({ callId: 'c1', seq: 1, status: 'running', input: JSON.stringify({ path: '/p/a.png' }) }),
      tc({ callId: 'c2', seq: 2, status: 'error', input: JSON.stringify({ path: '/p/b.png' }) }),
      tc({ callId: 'c3', seq: 3, name: 'edit_file', input: JSON.stringify({ path: '/p/c.md' }) }),
      tc({ callId: 'c4', seq: 4, name: 'read_file', input: JSON.stringify({ path: '/p/d.html' }) }),
      tc({ callId: 'c5', seq: 5, input: JSON.stringify({ path: '/p/keep.html' }) }),
    ]
    expect(extractRenderedArtifacts(calls)).toEqual<RenderedArtifact[]>([
      { path: '/p/keep.html', name: 'keep.html', kind: 'html' },
    ])
  })

  it('dedups by path keeping the last write, in first-seen order', () => {
    const calls: ToolCall[] = [
      tc({ callId: 'c1', seq: 1, input: JSON.stringify({ path: '/p/a.html' }) }),
      tc({ callId: 'c2', seq: 2, input: JSON.stringify({ path: '/p/b.md' }) }),
      tc({ callId: 'c3', seq: 3, input: JSON.stringify({ path: '/p/a.html' }) }),
    ]
    const out = extractRenderedArtifacts(calls)
    expect(out.map((a) => a.path)).toEqual(['/p/a.html', '/p/b.md'])
  })

  it('drops calls with malformed JSON or a missing/non-string path', () => {
    const calls: ToolCall[] = [
      tc({ callId: 'c1', seq: 1, input: 'not json' }),
      tc({ callId: 'c2', seq: 2, input: JSON.stringify({ nope: 1 }) }),
      tc({ callId: 'c3', seq: 3, input: JSON.stringify({ path: 42 }) }),
      tc({ callId: 'c4', seq: 4, input: JSON.stringify({ path: '/p/good.png' }) }),
    ]
    expect(extractRenderedArtifacts(calls)).toEqual<RenderedArtifact[]>([
      { path: '/p/good.png', name: 'good.png', kind: 'image' },
    ])
  })

  it('recovers the path from a >4KB write_file input truncated mid-content', () => {
    // Mirror the sidecar clip: real JSON whose `content` overflows ~4 KB, then chopped → invalid JSON.
    const full = JSON.stringify({ path: '/p/big.html', content: '<div>' + 'x'.repeat(8000) + '</div>' })
    const clipped = full.slice(0, 4096)
    expect(() => JSON.parse(clipped)).toThrow() // sanity: the clipped input is unparseable
    const calls: ToolCall[] = [tc({ callId: 'c1', seq: 1, input: clipped, truncated: true })]
    expect(extractRenderedArtifacts(calls)).toEqual<RenderedArtifact[]>([
      { path: '/p/big.html', name: 'big.html', kind: 'html' },
    ])
  })

  it('decodes JSON escapes in a recovered path', () => {
    const full = JSON.stringify({ path: '/p/a "b".md', content: 'y'.repeat(8000) })
    const clipped = full.slice(0, 4096)
    const calls: ToolCall[] = [tc({ callId: 'c1', seq: 1, input: clipped, truncated: true })]
    expect(extractRenderedArtifacts(calls)).toEqual<RenderedArtifact[]>([
      { path: '/p/a "b".md', name: 'a "b".md', kind: 'markdown' },
    ])
  })

  it('drops a truncated input with no recoverable path', () => {
    // content-first ordering: the `path` key was clipped off entirely → nothing to recover.
    const full = JSON.stringify({ content: 'z'.repeat(8000), path: '/p/late.html' })
    const clipped = full.slice(0, 4096)
    const calls: ToolCall[] = [tc({ callId: 'c1', seq: 1, input: clipped, truncated: true })]
    expect(extractRenderedArtifacts(calls)).toEqual([])
  })

  it('returns [] for undefined or empty input', () => {
    expect(extractRenderedArtifacts(undefined)).toEqual([])
    expect(extractRenderedArtifacts([])).toEqual([])
  })
})
