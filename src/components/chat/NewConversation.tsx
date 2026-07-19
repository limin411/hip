import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useDraftStore } from '@/store/draftStore'
import { useUiStore } from '@/store/uiStore'
import { useProvidersStore } from '@/store/providersStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useSkillsStore } from '@/store/skillsStore'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { sessionService, useActiveSessionId } from '@/domain'
import { Composer } from './Composer'
import { SlashCommandPalette, extractSlashQuery } from './SlashCommandPalette'
import { SkillArgInput, extractSkillInvocation } from './SkillArgInput'
import { useSlashCommandHandler } from './useSlashCommandHandler'
import { readSkillFile } from '@/ipc/skills'
import { FolderPill } from './FolderPill'
import { ModelPicker } from './ModelPicker'
import { EffortLevelPicker } from './EffortLevelPicker'
import { PermissionModePicker } from './PermissionModePicker'
import { PlanModeChip } from './PlanModeChip'
import { AttachmentButton } from './AttachmentButton'
import { SessionAgentPicker } from './SessionAgentPicker'
import { AcpCapabilityCliffBanner } from './AcpCapabilityCliffBanner'
import { isAttachmentSupported } from '@/lib/attachmentEligibility'
import { activeModelKey } from '@/lib/modelKey'
import { isExternalPrimary } from '@/lib/sessionAgent'
import type { LocalAttachment } from './attachmentTypes'
import { MascotActor } from '@/components/login/MascotActor'

