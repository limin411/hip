import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentConfig } from '@hip/protocol'
import { useProvidersStore } from '@/store/providersStore'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
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
  // For adapter-bridged ACP agents (Claude Code/Codex), the community adapter package — shown as a
  // clarifying note so the `npx @<vendor>/…` launch command doesn't read as a mistake.
  const adapterPkg = isAcp && form.quirks ? acpPresetById(form.quirks)?.adapterPkg : undefined
  const title = initial
    ? t('settings.agents.editTitle')
    : isAcp && acpStep === 'pick'
      ? t('settings.agents.acpPickTitle')
      : t(isAcp ? 'settings.agents.addAcp' : 'settings.agents.addInternal')
  const groups = groupModelOptions(catalog, config)
  const patch = (p: Partial<AgentForm>) => setForm((f) => ({ ...f, ...p }))
  const toggleSkill = (id: string, on: boolean) =>
    setForm((f) => ({ ...f, allowedSkills: on ? [...f.allowedSkills, id] : f.allowedSkills.filter((x) => x !== id) }))
  const toggleMcpServer = (id: string, on: boolean) =>
    setForm((f) => ({ ...f, allowedMcpServers: on ? [...f.allowedMcpServers, id] : f.allowedMcpServers.filter((x) => x !== id) }))

  const pickPreset = (preset: AcpPreset) => {
    patch({ command: preset.command, args: preset.args.join(' '), quirks: preset.quirks, authEnvVar: preset.authEnvVar, apiKey: '' })
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

  const body = (
    <div className="flex flex-col">
      {isAcp && acpStep === 'pick' ? (
        <>
          <div className="p-5">
            <AcpProviderPicker checked={detectionChecked} installed={installed} agents={agents} onPick={pickPreset} onRefresh={() => void refreshDetection()} />
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

                <Section label={t('settings.agents.toolSkillsSection')}>
                  <div className="text-caption text-ink-tertiary">{t('settings.agents.toolSkillsSectionDesc')}</div>
                  {skills.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-caption text-ink-tertiary">
                      {t('settings.agents.toolSkillsEmpty')}
                    </div>
                  ) : (
                    skills.map((s) => (
                      <ToolToggle
                        key={s.id}
                        label={s.name}
                        desc={s.description}
                        checked={form.allowedSkills.includes(s.id)}
                        onChange={(v) => toggleSkill(s.id, v)}
                      />
                    ))
                  )}
                </Section>

                <Section label={t('settings.agents.toolMcpServers')}>
                  <div className="text-caption text-ink-tertiary">{t('settings.agents.toolMcpServersDesc')}</div>
                  {mcpServers.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-caption text-ink-tertiary">
                      {t('settings.agents.toolMcpServersEmpty')}
                    </div>
                  ) : (
                    mcpServers.map((s) => (
                      <ToolToggle
                        key={s.id}
                        label={s.name}
                        desc={s.id}
                        checked={form.allowedMcpServers.includes(s.id)}
                        onChange={(v) => toggleMcpServer(s.id, v)}
                      />
                    ))
                  )}
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

                {adapterPkg && (
                  <div className="rounded-lg border border-dashed border-border px-3 py-2 text-caption text-ink-tertiary">
                    {t('settings.agents.acpAdapterNote', { pkg: adapterPkg })}
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
  )

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
      title={title}
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
      <div className="mb-2 text-caption font-medium uppercase tracking-wide text-ink-tertiary">{label}</div>
      <div className="space-y-2">{children}</div>
    </div>
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
