import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import type { ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'
import type { ToolCategory } from '@/lib/toolPresentation'
import { toolTitleHint } from '@/lib/toolPresentation'
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

export function ToolCallGroup({
  category,
  tools,
}: {
  category: ToolCategory
  tools: ToolCall[]
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const sample = tools[0] ? toolTitleHint(tools[0]) : ''
  return (
    <div className="rounded-lg border border-border bg-surface-muted/30" data-testid="tool-call-group" data-category={category}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-meta transition-colors hover:bg-surface-muted/50"
        data-testid="tool-call-group-toggle"
      >
        <ChevronRight
          size={12}
          className={cn('shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')}
        />
        <span className="shrink-0 font-medium text-ink-secondary">{t(CATEGORY_I18N[category])}</span>
        <span className="shrink-0 text-caption text-ink-tertiary">({tools.length})</span>
        {sample && !open && (
          <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink-tertiary">{sample}</span>
        )}
      </button>
      {open && (
        <div className="space-y-1 border-t border-border px-1.5 py-1.5">
          {tools.map((tool) => (
            <ToolCallRow key={tool.callId} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}
