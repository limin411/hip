import type { StylePreset } from '@/store/stylesStore'

export type StyleLabel =
  | { kind: 'none' }
  | { kind: 'custom' }
  | { kind: 'preset'; name: string }

/** Resolve the chip label for a session's instructions: a matching preset's name,
 *  'custom' when set but unmatched, or 'none' when unset. Pure (copy semantics). */
export function resolveStyleLabel(systemPrompt: string | undefined, presets: StylePreset[]): StyleLabel {
  if (!systemPrompt) return { kind: 'none' }
  const match = presets.find((p) => p.text === systemPrompt)
  return match ? { kind: 'preset', name: match.name } : { kind: 'custom' }
}
