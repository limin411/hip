import { useGlobalHotkeys } from './useGlobalHotkeys'

/** Mount-only side-effect component for ⌘K / Ctrl+K. */
export function GlobalHotkeysBinder() {
  useGlobalHotkeys()
  return null
}
