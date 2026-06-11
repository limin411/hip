import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDraftStore } from '@/store/draftStore'
import { sessionService } from '@/domain'
import { Composer } from './Composer'
import { FolderPill } from './FolderPill'

export function NewConversation() {
  const { t } = useTranslation()
  const draft = useDraftStore((s) => s.draft)
  const text = draft?.text ?? ''

  // Ensure a draft exists so the composer text binds + persists.
  useEffect(() => { useDraftStore.getState().ensureDraft() }, [])

  const submit = () => {
    const tx = text.trim()
    if (!tx) return
    sessionService.sendMessage(tx) // commit: creates the session + resets the draft
  }

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-5" data-testid="new-conversation">
      <div className="mt-[20vh] w-full max-w-3xl">
        <h1 className="mb-4 text-center text-display font-semibold text-ink">{t('chat.newConversationGreeting')}</h1>
        <Composer value={text} onChange={(v) => useDraftStore.getState().setText(v)} onSubmit={submit} autoFocus thinking thinkingDisabled />
        <div className="mt-2 flex justify-center">
          <FolderPill />
        </div>
      </div>
    </div>
  )
}
