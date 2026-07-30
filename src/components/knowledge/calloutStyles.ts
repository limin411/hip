/**
 * Shared callout visual styles for Reader (KnowledgeMarkdownBody) and Live NodeView.
 */
import type { CalloutType } from '@/domain/knowledge/callout'

export const CALLOUT_STYLE: Record<CalloutType, string> = {
  note: 'border-accent/50 bg-accent/5',
  tip: 'border-success/50 bg-success/5',
  info: 'border-accent/50 bg-accent/5',
  warning: 'border-warning/50 bg-warning/5',
  caution: 'border-warning/50 bg-warning/5',
  danger: 'border-danger/50 bg-danger/5',
  important: 'border-accent/60 bg-accent/10',
}

export function calloutStyleClass(type: string): string {
  return CALLOUT_STYLE[type as CalloutType] ?? CALLOUT_STYLE.note
}
