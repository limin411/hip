import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Folder, Search, X } from 'lucide-react'
import type { Automation, AutomationTrigger, AutomationTriggerKind } from '@/domain/automations'
import { AUTOMATION_NAME_MAX } from '@/domain/automations'
import { useAutomationStore } from '@/store/automationStore'
import { useProvidersStore } from '@/store/providersStore'
import { useAgents } from '@/store/hipConfigStore'
import { Button } from '@/components/ui/Button'
import { Input, inputClassName } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { pickDirectory } from '@/ipc/dialog'
import { groupModelOptions } from '@/lib/agentModelOptions'
import {
  currentModelLabel,
  filterModelGroups,
} from '@/lib/modelPickerSearch'
import { isAcpCapableAgent } from '@/lib/sessionAgent'
import { cn } from '@/lib/utils'
import {
  getAutomationTemplate,
  type AutomationTemplate,
  type AutomationTemplateSoftWarning,
} from './templates'
import type { SkillSeedDraft } from './AutomationEmptyState'

export type EditorMode =
  | { mode: 'closed' }
  | {
      mode: 'create'
      template?: AutomationTemplate | null
      skillSeed?: SkillSeedDraft | null
    }
  | { mode: 'edit'; automationId: string }

export type AutomationEditorModalProps = {
  state: EditorMode
  onClose: () => void
  onCreated?: (id: string, ran: boolean) => void
}

type Draft = {
  name: string
  prompt: string
  triggerKind: AutomationTriggerKind
  hour: number
  minute: number
  weekday: number
  projectPath: string
  agentId: string
  modelKey: string
  skillIds: string[]
  templateId: string | null
  requiresProject: boolean
  softWarnings: AutomationTemplateSoftWarning[]
}

function emptyDraft(): Draft {
  return {
    name: '',
    prompt: '',
    triggerKind: 'manual',
    hour: 9,
    minute: 0,
    weekday: 1,
    projectPath: '',
    agentId: '',
    modelKey: '',
    skillIds: [],
    templateId: null,
    requiresProject: false,
    softWarnings: [],
  }
}

/** Re-derive template constraints from catalog templateId (edit path honesty). */
function constraintsFromTemplateId(templateId: string | null | undefined): {
  requiresProject: boolean
  softWarnings: AutomationTemplateSoftWarning[]
} {
  if (!templateId) return { requiresProject: false, softWarnings: [] }
  const tpl = getAutomationTemplate(templateId)
  if (!tpl) return { requiresProject: false, softWarnings: [] }
  return {
    requiresProject: tpl.requiresProject,
    softWarnings: tpl.softWarnings ? [...tpl.softWarnings] : [],
  }
}

function draftFromAutomation(a: Automation): Draft {
  const tr = a.trigger
  const constraints = constraintsFromTemplateId(a.templateId)
  return {
    name: a.name,
    prompt: a.prompt,
    triggerKind: tr.kind,
    hour: tr.kind === 'manual' ? 9 : tr.hour,
    minute: tr.kind === 'manual' ? 0 : tr.minute,
    weekday: tr.kind === 'weekly' ? tr.weekday : 1,
    projectPath: a.projectPath?.trim() ?? '',
    agentId: a.agentId ?? '',
    modelKey:
      a.llmProvider && a.model ? `${a.llmProvider}/${a.model}` : a.model ?? '',
    skillIds: a.skillIds ? [...a.skillIds] : [],
    templateId: a.templateId ?? null,
    requiresProject: constraints.requiresProject,
    softWarnings: constraints.softWarnings,
  }
}

function toTrigger(d: Draft): AutomationTrigger {
  if (d.triggerKind === 'manual') return { kind: 'manual' }
  if (d.triggerKind === 'daily') {
    return { kind: 'daily', hour: d.hour, minute: d.minute }
  }
  return {
    kind: 'weekly',
    weekday: d.weekday,
    hour: d.hour,
    minute: d.minute,
  }
}

