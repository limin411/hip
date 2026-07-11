import type { ActiveView } from '@/store/uiStore'

/**
 * Session id for palette context commands.
 * Prefer the active surface; on History/Settings fall back to remembered chat then code.
 */
export function resolvePaletteSessionId(
  activeView: ActiveView,
  chatSessionId: string | null,
  codeSessionId: string | null,
): string | null {
  if (activeView === 'chat') return chatSessionId
  if (activeView === 'code') return codeSessionId
  return chatSessionId ?? codeSessionId
}
