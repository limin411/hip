import { useTranslation } from 'react-i18next'
import type { ToolCall } from '@hip/protocol'
import { ToolCallRow } from './ToolCallRow'

/** Ordered list of an agent's tool calls (seq is the ordering authority). */
export function ToolTrace({
  tools,
  onToolClick,
}: {
  tools: ToolCall[]
  /** Sprint B: jump to owning chat turn when a tool row is activated. */
  onToolClick?: () => void
}) {
  const { t } = useTranslation()
  if (tools.length === 0) {
    return <div className="text-caption text-ink-tertiary">{t('artifact.noTools')}</div>
  }
  const ordered = [...tools].sort((a, b) => a.seq - b.seq)
  return (
    <div className="flex flex-col gap-0.5" data-testid="tool-trace">
      {ordered.map((tc) => (
        <div
          key={tc.callId}
          className={
            onToolClick
              ? 'cursor-pointer rounded-md transition-colors duration-chrome hover:bg-state-hover'
              : undefined
          }
          onClick={onToolClick}
          onKeyDown={
            onToolClick
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onToolClick()
                  }
                }
              : undefined
          }
          role={onToolClick ? 'button' : undefined}
          tabIndex={onToolClick ? 0 : undefined}
        >
          <ToolCallRow tool={tc} />
        </div>
      ))}
    </div>
  )
}