function parseModelKey(key: string): { llmProvider?: string; model?: string } {
  const s = key.trim()
  if (!s) return {}
  const i = s.indexOf('/')
  if (i <= 0) return { model: s }
  return { llmProvider: s.slice(0, i), model: s.slice(i + 1) }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Copilot-style field label: slightly stronger than caption, not heavy. */
function FieldLabel({
  children,
  required,
  htmlFor,
}: {
  children: React.ReactNode
  required?: boolean
  htmlFor?: string
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-body font-medium text-ink"
    >
      {children}
      {required ? <span className="text-danger"> *</span> : null}
    </label>
  )
}

/** Compact chip used in the prompt toolbar (agent / project-style controls). */
const chipClassName = cn(
  'inline-flex h-7 max-w-[11rem] items-center gap-1 rounded-md px-2 text-meta font-medium transition-colors duration-chrome',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
  'text-ink-tertiary hover:bg-state-hover hover:text-ink-secondary',
  'disabled:cursor-not-allowed disabled:opacity-50',
)

export function AutomationEditorModal({
  state,
  onClose,
  onCreated,
}: AutomationEditorModalProps) {
  const { t } = useTranslation()
  const automations = useAutomationStore((s) => s.automations)
  const create = useAutomationStore((s) => s.create)
  const update = useAutomationStore((s) => s.update)
  const runNow = useAutomationStore((s) => s.runNow)
  const catalog = useProvidersStore((s) => s.catalog)
  const providersConfig = useProvidersStore((s) => s.config)
  const keyConfigured = useProvidersStore((s) => s.keyConfigured)
  const agents = useAgents()

  const modelGroups = useMemo(
    () => groupModelOptions(catalog, providersConfig, keyConfigured),
    [catalog, providersConfig, keyConfigured],
  )
  const acpAgents = useMemo(
    () => agents.filter((a) => isAcpCapableAgent(a)),
    [agents],
  )

  const open = state.mode !== 'closed'
  const editId = state.mode === 'edit' ? state.automationId : null
  const item = useMemo(
    () => (editId ? automations.find((a) => a.id === editId) ?? null : null),
    [editId, automations],
  )

  const [draft, setDraft] = useState<Draft>(() => emptyDraft())
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState(false)
  const [promptError, setPromptError] = useState(false)
  const [projectError, setProjectError] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const projectPickRef = useRef<HTMLButtonElement>(null)
  const modelSearchRef = useRef<HTMLInputElement>(null)

  const sessionKey =
    state.mode === 'closed'
      ? 'closed'
      : state.mode === 'create'
        ? `c:${state.template?.id ?? 'blank'}:${state.skillSeed?.skillIds?.join(',') ?? ''}`
        : `e:${state.automationId}`

  useEffect(() => {
    if (state.mode === 'closed') return
    setNameError(false)
    setPromptError(false)
    setProjectError(false)
    setModelQuery('')
    if (state.mode === 'create') {
      const d = emptyDraft()
      const tpl = state.template
      const seed = state.skillSeed
      if (tpl && tpl.id !== 'blank') {
        d.name = t(tpl.nameKey as 'automation.templates.dailyStandup.name')
        d.prompt = t(tpl.promptKey as 'automation.templates.dailyStandup.prompt')
        d.triggerKind = tpl.defaultTrigger.kind
        if (tpl.defaultTrigger.kind === 'daily') {
          d.hour = tpl.defaultTrigger.hour
          d.minute = tpl.defaultTrigger.minute
        } else if (tpl.defaultTrigger.kind === 'weekly') {
          d.weekday = tpl.defaultTrigger.weekday
          d.hour = tpl.defaultTrigger.hour
          d.minute = tpl.defaultTrigger.minute
        }
        d.templateId = tpl.id
        d.requiresProject = tpl.requiresProject
        d.softWarnings = tpl.softWarnings ? [...tpl.softWarnings] : []
      }
      if (seed) {
        d.name = seed.name
        d.prompt = seed.prompt
        d.skillIds = [...seed.skillIds]
        d.templateId = 'skill-bootstrap'
      }
      setDraft(d)
    } else if (state.mode === 'edit') {
      const target = automations.find((a) => a.id === state.automationId)
      if (target) {
        setDraft(draftFromAutomation(target))
      }
    }
    requestAnimationFrame(() => nameRef.current?.focus())
  }, [sessionKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.mode === 'edit' && editId && !item) onClose()
  }, [state.mode, editId, item, onClose])

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  const projectMissing =
    draft.requiresProject && !draft.projectPath.trim()

  const pickProject = async () => {
    const dir = await pickDirectory()
    if (dir) {
      patch({ projectPath: dir })
      setProjectError(false)
    }
  }

  const clearProject = () => {
    patch({ projectPath: '' })
    if (draft.requiresProject) setProjectError(true)
  }

  const validate = (): boolean => {
    let ok = true
    let focus: 'name' | 'prompt' | 'project' | null = null
    if (!draft.name.trim()) {
      setNameError(true)
      ok = false
      focus = 'name'
    }
    if (!draft.prompt.trim()) {
      setPromptError(true)
      ok = false
      if (!focus) focus = 'prompt'
    }
    if (projectMissing) {
      setProjectError(true)
      ok = false
      if (!focus) focus = 'project'
    }
    if (focus === 'name') nameRef.current?.focus()
    else if (focus === 'prompt') promptRef.current?.focus()
    else if (focus === 'project') projectPickRef.current?.focus()
    return ok
  }

  const buildInput = () => {
    const model = parseModelKey(draft.modelKey)
    return {
      name: draft.name.trim().slice(0, AUTOMATION_NAME_MAX),
      prompt: draft.prompt,
      trigger: toTrigger(draft),
      projectPath: draft.projectPath.trim() || null,
      agentId: draft.agentId.trim() || undefined,
      llmProvider: model.llmProvider,
      model: model.model,
      skillIds: draft.skillIds.length ? draft.skillIds : undefined,
      templateId: draft.templateId,
      enabled: true,
    }
  }

  const handleSave = async (andRun: boolean) => {
    if (!validate()) return
    setSaving(true)
    try {
      if (state.mode === 'edit' && editId) {
        await update(editId, buildInput())
        if (andRun) {
          await runNow(editId, { focus: true, trigger: 'manual' })
        }
        onClose()
      } else {
        const id = await create(buildInput())
        if (andRun) {
          await runNow(id, { focus: true, trigger: 'manual' })
        }
        onCreated?.(id, andRun)
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  const title =
    state.mode === 'edit'
      ? t('automation.editor.editTitle')
      : t('automation.editor.createTitle')

  const isEdit = state.mode === 'edit'
  const saveDisabled = saving || projectMissing
  const modelInCatalog = modelGroups.some((g) =>
    g.models.some((m) => m.key === draft.modelKey),
  )
  const agentInList = acpAgents.some((a) => a.id === draft.agentId)
  // ACP primary ignores hip model fields (same as session create).
  const acpSelected = Boolean(draft.agentId.trim() && agentInList)

  const agentLabel = (() => {
    if (!draft.agentId.trim()) return t('automation.editor.agentDefault')
    const found = acpAgents.find((a) => a.id === draft.agentId)
    if (found) return found.name?.trim() || found.id
    return t('automation.editor.agentUnavailable', { id: draft.agentId })
  })()

  const modelChipLabel = (() => {
    if (acpSelected) return t('automation.editor.modelUnusedByAgent')
    if (draft.modelKey.trim()) {
      if (!modelInCatalog && draft.modelKey) {
        return t('automation.editor.modelUnavailable', { key: draft.modelKey })
      }
      return currentModelLabel(draft.modelKey) || draft.modelKey
    }
    return t('automation.editor.modelDefaultShort')
  })()

  const filteredModelGroups = useMemo(
    () => filterModelGroups(acpSelected ? [] : modelGroups, modelQuery),
    [acpSelected, modelGroups, modelQuery],
  )

  const pickModel = (key: string) => {
    patch({ modelKey: key })
    setModelQuery('')
  }

  const primarySaveLabel = isEdit
    ? t('automation.editor.saveEdit')
    : t('automation.editor.save')
  const saveAndRunLabel = isEdit
    ? t('automation.editor.saveEditAndRun')
    : t('automation.editor.saveAndRun')

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v && !saving) onClose()
      }}
      title={title}
      closeDisabled={saving}
      className="max-w-lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            className="min-w-0 flex-1 text-caption leading-snug text-ink-tertiary"
            data-testid="automation-editor-footer-hint"
          >
            {isEdit
              ? t('automation.localOnlyHint')
              : t('automation.editor.footerCreateHint')}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={onClose}
            >
              {t('automation.editor.cancel')}
            </Button>
            {/* Split primary: Create | ▾ → Create and run (Copilot-style) */}
            <div className="flex items-stretch">
              <Button
                type="button"
                size="sm"
                disabled={saveDisabled}
                data-testid="automation-editor-save"
                className="rounded-r-none pr-2.5"
                onClick={() => void handleSave(false)}
              >
                {primarySaveLabel}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    disabled={saveDisabled}
                    aria-label={t('automation.editor.saveMenuAria')}
                    data-testid="automation-editor-save-menu"
                    className="rounded-l-none border-l border-on-btn-primary/15 px-1.5"
                  >
                    <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[11rem]">
                  <DropdownMenuItem
                    data-testid="automation-editor-save-run"
                    disabled={saveDisabled}
                    onSelect={() => void handleSave(true)}
                  >
                    {saveAndRunLabel}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      }
    >
      <div
        className="flex flex-col gap-5 px-5 py-5"
        data-testid="automation-editor-modal"
      >
        {draft.skillIds.length > 0 ? (
          <p
            className="rounded-lg border border-border bg-surface-subtle/70 px-3.5 py-2.5 text-meta leading-relaxed text-ink-secondary"
            data-testid="automation-skill-seed-hint"
          >
            {t('automation.seedOnlyHint')}
          </p>
        ) : null}

        {draft.softWarnings.length > 0 ? (
          <ul
            className="flex flex-col gap-2"
            data-testid="automation-soft-warnings"
          >
            {draft.softWarnings.map((w) => (
              <li
                key={w}
                className="rounded-lg border border-warning/25 bg-warning/10 px-3.5 py-2.5 text-meta leading-relaxed text-ink-secondary"
                data-testid={`automation-soft-warning-${w}`}
              >
                {t(
                  `automation.softWarnings.${w}` as 'automation.softWarnings.no_work_items_context',
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="automation-editor-name">
            {t('automation.editor.name')}
          </FieldLabel>
          <Input
            id="automation-editor-name"
            ref={nameRef}
            value={draft.name}
            maxLength={AUTOMATION_NAME_MAX}
            onChange={(e) => {
              patch({ name: e.target.value })
              setNameError(false)
            }}
            placeholder={t('automation.editor.namePlaceholder')}
            data-testid="automation-editor-name"
            aria-invalid={nameError}
            aria-describedby={nameError ? 'automation-name-error' : undefined}
          />
          {nameError ? (
            <span id="automation-name-error" className="text-caption text-danger">
              {t('automation.editor.nameRequired')}
            </span>
          ) : null}
        </div>

        {/* Trigger — compact select like Copilot */}
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="automation-editor-trigger">
            {t('automation.editor.trigger')}
          </FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="automation-editor-trigger"
              className={cn(
                inputClassName,
                'h-9 w-auto min-w-[8.5rem] appearance-none bg-[length:12px] bg-[right_0.65rem_center] bg-no-repeat pr-8',
              )}
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
              }}
              value={draft.triggerKind}
              onChange={(e) =>
                patch({ triggerKind: e.target.value as AutomationTriggerKind })
              }
              data-testid="automation-editor-trigger"
              aria-label={t('automation.editor.trigger')}
            >
              <option value="manual">{t('automation.trigger.manual')}</option>
              <option value="daily">{t('automation.trigger.daily')}</option>
              <option value="weekly">{t('automation.trigger.weekly')}</option>
            </select>

            {draft.triggerKind === 'weekly' ? (
              <select
                className={cn(inputClassName, 'h-9 w-auto min-w-[7.5rem]')}
                value={draft.weekday}
                onChange={(e) => patch({ weekday: Number(e.target.value) })}
                data-testid="automation-editor-weekday"
                aria-label={t('automation.editor.weekday')}
              >
                {([0, 1, 2, 3, 4, 5, 6] as const).map((d) => (
                  <option key={d} value={d}>
                    {t(`automation.weekday.${d}` as 'automation.weekday.0')}
                  </option>
                ))}
              </select>
            ) : null}

            {draft.triggerKind !== 'manual' ? (
              <input
                type="time"
                className={cn(inputClassName, 'h-9 w-auto min-w-[7.5rem]')}
                value={`${pad2(draft.hour)}:${pad2(draft.minute)}`}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number)
                  if (Number.isFinite(h) && Number.isFinite(m)) {
                    patch({ hour: h, minute: m })
                  }
                }}
                data-testid="automation-editor-time"
                aria-label={t('automation.editor.time')}
              />
            ) : null}
          </div>
          {draft.triggerKind === 'manual' ? (
            <p className="text-caption leading-snug text-ink-tertiary">
              {t('automation.editor.triggerManualHint')}
            </p>
          ) : null}
        </div>

        {/* Prompt composer card — agent + model both use DropdownMenu (float outside) */}
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="automation-editor-prompt">
            {t('automation.editor.prompt')}
          </FieldLabel>
          <div
            className={cn(
              'flex flex-col rounded-xl border bg-surface transition-[border-color,box-shadow] duration-chrome',
              promptError
                ? 'border-danger/50'
                : 'border-border focus-within:border-border-strong',
            )}
          >
            <textarea
              id="automation-editor-prompt"
              ref={promptRef}
              value={draft.prompt}
              rows={5}
              onChange={(e) => {
                patch({ prompt: e.target.value })
                setPromptError(false)
              }}
              placeholder={t('automation.editor.promptPlaceholder')}
              data-testid="automation-editor-prompt"
              aria-invalid={promptError}
              aria-describedby={
                promptError ? 'automation-prompt-error' : undefined
              }
              className={cn(
                'min-h-[7rem] w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-body leading-relaxed text-ink',
                'placeholder:text-ink-tertiary focus:outline-none',
              )}
            />
            <div
              className="flex flex-wrap items-center gap-0.5 border-t border-border/70 px-2 py-1.5"
              data-testid="automation-editor-advanced"
            >
              {/* Agent chip */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={chipClassName}
                    data-testid="automation-editor-agent"
                    aria-label={t('automation.editor.agent')}
                  >
                    <span className="min-w-0 truncate">{agentLabel}</span>
                    <ChevronDown
                      className="h-3 w-3 shrink-0 opacity-70"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[12rem]">
                  <DropdownMenuItem
                    onSelect={() => patch({ agentId: '' })}
                  >
                    <Check
                      size={14}
                      className={cn(
                        'shrink-0',
                        !draft.agentId.trim() ? 'opacity-100' : 'opacity-0',
                      )}
                      aria-hidden
                    />
                    <span>{t('automation.editor.agentDefault')}</span>
                  </DropdownMenuItem>
                  {acpAgents.map((a) => (
                    <DropdownMenuItem
                      key={a.id}
                      onSelect={() => {
                        // ACP primary ignores hip model pin — clear so UI stays honest.
                        patch({ agentId: a.id, modelKey: '' })
                      }}
                    >
                      <Check
                        size={14}
                        className={cn(
                          'shrink-0',
                          draft.agentId === a.id ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{a.name?.trim() || a.id}</span>
                    </DropdownMenuItem>
                  ))}
                  {draft.agentId.trim() && !agentInList ? (
                    <DropdownMenuItem disabled>
                      <Check size={14} className="shrink-0 opacity-100" aria-hidden />
                      <span className="truncate">
                        {t('automation.editor.agentUnavailable', {
                          id: draft.agentId,
                        })}
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>

              {/*
                Model chip: same uncontrolled DropdownMenu as agent.
                Do NOT control `open` / auto-focus search — either causes open→instant-close
                inside Dialog (focus trap + same-click dismiss).
              */}
              <DropdownMenu
                onOpenChange={(next) => {
                  if (!next) setModelQuery('')
                }}
              >
                <DropdownMenuTrigger asChild disabled={acpSelected}>
                  <button
                    type="button"
                    className={cn(
                      chipClassName,
                      'group data-[state=open]:bg-state-hover data-[state=open]:text-ink',
                    )}
                    data-testid="automation-editor-model"
                    aria-label={t('automation.editor.model')}
                    disabled={acpSelected}
                  >
                    <span className="min-w-0 truncate">{modelChipLabel}</span>
                    <ChevronDown
                      className="h-3 w-3 shrink-0 opacity-70 transition-transform duration-chrome group-data-[state=open]:rotate-180"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={4}
                  collisionPadding={12}
                  className="w-72 p-0"
                  data-testid="automation-editor-model-popover"
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  {/*
                    Search is a plain input (not a menu item). Stop keyboard events so
                    Radix typeahead / menu nav don't steal keystrokes or dismiss.
                  */}
                  <div
                    className="border-b border-border px-2 py-2"
                    onKeyDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2">
                      <Search
                        size={13}
                        className="shrink-0 text-ink-tertiary"
                        aria-hidden
                      />
                      <input
                        ref={modelSearchRef}
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        placeholder={t('chat.searchModels')}
                        className="w-full bg-transparent text-meta text-ink placeholder:text-ink-tertiary focus:outline-none"
                        data-testid="automation-editor-model-search"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                  <div
                    className="max-h-56 overflow-y-auto overscroll-contain p-1"
                    data-testid="automation-editor-model-list"
                  >
                    <DropdownMenuItem
                      data-testid="automation-editor-model-default"
                      onSelect={() => pickModel('')}
                    >
                      <Check
                        size={14}
                        className={cn(
                          'shrink-0',
                          !draft.modelKey.trim() ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden
                      />
                      <span className="truncate text-ink-secondary">
                        {t('automation.editor.modelDefault')}
                      </span>
                    </DropdownMenuItem>

                    {filteredModelGroups.length === 0 ? (
                      <div
                        className="px-2.5 py-3 text-center text-meta text-ink-tertiary"
                        data-testid="automation-editor-model-empty"
                      >
                        {modelGroups.length === 0
                          ? t('chat.noModelsAvailable')
                          : t('chat.noModelsMatch')}
                      </div>
                    ) : (
                      filteredModelGroups.map((g) => (
                        <div
                          key={g.providerID}
                          data-testid="automation-editor-model-group"
                        >
                          <DropdownMenuLabel>{g.providerName}</DropdownMenuLabel>
                          {g.models.map((m) => {
                            const selected = draft.modelKey === m.key
                            return (
                              <DropdownMenuItem
                                key={m.key}
                                data-testid="automation-editor-model-item"
                                onSelect={() => pickModel(m.key)}
                              >
                                <Check
                                  size={14}
                                  className={cn(
                                    'shrink-0',
                                    selected ? 'opacity-100' : 'opacity-0',
                                  )}
                                  aria-hidden
                                />
                                <span className="truncate">{m.modelID}</span>
                              </DropdownMenuItem>
                            )
                          })}
                        </div>
                      ))
                    )}

                    {!modelInCatalog && draft.modelKey.trim() ? (
                      <DropdownMenuItem
                        data-testid="automation-editor-model-orphan"
                        onSelect={() => pickModel(draft.modelKey)}
                      >
                        <Check size={14} className="shrink-0 opacity-100" aria-hidden />
                        <span className="truncate text-ink-secondary">
                          {t('automation.editor.modelUnavailable', {
                            key: draft.modelKey,
                          })}
                        </span>
                      </DropdownMenuItem>
                    ) : null}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {promptError ? (
            <span
              id="automation-prompt-error"
              className="text-caption text-danger"
            >
              {t('automation.editor.promptRequired')}
            </span>
          ) : acpSelected ? (
            <span className="text-caption text-ink-tertiary">
              {t('automation.editor.modelAgentHint')}
            </span>
          ) : null}
        </div>

        {/* Project row — under prompt, Copilot-style */}
        <div className="flex flex-col gap-1.5">
          <div
            className={cn(
              'flex flex-wrap items-center gap-2 rounded-lg px-0.5',
              projectError && 'rounded-md ring-1 ring-danger/40',
            )}
          >
            {draft.projectPath ? (
              <div
                className={cn(
                  'inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border border-border bg-surface-subtle/60 px-2 text-meta text-ink',
                )}
              >
                <Folder
                  className="h-3.5 w-3.5 shrink-0 text-ink-tertiary"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span
                  className="min-w-0 max-w-[14rem] truncate font-mono text-caption"
                  title={draft.projectPath}
                >
                  {draft.projectPath}
                </span>
                <button
                  type="button"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
                  aria-label={t('automation.editor.clearProject')}
                  data-testid="automation-editor-clear-project"
                  onClick={clearProject}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </div>
            ) : null}
            <button
              ref={projectPickRef}
              type="button"
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-meta font-medium text-ink-secondary transition-colors duration-chrome',
                'hover:bg-state-hover hover:text-ink',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
              )}
              data-testid="automation-editor-pick-project"
              onClick={() => void pickProject()}
              aria-invalid={projectError || undefined}
              aria-describedby={
                projectError ? 'automation-project-error' : undefined
              }
            >
              <Folder
                className="h-3.5 w-3.5 shrink-0 text-ink-tertiary"
                strokeWidth={1.75}
                aria-hidden
              />
              <span>
                {draft.projectPath
                  ? t('automation.editor.changeProject')
                  : t('automation.editor.selectProject')}
              </span>
              {!draft.projectPath ? (
                <ChevronDown
                  className="h-3 w-3 shrink-0 opacity-60"
                  strokeWidth={1.75}
                  aria-hidden
                />
              ) : null}
            </button>
            {!draft.projectPath ? (
              <span className="min-w-0 flex-1 text-caption leading-snug text-ink-tertiary">
                {draft.requiresProject
                  ? t('automation.editor.projectRequiredHint')
                  : t('automation.editor.projectOptional')}
              </span>
            ) : null}
          </div>
          {projectError ? (
            <span
              id="automation-project-error"
              className="text-caption text-danger"
              data-testid="automation-project-required"
            >
              {t('automation.projectRequired')}
            </span>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
