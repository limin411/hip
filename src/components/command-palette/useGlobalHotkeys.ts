import { useEffect } from 'react'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'

/**
 * Toggle the global command palette with ⌘K / Ctrl+K.
 * Mount only when GLOBAL_COMMAND_PALETTE is enabled (AppLayout gate).
 * Opening the palette leaves slash dismissal to consumers watching `open` (D18).
 */
export function useGlobalHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.key.toLowerCase() !== 'k') return
      // Avoid firing while the user is composing in IME.
      if (e.isComposing) return
      e.preventDefault()
      useCommandPaletteStore.getState().toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
