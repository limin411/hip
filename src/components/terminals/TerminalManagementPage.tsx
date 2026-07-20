import { useEffect } from 'react'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { ManagedTerminalSession } from './ManagedTerminalSession'
import { HostLibrary } from './HostLibrary'

/**
 * Terminal management main surface.
 * - focusedId null → HostLibrary (default landing)
 * - focusedId set → single mounted ManagedTerminalSession (D6a exclusive XtermSurface)
 *
 * Keep-alive: leaving activeView terminals unmounts this page (and xterm) but does not
 * kill PTYs — managedTerminalStore + terminalStore rings persist for the process.
 */
export function TerminalManagementPage() {
  const focusedId = useManagedTerminalStore((s) => s.focusedId)

  // Warm host catalog so Quick connect / library are available immediately.
  useEffect(() => {
    if (!useTerminalHostStore.getState().loaded) {
      void useTerminalHostStore.getState().load()
    }
  }, [])

  // Focused session mode — at most one XtermSurface (D6a).
  if (focusedId) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="terminal-management-page">
        <ManagedTerminalSession terminalId={focusedId} />
      </div>
    )
  }

  // Host library (PR4) — default landing when nothing focused.
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="terminal-management-page">
      <HostLibrary />
    </div>
  )
}
