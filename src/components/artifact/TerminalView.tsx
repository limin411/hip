import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { AlertCircle, Folder, Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon as FitAddonType } from '@xterm/addon-fit'
import { useActiveSession, useActiveSessionId, sessionService } from '@/domain'
import { pickDirectory } from '@/ipc/dialog'
import { ptyKill, ptyOpen, ptyResize, ptyWrite } from '@/ipc/pty'
import { attachDrainWrites, ringIndexForCursor, useTerminalStore } from '@/store/terminalStore'
import { useUiStore } from '@/store/uiStore'
import { buildXtermTheme, isDarkDom } from './terminalTheme'
import { bindTerminalRestarter } from './terminalRestartUi'
import { bindTerminalCanvas } from './terminalCanvasUi'
import {
  CONTEXT_MENUS,
  ControlledContextMenu,
  DeclarativeContextMenu,
} from '@/components/context-menu'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

/**
 * Code-panel Terminal tab: xterm UI + PTY open/resize/write.
 * Live output: store subscription only (D6a single-writer). Bridge never touches Terminal.
 * xterm is lazy-loaded (PR-4) to keep the main chat bundle smaller.
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
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddonType | null>(null)
  const cursorRef = useRef(0)
  const [bootKey, setBootKey] = useState(0)
  const [starting, setStarting] = useState(false)
  const [loadingXterm, setLoadingXterm] = useState(false)
  /** Point-anchored canvas context menu (ControlledContextMenu). */
  const [canvasMenu, setCanvasMenu] = useState<{
    open: boolean
    x: number
    y: number
  }>({ open: false, x: 0, y: 0 })

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

  // Context-menu Restart reuses the same handler as the chrome button (chrome + canvas).
  useEffect(() => {
    if (!sessionId) {
      bindTerminalRestarter(null)
      return
    }
    bindTerminalRestarter((id) => {
      if (id !== sessionId) return
      return restart()
    })
    return () => bindTerminalRestarter(null)
  }, [sessionId, restart])

  const onCanvasContextMenu = useCallback((e: MouseEvent) => {
    if (!CONTEXT_MENUS) return
    e.preventDefault()
    e.stopPropagation()
    setCanvasMenu({ open: true, x: e.clientX, y: e.clientY })
  }, [])

  // Boot xterm + PTY when session+cwd ready (lazy import modules).
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
    let term: XTerm | null = null

    const store = useTerminalStore.getState()
    store.ensureSession(sessionId)
    store.setStatus(sessionId, 'starting', { cwd })
    setStarting(true)
    setLoadingXterm(true)

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ])
      await import('@xterm/xterm/css/xterm.css')
      if (disposed) return

      setLoadingXterm(false)

      term = new Terminal({
        scrollback: 5000,
        cursorBlink: true,
        fontSize: 13,
        lineHeight: 1.25,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        theme: buildXtermTheme(),
        allowProposedApi: true,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(el)
      // Slight padding so glyphs don't hug the rounded panel edge.
      el.style.padding = '4px 6px'
      termRef.current = term
      fitRef.current = fit

      // Canvas menu bridge: copy selection / paste into live xterm.
      bindTerminalCanvas({
        getSelection: () => term?.getSelection() ?? '',
        hasSelection: () => term?.hasSelection() ?? false,
        paste: (text) => {
          if (!term || !text) return
          // xterm.paste respects bracketed paste when the shell supports it.
          if (typeof term.paste === 'function') {
            term.paste(text)
          } else {
            void ptyWrite(sessionId, text).catch(() => {})
          }
        },
      })

      const applyTheme = () => {
        if (term) term.options.theme = buildXtermTheme(isDarkDom())
      }
      applyTheme()

      mo = new MutationObserver(applyTheme)
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

      const writeChunk = (chunk: string) => {
        if (!disposed && term && chunk) term.write(chunk)
      }

      const doFit = () => {
        try {
          fit.fit()
        } catch {
          /* container may be 0-sized briefly */
        }
        return { cols: term!.cols || 80, rows: term!.rows || 24 }
      }

      const scheduleResize = () => {
        if (resizeTimer) clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          if (disposed || !term) return
          const { cols, rows } = doFit()
          void ptyResize(sessionId, cols, rows).catch(() => {})
        }, 50)
      }

      ro = new ResizeObserver(scheduleResize)
      ro.observe(el)

      let { cols, rows } = doFit()
      if (cols < 2 || rows < 1) {
        await new Promise((r) => requestAnimationFrame(() => r(undefined)))
        if (disposed) return
        ;({ cols, rows } = doFit())
      }

      let openGen = 0
      try {
        const opened = await ptyOpen(sessionId, cwd, cols, rows)
        openGen = opened.generation ?? 0
        useTerminalStore.getState().setGeneration(sessionId, openGen)
      } catch (e) {
        if (disposed) return
        const msg = e instanceof Error ? e.message : String(e)
        useTerminalStore.getState().setError(sessionId, msg)
        setStarting(false)
        return
      }
      if (disposed || !term) return

      // ── Attach protocol (D6a §3) ──
      // cursor is a lifetime index (accounts for ring trim via trimOffset).
      const sess0 = useTerminalStore.getState().getSession(sessionId)
      const ringBefore = sess0?.ring ?? []
      const trim0 = sess0?.trimOffset ?? 0
      const snapshot = ringBefore.length
      cursorRef.current = trim0 // start of current retained ring in lifetime coords

      let attachDone = false
      unsubStore = useTerminalStore.subscribe((state) => {
        if (state.attachedSessionId !== sessionId) return
        const sess = state.bySession[sessionId]
        if (!sess) return
        if (!attachDone) return
        const { ring, trimOffset } = sess
        // Lifetime cursor → current ring index after drop-oldest trims.
        let idx = ringIndexForCursor(cursorRef.current, trimOffset)
        if (idx < 0) {
          // Cursor was entirely before retained ring; accept gap, resync to start.
          idx = 0
          cursorRef.current = trimOffset
        }
        if (idx >= ring.length) return
        for (let i = idx; i < ring.length; i++) {
          writeChunk(ring[i]!)
        }
        cursorRef.current = trimOffset + ring.length
      })

      useTerminalStore.getState().setAttached(sessionId)
      useTerminalStore.getState().setStatus(sessionId, 'running', { cwd })

      const ringNow = useTerminalStore.getState().getRing(sessionId)
      const { writes, cursor } = attachDrainWrites(ringNow, snapshot)
      term.reset()
      for (const w of writes) writeChunk(w)
      const trimNow = useTerminalStore.getState().getSession(sessionId)?.trimOffset ?? trim0
      cursorRef.current = trimNow + cursor
      attachDone = true
      const afterSess = useTerminalStore.getState().getSession(sessionId)
      if (afterSess) {
        const idx = ringIndexForCursor(cursorRef.current, afterSess.trimOffset)
        if (idx >= 0 && idx < afterSess.ring.length) {
          for (let i = idx; i < afterSess.ring.length; i++) writeChunk(afterSess.ring[i]!)
          cursorRef.current = afterSess.trimOffset + afterSess.ring.length
        }
      }

      dataDisp = term.onData((data) => {
        void ptyWrite(sessionId, data).catch(() => {})
      })

      // Focus so keyboard works immediately after open.
      term.focus()
      setStarting(false)
    })()

    return () => {
      disposed = true
      setStarting(false)
      setLoadingXterm(false)
      bindTerminalCanvas(null)
      if (resizeTimer) clearTimeout(resizeTimer)
      unsubStore?.()
      dataDisp?.dispose()
      mo?.disconnect()
      ro?.disconnect()
      useTerminalStore.getState().setAttached(null)
      term?.dispose()
      termRef.current = null
      fitRef.current = null
      // Do NOT pty_kill — keep-alive (D6).
    }
  }, [sessionId, cwd, bootKey])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = buildXtermTheme(isDarkDom())
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
        <Button
          type="button"
          data-testid="terminal-select-folder"
          onClick={() => void chooseFolder()}
          variant="primary"
          size="sm"
        >
          {t('artifact.terminalView.selectFolder')}
        </Button>
      </div>
    )
  }

  const exited = status === 'exited'
  const errored = status === 'error'
  const showStatus = exited || errored || starting || loadingXterm

  const errorLabel = (() => {
    if (!lastError) return t('artifact.terminalView.error')
    if (lastError.includes('not supported on this platform')) {
      return t('artifact.terminalView.unsupportedPlatform')
    }
    if (lastError.includes('Too many terminals')) return t('artifact.terminalView.softCap')
    if (
      lastError.includes('not found') ||
      lastError.includes('no usable shell') ||
      lastError.includes('HIP_SHELL')
    ) {
      return t('artifact.terminalView.noShell')
    }
    return t('artifact.terminalView.error')
  })()

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" data-testid="terminal-view">
      <DeclarativeContextMenu
        kind="terminal"
        payload={{ sessionId, status }}
        className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/80 px-2.5"
        data-testid="terminal-chrome"
      >
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2" data-tauri-drag-region="false">
          <span
            className="min-w-0 truncate font-mono text-meta text-ink-tertiary"
            title={cwd}
            data-testid="terminal-cwd"
          >
            {cwd}
          </span>
          <button
            type="button"
            data-testid="terminal-restart"
            onClick={() => void restart()}
            title={t('artifact.terminalView.restart')}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-meta font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <RotateCcw size={13} />
            {t('artifact.terminalView.restart')}
          </button>
        </div>
      </DeclarativeContextMenu>

      {showStatus && (
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5 text-meta',
            errored && 'bg-danger/10 text-danger',
            exited && !errored && 'bg-surface-muted/60 text-ink-secondary',
            (starting || loadingXterm) && !errored && !exited && 'bg-surface-muted/40 text-ink-tertiary',
          )}
          data-testid="terminal-status-bar"
          role="status"
        >
          {(starting || loadingXterm) && !errored && (
            <>
              <Loader2 size={13} className="shrink-0 animate-spin text-accent-strong" />
              <span>{t('artifact.terminalView.starting')}</span>
            </>
          )}
          {exited && !errored && (
            <>
              <span className="min-w-0 flex-1">
                {exitCode == null
                  ? t('artifact.terminalView.exitedNull')
                  : t('artifact.terminalView.exited', { code: exitCode })}
              </span>
              <button
                type="button"
                className="shrink-0 rounded px-1.5 py-0.5 font-medium text-accent-strong hover:underline"
                onClick={() => void restart()}
                data-testid="terminal-status-restart"
              >
                {t('artifact.terminalView.restart')}
              </button>
            </>
          )}
          {errored && (
            <>
              <AlertCircle size={13} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate" title={lastError}>
                {errorLabel}
              </span>
              <button
                type="button"
                className="shrink-0 rounded px-1.5 py-0.5 font-medium hover:underline"
                onClick={() => void restart()}
                data-testid="terminal-status-restart"
              >
                {t('artifact.terminalView.restart')}
              </button>
            </>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden bg-surface"
        data-testid="terminal-xterm"
        data-no-drag
        data-tauri-drag-region="false"
        data-context-menu-kind="terminal"
        onContextMenu={onCanvasContextMenu}
      />

      {CONTEXT_MENUS ? (
        <ControlledContextMenu
          kind="terminal"
          payload={{ sessionId, status, target: 'canvas' }}
          open={canvasMenu.open}
          onOpenChange={(open) => {
            setCanvasMenu((m) => ({ ...m, open }))
            // After dismiss, return keyboard focus to xterm (virtual anchor must not keep it).
            if (!open) termRef.current?.focus()
          }}
          point={canvasMenu.open ? { x: canvasMenu.x, y: canvasMenu.y } : null}
        />
      ) : null}
    </div>
  )
}
