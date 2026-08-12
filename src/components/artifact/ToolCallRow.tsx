import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { ToolCall } from '@hip/protocol'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { cn } from '@/lib/utils'
import { sanitizeDisplayText } from '@/lib/sanitizeDisplayText'
import {
  humanizeToolError,
  parseToolInput,
  toolTitleHint,
} from '@/lib/toolPresentation'
import { buildToolResultModel } from '@/lib/toolResultView'
import { MarkdownBody } from '@/components/chat/MarkdownBody'

function Field({
  label,
  value,
  danger,
  mono = true,
}: {
  label: string
  value: string
  danger?: boolean
  mono?: boolean
}) {
  return (
    <div>
      <div className="text-caption font-medium text-ink-tertiary">{label}</div>
      <pre
        className={cn(
          'mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-muted/60 px-2 py-1.5 text-caption',
          mono ? 'font-mono' : 'font-sans',
          danger ? 'text-danger' : 'text-ink-secondary',
        )}
      >
        {value}
      </pre>
    </div>
  )
}

function LineList({ lines }: { lines: string[] }) {
  const shown = lines.slice(0, 80)
  return (
    <ul className="mt-0.5 max-h-40 list-none space-y-0.5 overflow-auto rounded-md bg-surface-muted/60 px-2 py-1.5 font-mono text-caption text-ink-secondary">
      {shown.map((line, i) => (
        <li key={i} className="break-all">
          {line || ' '}
        </li>
      ))}
      {lines.length > shown.length && (
        <li className="text-ink-tertiary">…+{lines.length - shown.length}</li>
      )}
    </ul>
  )
}

function StructuredOutput({ tool, cleanOutput }: { tool: ToolCall; cleanOutput: string }) {
  const { t } = useTranslation()
  const name = tool.name

  if (name === 'task' || name === 'dispatch_agent') {
    if (!cleanOutput.trim()) {
      return <p className="text-caption text-ink-tertiary">{t('chat.subagent.noSummary')}</p>
    }
    return (
      <div className="max-h-48 overflow-auto rounded-md bg-surface-muted/60 px-2 py-1.5" data-testid="tool-structured-md">
        <MarkdownBody content={cleanOutput} className="text-meta [&_p]:my-1" />
      </div>
    )
  }

  if (name === 'grep' || name === 'glob' || name === 'ls') {
    const lines = cleanOutput.split('\n')
    return (
      <div>
        <div className="text-caption font-medium text-ink-tertiary">
          {tool.truncated ? `${t('artifact.output')} · ${t('artifact.truncated')}` : t('artifact.output')}
        </div>
        <LineList lines={lines} />
      </div>
    )
  }

  if (name === 'read_file' || name === 'read_media') {
    return (
      <Field
        label={tool.truncated ? `${t('artifact.output')} · ${t('artifact.truncated')}` : t('artifact.output')}
        value={cleanOutput}
      />
    )
  }

  return (
    <Field
      label={tool.truncated ? `${t('artifact.output')} · ${t('artifact.truncated')}` : t('artifact.output')}
      value={cleanOutput}
    />
  )
}

export function ToolCallRow({ tool }: { tool: ToolCall }) {
  const { t } = useTranslation()
  const model = useMemo(() => buildToolResultModel(tool), [tool])
  // Default collapsed — tool bodies (output/diff) are noisy when every row is open.
  const [open, setOpen] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const title = useMemo(() => toolTitleHint(tool), [tool])
  const cleanOutput = useMemo(
    () => sanitizeDisplayText(tool.output),
    [tool.output],
  )
  const errorInfo = useMemo(() => {
    if (tool.status !== 'error' || !tool.error) return null
    return humanizeToolError(tool.error, tool.input)
  }, [tool.status, tool.error, tool.input])

  const humanError = errorInfo
    ? errorInfo.key === 'chat.tool.error.generic'
      ? errorInfo.message
      : t(errorInfo.key, { path: errorInfo.path ?? '' })
    : ''

  return (
    <DeclarativeContextMenu kind="toolCall" payload={{ tool }}>
      <div
        className="min-w-0"
        data-testid="tool-card"
        data-tool-status={tool.status}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-[var(--trail-min-h)] w-full items-center gap-[var(--meta-gap)] py-0.5 text-left text-meta leading-5 text-ink-secondary transition-colors duration-chrome hover:text-ink"
          data-testid={tool.status === 'running' ? 'tool-card-running' : 'tool-row'}
        >
          <ChevronRight
            size={14}
            strokeWidth={1.75}
            className={cn('block shrink-0 text-ink-tertiary transition-transform duration-chrome', open && 'rotate-90')}
          />
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            {tool.status === 'running' && <Loader2 size={14} className="block animate-spin text-accent" />}
            {tool.status === 'finished' && <CheckCircle2 size={14} className="block text-success" />}
            {tool.status === 'error' && <XCircle size={14} className="block text-danger" />}
          </span>
          <span className="min-w-0 truncate font-mono text-ink" title={title}>
            {title}
          </span>
          {model.kind === 'shell' && model.exitCode != null && (
            <span className="shrink-0 font-mono text-ink-tertiary">
              exit {model.exitCode}
            </span>
          )}
          {tool.truncated && (
            <span className="shrink-0 text-ink-tertiary">{t('chat.tool.truncated')}</span>
          )}
        </button>
        <div className={cn('clip-expand', open && 'is-open')}>
          <div className="clip-expand-inner">
            <div className="mt-0.5 space-y-1.5 border-l border-border/70 py-1 pl-3" data-testid="tool-result-view">
            {tool.status === 'error' ? (
              <Field label={t('artifact.failed')} value={humanError || tool.error || ''} danger mono={false} />
            ) : model.kind === 'diff' && model.diff ? (
              <pre
                className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-muted/60 px-2 py-1.5 font-mono text-caption text-ink-secondary"
                data-testid="tool-inline-diff"
              >
                {model.diff}
              </pre>
            ) : model.kind === 'lines' && model.lines ? (
              <LineList lines={model.lines} />
            ) : (
              tool.output !== undefined && <StructuredOutput tool={tool} cleanOutput={cleanOutput} />
            )}
            <button
              type="button"
              className="text-caption text-ink-tertiary underline-offset-2 hover:text-ink-secondary hover:underline"
              onClick={() => setShowRaw((v) => !v)}
              data-testid="tool-raw-toggle"
            >
              {showRaw ? t('chat.tool.hideRaw') : t('chat.tool.showRaw')}
            </button>
            {showRaw && (
              <div className="space-y-1.5">
                <Field
                  label={tool.truncated ? `${t('artifact.arguments')} · ${t('artifact.truncated')}` : t('artifact.arguments')}
                  value={tool.input}
                />
                {tool.status === 'error' && tool.error && (
                  <Field label={t('chat.tool.rawError')} value={tool.error} danger />
                )}
                {tool.output !== undefined && (
                  <Field
                    label={t('chat.tool.rawOutput')}
                    value={tool.output}
                  />
                )}
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </DeclarativeContextMenu>
  )
}

// re-export for tests that might want input parse
export { parseToolInput, toolTitleHint }
