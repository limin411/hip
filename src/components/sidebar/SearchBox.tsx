import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { sessionService } from '@/domain'

export function SearchBox() {
  const { t } = useTranslation()
  const search = useUiStore((s) => s.search)
  const setSearch = useUiStore((s) => s.setSearch)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  // Debounce content search into the sidecar (FTS); the local title/preview filter
  // in SessionList stays instant, so typing never feels laggy.
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => sessionService.search(search.trim()), 200)
    return () => clearTimeout(timer.current)
  }, [search])
  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('sidebar.search')}
        className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      />
    </div>
  )
}
