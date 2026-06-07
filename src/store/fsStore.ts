import { create } from 'zustand'
import type { FsEntry } from '@hip/protocol'

export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | { status: 'ready'; path: string; content?: string; encoding?: 'utf8' | 'base64'; mimeType?: string; truncated?: boolean; error?: string }

export interface SessionFs {
  entriesByDir: Record<string, FsEntry[]>
  expanded: Record<string, boolean>
  activePath: string | null
  preview: PreviewState
}

export const EMPTY_FS: SessionFs = { entriesByDir: {}, expanded: {}, activePath: null, preview: { status: 'idle' } }

interface FsStore {
  bySession: Record<string, SessionFs>
  setEntries: (sessionId: string, dir: string, entries: FsEntry[]) => void
  toggleExpanded: (sessionId: string, dir: string) => void
  setActive: (sessionId: string, path: string) => void
  setPreview: (sessionId: string, preview: PreviewState) => void
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
  clearSession: (id) =>
    set((st) => ({ bySession: { ...st.bySession, [id]: EMPTY_FS } })),
}))
