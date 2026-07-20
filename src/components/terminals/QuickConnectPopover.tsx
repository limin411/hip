import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, History, Loader2, Plus, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isDirectory } from '@/ipc/pathExists'
import { pickDirectory } from '@/ipc/dialog'
import type { RecentLaunch } from '@/ipc/terminalHosts'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { enterTerminalsSection } from '@/components/layout/sidebarActions'
import { useHostLibraryUi } from '@/components/terminals/hostLibraryUi'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/Popover'
import { cn } from '@/lib/utils'

/**
 * Single trailing action under 终端管理 (matches chat / code / knowledge):
 * one "新建终端" button → popover with create actions + 快捷连接 recents (K11).
 * Command palette can open via `useHostLibraryUi.requestOpenQuickConnect`.
 */
export function QuickConnectPopover() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const recents = useTerminalHostStore((s) => s.recents)
  const hosts = useTerminalHostStore((s) => s.hosts)
  const loaded = useTerminalHostStore((s) => s.loaded)
  const quickConnectOpenTick = useHostLibraryUi((s) => s.quickConnectOpenTick)
  const [missingLocal, setMissingLocal] = useState<Record<string, boolean>>({})
  const [launching, setLaunching] = useState(false)

  useEffect(() => {
    if (!loaded) {
      void useTerminalHostStore.getState().load()
    }
  }, [loaded])

  // Palette / external "Quick connect" — open after terminals section mounts.
  useEffect(() => {
    if (quickConnectOpenTick > 0) {
      setOpen(true)
    }
  }, [quickConnectOpenTick])

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

  const finishLaunch = useCallback(async () => {
    await enterTerminalsSection()
    setOpen(false)
  }, [])

  const onNewLocal = useCallback(async () => {
    setLaunching(true)
    try {
      await useManagedTerminalStore.getState().openLocal()
      await finishLaunch()
    } catch (e) {
      console.error('[hip] open local terminal failed:', e)
    } finally {
      setLaunching(false)
    }
  }, [finishLaunch])

  const onNewLocalFolder = useCallback(async () => {
    const dir = await pickDirectory()
    if (!dir) return
    setLaunching(true)
    try {
      await useManagedTerminalStore.getState().openLocal({ cwd: dir })
      await finishLaunch()
    } catch (e) {
      console.error('[hip] open local terminal failed:', e)
    } finally {
      setLaunching(false)
    }
  }, [finishLaunch])

  const onNewRemote = useCallback(() => {
    void (async () => {
      // Unfocus any session so HostLibrary mounts and can open the form.
      useManagedTerminalStore.getState().focus(null)
      await enterTerminalsSection()
      useHostLibraryUi.getState().requestCreateHost()
      setOpen(false)
    })()
  }, [])

  const onPickLocal = useCallback(
    async (r: Extract<RecentLaunch, { type: 'local' }>) => {
      if (missingLocal[r.cwd]) return
      setLaunching(true)
      try {
        await useManagedTerminalStore.getState().openLocal({ cwd: r.cwd, label: r.label })
        await finishLaunch()
      } catch (e) {
        console.error('[hip] quick connect local failed:', e)
      } finally {
        setLaunching(false)
      }
    },
    [missingLocal, finishLaunch],
  )

  const onPickSsh = useCallback(
    async (r: Extract<RecentLaunch, { type: 'ssh' }>) => {
      const host = hosts.find((h) => h.id === r.hostId)
      if (!host) return
      setLaunching(true)
      try {
        await useManagedTerminalStore.getState().openSsh(host)
        await finishLaunch()
      } catch (e) {
        console.error('[hip] quick connect ssh failed:', e)
      } finally {
        setLaunching(false)
      }
    },
    [hosts, finishLaunch],
  )

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="sidebar-new-terminal"
          data-no-drag
          title={t('sidebar.newTerminal')}
          className={cn(
            'rounded-md px-1.5 py-0.5 text-caption text-ink-tertiary transition-colors duration-chrome',
            'hover:bg-state-hover hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
            open && 'bg-state-hover text-ink',
          )}
        >
          {t('sidebar.newTerminal')}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-[min(280px,calc(100vw-2rem))] p-0"
        data-testid="terminals-new-popover"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Create actions */}
        <ul className="m-0 list-none p-1" role="list">
          <li>
            <button
              type="button"
              disabled={launching}
              data-testid="sidebar-new-local-terminal"
              onClick={() => void onNewLocal()}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                launching ? 'cursor-not-allowed opacity-50' : 'hover:bg-state-hover',
              )}
            >
              <Terminal size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
              <span className="text-body font-medium text-ink">{t('terminals.newLocal')}</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              disabled={launching}
              data-testid="sidebar-new-local-folder"
              onClick={() => void onNewLocalFolder()}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                launching ? 'cursor-not-allowed opacity-50' : 'hover:bg-state-hover',
              )}
            >
              <FolderOpen size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
              <span className="text-body font-medium text-ink">{t('terminals.newLocalFolder')}</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              disabled={launching}
              data-testid="sidebar-new-remote-host"
              onClick={onNewRemote}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                launching ? 'cursor-not-allowed opacity-50' : 'hover:bg-state-hover',
              )}
            >
              <Plus size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
              <span className="text-body font-medium text-ink">{t('terminals.newRemote')}</span>
            </button>
          </li>
        </ul>

        {/* Quick connect recents */}
        <div className="border-t border-border">
          <div className="flex items-center gap-1.5 px-3 py-2 text-meta font-medium text-ink-tertiary">
            <History size={13} className="shrink-0" aria-hidden />
            {t('sidebar.quickConnect')}
          </div>
          {recents.length === 0 ? (
            <p
              className="px-3 pb-3 text-center text-meta text-ink-tertiary"
              role="status"
              data-testid="terminals-quick-connect-empty"
            >
              {t('terminals.quickConnectEmpty')}
            </p>
          ) : (
            <ul className="m-0 max-h-48 list-none overflow-y-auto p-1 pt-0" role="list">
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
        </div>

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
