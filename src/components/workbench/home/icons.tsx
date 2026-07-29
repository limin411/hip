import type { ZoneId } from '../workbenchTypes'
import {
  BookOpen,
  CheckSquare,
  MessageSquare,
  Terminal,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export const ZONE_ICON: Record<ZoneId, LucideIcon> = {
  sessions: MessageSquare,
  tasks: CheckSquare,
  automations: Zap,
  knowledge: BookOpen,
  terminals: Terminal,
  workflows: Workflow,
}
