import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { useProvidersStore } from '@/store/providersStore'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { cn } from '@/lib/utils'
import { groupModelOptions } from '@/lib/agentModelOptions'
import { buildAgentDraft, isAgentDraftValid, type AgentForm } from '@/lib/agentDraft'
import { agentCategory } from '@/lib/agentCategory'
import { toolNamesToGroups, DEFAULT_TOOL_GROUPS, grantedMcpServerIds } from '@/lib/agentTools'
import { AcpProviderPicker } from './AcpProviderPicker'
import type { AcpPreset } from '@/lib/acpPresets'

const inputCls =
  'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

export function AgentEditor({
  initial,
  initialKind,
  onSave,
  onCancel,
}: {
  initial: AgentConfig | null
  initialKind?: AgentConfig['kind']
  onSave: (draft: Omit<AgentConfig, 'id'>) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { config, catalog } = useProvidersStore()
  // Existing agent → derive toggles from its stored allow-list; new agent → the git-off default.
  const groups0 = initial ? toolNamesToGroups(initial.allowedTools) : DEFAULT_TOOL_GROUPS
  const [form, setForm] = useState<AgentForm>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    kind: initial?.kind ?? initialKind ?? 'custom',
    command: initial?.command ?? '',
    args: (initial?.args ?? []).join(' '),
    transport: initial?.transport ?? (initialKind === 'acp' ? 'rich' : 'thin'),
    acceptsModelConfig: initial?.acceptsModelConfig ?? false,
    boundModelKey: initial?.boundModel ? `${initial.boundModel.providerID}/${initial.boundModel.modelID}` : '',
    authMode: initial?.authMode ?? 'opencode-self',
    quirks: initial?.quirks,
    prompt: initial?.prompt ?? '',
    toolsRead: groups0.read,
    toolsEdit: groups0.edit,
    toolsPlan: groups0.plan,
    toolsGit: groups0.git,
    toolsSkill: groups0.skill,
    toolsScript: groups0.script,
    mcpServerIds: initial ? grantedMcpServerIds(initial.allowedTools) : [],
    enabled: initial?.enabled ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isNewAcp = !initial && initialKind === 'acp'
  const [acpStep, setAcpStep] = useState<'pick' | 'form'>(isNewAcp ? 'pick' : 'form')

  const category = agentCategory({ kind: form.kind })
  const isAcp = category === 'acp'
  const isInternal = category === 'internal'
  const title = initial
    ? t('settings.agents.editTitle')
    : isAcp && acpStep === 'pick'
      ? t('settings.agents.acpPickTitle')
      : t(isAcp ? 'settings.agents.addAcp' : isInternal ? 'settings.agents.addInternal' : 'settings.agents.addCli')
  const groups = groupModelOptions(catalog, config)
  const patch = (p: Partial<AgentForm>) => setForm((f) => ({ ...f, ...p }))

  const pickPreset = (preset: AcpPreset) => {
    patch({ command: preset.command, args: preset.args.join(' '), quirks: preset.quirks, authMode: preset.authModeDefault ?? 'opencode-self', transport: 'rich' })
    setAcpStep('form')
  }
  const pickCustom = () => {
    patch({ command: '', args: '', quirks: undefined, authMode: 'opencode-self', transport: 'rich' })
    setAcpStep('form')
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSave(buildAgentDraft(form))
    } catch {
      setError(t('settings.agents.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
      title={title}
    >
      <div className="flex flex-col">
        {isAcp && acpStep === 'pick' ? (
          <>
            <div className="p-5">
              <AcpProviderPicker onPick={pickPreset} onPickCustom={pickCustom} />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-3">
              <Button variant="outline" size="sm" onClick={onCancel}>
                {t('settings.agents.cancel')}
              </Button>
            </div>
          </>
        ) : (
          <>
        <div className="space-y-5 p-5">
          {isNewAcp && (
            <button type="button" onClick={() => setAcpStep('pick')} className="text-meta text-accent-strong transition-colors hover:underline">
              {t('settings.agents.backToProviders')}
            </button>
          )}
          <Field label={t('settings.agents.name')}>
            <input className={inputCls} value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="My Agent" />
          </Field>

          <Field label={t('settings.agents.description')}>
            <textarea
              className={cn(inputCls, 'min-h-[64px] resize-y')}
              value={form.description ?? ''}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder={t('settings.agents.descriptionPlaceholder')}
              rows={3}
            />
          </Field>

          {isInternal ? (
            <>
              <Field label={t('settings.agents.prompt')}>
                <textarea
                  className={cn(inputCls, 'min-h-[140px] resize-y font-mono')}
                  value={form.prompt}
                  onChange={(e) => patch({ prompt: e.target.value })}
                  placeholder={t('settings.agents.promptPlaceholder')}
                  rows={7}
                />
              </Field>

              <Section label={t('settings.agents.sectionModel')}>
                <select className={inputCls} value={form.boundModelKey} onChange={(e) => patch({ boundModelKey: e.target.value })}>
                  <option value="">{t('settings.agents.modelGlobal')}</option>
                  {groups.map((g) => (
                    <optgroup key={g.providerID} label={g.providerName}>
                      {g.models.map((m) => (
                        <option key={m.key} value={m.key}>{m.modelID}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Section>

              <Section label={t('settings.agents.sectionTools')}>
                <div className="text-caption text-ink-tertiary">{t('settings.agents.toolsHint')}</div>
                <ToolToggle label={t('settings.agents.toolRead')} desc={t('settings.agents.toolReadDesc')} checked={form.toolsRead} onChange={(v) => patch({ toolsRead: v })} />
                <ToolToggle label={t('settings.agents.toolEdit')} desc={t('settings.agents.toolEditDesc')} checked={form.toolsEdit} onChange={(v) => patch({ toolsEdit: v })} />
                <ToolToggle label={t('settings.agents.toolPlan')} desc={t('settings.agents.toolPlanDesc')} checked={form.toolsPlan} onChange={(v) => patch({ toolsPlan: v })} />
                <ToolToggle label={t('settings.agents.toolGit')} desc={t('settings.agents.toolGitDesc')} checked={form.toolsGit} onChange={(v) => patch({ toolsGit: v })} />
              </Section>
            </>
          ) : (
            <>
              <Section label={t('settings.agents.sectionCommand')}>
                <Field label={t('settings.agents.command')}>
                  <input
                    className={cn(inputCls, 'font-mono')}
                    value={form.command}
                    onChange={(e) => patch({ command: e.target.value })}
                    placeholder="/usr/local/bin/my-agent"
                  />
                </Field>
                <Field label={t('settings.agents.args')}>
                  <input
                    className={cn(inputCls, 'font-mono')}
                    value={form.args}
                    onChange={(e) => patch({ args: e.target.value })}
                    placeholder="--loop --json"
                  />
                </Field>
              </Section>

              {isAcp && (
                <Field label={t('settings.agents.quirks')}>
                  <input
                    className={cn(inputCls, 'font-mono')}
                    value={form.quirks ?? ''}
                    onChange={(e) => patch({ quirks: e.target.value || undefined })}
                    placeholder={t('settings.agents.quirksPlaceholder')}
                  />
                </Field>
              )}

              <Section label={t('settings.agents.sectionTransport')}>
                <div
                  role="radiogroup"
                  aria-label={t('settings.agents.sectionTransport')}
                  className="flex gap-2"
                  onKeyDown={(e) => {
                    const next =
                      e.key === 'ArrowRight' || e.key === 'ArrowDown'
                        ? 'rich'
                        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                          ? 'thin'
                          : null
                    if (!next) return
                    e.preventDefault()
                    patch({ transport: next })
                    e.currentTarget.querySelectorAll('button')[next === 'thin' ? 0 : 1]?.focus()
                  }}
                >
                  <ChoiceCard
                    selected={form.transport === 'thin'}
                    title={t('settings.agents.transportThin')}
                    desc={t('settings.agents.transportThinDesc')}
                    onClick={() => patch({ transport: 'thin' })}
                  />
                  <ChoiceCard
                    selected={form.transport === 'rich'}
                    title={t('settings.agents.transportRich')}
                    desc={t('settings.agents.transportRichDesc')}
                    onClick={() => patch({ transport: 'rich' })}
                  />
                </div>
              </Section>

            </>
          )}

          {error && <div className="text-meta text-danger">{error}</div>}
        </div>

        <div className="flex items-center gap-2 border-t border-border bg-surface-subtle px-5 py-3">
          <div className="flex flex-1 items-center gap-2">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => patch({ enabled: v })}
              ariaLabel={t('settings.agents.enableThis')}
            />
            <span className="text-body text-ink-secondary">{t('settings.agents.enableThis')}</span>
          </div>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('settings.agents.cancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={busy || !isAgentDraftValid(form)} onClick={() => void submit()}>
            {t('settings.agents.save')}
          </Button>
        </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-meta text-ink-tertiary">{label}</label>
      {children}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-caption font-medium uppercase tracking-wide text-ink-tertiary">{label}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function ChoiceCard({
  selected,
  title,
  desc,
  onClick,
}: {
  selected: boolean
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onClick}
      className={cn(
        'flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        selected ? 'border-accent bg-accent-subtle' : 'border-border hover:bg-surface-muted',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('text-body font-medium', selected ? 'text-accent-strong' : 'text-ink')}>{title}</span>
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded-full border',
            selected ? 'border-accent bg-accent text-white' : 'border-border',
          )}
        >
          {selected && <Check size={11} />}
        </span>
      </div>
      <div className={cn('mt-1 text-caption', selected ? 'text-accent-strong/80' : 'text-ink-tertiary')}>{desc}</div>
    </button>
  )
}

function ToolToggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="flex-1">
        <div className="text-body text-ink">{label}</div>
        <div className="mt-0.5 font-mono text-caption text-ink-tertiary">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} ariaLabel={label} />
    </div>
  )
}
