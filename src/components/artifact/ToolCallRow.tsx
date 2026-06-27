import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import type { ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'

/** Best-effort: pull a file path (or first stringy arg) out of a JSON-stringified tool input. */
function targetHint(input: string): string {
  try {
    const o = JSON.parse(input) as Record<string, unknown>
    const v = o.path ?? o.file_path ?? o.filename ?? o.file
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

function Field({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <div className="text-caption uppercase tracking-wide text-ink-tertiary">{label}</div>
      <pre className={cn('mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-surface px-2 py-1 font-mono text-caption', danger ? 'text-danger' : 'text-ink-secondary')}>{value}</pre>
    </div>
  )
}

export function ToolCallRow({ tool }: { tool: ToolCall }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const hint = targetHint(tool.input)
  return (
    <div className="rounded-lg border border-border bg-surface-muted/40">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors" data-testid="tool-row">
        <ChevronRight size={12} className={cn('shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')} />
        <span className="shrink-0 font-mono text-meta text-ink">{tool.name}</span>
        {hint && <span className="truncate font-mono text-caption text-ink-tertiary">{hint}</span>}
        <span className="ml-auto shrink-0">
          {tool.status === 'running' && <Loader2 size={12} className="animate-spin text-accent-strong" />}
          {tool.status === 'finished' && <CheckCircle2 size={12} className="text-success" />}
          {tool.status === 'error' && <XCircle size={12} className="text-danger" />}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border px-2 py-1.5">
          <Field label={tool.truncated ? `${t('artifact.arguments')} · ${t('artifact.truncated')}` : t('artifact.arguments')} value={tool.input} />
          {tool.status === 'error'
            ? <Field label={t('artifact.failed')} value={tool.error ?? ''} danger />
            : tool.output !== undefined && (
                <Field label={tool.truncated ? `${t('artifact.output')} · ${t('artifact.truncated')}` : t('artifact.output')} value={tool.output} />
              )}
        </div>
      )}
    </div>
  )
}
