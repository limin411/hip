import { describe, it, expect } from 'vitest'
import type { ToolCall, Message } from '@hip/protocol'
import {
  extractRenderedArtifacts,
  extractAutoOpenArtifacts,
  collectConversationArtifacts,
  isAutoOpenPanelArtifactPath,
  type RenderedArtifact,
} from './renderedArtifacts'

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

  it('recovers path from write_file confirmation when clipped input is content-first', () => {
    // content-first + clip chops `"path"` off; output still carries `wrote /p/late.html (N bytes)`.
    const full = JSON.stringify({ content: 'z'.repeat(8000), path: '/p/late.html' })
    const clipped = full.slice(0, 4096)
    const calls: ToolCall[] = [
      tc({
        callId: 'c1',
        seq: 1,
        input: clipped,
        truncated: true,
        output: 'wrote /p/late.html (8000 bytes)',
      }),
    ]
    expect(extractRenderedArtifacts(calls)).toEqual<RenderedArtifact[]>([
      { path: '/p/late.html', name: 'late.html', kind: 'html' },
    ])
  })

  it('returns [] for undefined or empty input', () => {
    expect(extractRenderedArtifacts(undefined)).toEqual([])
    expect(extractRenderedArtifacts([])).toEqual([])
  })
})

describe('extractAutoOpenArtifacts / isAutoOpenPanelArtifactPath', () => {
  it('keeps durable renderable deliverables', () => {
    expect(isAutoOpenPanelArtifactPath('/p/page.html')).toBe(true)
    expect(isAutoOpenPanelArtifactPath('/p/report.md')).toBe(true)
    expect(isAutoOpenPanelArtifactPath('/p/logo.png')).toBe(true)
    expect(isAutoOpenPanelArtifactPath('/p/out.pdf')).toBe(true)
  })

  it('drops source, process intermediates, and ephemeral paths', () => {
    expect(isAutoOpenPanelArtifactPath('/p/main.ts')).toBe(false)
    expect(isAutoOpenPanelArtifactPath('/p/notes_draft.md')).toBe(false)
    expect(isAutoOpenPanelArtifactPath('/p/wip-outline.md')).toBe(false)
    expect(isAutoOpenPanelArtifactPath('/tmp/a.md')).toBe(false)
    expect(isAutoOpenPanelArtifactPath('/proj/scratch/note.md')).toBe(false)
  })

  it('keeps chat sandbox deliverables under ~/.hip/scratch/<session>/', () => {
    expect(isAutoOpenPanelArtifactPath('/Users/x/.hip/scratch/s1/page.html')).toBe(true)
    expect(isAutoOpenPanelArtifactPath('/Users/x/.hip/scratch/s1/report.md')).toBe(true)
  })

  it('filters turn writes to durable products only (cards still use extractRenderedArtifacts)', () => {
    const calls: ToolCall[] = [
      tc({ callId: 'c1', seq: 1, input: JSON.stringify({ path: '/p/notes_draft.md' }) }),
      tc({ callId: 'c2', seq: 2, input: JSON.stringify({ path: '/p/page.html' }) }),
      tc({ callId: 'c3', seq: 3, input: JSON.stringify({ path: '/tmp/x.md' }) }),
      tc({ callId: 'c4', seq: 4, input: JSON.stringify({ path: '/p/main.ts' }) }),
    ]
    expect(extractRenderedArtifacts(calls).map((a) => a.path)).toEqual([
      '/p/notes_draft.md',
      '/p/page.html',
      '/tmp/x.md',
    ])
    expect(extractAutoOpenArtifacts(calls)).toEqual<RenderedArtifact[]>([
      { path: '/p/page.html', name: 'page.html', kind: 'html' },
    ])
  })
})

function asstMsg(id: string, toolCalls: Message['toolCalls']): Message {
  return { id, role: 'assistant', content: '', timestamp: 1, toolCalls }
}
const w = (callId: string, path: string, seq: number) =>
  ({ callId, agentId: 'supervisor', name: 'write_file', input: JSON.stringify({ path }), status: 'finished' as const, seq })

describe('collectConversationArtifacts', () => {
  it('aggregates renderable artifacts across assistant turns, last write wins, first-seen order', () => {
    const messages: Message[] = [
      asstMsg('a', [w('1', '/doc.md', 0), w('2', '/pic.png', 1)]),
      { id: 'u', role: 'user', content: 'x', timestamp: 2 },
      asstMsg('b', [w('3', '/doc.md', 0)]),
    ]
    const out = collectConversationArtifacts(messages)
    expect(out.map((a) => a.path)).toEqual(['/doc.md', '/pic.png'])
  })
  it('ignores user messages and non-renderable writes; empty input → []', () => {
    expect(collectConversationArtifacts([])).toEqual([])
    expect(collectConversationArtifacts([asstMsg('a', [w('1', '/main.ts', 0)])])).toEqual([])
  })
})
