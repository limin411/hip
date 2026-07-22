import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { useUiStore } from '@/store/uiStore'

/**
 * Tokenized Sonner host (token surfaces + semantic left borders; no Sonner palette mode).
 * Theme tracks document `dark` class (ThemeProvider + uiStore.theme preference).
 */
export function ToasterHost() {
  const themePref = useUiStore((s) => s.theme)
  const [mode, setMode] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light',
  )

  useEffect(() => {
    const sync = () =>
      setMode(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [themePref])

  return (
    <Toaster
      position="bottom-right"
      theme={mode}
      toastOptions={{
        classNames: {
          toast: 'border border-border bg-surface text-ink shadow-menu',
          title: 'text-body font-medium text-ink',
          description: 'text-meta text-ink-secondary',
          success: 'border-l-2 border-l-success',
          error: 'border-l-2 border-l-danger',
          warning: 'border-l-2 border-l-warning',
        },
      }}
    />
  )
}
