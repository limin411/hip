import { Search } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'

export function SearchBox() {
  const search = useUiStore((s) => s.search)
  const setSearch = useUiStore((s) => s.setSearch)
  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索会话"
        className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      />
    </div>
  )
}
