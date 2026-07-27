import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, X } from 'lucide-react'
import type { Automation, AutomationTrigger, AutomationTriggerKind } from '@/domain/automations'
import { AUTOMATION_NAME_MAX } from '@/domain/automations'
import { useAutomationStore } from '@/store/automationStore'
import { Button } from '@/components/ui/Button'
import { Input, inputClassName } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Modal } from '@/components/ui/Modal'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { pickDirectory } from '@/ipc/dialog'
import { cn } from '@/lib/utils'
import type { AutomationTemplate } from './templates'
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
  }
}

function draftFromAutomation(a: Automation): Draft {
  const tr = a.trigger
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
    requiresProject: false,
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
  const nameRef = useRef<HTMLInputElement>(null)

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
      if (target) setDraft(draftFromAutomation(target))
    }
    requestAnimationFrame(() => nameRef.current?.focus())
  }, [sessionKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.mode === 'edit' && editId && !item) onClose()
  }, [state.mode, editId, item, onClose])

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  const pickProject = async () => {
    const dir = await pickDirectory()
    if (dir) {
      patch({ projectPath: dir })
      setProjectError(false)
    }
  }

  const validate = (): boolean => {
    let ok = true
    if (!draft.name.trim()) {
      setNameError(true)
      ok = false
    }
    if (!draft.prompt.trim()) {
      setPromptError(true)
      ok = false
    }
    if (draft.requiresProject && !draft.projectPath.trim()) {
      setProjectError(true)
      ok = false
    }
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
    if (!validate()) {
      nameRef.current?.focus()
      return
    }
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={onClose}
          >
            {t('automation.editor.cancel')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving}
            data-testid="automation-editor-save"
            onClick={() => void handleSave(false)}
          >
            {state.mode === 'edit'
              ? t('automation.editor.saveEdit')
              : t('automation.editor.save')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            data-testid="automation-editor-save-run"
            onClick={() => void handleSave(true)}
          >
            {state.mode === 'edit'
              ? t('automation.editor.saveEditAndRun')
              : t('automation.editor.saveAndRun')}
          </Button>
        </div>
      }
    >
      <div
        className="flex flex-col gap-3 p-1"
        data-testid="automation-editor-modal"
      >
        {draft.skillIds.length > 0 ? (
          <p
            className="rounded-md border border-border bg-surface-muted/50 px-2.5 py-1.5 text-meta text-ink-secondary"
            data-testid="automation-skill-seed-hint"
          >
            {t('automation.seedOnlyHint')}
          </p>
        ) : null}

        <p className="text-meta text-ink-tertiary" data-testid="automation-local-hint">
          {t('automation.localOnlyHint')}
        </p>

        <label className="flex flex-col gap-1">
          <span className="text-meta font-medium text-ink-secondary">
            {t('automation.editor.name')}
          </span>
          <Input
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
          />
          {nameError ? (
            <span className="text-caption text-danger">
              {t('automation.editor.nameRequired')}
            </span>
          ) : null}
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-meta font-medium text-ink-secondary">
            {t('automation.editor.trigger')}
          </span>
          <SegmentedControl
            data-testid="automation-editor-trigger"
            aria-label={t('automation.editor.trigger')}
            value={draft.triggerKind}
            onChange={(v) => patch({ triggerKind: v })}
            options={[
              { value: 'manual', label: t('automation.trigger.manual') },
              { value: 'daily', label: t('automation.trigger.daily') },
              { value: 'weekly', label: t('automation.trigger.weekly') },
            ]}
          />
          {draft.triggerKind !== 'manual' ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {draft.triggerKind === 'weekly' ? (
                <select
                  className={cn(inputClassName, 'h-8 w-auto')}
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
              <input
                type="time"
                className={cn(inputClassName, 'h-8 w-auto')}
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
            </div>
          ) : null}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-meta font-medium text-ink-secondary">
            {t('automation.editor.prompt')}
          </span>
          <Textarea
            value={draft.prompt}
            rows={6}
            onChange={(e) => {
              patch({ prompt: e.target.value })
              setPromptError(false)
            }}
            placeholder={t('automation.editor.promptPlaceholder')}
            data-testid="automation-editor-prompt"
            aria-invalid={promptError}
          />
          {promptError ? (
            <span className="text-caption text-danger">
              {t('automation.editor.promptRequired')}
            </span>
          ) : null}
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-meta font-medium text-ink-secondary">
            {t('automation.editor.project')}
            {draft.requiresProject ? (
              <span className="text-danger"> *</span>
            ) : null}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="automation-editor-pick-project"
              onClick={() => void pickProject()}
            >
              <Folder className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              {t('automation.editor.pickProject')}
            </Button>
            {draft.projectPath ? (
              <div
                className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-border bg-surface-muted/40 px-2 py-1 text-meta text-ink-secondary"
                title={draft.projectPath}
              >
                <span className="truncate">{draft.projectPath}</span>
                <button
                  type="button"
                  className="shrink-0 text-ink-tertiary hover:text-ink"
                  aria-label={t('automation.editor.clearProject')}
                  data-testid="automation-editor-clear-project"
                  onClick={() => patch({ projectPath: '' })}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <span className="text-meta text-ink-tertiary">
                {t('automation.editor.projectOptional')}
              </span>
            )}
          </div>
          {projectError ? (
            <span className="text-caption text-danger" data-testid="automation-project-required">
              {t('automation.projectRequired')}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-meta font-medium text-ink-secondary">
              {t('automation.editor.model')}
            </span>
            <Input
              value={draft.modelKey}
              onChange={(e) => patch({ modelKey: e.target.value })}
              placeholder={t('automation.editor.modelPlaceholder')}
              data-testid="automation-editor-model"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-meta font-medium text-ink-secondary">
              {t('automation.editor.agent')}
            </span>
            <Input
              value={draft.agentId}
              onChange={(e) => patch({ agentId: e.target.value })}
              placeholder={t('automation.editor.agentPlaceholder')}
              data-testid="automation-editor-agent"
            />
          </label>
        </div>
      </div>
    </Modal>
  )
}
