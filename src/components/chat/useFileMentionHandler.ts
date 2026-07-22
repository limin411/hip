import { useCallback, useMemo } from 'react'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { WorkspaceFileSearchHit } from '@/ipc/workspaceFileSearch'
import { getAttachmentMimeType } from '@/lib/attachmentMimeType'
import {
  isFeAllowedAttachment,
  isMultimodalAttachmentMime,
} from '@/lib/attachmentAllowlist'
import {
  applyFileMention,
  applyFileMentionDirPrefix,
  extractAtQuery,
  stripAtToken,
} from './fileMentionQuery'
import type { LocalAttachment } from './attachmentTypes'

export function useFileMentionHandler(opts: {
  value: string
  setValue: (v: string) => void
  searchRoot: string | null
  attachments: LocalAttachment[]
  setAttachments: (
    a: LocalAttachment[] | ((p: LocalAttachment[]) => LocalAttachment[]),
  ) => void
  attachmentsSupported: boolean
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}): {
  atQuery: string | null
  handleSelect: (hit: WorkspaceFileSearchHit) => void
  handleDismiss: () => void
} {
  const { t } = useTranslation()
  const {
    value,
    setValue,
    searchRoot,
    attachments,
    setAttachments,
    attachmentsSupported,
    inputRef,
  } = opts

  const rawAt = useMemo(() => extractAtQuery(value), [value])
  const atQuery = searchRoot && rawAt !== null ? rawAt : null

  const handleDismiss = useCallback(() => {
    setValue(stripAtToken(value))
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [value, setValue, inputRef])

  const handleSelect = useCallback(
    (hit: WorkspaceFileSearchHit) => {
      if (hit.isDir) {
        setValue(applyFileMentionDirPrefix(value, hit.relativePath))
        setTimeout(() => inputRef.current?.focus(), 0)
        return
      }

      setValue(applyFileMention(value, hit.relativePath))

      const mime = getAttachmentMimeType(hit.name)

      if (isMultimodalAttachmentMime(mime) && !attachmentsSupported) {
        toast.message(t('chat.fileMention.multimodalUnsupported'))
        setTimeout(() => inputRef.current?.focus(), 0)
        return
      }

      if (!isFeAllowedAttachment(hit.name, mime)) {
        toast.message(t('chat.fileMention.typeNotAttachable', { name: hit.name }))
        setTimeout(() => inputRef.current?.focus(), 0)
        return
      }

      if (attachments.some((a) => a.path === hit.absolutePath)) {
        setTimeout(() => inputRef.current?.focus(), 0)
        return
      }

      setAttachments([
        ...attachments,
        {
          id: nanoid(),
          name: hit.name,
          mimeType: mime,
          path: hit.absolutePath,
          source: 'at-mention',
        },
      ])
      setTimeout(() => inputRef.current?.focus(), 0)
    },
    [
      value,
      setValue,
      attachments,
      setAttachments,
      attachmentsSupported,
      inputRef,
      t,
    ],
  )

  return { atQuery, handleSelect, handleDismiss }
}
