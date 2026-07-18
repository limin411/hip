import type { DiffAnnotation } from '@/store/diffAnnotationStore'

/**
 * Structured block injected into outbound user messages (spec G2).
 * Prefer JSON fence for machine parse + human readable heading.
 */
export function formatAnnotationsStructured(anns: DiffAnnotation[]): string {
  if (anns.length === 0) return ''
  const payload = anns.map((a) => ({
    id: a.id,
    path: a.path,
    body: a.body,
    note: a.note ?? null,
    createdAt: a.createdAt,
  }))
  return (
    `## Diff annotations for agent\n` +
    `Please address the following review notes on the working tree diff.\n\n` +
    '```json\n' +
    `${JSON.stringify({ type: 'hip.diff_annotations', annotations: payload }, null, 2)}\n` +
    '```\n\n---\n\n'
  )
}

/** Detect structured annotation block in a user message (tests / guards). */
export function messageHasAnnotationInject(text: string): boolean {
  return text.includes('"type": "hip.diff_annotations"') || text.includes('"type":"hip.diff_annotations"')
}
