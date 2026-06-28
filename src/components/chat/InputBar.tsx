import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Composer } from './Composer'
import { ModelPicker } from './ModelPicker'
import { PermissionModePicker } from './PermissionModePicker'
import { AttachmentButton } from './AttachmentButton'
import { sessionService, useActiveSession, useActiveSessionStatus, useConnectionStatus } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import { hasPlanApproval } from './planApproval'
import type { LocalAttachment } from './attachmentTypes'

export function InputBar() {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])
  const status = useActiveSessionStatus()
  const connection = useConnectionStatus()
  const active = useActiveSession()
  const isCode = active ? surfaceOf(active.config) === 'code' : false
  const planApprovalPending = hasPlanApproval(active)
  // Any non-connected state (connecting/disconnected/error) means cancel() can't reach the sidecar
  // (it would only queue), so we disable Stop and show "reconnecting…". The ws-client retries
  // continuously, and the real recourse for a hard disconnect is the title-bar reconnect button.
  const reconnecting = status === 'running' && connection !== 'connected'
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
          <Composer
            value={value}
            onChange={setValue}
            onSubmit={submit}
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
        )}
      </div>
    </div>
  )
}
