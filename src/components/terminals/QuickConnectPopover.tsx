import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isDirectory } from '@/ipc/pathExists'
import type { RecentLaunch } from '@/ipc/terminalHosts'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { enterTerminalsSection } from '@/components/layout/sidebarActions'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/Popover'
import { cn } from '@/lib/utils'

/**
 * 快捷连接 — last 5 successful launches (K11).
 * Local + SSH rows launch immediately.
 */
export function QuickConnectPopover() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const recents = useTerminalHostStore((s) => s.recents)
  const hosts = useTerminalHostStore((s) => s.hosts)
  const loaded = useTerminalHostStore((s) => s.loaded)
  const [missingLocal, setMissingLocal] = useState<Record<string, boolean>>({})
  const [launching, setLaunching] = useState(false)

  useEffect(() => {
    if (!loaded) {
      void useTerminalHostStore.getState().load()
    }
  }, [loaded])

  // Probe local cwd existence when popover opens (disabled rows for missing paths).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const locals = recents.filter((r): r is Extract<RecentLaunch, { type: 'local' }> => r.type === 'local')
    void (async () => {
      const next: Record<string, boolean> = {}
      await Promise.all(
        locals.map(async (r) => {
          const exists = await isDirectory(r.cwd)
          // null = unknown (non-Tauri) → treat as available so dogfood still works in tests.
          next[r.cwd] = exists === false
        }),
      )
      if (!cancelled) setMissingLocal(next)
    })()
    return () => {
      cancelled = true
    }
  }, [open, recents])

  const onPickLocal = useCallback(
    async (r: Extract<RecentLaunch, { type: 'local' }>) => {
      if (missingLocal[r.cwd]) return
      setLaunching(true)
      try {
        await useManagedTerminalStore.getState().openLocal({ cwd: r.cwd, label: r.label })
        // Bring TerminalManagementPage into view when chrome left activeView elsewhere.
        await enterTerminalsSection()
        setOpen(false)
      } catch (e) {
        console.error('[hip] quick connect local failed:', e)
      } finally {
        setLaunching(false)
      }
    },
    [missingLocal],
  )

  const onPickSsh = useCallback(
    async (r: Extract<RecentLaunch, { type: 'ssh' }>) => {
      const host = hosts.find((h) => h.id === r.hostId)
      if (!host) return
      setLaunching(true)
      try {
        await useManagedTerminalStore.getState().openSsh(host)
        await enterTerminalsSection()
        setOpen(false)
      } catch (e) {
        console.error('[hip] quick connect ssh failed:', e)
      } finally {
        setLaunching(false)
      }
    },
    [hosts],
  )

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="terminals-quick-connect"
          data-no-drag
          title={t('sidebar.quickConnect')}
          className={cn(
            'rounded-md px-1.5 py-0.5 text-caption text-ink-tertiary transition-colors duration-chrome',
            'hover:bg-state-hover hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
            open && 'bg-state-hover text-ink',
          )}
        >
          {t('sidebar.quickConnect')}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="w-[min(280px,calc(100vw-2rem))] p-0"
        data-testid="terminals-quick-connect-popover"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-b border-border px-3 py-2">
          <div className="flex items-center gap-1.5 text-meta font-medium text-ink">
            <History size={13} className="shrink-0 text-ink-tertiary" aria-hidden />
            {t('sidebar.quickConnect')}
          </div>
        </div>
        {recents.length === 0 ? (
          <p
            className="px-3 py-4 text-center text-meta text-ink-tertiary"
            role="status"
            data-testid="terminals-quick-connect-empty"
          >
            {t('terminals.quickConnectEmpty')}
          </p>
        ) : (
          <ul className="m-0 max-h-64 list-none overflow-y-auto p-1" role="list">
            {recents.map((r) => {
              if (r.type === 'local') {
                const missing = missingLocal[r.cwd] === true
                const label = r.label?.trim() || r.cwd
                return (
                  <li key={`local:${r.cwd}`}>
                    <button
                      type="button"
                      disabled={missing || launching}
                      title={missing ? t('terminals.cwdMissing') : r.cwd}
                      data-testid={`quick-connect-local-${r.cwd}`}
                      onClick={() => void onPickLocal(r)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        missing || launching
                          ? 'cursor-not-allowed opacity-50'
                          : 'hover:bg-state-hover',
                      )}
                    >
                      <Terminal size={14} className="mt-0.5 shrink-0 text-ink-tertiary" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-ink">{label}</span>
                        <span className="block truncate font-mono text-caption text-ink-tertiary">
                          {r.cwd}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              }
              const host = hosts.find((h) => h.id === r.hostId)
              const missing = !host
              const subtitle = host
                ? `${host.username}@${host.hostname}:${host.port}`
                : t('terminals.hostMissing')
              return (
                <li key={`ssh:${r.hostId}`}>
                  <button
                    type="button"
                    disabled={missing || launching}
                    title={missing ? t('terminals.hostMissing') : subtitle}
                    data-testid={`quick-connect-ssh-${r.hostId}`}
                    onClick={() => void onPickSsh(r)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      missing || launching
                        ? 'cursor-not-allowed opacity-50'
                        : 'hover:bg-state-hover',
                    )}
                  >
                    <Terminal size={14} className="mt-0.5 shrink-0 text-ink-tertiary" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-ink">{r.label}</span>
                      <span className="block truncate font-mono text-caption text-ink-tertiary">
                        {subtitle}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {launching ? (
          <div className="flex items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-meta text-ink-tertiary">
            <Loader2 size={12} className="animate-spin" aria-hidden />
            {t('terminals.connecting')}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
