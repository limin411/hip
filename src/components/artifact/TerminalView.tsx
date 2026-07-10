import { useCallback, useEffect, useRef, useState } from 'react'
import { Folder, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useActiveSession, useActiveSessionId, sessionService } from '@/domain'
import { pickDirectory } from '@/ipc/dialog'
import { ptyKill, ptyOpen, ptyResize, ptyWrite } from '@/ipc/pty'
import { attachDrainWrites, useTerminalStore } from '@/store/terminalStore'
import { useUiStore } from '@/store/uiStore'

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#1a1a1a',
  cursor: '#1a1a1a',
  selectionBackground: '#c8d6f0',
}

const DARK_THEME = {
  background: '#0d0d0d',
  foreground: '#e8e8e8',
  cursor: '#e8e8e8',
  selectionBackground: '#3a4a6a',
}

function isDarkDom(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

function xtermTheme() {
  return isDarkDom() ? DARK_THEME : LIGHT_THEME
}

/**
 * Code-panel Terminal tab: xterm UI + PTY open/resize/write.
 * Live output: store subscription only (D6a single-writer). Bridge never touches Terminal.
 */
export function TerminalView() {
  const { t } = useTranslation()
  const sessionId = useActiveSessionId()
  const cwd = useActiveSession()?.config.cwd
  const theme = useUiStore((s) => s.theme)
  const status = useTerminalStore((s) =>
    sessionId ? s.bySession[sessionId]?.status ?? 'idle' : 'idle',
  )
  const exitCode = useTerminalStore((s) =>
    sessionId ? s.bySession[sessionId]?.exitCode : null,
  )
  const lastError = useTerminalStore((s) =>
    sessionId ? s.bySession[sessionId]?.lastError : undefined,
  )

  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const cursorRef = useRef(0)
  const [bootKey, setBootKey] = useState(0)
  const [starting, setStarting] = useState(false)

  const chooseFolder = useCallback(async () => {
    if (!sessionId) return
    const dir = await pickDirectory()
    if (!dir) return
    sessionService.setProjectDir(sessionId, dir)
  }, [sessionId])

  const restart = useCallback(async () => {
    if (!sessionId) return
    try {
      await ptyKill(sessionId)
    } catch {
      /* ok if already dead */
    }
    useTerminalStore.getState().clearSession(sessionId)
    setBootKey((k) => k + 1)
  }, [sessionId])

  // Boot xterm + PTY when session+cwd ready.
  useEffect(() => {
    if (!sessionId || !cwd) return
    const el = containerRef.current
    if (!el) return

    let disposed = false
    let unsubStore: (() => void) | undefined
    let ro: ResizeObserver | undefined
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let dataDisp: { dispose: () => void } | undefined
    let mo: MutationObserver | undefined

    const store = useTerminalStore.getState()
    store.ensureSession(sessionId)
    store.setStatus(sessionId, 'starting', { cwd })
    setStarting(true)

    const term = new Terminal({
      scrollback: 5000,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: xtermTheme(),
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    termRef.current = term
    fitRef.current = fit

    const applyTheme = () => {
      term.options.theme = xtermTheme()
    }
    applyTheme()

    // Theme via store + dark class mutations (system theme changes).
    mo = new MutationObserver(applyTheme)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const writeChunk = (chunk: string) => {
      if (!disposed && chunk) term.write(chunk)
    }

    const doFit = () => {
      try {
        fit.fit()
      } catch {
        /* container may be 0-sized briefly */
      }
      return { cols: term.cols || 80, rows: term.rows || 24 }
    }

    const scheduleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (disposed) return
        const { cols, rows } = doFit()
        void ptyResize(sessionId, cols, rows).catch(() => {})
      }, 50)
    }

    ro = new ResizeObserver(scheduleResize)
    ro.observe(el)

    void (async () => {
      // Measure before open.
      let { cols, rows } = doFit()
      if (cols < 2 || rows < 1) {
        await new Promise((r) => requestAnimationFrame(() => r(undefined)))
        if (disposed) return
        ;({ cols, rows } = doFit())
      }

      try {
        await ptyOpen(sessionId, cwd, cols, rows)
      } catch (e) {
        if (disposed) return
        const msg = e instanceof Error ? e.message : String(e)
        useTerminalStore.getState().setError(sessionId, msg)
        setStarting(false)
        return
      }
      if (disposed) return

      // ── Attach protocol (D6a §3) ──
      const ringBefore = useTerminalStore.getState().getRing(sessionId)
      const snapshot = ringBefore.length
      cursorRef.current = 0

      // Subscribe first; cursor gates live writes until drain completes.
      let attachDone = false
      unsubStore = useTerminalStore.subscribe((state, prev) => {
        if (state.attachedSessionId !== sessionId) return
        const ring = state.bySession[sessionId]?.ring
        if (!ring) return
        // Only process when our ring grew.
        const prevLen = prev.bySession[sessionId]?.ring.length ?? 0
        if (!attachDone) return // rehydrate path owns writes until drain
        if (ring.length <= cursorRef.current) return
        if (ring.length === prevLen && cursorRef.current >= ring.length) return
        for (let i = cursorRef.current; i < ring.length; i++) {
          writeChunk(ring[i]!)
        }
        cursorRef.current = ring.length
      })

      useTerminalStore.getState().setAttached(sessionId)
      useTerminalStore.getState().setStatus(sessionId, 'running', { cwd })

      // Rehydrate snapshot + drain tail (mid-append safe).
      const ringNow = useTerminalStore.getState().getRing(sessionId)
      const { writes, cursor } = attachDrainWrites(ringNow, snapshot)
      term.reset()
      for (const w of writes) writeChunk(w)
      cursorRef.current = cursor
      attachDone = true
      // Drain anything that landed between drain and attachDone flip.
      const after = useTerminalStore.getState().getRing(sessionId)
      if (after.length > cursorRef.current) {
        for (let i = cursorRef.current; i < after.length; i++) writeChunk(after[i]!)
        cursorRef.current = after.length
      }

      dataDisp = term.onData((data) => {
        void ptyWrite(sessionId, data).catch(() => {})
      })

      setStarting(false)
    })()

    return () => {
      disposed = true
      setStarting(false)
      if (resizeTimer) clearTimeout(resizeTimer)
      unsubStore?.()
      dataDisp?.dispose()
      mo?.disconnect()
      ro?.disconnect()
      useTerminalStore.getState().setAttached(null)
      term.dispose()
      termRef.current = null
      fitRef.current = null
      // Do NOT pty_kill — keep-alive (D6).
    }
  }, [sessionId, cwd, bootKey])

  // Re-apply theme when uiStore.theme changes (covers non-class store updates).
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = xtermTheme()
  }, [theme])

  if (!sessionId) return null

  if (!cwd) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-ink-tertiary"
        data-testid="terminal-view-empty"
      >
        <Folder size={32} className="opacity-40" />
        <div className="max-w-[240px] text-body font-medium text-ink-secondary">
          {t('artifact.terminalView.noCwd')}
        </div>
        <div className="max-w-[240px] text-meta">{t('artifact.terminalView.noCwdDesc')}</div>
        <button
          type="button"
          data-testid="terminal-select-folder"
          onClick={() => void chooseFolder()}
          className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {t('artifact.terminalView.selectFolder')}
        </button>
      </div>
    )
  }

  const exited = status === 'exited'
  const errored = status === 'error'

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="terminal-view">
      <div
        className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-2"
        data-tauri-drag-region="false"
      >
        <span className="min-w-0 truncate font-mono text-meta text-ink-tertiary" title={cwd}>
          {cwd}
        </span>
        <button
          type="button"
          data-testid="terminal-restart"
          onClick={() => void restart()}
          title={t('artifact.terminalView.restart')}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-meta text-ink-secondary hover:bg-surface-muted hover:text-ink"
        >
          <RotateCcw size={12} />
          {t('artifact.terminalView.restart')}
        </button>
      </div>

      {(exited || errored || starting) && (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-muted/50 px-2 py-1 text-meta text-ink-secondary"
          data-testid="terminal-status-bar"
        >
          {starting && <span>{t('artifact.terminalView.starting')}</span>}
          {exited && (
            <span>
              {exitCode == null
                ? t('artifact.terminalView.exitedNull')
                : t('artifact.terminalView.exited', { code: exitCode })}
            </span>
          )}
          {errored && (
            <span className="text-danger" title={lastError}>
              {lastError?.includes('Windows') || lastError?.includes('not supported')
                ? t('artifact.terminalView.unsupportedPlatform')
                : lastError?.includes('Too many terminals')
                  ? t('artifact.terminalView.softCap')
                  : t('artifact.terminalView.error')}
            </span>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden p-1"
        data-testid="terminal-xterm"
        data-no-drag
        data-tauri-drag-region="false"
      />
    </div>
  )
}
