import { create } from 'zustand'
import type { FsEntry } from '@hip/protocol'

export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | { status: 'ready'; path: string; content?: string; encoding?: 'utf8' | 'base64'; mimeType?: string; truncated?: boolean; error?: string }

export type PreviewReadyPayload = {
  path: string
  content?: string
  encoding?: 'utf8' | 'base64'
  mimeType?: string
  truncated?: boolean
  error?: string
}

export interface SessionFs {
  entriesByDir: Record<string, FsEntry[]>
  expanded: Record<string, boolean>
  activePath: string | null
  preview: PreviewState
}

export const EMPTY_FS: SessionFs = { entriesByDir: {}, expanded: {}, activePath: null, preview: { status: 'idle' } }

/**
 * Whether an inbound fs:read result should replace the current preview.
 * Drops stale in-flight results when the user (or write-follow) already
 * requested a different path — e.g. message:complete re-reads activePath
 * then auto-opens a deliverable; the older read must not overwrite.
 */
export function shouldApplyPreviewResult(
  current: PreviewState | undefined,
  activePath: string | null | undefined,
  resultPath: string,
): boolean {
  if (!current || current.status === 'idle') return true
  if (current.status === 'loading') return current.path === resultPath
  // ready: accept refresh of the same file, or results matching the active selection
  if (current.path === resultPath) return true
  if (activePath != null && activePath === resultPath) return true
  return false
}

interface FsStore {
  bySession: Record<string, SessionFs>
  setEntries: (sessionId: string, dir: string, entries: FsEntry[]) => void
  toggleExpanded: (sessionId: string, dir: string) => void
  setActive: (sessionId: string, path: string) => void
  setPreview: (sessionId: string, preview: PreviewState) => void
  /** Apply a ready preview only if it is not a stale in-flight read. */
  applyPreviewResult: (sessionId: string, payload: PreviewReadyPayload) => void
  clearSession: (sessionId: string) => void
}

function patch(bySession: Record<string, SessionFs>, id: string, fn: (s: SessionFs) => SessionFs): Record<string, SessionFs> {
  return { ...bySession, [id]: fn(bySession[id] ?? EMPTY_FS) }
}

export const useFsStore = create<FsStore>((set) => ({
  bySession: {},
  setEntries: (id, dir, entries) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, entriesByDir: { ...s.entriesByDir, [dir]: entries } })) })),
  toggleExpanded: (id, dir) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, expanded: { ...s.expanded, [dir]: !s.expanded[dir] } })) })),
  setActive: (id, path) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, activePath: path })) })),
  setPreview: (id, preview) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, preview })) })),
  applyPreviewResult: (id, payload) =>
    set((st) => {
      const cur = st.bySession[id] ?? EMPTY_FS
      if (!shouldApplyPreviewResult(cur.preview, cur.activePath, payload.path)) return st
      return {
        bySession: patch(st.bySession, id, (s) => ({
          ...s,
          preview: {
            status: 'ready',
            path: payload.path,
            content: payload.content,
            encoding: payload.encoding,
            mimeType: payload.mimeType,
            truncated: payload.truncated,
            error: payload.error,
          },
        })),
      }
    }),
  clearSession: (id) =>
    set((st) => ({ bySession: { ...st.bySession, [id]: EMPTY_FS } })),
}))
