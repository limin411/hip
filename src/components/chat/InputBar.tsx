import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Composer } from './Composer'
import { SlashCommandPalette, extractSlashQuery, type ComposerSurface } from './SlashCommandPalette'
import { SkillArgInput, extractSkillInvocation } from './SkillArgInput'
import { useSlashCommandHandler } from './useSlashCommandHandler'
import { readSkillFile } from '@/ipc/skills'
import { ModelPicker } from './ModelPicker'
import { PermissionModePicker } from './PermissionModePicker'
import { PlanModeChip } from './PlanModeChip'
import { ProjectGuidanceChip } from './ProjectGuidanceChip'
import { AttachmentButton } from './AttachmentButton'
import { sessionService, useActiveSession, useActiveSessionId, useActiveSessionStatus, useConnectionStatus } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import { hasPlanApproval } from './planApproval'
import { isAttachmentSupported } from '@/lib/attachmentEligibility'
import { activeModelKey } from '@/lib/modelKey'
import { useProvidersStore } from '@/store/providersStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useDraftStore } from '@/store/draftStore'
import { useSkillsStore } from '@/store/skillsStore'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { registerComposerHandlers } from '@/components/command-palette/composerBridge'
import { formatQuoteForComposer } from '@/components/context-menu/providers/message'
import type { LocalAttachment } from './attachmentTypes'

