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
  type LucideIcon,
} from 'lucide-react'
import type { GlobalCommand, PaletteIconName } from '../types'
import { matchHighlightIndices } from '../fuzzyScore'

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
}: {
  item: GlobalCommand
  search?: string
}) {
  const Icon = item.icon ? ICONS[item.icon] : null
  const showShortcut = Boolean(item.shortcut) && !item.to
  const showChevron = Boolean(item.to)

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
      {showShortcut ? (
        <kbd className="ml-auto shrink-0 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-caption text-ink-tertiary">
          {item.shortcut}
        </kbd>
      ) : null}
      {showChevron ? (
        <ChevronRight
          className={`size-3.5 shrink-0 text-ink-tertiary ${showShortcut ? '' : 'ml-auto'}`}
          size={14}
        />
      ) : null}
    </>
  )
}
