import { Package, Plus, Trash2, CheckCircle2, AlertCircle } from 'lucide-react'
import type { PluginMeta } from '@hip/protocol'
import type { PluginInstallState } from '@/domain/sessionStore'
import { Button } from '@/components/ui/Button'

const inputCls =
  'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

export type Translate = (key: string, options?: Record<string, unknown>) => string

export function formatComponentCounts(plugin: PluginMeta, t: Translate): string {
  return t('settings.plugins.componentCounts', {
    skills: plugin.skills.length,
    mcpServers: plugin.mcpServers.length,
    agents: plugin.agents.length,
    hooks: plugin.hookCount,
  })
}

export function installStatusLabel(status: PluginInstallState['status'] | null | undefined, t: Translate): string {
  switch (status) {
    case 'cloning':
      return t('settings.plugins.statusCloning')
    case 'scanning':
      return t('settings.plugins.statusScanning')
    case 'generating_manifest':
      return t('settings.plugins.statusGeneratingManifest')
    case 'registering':
      return t('settings.plugins.statusRegistering')
    case 'done':
      return t('settings.plugins.statusDone')
    case 'error':
      return t('settings.plugins.statusError')
    default:
      return ''
  }
}

export interface PluginConfigViewProps {
  plugins: PluginMeta[]
  pluginInstall: PluginInstallState | null
  showForm: boolean
  url: string
  submitted: boolean
  error: string | null
  success: boolean
  onShowForm: () => void
  onHideForm: () => void
  onUrlChange: (url: string) => void
  onSubmit: () => void
  onRetry: () => void
  onDelete: (plugin: PluginMeta) => void
  t: Translate
}

export function PluginConfigView({
  plugins,
  pluginInstall,
  showForm,
  url,
  submitted,
  error,
  success,
  onShowForm,
  onHideForm,
  onUrlChange,
  onSubmit,
  onRetry,
  onDelete,
  t,
}: PluginConfigViewProps) {
  const showProgress = submitted && !pluginInstall?.result && pluginInstall?.status && pluginInstall.status !== 'done' && pluginInstall.status !== 'error'
  const progressLabel = showProgress ? installStatusLabel(pluginInstall.status, t) : ''

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-title font-semibold text-ink">{t('settings.plugins.title')}</h2>
          <p className="mt-1 text-body text-ink-secondary">{t('settings.plugins.intro')}</p>
        </div>
        <Button size="sm" onClick={onShowForm}>
          <Plus size={15} /> {t('settings.plugins.install')}
        </Button>
      </div>

      {showForm && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <label className="mb-1.5 block text-meta text-ink-tertiary">{t('settings.plugins.urlLabel')}</label>
          <input
            className={inputCls}
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder={t('settings.plugins.urlPlaceholder')}
            disabled={submitted}
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={submitted} onClick={onHideForm}>
              {t('settings.plugins.cancel')}
            </Button>
            <Button size="sm" disabled={submitted || !url.trim()} onClick={() => void onSubmit()}>
              {t('settings.plugins.install')}
            </Button>
          </div>
        </div>
      )}

      {showProgress && (
        <div className="mt-4 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-meta text-accent-strong">
          {progressLabel}{pluginInstall?.message ? `: ${pluginInstall.message}` : ''}
        </div>
      )}

      {success && (
        <div className="mt-4 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-meta text-success">
          <CheckCircle2 size={14} className="mr-1.5 inline" />
          {t('settings.plugins.installSuccess')}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-meta text-danger">
          <AlertCircle size={14} className="mr-1.5 inline" />
          {error}
          <button
            onClick={() => void onRetry()}
            className="ml-3 font-medium underline hover:no-underline"
          >
            {t('settings.plugins.retry')}
          </button>
        </div>
      )}

      {plugins.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-8 text-center">
          <Package size={22} className="mx-auto text-ink-tertiary" />
          <div className="mt-2 text-body text-ink-secondary">{t('settings.plugins.empty')}</div>
          <div className="mt-1 text-meta text-ink-tertiary">{t('settings.plugins.emptyHint')}</div>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plugins.map((plugin) => (
            <PluginCard key={plugin.id} plugin={plugin} onDelete={() => onDelete(plugin)} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}

function PluginCard({ plugin, onDelete, t }: { plugin: PluginMeta; onDelete: () => void; t: Translate }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
            <Package size={18} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-body font-medium text-ink">{plugin.name}</span>
              <span className="shrink-0 text-caption text-ink-tertiary">{plugin.version}</span>
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onDelete}>
          <Trash2 size={14} /> {t('settings.plugins.uninstall')}
        </Button>
      </div>
      {plugin.description && (
        <div className="mt-3 truncate text-body text-ink-secondary">{plugin.description}</div>
      )}
      <div className="mt-3 text-caption text-ink-tertiary">{formatComponentCounts(plugin, t)}</div>
    </div>
  )
}