export function InputBar() {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])
  const [quoteText, setQuoteText] = useState<string | null>(null)
  const status = useActiveSessionStatus()
  const connection = useConnectionStatus()
  const activeId = useActiveSessionId()
  const active = useActiveSession()
  const isCode = active ? surfaceOf(active.config) === 'code' : false
  const surface: ComposerSurface = isCode ? 'code' : 'chat'
  const planApprovalPending = hasPlanApproval(active)
  // Any non-connected state (connecting/disconnected/error) means cancel() can't reach the sidecar
  // (it would only queue), so we disable Stop and show "reconnecting…". The ws-client retries
  // continuously, and the real recourse for a hard disconnect is the title-bar reconnect button.
  const reconnecting = status === 'running' && connection !== 'connected'

  const allSkills = useSkillsStore((s) => s.skills)
  const skillsEnabled = useSkillsStore((s) => s.enabled) ?? {}
  const skills = useMemo(
    () =>
      allSkills.filter(
        (sk) => sk.userInvocable !== false && skillsEnabled[sk.id] !== false,
      ),
    [allSkills, skillsEnabled],
  )
  const query = useMemo(() => extractSlashQuery(value), [value])
  const invocation = useMemo(() => extractSkillInvocation(value), [value])
  const selectedSkill = useMemo(() => {
    if (!invocation) return undefined
    return skills.find((s) => s.name === invocation.skillName)
  }, [invocation, skills])

  const [skillBody, setSkillBody] = useState<string | undefined>(undefined)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Drop pending quote when switching sessions so it doesn't leak across conversations.
  useEffect(() => {
    setQuoteText(null)
  }, [activeId])

  // Composer bridge: insert preserves draft (context menus); replace for skill handoff; setQuote for message quote chip.
  useEffect(() => {
    registerComposerHandlers({
      insert: (text) => {
        setValue((prev) => {
          const el = inputRef.current
          if (el) {
            const start = Math.min(el.selectionStart ?? prev.length, prev.length)
            const end = Math.min(Math.max(el.selectionEnd ?? start, start), prev.length)
            const next = prev.slice(0, start) + text + prev.slice(end)
            const caret = start + text.length
            setTimeout(() => {
              const ta = inputRef.current
              if (!ta) return
              ta.focus()
              try {
                ta.setSelectionRange(caret, caret)
              } catch {
                // ignore selection errors on unmounted / non-text controls
              }
            }, 0)
            return next
          }
          return prev + text
        })
      },
      replace: (text) => {
        setValue(text)
        setTimeout(() => inputRef.current?.focus(), 0)
      },
      setQuote: (text) => {
        setQuoteText(text?.trim() ? text : null)
        setTimeout(() => inputRef.current?.focus(), 0)
      },
    })
    return () => registerComposerHandlers(null)
  }, [])

  useEffect(() => {
    if (!selectedSkill) {
      setSkillBody(undefined)
      return
    }
    let cancelled = false
    console.log('[InputBar] fetching skill body', selectedSkill.id, selectedSkill.name)
    readSkillFile(selectedSkill.id, 'SKILL.md').then((body) => {
      console.log('[InputBar] readSkillFile success', selectedSkill.id, body.length, body.slice(0, 50))
      if (!cancelled) setSkillBody(body)
    }).catch((err) => {
      console.error('[InputBar] readSkillFile error', selectedSkill.id, err)
      if (!cancelled) setSkillBody(undefined)
    })
    return () => { cancelled = true }
  }, [selectedSkill])

  const { handleCommandSelect, handleDismiss } = useSlashCommandHandler(surface, {
    sessionId: activeId,
    skills,
    skillsEnabled,
    value,
    setText: setValue,
    inputRef,
  })

  // D18: when global ⌘K opens, dismiss active slash query so two palettes never stack.
  const globalPaletteOpen = useCommandPaletteStore((s) => s.open)
  useEffect(() => {
    if (globalPaletteOpen && extractSlashQuery(value) !== null) {
      handleDismiss()
    }
  }, [globalPaletteOpen, value, handleDismiss])

  const draft = useDraftStore((s) => s.draft)
  const catalog = useProvidersStore((s) => s.catalog)
  const config = useProvidersStore((s) => s.config)
  const agents = useHipConfigStore(useShallow((s) => s.config.agents ?? []))
  const currentKey = activeId && active
    ? (active.config.model ? `${active.config.llmProvider}/${active.config.model}` : activeModelKey(config))
    : (draft?.modelKey ?? activeModelKey(config))
  const attachmentsSupported = isAttachmentSupported(currentKey, agents, catalog)

  useEffect(() => {
    if (!attachmentsSupported && attachments.length > 0) {
      setAttachments([])
    }
  }, [attachmentsSupported, attachments.length])

  const submit = () => {
    const text = value.trim()
    if (!text && attachments.length === 0) return
    const content = quoteText ? `${formatQuoteForComposer(quoteText)}${text}` : text
    sessionService.sendMessage(content, attachments)
    setValue('')
    setAttachments([])
    setQuoteText(null)
  }
  return (
    <div className="shrink-0 px-5 pb-5" data-testid="input-bar">
      <div className="mx-auto max-w-3xl">
        {planApprovalPending ? (
          <div className="rounded-xl border border-border bg-surface px-4 py-3 text-center text-meta text-ink-secondary">
            {t('chat.planApproval.reviewAbove')}
          </div>
        ) : (
            <div className="relative">
              {query !== null && (
                <SlashCommandPalette
                  value={value}
                  surface={surface}
                  sessionId={activeId}
                  skills={skills}
                  skillsEnabled={skillsEnabled}
                  onSelect={handleCommandSelect}
                  onDismiss={handleDismiss}
                />
              )}
              <Composer
                value={value}
                onChange={setValue}
                onSubmit={submit}
                inputRef={inputRef}
                running={status === 'running'}
                onStop={() => sessionService.cancel()}
                reconnecting={reconnecting}
                leftSlot={
                  isCode ? (
                    <><ModelPicker /><PermissionModePicker /><PlanModeChip /><ProjectGuidanceChip /><AttachmentButton onAttach={setAttachments} /></>
                  ) : (
                    <><ModelPicker /><AttachmentButton onAttach={(add) => setAttachments((prev) => [...prev, ...add])} /></>
                  )
                }
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              quoteText={quoteText}
              onQuoteClear={() => setQuoteText(null)}
            />
            {selectedSkill && (
              <SkillArgInput
                value={value}
                skillBody={skillBody}
                skillArgs={selectedSkill.arguments}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
