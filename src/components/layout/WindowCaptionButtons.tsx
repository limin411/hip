import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Minus, Square, X, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isCustomCaptionActive } from '@/lib/windowChrome'

type WindowApi = typeof import('@tauri-apps/api/window')

let windowApi: WindowApi | null = null

async function getWin() {
  if (!windowApi) {
    windowApi = await import('@tauri-apps/api/window')
  }
  return windowApi.getCurrentWindow()
}

/**
 * In-content min / max / close for Windows frameless chrome.
 * Renders only when `html[data-caption=custom]` (set by applyPlatformWindowChrome).
 */
export function WindowCaptionButtons({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [active, setActive] = useState(() => isCustomCaptionActive())
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const sync = () => setActive(isCustomCaptionActive())
    sync()
    // Chrome apply is async at boot; observe attribute.
    const obs = new MutationObserver(sync)
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-caption'],
    })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!active) return
    let unlisten: (() => void) | undefined
    let cancelled = false

    void (async () => {
      try {
        const win = await getWin()
        if (cancelled) return
        setMaximized(await win.isMaximized())
        unlisten = await win.onResized(async () => {
          try {
            setMaximized(await win.isMaximized())
          } catch {
            /* ignore */
          }
        })
      } catch {
        /* non-Tauri */
      }
    })()

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [active])

  const onMin = useCallback(() => {
    void getWin()
      .then((w) => w.minimize())
      .catch(() => {})
  }, [])

  const onMax = useCallback(() => {
    void getWin()
      .then((w) => w.toggleMaximize())
      .catch(() => {})
  }, [])

  const onClose = useCallback(() => {
    void getWin()
      .then((w) => w.close())
      .catch(() => {})
  }, [])

  if (!active) return null

  const btn =
    'flex h-full w-[46px] items-center justify-center text-ink transition-colors ' +
    'hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:bg-state-hover ' +
    'active:bg-state-active'

  return (
    <div
      className={cn('flex h-10 shrink-0 items-stretch -mr-3', className)}
      data-testid="window-caption"
      data-no-drag
      data-tauri-drag-region="false"
      role="group"
      aria-label={t('windowCaption.aria')}
    >
      <button
        type="button"
        data-testid="window-caption-min"
        data-no-drag
        aria-label={t('windowCaption.minimize')}
        title={t('windowCaption.minimize')}
        onClick={onMin}
        className={btn}
      >
        <Minus size={14} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        data-testid="window-caption-max"
        data-no-drag
        aria-label={maximized ? t('windowCaption.restore') : t('windowCaption.maximize')}
        title={maximized ? t('windowCaption.restore') : t('windowCaption.maximize')}
        onClick={onMax}
        className={btn}
      >
        {maximized ? (
          <Copy size={12} strokeWidth={1.75} aria-hidden className="opacity-90" />
        ) : (
          <Square size={12} strokeWidth={1.75} aria-hidden />
        )}
      </button>
      <button
        type="button"
        data-testid="window-caption-close"
        data-no-drag
        aria-label={t('windowCaption.close')}
        title={t('windowCaption.close')}
        onClick={onClose}
        className={cn(
          btn,
          'hover:bg-danger hover:text-white focus-visible:bg-danger focus-visible:text-white',
        )}
      >
        <X size={14} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  )
}

/** Double-click title area → toggle maximize (Windows convention). */
export function useCaptionTitleDoubleClick() {
  return useCallback((e: MouseEvent) => {
    if (!isCustomCaptionActive()) return
    if (e.detail !== 2) return
    if ((e.target as Element).closest('button, a, input, [data-no-drag]')) return
    void getWin()
      .then((w) => w.toggleMaximize())
      .catch(() => {})
  }, [])
}
