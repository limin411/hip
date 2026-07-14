/** Single large-doc threshold used everywhere (edit, index, snapshots). */
export const KNOWLEDGE_LARGE_DOC_CHARS = 512_000
/** Versions retained per doc. */
export const KNOWLEDGE_VERSION_CAP = 30

/** Local calendar day key `YYYY-MM-DD` for daily snapshots (system local TZ). */
export function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
