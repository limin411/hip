import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Plug, Terminal, Search, Sparkles, Wrench } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { useProvidersStore } from '@/store/providersStore'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Badge } from '@/components/ui/Badge'
import { inputClassName } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { groupModelOptions } from '@/lib/agentModelOptions'
import { buildAgentDraft, isAgentDraftValid, type AgentForm } from '@/lib/agentDraft'
import { agentCategory } from '@/lib/agentCategory'
import { grantedMcpServerIds } from '@/lib/agentTools'
import { useHipConfigStore, useMcpServers } from '@/store/hipConfigStore'
import { useSkillsStore } from '@/store/skillsStore'
import { useAgentsStore } from '@/store/agentsStore'
import { useDetectionStore } from '@/store/detectionStore'
import { acpPresetById } from '@/lib/acpPresets'
import { AcpProviderPicker } from './AcpProviderPicker'
import type { AcpPreset } from '@/lib/acpPresets'

const inputCls = inputClassName

export function AgentEditor({
  initial,
  initialKind,
  onSave,
  onCancel,
  mode = 'inline',
}: {
  initial: AgentConfig | null
  initialKind?: AgentConfig['kind']
  onSave: (draft: Omit<AgentConfig, 'id'>) => Promise<void>
  onCancel: () => void
  /** `inline` = in-shell Settings L2 (default). `modal` = legacy portaled Task dialog. */
  mode?: 'modal' | 'inline'
}) {
  const { t } = useTranslation()
  const { config, catalog, keyConfigured } = useProvidersStore()
  const mcpServers = useMcpServers()
  const { skills } = useSkillsStore()
  const agents = useAgentsStore((s) => s.agents)
  const installed = useDetectionStore((s) => s.installed)
  const detectionChecked = useDetectionStore((s) => s.checked)
  const refreshDetection = useDetectionStore((s) => s.refresh)
  // Seed the per-skill / per-MCP grants from the stored agent. Back-compat: an old internal agent
  // has no allowedMcpServers — derive it once from legacy `mcp__<id>__*` wildcards in allowedTools
  // (grantedMcpServerIds(undefined) === [] when initial is null, so a new agent starts empty);
  // allowedSkills was never represented in the old model, so it starts empty (user re-selects).
  const seedAuthEnvVar = initial?.quirks ? acpPresetById(initial.quirks)?.authEnvVar : undefined
  const [form, setForm] = useState<AgentForm>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    kind: initial?.kind ?? initialKind ?? 'custom',
    command: initial?.command ?? '',
    args: (initial?.args ?? []).join(' '),
    boundModelKey: initial?.boundModel ? `${initial.boundModel.providerID}/${initial.boundModel.modelID}` : '',
    quirks: initial?.quirks,
    prompt: initial?.prompt ?? '',
    allowedSkills: initial?.allowedSkills ?? [],
    allowedMcpServers: initial?.allowedMcpServers ?? grantedMcpServerIds(initial?.allowedTools),
    enabled: initial?.enabled ?? true,
    apiKey: seedAuthEnvVar ? (initial?.env?.[seedAuthEnvVar] ?? '') : '',
    authEnvVar: seedAuthEnvVar,
    env: initial?.env,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void useHipConfigStore.getState().load()
    void useSkillsStore.getState().load()
    void refreshDetection()
  }, [refreshDetection])

  const isNewAcp = !initial && initialKind === 'acp'
  const [acpStep, setAcpStep] = useState<'pick' | 'form'>(isNewAcp ? 'pick' : 'form')

  const category = agentCategory({ kind: form.kind })
  const isAcp = category === 'acp'
  const isInternal = category === 'internal'
  // Bridged ACP agents need a community adapter CLI on PATH — note shown so launch command is clear.
  const selectedPreset = isAcp && form.quirks ? acpPresetById(form.quirks) : undefined
  const adapterPkg = selectedPreset?.adapterPkg
  const isPickStep = isAcp && acpStep === 'pick'
  const title = initial
    ? t('settings.agents.editTitle')
    : isPickStep
      ? t('settings.agents.acpPickTitle')
      : t(isAcp ? 'settings.agents.addAcp' : 'settings.agents.addInternal')
  const groups = groupModelOptions(catalog, config, keyConfigured)
  const patch = (p: Partial<AgentForm>) => setForm((f) => ({ ...f, ...p }))
  const toggleSkill = (id: string, on: boolean) =>
    setForm((f) => ({ ...f, allowedSkills: on ? [...f.allowedSkills, id] : f.allowedSkills.filter((x) => x !== id) }))
  const toggleMcpServer = (id: string, on: boolean) =>
    setForm((f) => ({ ...f, allowedMcpServers: on ? [...f.allowedMcpServers, id] : f.allowedMcpServers.filter((x) => x !== id) }))
  const setSkills = (ids: string[]) => setForm((f) => ({ ...f, allowedSkills: ids }))
  const setMcpServers = (ids: string[]) => setForm((f) => ({ ...f, allowedMcpServers: ids }))

  const skillItems = useMemo(
    () => skills.map((s) => ({ id: s.id, label: s.name, desc: s.description })),
    [skills],
  )
  const mcpItems = useMemo(
    () => mcpServers.map((s) => ({ id: s.id, label: s.name, desc: s.id })),
    [mcpServers],
  )

  const pickPreset = (preset: AcpPreset) => {
    patch({
      name: form.name.trim() || preset.name,
      command: preset.command,
      args: preset.args.join(' '),
      quirks: preset.quirks,
      authEnvVar: preset.authEnvVar,
      apiKey: '',
    })
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

  const formBody = (
    <div className="space-y-5 p-5 sm:p-6">
      {isNewAcp && (
        <button
          type="button"
          onClick={() => setAcpStep('pick')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 -ml-1.5',
            'text-meta font-medium text-accent-strong transition-colors',
            'hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
          )}
        >
          <ArrowLeft size={14} />
          {t('settings.agents.backToProviders')}
        </button>
      )}

      {isNewAcp && selectedPreset && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-subtle/80 px-3.5 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
            <Terminal size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body font-semibold text-ink">{selectedPreset.name}</span>
              {adapterPkg && (
                <Badge size="sm">
                  <Plug size={10} />
                  {adapterPkg}
                </Badge>
              )}
            </div>
            <div className="mt-0.5 truncate font-mono text-caption text-ink-tertiary">
              {selectedPreset.command}
              {selectedPreset.args.length > 0 ? ` ${selectedPreset.args.join(' ')}` : ''}
            </div>
          </div>
        </div>
      )}

      <Field label={t('settings.agents.name')}>
        <input className={inputCls} value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="My Agent" />
      </Field>

      <Field label={t('settings.agents.description')}>
        <textarea
          className={cn(inputCls, 'min-h-[56px] resize-y')}
          value={form.description ?? ''}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder={t('settings.agents.descriptionPlaceholder')}
          rows={2}
        />
      </Field>

      {isInternal ? (
        <>
          <Field label={t('settings.agents.prompt')}>
            <textarea
              className={cn(inputCls, 'min-h-[100px] resize-y font-mono')}
              value={form.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder={t('settings.agents.promptPlaceholder')}
              rows={5}
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

          {/* Side-by-side grant panels with independent scroll — keeps identity fields above the fold. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
            <GrantPanel
              icon={<Sparkles size={14} />}
              title={t('settings.agents.toolSkillsSection')}
              description={t('settings.agents.toolSkillsSectionDesc')}
              emptyLabel={t('settings.agents.toolSkillsEmpty')}
              items={skillItems}
              selected={form.allowedSkills}
              onToggle={toggleSkill}
              onSetSelected={setSkills}
            />
            <GrantPanel
              icon={<Wrench size={14} />}
              title={t('settings.agents.toolMcpServers')}
              description={t('settings.agents.toolMcpServersDesc')}
              emptyLabel={t('settings.agents.toolMcpServersEmpty')}
              items={mcpItems}
              selected={form.allowedMcpServers}
              onToggle={toggleMcpServer}
              onSetSelected={setMcpServers}
            />
          </div>
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

          {adapterPkg && (
            <div className="flex gap-2.5 rounded-xl border border-border bg-surface-subtle/60 px-3.5 py-2.5">
              <Plug size={14} className="mt-0.5 shrink-0 text-ink-tertiary" />
              <p className="text-caption leading-relaxed text-ink-secondary">
                {t('settings.agents.acpAdapterNote', { pkg: adapterPkg })}
              </p>
            </div>
          )}

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

          {isAcp && form.authEnvVar && (
            <Field label={t('settings.agents.apiKey')}>
              <input
                className={cn(inputCls, 'font-mono')}
                type="password"
                value={form.apiKey ?? ''}
                onChange={(e) => patch({ apiKey: e.target.value })}
                placeholder={form.authEnvVar}
              />
              <div className="mt-1 text-caption text-ink-tertiary">{t('settings.agents.apiKeyHint', { env: form.authEnvVar })}</div>
            </Field>
          )}
        </>
      )}

      {error && <div className="text-meta text-danger">{error}</div>}
    </div>
  )

  const formFooter = (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 items-center gap-2">
        <Switch
          checked={form.enabled}
          onCheckedChange={(v) => patch({ enabled: v })}
          ariaLabel={t('settings.agents.enableThis')}
        />
        <span className="text-body text-ink-secondary">{t('settings.agents.enableThis')}</span>
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {t('settings.agents.cancel')}
      </Button>
      <Button variant="primary" size="sm" disabled={busy || !isAgentDraftValid(form)} onClick={() => void submit()}>
        {t('settings.agents.save')}
      </Button>
    </div>
  )

  const pickFooter = (
    <div className="flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {t('settings.agents.cancel')}
      </Button>
    </div>
  )

  const body = isPickStep ? (
    <div className="p-5 sm:p-6">
      <AcpProviderPicker checked={detectionChecked} installed={installed} agents={agents} onPick={pickPreset} onRefresh={() => void refreshDetection()} />
    </div>
  ) : (
    formBody
  )
  const footer = isPickStep ? pickFooter : formFooter

  if (mode === 'inline') {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="settings-agent-editor">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-5">
          <h2 className="text-title font-semibold tracking-tight text-ink">{title}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
        <div className="shrink-0 border-t border-border bg-surface-subtle/80 px-5 py-3">{footer}</div>
      </div>
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
      title={title}
      variant="task"
      nested
      className={isPickStep || isInternal ? 'max-w-2xl' : undefined}
      footer={footer}
    >
      {body}
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
      <div className="mb-2 text-caption font-medium text-ink-tertiary">{label}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

type GrantItem = { id: string; label: string; desc: string }

/** Compact, independently-scrollable multi-select for skills / MCP grants. */
function GrantPanel({
  icon,
  title,
  description,
  emptyLabel,
  items,
  selected,
  onToggle,
  onSetSelected,
}: {
  icon: React.ReactNode
  title: string
  description: string
  emptyLabel: string
  items: GrantItem[]
  selected: string[]
  onToggle: (id: string, on: boolean) => void
  onSetSelected: (ids: string[]) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (it) => it.label.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q) || it.id.toLowerCase().includes(q),
    )
  }, [items, query])

  const showSearch = items.length > 6
  const allFilteredSelected = filtered.length > 0 && filtered.every((it) => selectedSet.has(it.id))
  const noneFilteredSelected = filtered.every((it) => !selectedSet.has(it.id))

  const selectFiltered = () => {
    const next = new Set(selected)
    for (const it of filtered) next.add(it.id)
    onSetSelected([...next])
  }
  const clearFiltered = () => {
    const drop = new Set(filtered.map((it) => it.id))
    onSetSelected(selected.filter((id) => !drop.has(id)))
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="shrink-0 space-y-2 border-b border-border bg-surface-subtle/50 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-body font-semibold text-ink">
              <span className="text-ink-tertiary">{icon}</span>
              {title}
            </div>
            <p className="mt-0.5 text-caption leading-snug text-ink-tertiary">{description}</p>
          </div>
          {items.length > 0 && (
            <Badge size="sm" className="shrink-0 tabular-nums">
              {t('settings.agents.toolGrantSelected', { selected: selected.length, total: items.length })}
            </Badge>
          )}
        </div>

        {items.length > 0 && (
          <div className="flex items-center gap-1.5">
            {showSearch && (
              <div className="relative min-w-0 flex-1">
                <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-tertiary" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('settings.agents.toolGrantSearch')}
                  className={cn(
                    'h-7 w-full rounded-md border border-border bg-surface pl-7 pr-2 text-caption text-ink',
                    'placeholder:text-ink-tertiary focus-visible:outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/10',
                  )}
                />
              </div>
            )}
            <div className={cn('flex shrink-0 items-center gap-0.5', !showSearch && 'ml-auto')}>
              <button
                type="button"
                disabled={allFilteredSelected || filtered.length === 0}
                onClick={selectFiltered}
                className={cn(
                  'rounded-md px-1.5 py-1 text-caption font-medium text-accent-strong transition-colors',
                  'hover:bg-state-hover disabled:pointer-events-none disabled:opacity-40',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                )}
              >
                {t('settings.agents.toolGrantSelectAll')}
              </button>
              <span className="text-ink-tertiary/50">·</span>
              <button
                type="button"
                disabled={noneFilteredSelected}
                onClick={clearFiltered}
                className={cn(
                  'rounded-md px-1.5 py-1 text-caption font-medium text-ink-secondary transition-colors',
                  'hover:bg-state-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                )}
              >
                {t('settings.agents.toolGrantClear')}
              </button>
            </div>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="px-3 py-6 text-center text-caption text-ink-tertiary">{emptyLabel}</div>
      ) : filtered.length === 0 ? (
        <div className="px-3 py-6 text-center text-caption text-ink-tertiary">{t('settings.agents.toolGrantNoMatch')}</div>
      ) : (
        <div className="max-h-52 divide-y divide-border overflow-y-auto overscroll-contain sm:max-h-60">
          {filtered.map((it) => {
            const checked = selectedSet.has(it.id)
            return (
              <div
                key={it.id}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 transition-colors',
                  checked ? 'bg-accent-subtle/40' : 'hover:bg-state-hover',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-ink">{it.label}</div>
                  {it.desc && it.desc !== it.label && (
                    <div className="truncate text-caption text-ink-tertiary" title={it.desc}>
                      {it.desc}
                    </div>
                  )}
                </div>
                <Switch checked={checked} onCheckedChange={(v) => onToggle(it.id, v)} ariaLabel={it.label} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
