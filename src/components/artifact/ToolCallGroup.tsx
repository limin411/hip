import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import type { ToolCall } from '@hip/protocol'
import type { ToolCategory } from '@/lib/toolPresentation'
import { ToolCallRow } from './ToolCallRow'
import { cn } from '@/lib/utils'

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

/**
 * Category chapter for tool trails.
 * Collapsible: expanded by default when any tool is still running; otherwise collapsed
 * for dense finished groups (scannable narrative).
 */
export function ToolCallGroup({
  category,
  tools,
}: {
  category: ToolCategory
  tools: ToolCall[]
}) {
  const { t } = useTranslation()
  const anyRunning = tools.some((tool) => tool.status === 'running')
  // Default open while live; user toggle wins so collapse works mid-run.
  const [manual, setManual] = useState<boolean | null>(null)
  const showBody = manual ?? anyRunning

  return (
    <div
      className="flex flex-col gap-0.5"
      data-testid="tool-call-group"
      data-category={category}
      data-open={showBody ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={() => setManual(!showBody)}
        aria-expanded={showBody}
        className={cn(
          'flex min-h-[var(--trail-min-h)] w-full items-center gap-[var(--meta-gap)] text-left text-meta leading-5',
          'text-ink-tertiary transition-colors hover:text-ink-secondary',
        )}
        data-testid="tool-call-group-header"
      >
        <ChevronRight
          size={14}
          className={cn('block shrink-0 transition-transform', showBody && 'rotate-90')}
          aria-hidden
        />
        <span className="shrink-0 font-medium text-ink-secondary">{t(CATEGORY_I18N[category])}</span>
        <span className="shrink-0 text-ink-tertiary">({tools.length})</span>
        {anyRunning && (
          <span className="shrink-0 text-caption text-accent-strong" data-testid="tool-call-group-running">
            {t('chat.activity.chapterRunning')}
          </span>
        )}
      </button>
      {showBody &&
        tools.map((tool) => <ToolCallRow key={tool.callId} tool={tool} />)}
    </div>
  )
}
