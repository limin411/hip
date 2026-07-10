import type { ToolCall, Message } from '@hip/protocol'
import { previewKind, type PreviewKind } from '@/components/artifact/previewKind'

/** A renderable file the agent wrote this turn — surfaced as an artifact-card row. */
export interface RenderedArtifact {
  path: string
  name: string
  kind: Extract<PreviewKind, 'image' | 'markdown' | 'html' | 'pdf'>
}

const RENDERABLE: ReadonlySet<PreviewKind> = new Set(['image', 'markdown', 'html', 'pdf'])

/**
 * Recover a `"path"` value from possibly-truncated JSON via regex. The sidecar clips ToolCall.input
 * to ~4 KB, so a large write_file's content overflows and JSON.parse throws — but `path` precedes
 * `content` in practice, so the leading `"path":"…"` literal usually survives the clip. Matches a
 * JSON string literal (handling escapes) and decodes it. Null if no recoverable path.
 */
function recoverPath(input: string): string | null {
  const m = /"path"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(input)
  if (!m) return null
  try {
    return JSON.parse('"' + m[1] + '"') as string
  } catch {
    return null
  }
}

/**
 * Recover path from write_file's success confirmation (`wrote /path (N bytes)`). Used when the
 * clipped input is content-first and the `"path"` key was chopped off entirely — the short
 * confirmation string still carries the path reliably.
 */
function pathFromWriteOutput(output?: string): string | null {
  if (!output) return null
  const m = /^wrote (.+) \(\d+ bytes\)$/.exec(output.trim())
  return m ? m[1] : null
}

/** Parse a write_file ToolCall.input (JSON) and return its `.path`, or null; never throws. When the
 *  input was clipped (`truncated`) or JSON.parse fails, fall back to a leading-`path` regex so the
 *  large HTML/MD/SVG/PDF artifacts the card targets aren't silently dropped. When input still has
 *  no path, fall back to the write confirmation in `output`. */
function pathOf(input: string, truncated?: boolean, output?: string): string | null {
  if (!truncated) {
    try {
      const p = (JSON.parse(input) as { path?: unknown }).path
      if (typeof p === 'string') return p
    } catch {
      const recovered = recoverPath(input)
      if (recovered) return recovered
    }
  } else {
    const recovered = recoverPath(input)
    if (recovered) return recovered
  }
  return pathFromWriteOutput(output)
}

function basename(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

/**
 * Renderable files written this turn, for the aggregate artifact card. Filters finished
 * `write_file` calls, parses `.path`, keeps only renderable previewKinds (image/markdown/html/pdf
 * — source files map to text/none and are dropped), and dedups by path keeping the LAST write
 * (later seq wins) while preserving first-seen order. A turn's Message.toolCalls flattens child
 * runs' calls, so a sub-agent's writes are included by design. Never throws.
 */
export function extractRenderedArtifacts(toolCalls?: ToolCall[]): RenderedArtifact[] {
  if (!toolCalls || toolCalls.length === 0) return []
  // Last write per path wins: sort a shallow copy by seq, build a path→artifact map, then
  // re-emit in first-seen order.
  const byPath = new Map<string, RenderedArtifact>()
  const order: string[] = []
  const sorted = [...toolCalls].sort((a, b) => a.seq - b.seq)
  for (const tc of sorted) {
    if (tc.name !== 'write_file' || tc.status !== 'finished') continue
    const path = pathOf(tc.input, tc.truncated, tc.output)
    if (!path) continue
    const kind = previewKind(path)
    if (!RENDERABLE.has(kind)) continue
    if (!byPath.has(path)) order.push(path)
    byPath.set(path, { path, name: basename(path), kind: kind as RenderedArtifact['kind'] })
  }
  return order.map((p) => byPath.get(p)!)
}

/** Conversation-level rollup of renderable artifacts: the union of every assistant turn's
 *  extractRenderedArtifacts, deduped by path keeping the LAST write while preserving first-seen
 *  order. Drives the Chat surface's PreviewPanel list. Never throws. */
export function collectConversationArtifacts(messages: Message[]): RenderedArtifact[] {
  const byPath = new Map<string, RenderedArtifact>()
  const order: string[] = []
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    for (const a of extractRenderedArtifacts(m.toolCalls)) {
      if (!byPath.has(a.path)) order.push(a.path)
      byPath.set(a.path, a)
    }
  }
  return order.map((p) => byPath.get(p)!)
}
