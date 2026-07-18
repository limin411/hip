import { create } from 'zustand'
import { nanoid } from 'nanoid'

export interface DiffAnnotation {
  id: string
  path: string
  /** Unified hunk or selected line text. */
  body: string
  note?: string
  createdAt: number
}

interface DiffAnnotationState {
  bySession: Record<string, DiffAnnotation[]>
  add: (sessionId: string, ann: Omit<DiffAnnotation, 'id' | 'createdAt'> & { id?: string }) => string
  remove: (sessionId: string, id: string) => void
  clear: (sessionId: string) => void
  list: (sessionId: string) => DiffAnnotation[]
}

export const useDiffAnnotationStore = create<DiffAnnotationState>((set, get) => ({
  bySession: {},

  add: (sessionId, ann) => {
    const id = ann.id ?? nanoid(8)
    const item: DiffAnnotation = {
      id,
      path: ann.path,
      body: ann.body,
      note: ann.note,
      createdAt: Date.now(),
    }
    set((st) => ({
      bySession: {
        ...st.bySession,
        [sessionId]: [...(st.bySession[sessionId] ?? []), item],
      },
    }))
    return id
  },

  remove: (sessionId, id) => {
    set((st) => ({
      bySession: {
        ...st.bySession,
        [sessionId]: (st.bySession[sessionId] ?? []).filter((a) => a.id !== id),
      },
    }))
  },

  clear: (sessionId) => {
    set((st) => {
      const next = { ...st.bySession }
      delete next[sessionId]
      return { bySession: next }
    })
  },

  list: (sessionId) => get().bySession[sessionId] ?? [],
}))

/** Markdown + JSON block prepended to the user message when sending annotations (spec G2). */
export function formatDiffAnnotationsForComposer(anns: DiffAnnotation[]): string {
  if (anns.length === 0) return ''
  const payload = anns.map((a) => ({
    id: a.id,
    path: a.path,
    body: a.body,
    note: a.note ?? null,
    createdAt: a.createdAt,
  }))
  const human = anns
    .map((a, i) => {
      const note = a.note?.trim() ? `\nNote: ${a.note.trim()}` : ''
      return `### Annotation ${i + 1}: \`${a.path}\`${note}\n\`\`\`diff\n${a.body.trim()}\n\`\`\``
    })
    .join('\n\n')
  return (
    `## Diff annotations for agent\n` +
    `Please address the following review notes on the working tree diff.\n\n` +
    `${human}\n\n` +
    '```json\n' +
    `${JSON.stringify({ type: 'hip.diff_annotations', annotations: payload }, null, 2)}\n` +
    '```\n\n---\n\n'
  )
}