export function NewConversation() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const surface = activeView === 'code' ? 'code' : 'chat'
  const draft = useDraftStore((s) => s.draft)
  const text = draft?.text ?? ''
  const activeId = useActiveSessionId()
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])

  // Ensure a draft exists; keep Chat drafts in chat mode so a leftover project draft (e.g. a
  // folder picked in Code, then switched to Chat without sending) can't commit as a Code session.
  // (configFromDraft derives surface from draft.mode, so mode must match the surface here.)
  // Also drop a stale slash query on the first mount so the slash palette doesn't pop up on a
  // fresh screen; don't clear on surface changes or the user loses text when switching views.
  const hasClearedStaleSlash = useRef(false)
  useEffect(() => {
    useDraftStore.getState().ensureDraft(surface)
    if (surface === 'chat' && useDraftStore.getState().draft?.mode === 'project') {
      useDraftStore.getState().clearProject()
    }
    if (!hasClearedStaleSlash.current) {
      hasClearedStaleSlash.current = true
      const draftText = useDraftStore.getState().draft?.text ?? ''
      if (extractSlashQuery(draftText) !== null) {
        useDraftStore.getState().setText('')
      }
    }
  }, [surface])

  const catalog = useProvidersStore((s) => s.catalog)
  const providersConfig = useProvidersStore((s) => s.config)
  const agents = useHipConfigStore(useShallow((s) => s.config.agents ?? []))
  const currentKey = draft?.modelKey ?? activeModelKey(providersConfig)
  const attachmentsSupported = isAttachmentSupported(currentKey, agents, catalog)
  // External ACP primary: hide hip-model-only controls (model/effort/forcePlan); keep permissionMode.
  const externalPrimary = isExternalPrimary(draft?.agentId)

  useEffect(() => {
    if (!attachmentsSupported) {
      setAttachments((prev) => (prev.length > 0 ? [] : prev))
    }
  }, [attachmentsSupported])

  // Code requires a project folder before the first send; Chat is always sandboxed.
  const hasFolder = draft?.mode === 'project' && !!draft.cwd
  const canSend = surface === 'chat'
    ? !!text.trim() || attachments.length > 0
    : (!!text.trim() || attachments.length > 0) && hasFolder

  const submit = () => {
    if (!canSend) return
    sessionService.sendMessage(text, attachments) // commit: creates the session (surface-aware) + resets the draft
    setAttachments([])
  }

  const greeting = surface === 'code' ? t('chat.codeGreeting') : t('chat.newConversationGreeting')
  // J1 empty-state CTA identity for e2e (@smooth-p4)

  const setText = useCallback((value: string) => useDraftStore.getState().setText(value), [])

  const allSkills = useSkillsStore((s) => s.skills)
  const skills = useMemo(() => allSkills.filter((sk) => sk.userInvocable !== false), [allSkills])
  const query = useMemo(() => extractSlashQuery(text), [text])
  const invocation = useMemo(() => extractSkillInvocation(text), [text])
  const selectedSkill = useMemo(() => {
    if (!invocation) return undefined
    return skills.find((s) => s.name === invocation.skillName)
  }, [invocation, skills])

  const [skillBody, setSkillBody] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!selectedSkill) {
      setSkillBody(undefined)
      return
    }
    let cancelled = false
    readSkillFile(selectedSkill.id, 'SKILL.md').then((body) => {
      if (!cancelled) setSkillBody(body)
    }).catch(() => {
      if (!cancelled) setSkillBody(undefined)
    })
    return () => { cancelled = true }
  }, [selectedSkill])

  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { handleCommandSelect, handleDismiss } = useSlashCommandHandler(surface, {
    sessionId: activeId,
    skills,
    value: text,
    setText,
    inputRef,
  })

  // D18: when global ⌘K opens, dismiss active slash query so two palettes never stack.
  const globalPaletteOpen = useCommandPaletteStore((s) => s.open)
  useEffect(() => {
    if (globalPaletteOpen && extractSlashQuery(text) !== null) {
      handleDismiss()
    }
  }, [globalPaletteOpen, text, handleDismiss])

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-5 pb-28" data-testid="new-conversation">
      <div className="w-full max-w-3xl">
        <div className="mb-1 flex justify-center">
          <MascotActor
            key={surface}
            size={420}
            initialAction={surface === 'code' ? 'code' : 'wave'}
            transition="slide"
          />
        </div>
        <div key={surface} className="animate-greeting-enter">
          <h1 className="mb-1 text-center text-display font-semibold text-ink">
            {greeting}
          </h1>
          <p className="mb-4 text-center text-body text-ink-secondary">
            {t('chat.greetingSub.default', '')}
          </p>
        </div>
        <AcpCapabilityCliffBanner />
        <div className="relative">
          {query !== null && (
            <SlashCommandPalette value={text} surface={surface} sessionId={activeId} skills={skills} onSelect={handleCommandSelect} onDismiss={handleDismiss} />
          )}
          <Composer
            variant="card"
            value={text}
            onChange={(v) => setText(v)}
            onSubmit={submit}
            autoFocus
            submitDisabled={!canSend}
            inputRef={inputRef}
            leftSlot={
              surface === 'code' ? (
                <>
                  <SessionAgentPicker />
                  {!externalPrimary && <ModelPicker />}
                  {!externalPrimary && <EffortLevelPicker />}
                  <PermissionModePicker />
                  {!externalPrimary && <PlanModeChip />}
                  <AttachmentButton onAttach={setAttachments} />
                </>
              ) : (
                <>
                  <SessionAgentPicker />
                  {!externalPrimary && <ModelPicker />}
                  {!externalPrimary && <EffortLevelPicker />}
                  <AttachmentButton onAttach={(add) => setAttachments((prev) => [...prev, ...add])} />
                </>
              )
            }
            attachments={attachments}
            onAttachmentsChange={setAttachments}
          />
          {selectedSkill && (
            <SkillArgInput
              value={text}
              skillBody={skillBody}
              skillArgs={selectedSkill.arguments}
            />
          )}
        </div>
        {surface === 'code' && (
          <div className="mt-2 flex flex-col items-center gap-1">
            <FolderPill />
            {!hasFolder && <span className="text-meta text-ink-tertiary">{t('chat.codeNeedFolder')}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
