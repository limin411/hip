import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, Download, Trash2, Upload } from 'lucide-react'
import type { MemoryFileConfig, MemoryItem } from '@hip/protocol'
import { sessionService } from '@/domain'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { cn } from '@/lib/utils'

const inputCls =
  'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

function downloadText(filename: string, data: string, mime = 'application/x-ndjson') {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function MemoryConfig() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<MemoryFileConfig | null>(null)
  const [items, setItems] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extractModelDraft, setExtractModelDraft] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const cfg = await sessionService.getMemoryConfig()
      setConfig(cfg)
      setExtractModelDraft(cfg.extractModel ?? '')
      if (cfg.useMemories || cfg.generateMemories) {
        const list = await sessionService.listMemories({ limit: 200 })
        setItems(list)
      } else {
        setItems([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const applyConfig = async (partial: Partial<MemoryFileConfig>) => {
    setBusy(true)
    setError(null)
    try {
      const cfg = await sessionService.setMemoryConfig(partial)
      setConfig(cfg)
      setExtractModelDraft(cfg.extractModel ?? '')
      if (cfg.useMemories || cfg.generateMemories) {
        const list = await sessionService.listMemories({ limit: 200 })
        setItems(list)
      } else {
        setItems([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await sessionService.deleteMemory(id)
      setItems((prev) => prev.filter((it) => it.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onExport = async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await sessionService.exportMemories('jsonl')
      downloadText(`hip-memories-${new Date().toISOString().slice(0, 10)}.jsonl`, data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onImportFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const data = await file.text()
      await sessionService.importMemories(data)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onConsolidate = () => {
    sessionService.consolidateMemories()
  }

  const onSaveExtractModel = async () => {
    const next = extractModelDraft.trim()
    await applyConfig({ extractModel: next || undefined })
  }

  if (loading && !config) {
    return (
      <div className="p-6">
        <h2 className="text-title font-semibold text-ink">{t('settings.memory.title')}</h2>
        <p className="mt-2 text-body text-ink-secondary">{t('settings.memory.loading')}</p>
      </div>
    )
  }

  const bothOff = config !== null && !config.useMemories && !config.generateMemories

  if (bothOff) {
    return (
      <div className="p-6" data-testid="memory-config-empty">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Brain size={18} />
          </span>
          <div>
            <h2 className="text-title font-semibold text-ink">{t('settings.memory.title')}</h2>
            <p className="mt-1 text-body text-ink-secondary">{t('settings.memory.intro')}</p>
            <p className="mt-3 text-body text-ink-tertiary">{t('settings.memory.emptyHint')}</p>
          </div>
        </div>
        {error && (
          <p className="mt-4 text-body text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            data-testid="memory-enable-both"
            onClick={() => void applyConfig({ useMemories: true, generateMemories: true })}
          >
            {t('settings.memory.enableBoth')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            data-testid="memory-enable-use-only"
            onClick={() => void applyConfig({ useMemories: true, generateMemories: false })}
          >
            {t('settings.memory.enableUseOnly')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6" data-testid="memory-config">
      <div>
        <h2 className="text-title font-semibold text-ink">{t('settings.memory.title')}</h2>
        <p className="mt-1 text-body text-ink-secondary">{t('settings.memory.intro')}</p>
      </div>

      {error && (
        <p className="mt-4 text-body text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="mt-2 divide-y divide-border border-t border-border">
        <div className="flex items-center justify-between px-0 py-5">
          <div className="min-w-0 flex-1">
            <div className="text-prose font-medium text-ink">{t('settings.memory.useMemories')}</div>
            <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.memory.useMemoriesDesc')}</div>
          </div>
          <Switch
            checked={!!config?.useMemories}
            disabled={busy || !config}
            ariaLabel={t('settings.memory.useMemories')}
            data-testid="memory-switch-use"
            onCheckedChange={(v) => void applyConfig({ useMemories: v })}
          />
        </div>
        <div className="flex items-center justify-between px-0 py-5">
          <div className="min-w-0 flex-1">
            <div className="text-prose font-medium text-ink">{t('settings.memory.generateMemories')}</div>
            <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.memory.generateMemoriesDesc')}</div>
          </div>
          <Switch
            checked={!!config?.generateMemories}
            disabled={busy || !config}
            ariaLabel={t('settings.memory.generateMemories')}
            data-testid="memory-switch-generate"
            onCheckedChange={(v) => void applyConfig({ generateMemories: v })}
          />
        </div>
      </div>

      <div className="mt-2 border-t border-border pt-5">
        <label className="text-prose font-medium text-ink" htmlFor="memory-extract-model">
          {t('settings.memory.extractModel')}
        </label>
        <p className="mt-0.5 text-meta text-ink-tertiary">{t('settings.memory.extractModelDesc')}</p>
        <div className="mt-2 flex gap-2">
          <input
            id="memory-extract-model"
            className={cn(inputCls, 'flex-1')}
            value={extractModelDraft}
            placeholder={t('settings.memory.extractModelPlaceholder')}
            data-testid="memory-extract-model"
            onChange={(e) => setExtractModelDraft(e.target.value)}
          />
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onSaveExtractModel()}>
            {t('settings.memory.save')}
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy} data-testid="memory-export" onClick={() => void onExport()}>
          <Download size={14} />
          {t('settings.memory.exportJsonl')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          data-testid="memory-import"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={14} />
          {t('settings.memory.importJsonl')}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} data-testid="memory-consolidate" onClick={onConsolidate}>
          {t('settings.memory.consolidate')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jsonl,application/x-ndjson,text/plain"
          className="hidden"
          data-testid="memory-import-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void onImportFile(f)
          }}
        />
      </div>

      <div className="mt-8">
        <h3 className="text-prose font-medium text-ink">{t('settings.memory.listTitle')}</h3>
        {items.length === 0 ? (
          <p className="mt-3 text-body text-ink-tertiary" data-testid="memory-list-empty">
            {t('settings.memory.listEmpty')}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border" data-testid="memory-list">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-3 py-3" data-testid={`memory-item-${item.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-ink">{item.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-caption text-ink-tertiary">
                    <span>{item.kind}</span>
                    <span>·</span>
                    <span>{item.scope}</span>
                    <span>·</span>
                    <span>
                      {t('settings.memory.confidence', {
                        value: Math.round(item.confidence * 100),
                      })}
                    </span>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0 text-ink-secondary hover:text-danger"
                  disabled={busy}
                  aria-label={t('settings.memory.delete')}
                  data-testid={`memory-delete-${item.id}`}
                  onClick={() => void onDelete(item.id)}
                >
                  <Trash2 size={15} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
