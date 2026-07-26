/** Append a final ASR transcript to the composer draft. */
export function appendTranscript(prev: string, text: string): string {
  const t = text.trim()
  if (!t) return prev
  if (!prev) return t
  if (/\s$/.test(prev)) return prev + t
  return prev + ' ' + t
}
