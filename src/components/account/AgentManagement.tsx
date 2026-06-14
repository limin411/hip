import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Pencil, Trash2, Plus } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { useProvidersStore } from '@/store/providersStore'
import { Modal } from '@/components/ui/Modal'

type Editing = { mode: 'add' } | { mode: 'edit'; agent: AgentConfig } | null

export function AgentManagement() {
  const { t } = useTranslation()
  const { agents, loaded, load, addAgent, updateAgent, removeAgent } = useAgentsStore()
  const [editing, setEditing] = useState<Editing>(null)

  useEffect(() => { if (!loaded) void load() }, [loaded, load])

  return (
    <div className="p-6">
      <h2 className="text-title font-semibold text-ink">{t('settings.agents.title')}</h2>
      <p className="mt-1 text-body text-ink-secondary">{t('settings.agents.intro')}</p>

      <div className="mt-5 space-y-2">
        {/* Built-in hip agent — pinned, non-editable */}
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-subtle px-4 py-3">
          <div className="flex items-center gap-3">
            <Bot size={18} className="text-accent-strong" />
            <div>
              <div className="text-body font-medium text-ink">{t('settings.agents.builtinName')}</div>
              <div className="text-meta text-ink-tertiary">{t('settings.agents.builtinDesc')}</div>
            </div>
          </div>
        </div>

        {/* Registered external agents */}
        {agents.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-md border border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium text-ink">
                {a.name}
                {!a.enabled && <span className="ml-2 text-meta text-ink-tertiary">({t('settings.agents.off')})</span>}
              </div>
              <div className="truncate text-meta text-ink-tertiary">
                {a.command}{a.args.length > 0 ? ` ${a.args.join(' ')}` : ''} · {a.transport}
                {a.boundModel ? ` · ${a.boundModel.providerID}/${a.boundModel.modelID}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pl-3">
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted"
                onClick={() => setEditing({ mode: 'edit', agent: a })}
                aria-label={t('settings.agents.edit')}
              >
                <Pencil size={14} />
              </button>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted"
                onClick={() => void removeAgent(a.id)}
                aria-label={t('settings.agents.delete')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}

        {agents.length === 0 && (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-meta text-ink-tertiary">
            {t('settings.agents.empty')}
          </div>
        )}

        <button
          onClick={() => setEditing({ mode: 'add' })}
          className="mt-2 flex items-center gap-1.5 text-body font-medium text-accent-strong hover:opacity-75"
        >
          <Plus size={15} /> {t('settings.agents.add')}
        </button>
      </div>

      {editing && (
        <AgentEditor
          initial={editing.mode === 'edit' ? editing.agent : null}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            if (editing.mode === 'edit') await updateAgent(editing.agent.id, draft)
            else await addAgent(draft)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function AgentEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: AgentConfig | null
  onSave: (draft: Omit<AgentConfig, 'id'>) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { config, catalog } = useProvidersStore()
  const [name, setName] = useState(initial?.name ?? '')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [args, setArgs] = useState((initial?.args ?? []).join(' '))
  const [transport, setTransport] = useState<AgentConfig['transport']>(initial?.transport ?? 'thin')
  const [acceptsModelConfig, setAccepts] = useState(initial?.acceptsModelConfig ?? false)
  const [boundModelKey, setBoundModelKey] = useState(
    initial?.boundModel ? `${initial.boundModel.providerID}/${initial.boundModel.modelID}` : '',
  )
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Flatten catalog entries that are enabled in config into provider/model option pairs.
  const modelOptions: Array<{ key: string; label: string }> = Object.entries(catalog)
    .filter(([id]) => config.providers[id]?.enabled)
    .flatMap(([id, p]) =>
      Object.keys(p.models ?? {}).map((m) => ({
        key: `${id}/${m}`,
        label: `${p.name} · ${m}`,
      })),
    )

  const valid = name.trim() !== '' && command.trim() !== '' && (!acceptsModelConfig || boundModelKey !== '')

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const [providerID, modelID] = boundModelKey.split('/')
      await onSave({
        name: name.trim(),
        kind: 'custom',
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : [],
        transport,
        acceptsModelConfig,
        boundModel:
          acceptsModelConfig && boundModelKey ? { providerID, modelID } : undefined,
        enabled,
      })
    } catch {
      setError(t('settings.agents.error'))
    } finally {
      setBusy(false)
    }
  }

  // Real input class from ModelConfig.tsx (AddCustomProvider `field` variable):
  const inputCls =
    'h-8 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onCancel() }}
      title={initial ? t('settings.agents.editTitle') : t('settings.agents.addCustom')}
      resizable
      defaultSize={{ width: 560, height: 560 }}
      minSize={{ width: 480, height: 440 }}
    >
      <div className="space-y-4 p-5 text-body">
        <Field label={t('settings.agents.name')}>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Agent"
          />
        </Field>
        <Field label={t('settings.agents.command')}>
          <input
            className={inputCls}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="/usr/local/bin/my-agent"
          />
        </Field>
        <Field label={t('settings.agents.args')}>
          <input
            className={inputCls}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="--loop --json"
          />
        </Field>
        <Field label={t('settings.agents.transport')}>
          <select
            className={inputCls}
            value={transport}
            onChange={(e) => setTransport(e.target.value as AgentConfig['transport'])}
          >
            <option value="thin">{t('settings.agents.transportThin')}</option>
            <option value="rich">{t('settings.agents.transportRich')}</option>
          </select>
        </Field>

        <label className="flex items-center gap-2 text-body text-ink">
          <input
            type="checkbox"
            checked={acceptsModelConfig}
            onChange={(e) => setAccepts(e.target.checked)}
          />
          {t('settings.agents.acceptsModel')}
        </label>

        {acceptsModelConfig && (
          <Field label={t('settings.agents.boundModel')}>
            <select
              className={inputCls}
              value={boundModelKey}
              onChange={(e) => setBoundModelKey(e.target.value)}
            >
              <option value="">—</option>
              {modelOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <label className="flex items-center gap-2 text-body text-ink">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t('settings.agents.enabled')}
        </label>

        {error && <div className="text-meta text-danger">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          {/* Secondary button — matches ModelConfig.tsx "Clear" / "Cancel" button style */}
          <button
            className="h-8 rounded-md border border-border px-3 text-body text-ink-secondary hover:bg-surface-muted disabled:opacity-50"
            onClick={onCancel}
          >
            {t('settings.agents.cancel')}
          </button>
          {/* Primary button — matches ModelConfig.tsx "Save" button style */}
          <button
            className="h-8 rounded-md bg-accent px-3 text-body font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            disabled={busy || !valid}
            onClick={() => void submit()}
          >
            {t('settings.agents.save')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-meta text-ink-tertiary">{label}</label>
      {children}
    </div>
  )
}
