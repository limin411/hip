import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Terminal as XTerm } from '@xterm/xterm'
import type { FitAddon as FitAddonType } from '@xterm/addon-fit'
import { attachDrainWrites, ringIndexForCursor, useTerminalStore } from '@/store/terminalStore'
import { useUiStore } from '@/store/uiStore'
import { buildXtermTheme, isDarkDom } from './terminalTheme'
import { bindTerminalRestarter } from './terminalRestartUi'
import { bindTerminalCanvas } from './terminalCanvasUi'
import {
  CONTEXT_MENUS,
  ControlledContextMenu,
} from '@/components/context-menu'
import { cn } from '@/lib/utils'

/**
 * Shared xterm host (D6a).
 *
 * Contract:
 * - At most one XtermSurface mounted app-wide for a given layout epoch.
 * - Only the attached terminalId may drain the store into term.write.
 * - Parent injects open/write/resize (pty vs ssh); surface never dual-subscribes backends.
 * - Canvas / restarter bridges are keyed by terminalId (no silent global default).
 * - Unmount detaches + unbinds but does not kill the backend (keep-alive).
 */
export type XtermSurfaceProps = {
  terminalId: string
  /** Backend label for future SSH path; open/write/resize are parent-injected. */
  backend?: 'pty' | 'ssh'
  open: (cols: number, rows: number) => Promise<{ reused: boolean; generation: number }>
  write: (data: string) => Promise<void>
  resize: (cols: number, rows: number) => Promise<void>
  onRestart?: () => void | Promise<void>
  /** Optional cwd shown only for status/error context; chrome is parent-owned. */
  cwd?: string
}

