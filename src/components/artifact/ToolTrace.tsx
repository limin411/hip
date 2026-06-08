import { useTranslation } from 'react-i18next'
import type { ToolCall } from '@hip/protocol'
import { ToolCallRow } from './ToolCallRow'

/** Ordered list of an agent's tool calls (seq is the ordering authority). */
export function ToolTrace({ tools }: { tools: ToolCall[] }) {
  const { t } = useTranslation()
  if (tools.length === 0) {
    return <div className="text-[11px] text-ink-tertiary">{t('artifact.noTools')}</div>
  }
  const ordered = [...tools].sort((a, b) => a.seq - b.seq)
  return (
    <div className="flex flex-col gap-1" data-testid="tool-trace">
      {ordered.map((tc) => (
        <ToolCallRow key={tc.callId} tool={tc} />
      ))}
    </div>
  )
}
