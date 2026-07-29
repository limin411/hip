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
  Bot,
  Puzzle,
  GitBranch,
  Link2,
  BookOpen,
  Terminal,
  CheckSquare,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { ContextIconName } from './types'

/** Closed icon map — no free-form lucide dynamic strings. */
const ICONS: Record<ContextIconName, LucideIcon> = {
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
  'link-2': Link2,
  'book-open': BookOpen,
  terminal: Terminal,
  zap: Zap,
  'check-square': CheckSquare,
}

export function ContextMenuIcon({
  name,
  className = 'size-3.5 shrink-0 text-ink-tertiary',
}: {
  name: ContextIconName
  className?: string
}) {
  const Icon = ICONS[name]
  if (!Icon) return null
  return <Icon className={className} size={14} />
}
