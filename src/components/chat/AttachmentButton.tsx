import { useTranslation } from 'react-i18next'
import { Paperclip } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Button } from '@/components/ui/Button'
import { pickAttachmentFiles } from '@/ipc/dialog'
import { getAttachmentMimeType } from '@/lib/attachmentMimeType'
import { isAttachmentSupported } from '@/lib/attachmentEligibility'
import { useProvidersStore } from '@/store/providersStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useActiveSession, useActiveSessionId } from '@/domain'
import { useDraftStore } from '@/store/draftStore'
import { activeModelKey } from '@/lib/modelKey'
import type { LocalAttachment } from './attachmentTypes'

export interface AttachmentButtonProps {
  onAttach: (attachments: LocalAttachment[]) => void
}

export function AttachmentButton({ onAttach }: AttachmentButtonProps) {
  const { t } = useTranslation()
  const catalog = useProvidersStore((s) => s.catalog)
  const config = useProvidersStore((s) => s.config)
  const agents = useHipConfigStore((s) => s.config.agents ?? [])
  const draft = useDraftStore((s) => s.draft)
  const activeId = useActiveSessionId()
  const session = useActiveSession()

  const currentKey = activeId && session
    ? (session.config.model ? `${session.config.llmProvider}/${session.config.model}` : activeModelKey(config))
    : (draft?.modelKey ?? activeModelKey(config))

  if (!isAttachmentSupported(currentKey, agents, catalog)) return null

  const handleClick = async () => {
    const paths = await pickAttachmentFiles()
    if (!paths) return
    const attachments: LocalAttachment[] = paths.map((path) => {
      const name = path.replace(/\\/g, '/').split('/').pop() ?? path
      return {
        id: nanoid(),
        name,
        mimeType: getAttachmentMimeType(name),
        path,
      }
    })
    onAttach(attachments)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleClick}
      title={t('chat.attach')}
      data-testid="attachment-button"
    >
      <Paperclip size={16} />
    </Button>
  )
}
