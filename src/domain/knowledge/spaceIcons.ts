/**
 * Curated emoji set for knowledge-space icons (stored as plain strings in meta).
 * Not a full emoji picker — short list + free-form paste covers the product need.
 */
export const SPACE_ICON_PRESETS = [
  '📚',
  '📖',
  '📝',
  '💡',
  '🎯',
  '🚀',
  '📊',
  '📈',
  '💹',
  '💼',
  '🧠',
  '🔧',
  '🧪',
  '🌱',
  '⭐',
  '🗂️',
  '🏠',
  '🎨',
  '💻',
  '📎',
  '🔑',
  '📌',
  '🌐',
  '✨',
  '📦',
  '🔬',
] as const

/** Trim and cap length so meta cannot store arbitrary blobs as “icon”. */
export function normalizeSpaceIcon(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined
  const t = raw.trim()
  if (!t) return undefined
  // Multi-codepoint emoji sequences; keep generous but bounded.
  if (t.length > 16) return t.slice(0, 16)
  return t
}
