import { useEffect } from 'react'
import { useUiStore, type Theme } from '@/store/uiStore'
import { syncVibrancyWithTheme } from '@/lib/windowVibrancy'

interface ThemeProviderProps {
  children: React.ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useUiStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement

    const applyTheme = (value: Theme) => {
      if (value === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        root.classList.toggle('dark', isDark)
      } else {
        root.classList.toggle('dark', value === 'dark')
      }
      // Keep NSVisualEffect / Mica appearance aligned with app chrome.
      void syncVibrancyWithTheme()
    }

    applyTheme(theme)

    if (theme !== 'system') {
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => {
      root.classList.toggle('dark', event.matches)
      void syncVibrancyWithTheme()
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme])

  return <>{children}</>
}
