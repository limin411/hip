/**
 * Document content column width (General Settings → 文档宽度).
 * Persisted via hip.toml `[knowledge].doc_width` (KnowledgeConfig).
 * Applied as `--kb-measure` / `data-doc-width` on the knowledge paper host.
 */
import { DOC_WIDTH_IDS, isDocWidthId, type DocWidthId } from '@hip/protocol'

export type { DocWidthId }
export { DOC_WIDTH_IDS }

/** Normalize raw config / persisted values; unknown or missing → `default`. */
export function normalizeDocWidthId(raw: string | undefined | null): DocWidthId {
  if (!raw) return 'default'
  const id = raw.trim().toLowerCase()
  return isDocWidthId(id) ? id : 'default'
}

/** CSS `--kb-measure` values for each preference. */
export const DOC_WIDTH_MEASURE: Record<DocWidthId, string> = {
  default: 'min(100%, 44.25rem)',
  wide: 'min(100%, 72rem)',
  full: '100%',
}
