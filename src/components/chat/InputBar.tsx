import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Composer } from './Composer'
import { SlashCommandPalette, extractSlashQuery, type ComposerSurface } from './SlashCommandPalette'
import { useSlashCommandHandler } from './useSlashCommandHandler'
import { ModelPicker } from './ModelPicker'
import { PermissionModePicker } from './PermissionModePicker'
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
import type { LocalAttachment } from './attachmentTypes'

export function InputBar() {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])
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
  const skills = useMemo(() => allSkills.filter((sk) => sk.userInvocable !== false), [allSkills])
  const query = useMemo(() => extractSlashQuery(value), [value])
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { handleCommandSelect, handleDismiss } = useSlashCommandHandler(surface, {
    sessionId: activeId,
    skills,
    value,
    setText: setValue,
    inputRef,
  })

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
    sessionService.sendMessage(text, attachments)
    setValue('')
    setAttachments([])
  }
  return (
    <div className="shrink-0 px-5 pb-5">
      <div className="mx-auto max-w-3xl">
        {planApprovalPending ? (
          <div className="rounded-xl border border-border bg-surface px-4 py-3 text-center text-meta text-ink-secondary">
            {t('chat.planApproval.reviewAbove')}
          </div>
        ) : (
          <div className="relative">
            {query !== null && (
              <SlashCommandPalette value={value} surface={surface} sessionId={activeId} skills={skills} onSelect={handleCommandSelect} onDismiss={handleDismiss} />
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
                  <><ModelPicker /><PermissionModePicker /><AttachmentButton onAttach={setAttachments} /></>
                ) : (
                  <><ModelPicker /><AttachmentButton onAttach={(add) => setAttachments((prev) => [...prev, ...add])} /></>
                )
              }
              attachments={attachments}
              onAttachmentsChange={setAttachments}
            />
          </div>
        )}
      </div>
    </div>
  )
}
