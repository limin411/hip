import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useDraftStore } from '@/store/draftStore'
import { useUiStore } from '@/store/uiStore'
import { useProvidersStore } from '@/store/providersStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useSkillsStore } from '@/store/skillsStore'
import { sessionService, useActiveSessionId } from '@/domain'
import { Composer } from './Composer'
import { SlashCommandPalette, extractSlashQuery } from './SlashCommandPalette'
import { useSlashCommandHandler } from './useSlashCommandHandler'
import { FolderPill } from './FolderPill'
import { ModelPicker } from './ModelPicker'
import { PermissionModePicker } from './PermissionModePicker'
import { AttachmentButton } from './AttachmentButton'
import { isAttachmentSupported } from '@/lib/attachmentEligibility'
import { activeModelKey } from '@/lib/modelKey'
import type { LocalAttachment } from './attachmentTypes'
import { HipLogo } from '@/components/login/HipLogo'

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
  useEffect(() => {
    useDraftStore.getState().ensureDraft()
    if (surface === 'chat' && useDraftStore.getState().draft?.mode === 'project') {
      useDraftStore.getState().clearProject()
    }
  }, [surface])

  const catalog = useProvidersStore((s) => s.catalog)
  const providersConfig = useProvidersStore((s) => s.config)
  const agents = useHipConfigStore(useShallow((s) => s.config.agents ?? []))
  const currentKey = draft?.modelKey ?? activeModelKey(providersConfig)
  const attachmentsSupported = isAttachmentSupported(currentKey, agents, catalog)

  useEffect(() => {
    if (!attachmentsSupported && attachments.length > 0) {
      setAttachments([])
    }
  }, [attachmentsSupported, attachments.length])

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

  const setText = (value: string) => useDraftStore.getState().setText(value)

  const allSkills = useSkillsStore((s) => s.skills)
  const skills = useMemo(() => allSkills.filter((sk) => sk.userInvocable !== false), [allSkills])
  const query = useMemo(() => extractSlashQuery(text), [text])
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { handleCommandSelect, handleDismiss } = useSlashCommandHandler(surface, {
    sessionId: activeId,
    skills,
    setText,
    inputRef,
  })

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-5" data-testid="new-conversation">
      <div className="w-full max-w-3xl">
        <div className="mb-6 flex justify-center">
          <HipLogo size={160} />
        </div>
        <div key={surface} className="animate-greeting-enter">
          <h1 className="mb-1 text-center text-display font-semibold text-ink">
            {greeting}
          </h1>
          <p className="mb-4 text-center text-body text-ink-secondary">
            {t('chat.greetingSub.default', '')}
          </p>
        </div>
        <div className="relative">
          {query !== null && (
            <SlashCommandPalette value={text} surface={surface} sessionId={activeId} skills={skills} onSelect={handleCommandSelect} onDismiss={handleDismiss} />
          )}
          <Composer
            value={text}
            onChange={(v) => setText(v)}
            onSubmit={submit}
            autoFocus
            submitDisabled={!canSend}
            inputRef={inputRef}
            leftSlot={
              surface === 'code' ? (
                <><ModelPicker /><PermissionModePicker /><AttachmentButton onAttach={setAttachments} /></>
              ) : (
                <><ModelPicker /><AttachmentButton onAttach={(add) => setAttachments((prev) => [...prev, ...add])} /></>
              )
            }
            attachments={attachments}
            onAttachmentsChange={setAttachments}
          />
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
