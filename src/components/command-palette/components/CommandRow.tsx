import {
  MessageSquare,
  Code2,
  History,
  Settings,
  Plus,
  Sun,
  Moon,
  Monitor,
  Palette,
  Keyboard,
  Brain,
  Wrench,
  Package,
  Cpu,
  Sparkles,
  ChevronRight,
  Check,
  Bot,
  Puzzle,
  GitBranch,
  Star,
  type LucideIcon,
} from 'lucide-react'
import type { GlobalCommand, PaletteIconName } from '../types'
import { matchHighlightIndices } from '../fuzzyScore'
import { cn } from '@/lib/utils'

const ICONS: Record<PaletteIconName, LucideIcon> = {
  'message-square': MessageSquare,
  code: Code2,
  history: History,
  settings: Settings,
  plus: Plus,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  palette: Palette,
  keyboard: Keyboard,
  brain: Brain,
  wrench: Wrench,
  package: Package,
  cpu: Cpu,
  'git-branch': GitBranch,
  sparkles: Sparkles,
  bot: Bot,
  puzzle: Puzzle,
}

function HighlightLabel({ label, search }: { label: string; search?: string }) {
  const indices = search ? matchHighlightIndices(label, search) : []
  if (indices.length === 0) {
    return <span className="min-w-0 flex-1 truncate">{label}</span>
  }
  const set = new Set(indices)
  return (
    <span className="min-w-0 flex-1 truncate">
      {Array.from(label).map((ch, i) =>
        set.has(i) ? (
          <mark
            key={i}
            className="bg-transparent font-medium text-accent"
            data-testid="cmd-match-mark"
          >
            {ch}
          </mark>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </span>
  )
}

export function CommandRow({
  item,
  search,
  favorited,
  onToggleFavorite,
  hotkeyIndex,
}: {
  item: GlobalCommand
  search?: string
  favorited?: boolean
  onToggleFavorite?: (id: string) => void
  /** 1–9 when shown as quick-run hint */
  hotkeyIndex?: number
}) {
  const Icon = item.icon ? ICONS[item.icon] : null
  const showShortcut = Boolean(item.shortcut) && !item.to && hotkeyIndex == null
  const showChevron = Boolean(item.to)
  const canFavorite = Boolean(onToggleFavorite) && !item.to

  return (
    <>
      {Icon ? <Icon className="size-3.5 shrink-0 text-ink-tertiary" size={14} /> : null}
      <HighlightLabel label={item.label} search={search} />
      {item.active ? (
        <Check className="size-3.5 shrink-0 text-accent" data-testid="global-cmd-active" />
      ) : null}
      {item.description && !item.active ? (
        <span className="hidden max-w-[8rem] truncate text-caption text-ink-tertiary sm:inline">
          {item.description}
        </span>
      ) : null}
      {hotkeyIndex != null && hotkeyIndex >= 1 && hotkeyIndex <= 9 ? (
        <kbd className="ml-auto shrink-0 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-caption text-ink-tertiary">
          ⌘{hotkeyIndex}
        </kbd>
      ) : null}
      {showShortcut ? (
        <kbd className="ml-auto shrink-0 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-caption text-ink-tertiary">
          {item.shortcut}
        </kbd>
      ) : null}
      {canFavorite ? (
        <button
          type="button"
          data-testid={`global-cmd-fav-${item.id}`}
          aria-label={favorited ? 'Remove favorite' : 'Add favorite'}
          aria-pressed={favorited}
          className={cn(
            'shrink-0 rounded p-0.5 text-ink-tertiary hover:text-accent',
            favorited && 'text-accent',
            !showShortcut && hotkeyIndex == null && !showChevron && 'ml-auto',
          )}
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggleFavorite?.(item.id)
          }}
        >
          <Star className="size-3.5" fill={favorited ? 'currentColor' : 'none'} size={14} />
        </button>
      ) : null}
      {showChevron ? (
        <ChevronRight
          className={`size-3.5 shrink-0 text-ink-tertiary ${showShortcut || canFavorite || hotkeyIndex != null ? '' : 'ml-auto'}`}
          size={14}
        />
      ) : null}
    </>
  )
}