export function XtermSurface({
  terminalId,
  backend: _backend = 'pty',
  open,
  write,
  resize,
  onRestart,
  cwd,
}: XtermSurfaceProps) {
  const { t } = useTranslation()
  const theme = useUiStore((s) => s.theme)
  const status = useTerminalStore((s) => s.bySession[terminalId]?.status ?? 'idle')
  const exitCode = useTerminalStore((s) => s.bySession[terminalId]?.exitCode)
  const lastError = useTerminalStore((s) => s.bySession[terminalId]?.lastError)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddonType | null>(null)
  const cursorRef = useRef(0)
  const openRef = useRef(open)
  const writeRef = useRef(write)
  const resizeRef = useRef(resize)
  openRef.current = open
  writeRef.current = write
  resizeRef.current = resize

  const [starting, setStarting] = useState(false)
  const [loadingXterm, setLoadingXterm] = useState(false)
  /** Point-anchored canvas context menu (ControlledContextMenu). */
  const [canvasMenu, setCanvasMenu] = useState<{
    open: boolean
    x: number
    y: number
  }>({ open: false, x: 0, y: 0 })

  // Context-menu Restart reuses the parent-supplied handler (chrome + canvas).
  useEffect(() => {
    if (!onRestart) {
      bindTerminalRestarter(terminalId, null)
      return
    }
    bindTerminalRestarter(terminalId, () => onRestart())
    return () => bindTerminalRestarter(terminalId, null)
  }, [terminalId, onRestart])

  const onCanvasContextMenu = useCallback((e: MouseEvent) => {
    if (!CONTEXT_MENUS) return
    e.preventDefault()
    e.stopPropagation()
    setCanvasMenu({ open: true, x: e.clientX, y: e.clientY })
  }, [])

  // Boot xterm + backend open when terminalId is ready (lazy import modules).
  useEffect(() => {
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
    store.ensureSession(terminalId)
    store.setStatus(terminalId, 'starting', cwd ? { cwd } : undefined)
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

      // Canvas menu bridge: copy selection / paste into live xterm (keyed by terminalId).
      bindTerminalCanvas(terminalId, {
        getSelection: () => term?.getSelection() ?? '',
        hasSelection: () => term?.hasSelection() ?? false,
        paste: (text) => {
          if (!term || !text) return
          // xterm.paste respects bracketed paste when the shell supports it.
          if (typeof term.paste === 'function') {
            term.paste(text)
          } else {
            void writeRef.current(text).catch(() => {})
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
          void resizeRef.current(cols, rows).catch(() => {})
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
        const opened = await openRef.current(cols, rows)
        openGen = opened.generation ?? 0
        useTerminalStore.getState().setGeneration(terminalId, openGen)
      } catch (e) {
        if (disposed) return
        const msg = e instanceof Error ? e.message : String(e)
        useTerminalStore.getState().setError(terminalId, msg)
        setStarting(false)
        return
      }
      if (disposed || !term) return

      // ── Attach protocol (D6a §3) ──
      // cursor is a lifetime index (accounts for ring trim via trimOffset).
      const sess0 = useTerminalStore.getState().getSession(terminalId)
      const ringBefore = sess0?.ring ?? []
      const trim0 = sess0?.trimOffset ?? 0
      const snapshot = ringBefore.length
      cursorRef.current = trim0 // start of current retained ring in lifetime coords

      let attachDone = false
      unsubStore = useTerminalStore.subscribe((state) => {
        // Prefer attachedTerminalId alias; fall back to attachedSessionId (same field dual-write).
        const attached = state.attachedTerminalId ?? state.attachedSessionId
        if (attached !== terminalId) return
        const sess = state.bySession[terminalId]
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

      useTerminalStore.getState().setAttached(terminalId)
      useTerminalStore.getState().setStatus(terminalId, 'running', cwd ? { cwd } : undefined)

      const ringNow = useTerminalStore.getState().getRing(terminalId)
      const { writes, cursor } = attachDrainWrites(ringNow, snapshot)
      term.reset()
      for (const w of writes) writeChunk(w)
      const trimNow = useTerminalStore.getState().getSession(terminalId)?.trimOffset ?? trim0
      cursorRef.current = trimNow + cursor
      attachDone = true
      const afterSess = useTerminalStore.getState().getSession(terminalId)
      if (afterSess) {
        const idx = ringIndexForCursor(cursorRef.current, afterSess.trimOffset)
        if (idx >= 0 && idx < afterSess.ring.length) {
          for (let i = idx; i < afterSess.ring.length; i++) writeChunk(afterSess.ring[i]!)
          cursorRef.current = afterSess.trimOffset + afterSess.ring.length
        }
      }

      dataDisp = term.onData((data) => {
        void writeRef.current(data).catch(() => {})
      })

      // Focus so keyboard works immediately after open.
      term.focus()
      setStarting(false)
    })()

    return () => {
      disposed = true
      setStarting(false)
      setLoadingXterm(false)
      bindTerminalCanvas(terminalId, null)
      if (resizeTimer) clearTimeout(resizeTimer)
      unsubStore?.()
      dataDisp?.dispose()
      mo?.disconnect()
      ro?.disconnect()
      const st = useTerminalStore.getState()
      const attached = st.attachedTerminalId ?? st.attachedSessionId
      if (attached === terminalId) {
        st.setAttached(null)
      }
      term?.dispose()
      termRef.current = null
      fitRef.current = null
      // Do NOT kill backend — keep-alive (D6).
    }
  }, [terminalId, cwd])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = buildXtermTheme(isDarkDom())
  }, [theme])

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
    <div className="flex h-full min-h-0 flex-col bg-surface" data-testid="xterm-surface">
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
              {onRestart ? (
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 py-0.5 font-medium text-accent-strong hover:underline"
                  onClick={() => void onRestart()}
                  data-testid="terminal-status-restart"
                >
                  {t('artifact.terminalView.restart')}
                </button>
              ) : null}
            </>
          )}
          {errored && (
            <>
              <AlertCircle size={13} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate" title={lastError}>
                {errorLabel}
              </span>
              {onRestart ? (
                <button
                  type="button"
                  className="shrink-0 rounded px-1.5 py-0.5 font-medium hover:underline"
                  onClick={() => void onRestart()}
                  data-testid="terminal-status-restart"
                >
                  {t('artifact.terminalView.restart')}
                </button>
              ) : null}
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
          payload={{ sessionId: terminalId, status, target: 'canvas' }}
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
