import type { ToolCall } from '@hip/protocol'
import { previewKind, type PreviewKind } from '@/components/artifact/previewKind'

/** A renderable file the agent wrote this turn — surfaced as an artifact-card row. */
export interface RenderedArtifact {
  path: string
  name: string
  kind: Extract<PreviewKind, 'image' | 'markdown' | 'html' | 'pdf'>
}

const RENDERABLE: ReadonlySet<PreviewKind> = new Set(['image', 'markdown', 'html', 'pdf'])

/** Parse a write_file ToolCall.input (JSON) and return its `.path`, or null; never throws. */
function pathOf(input: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    return null
  }
  const p = (parsed as { path?: unknown }).path
  return typeof p === 'string' ? p : null
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
    const path = pathOf(tc.input)
    if (!path) continue
    const kind = previewKind(path)
    if (!RENDERABLE.has(kind)) continue
    if (!byPath.has(path)) order.push(path)
    byPath.set(path, { path, name: basename(path), kind: kind as RenderedArtifact['kind'] })
  }
  return order.map((p) => byPath.get(p)!)
}
