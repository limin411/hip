import { useTranslation } from 'react-i18next'
import type { ToolCall } from '@hip/protocol'
import type { ToolCategory } from '@/lib/toolPresentation'
import { ToolCallRow } from './ToolCallRow'

const CATEGORY_I18N = {
  search: 'chat.activity.groups.search',
  read: 'chat.activity.groups.read',
  browse: 'chat.activity.groups.browse',
  edit: 'chat.activity.groups.edit',
  shell: 'chat.activity.groups.shell',
  delegate: 'chat.activity.groups.delegate',
  plan: 'chat.activity.groups.plan',
  other: 'chat.activity.groups.other',
} as const satisfies Record<ToolCategory, string>

/** Flat category section — always expanded (CLI-style tool trail). */
export function ToolCallGroup({
  category,
  tools,
}: {
  category: ToolCategory
  tools: ToolCall[]
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1" data-testid="tool-call-group" data-category={category}>
      <div
        className="flex items-center gap-2 py-0.5 text-meta"
        data-testid="tool-call-group-header"
      >
        <span className="shrink-0 font-medium text-ink-secondary">{t(CATEGORY_I18N[category])}</span>
        <span className="shrink-0 text-caption text-ink-tertiary">({tools.length})</span>
      </div>
      {tools.map((tool) => (
        <ToolCallRow key={tool.callId} tool={tool} />
      ))}
    </div>
  )
}
