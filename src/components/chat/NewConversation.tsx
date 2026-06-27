import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDraftStore } from '@/store/draftStore'
import { useUiStore } from '@/store/uiStore'
import { sessionService } from '@/domain'
import { Composer } from './Composer'
import { FolderPill } from './FolderPill'
import { ModelPicker } from './ModelPicker'
import { PermissionModePicker } from './PermissionModePicker'
import { HipLogo } from '@/components/login/HipLogo'

export function NewConversation() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const surface = activeView === 'code' ? 'code' : 'chat'
  const draft = useDraftStore((s) => s.draft)
  const text = draft?.text ?? ''

  // Ensure a draft exists; keep Chat drafts in chat mode so a leftover project draft (e.g. a
  // folder picked in Code, then switched to Chat without sending) can't commit as a Code session.
  // (configFromDraft derives surface from draft.mode, so mode must match the surface here.)
  useEffect(() => {
    useDraftStore.getState().ensureDraft()
    if (surface === 'chat' && useDraftStore.getState().draft?.mode === 'project') {
      useDraftStore.getState().clearProject()
    }
  }, [surface])

  // Code requires a project folder before the first send; Chat is always sandboxed.
  const hasFolder = draft?.mode === 'project' && !!draft.cwd
  const canSend = surface === 'chat' ? !!text.trim() : !!text.trim() && hasFolder

  const submit = () => {
    if (!canSend) return
    sessionService.sendMessage(text) // commit: creates the session (surface-aware) + resets the draft
  }

  const greeting = surface === 'code' ? t('chat.codeGreeting') : t('chat.newConversationGreeting')

  const setText = (value: string) => useDraftStore.getState().setText(value)

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-5" data-testid="new-conversation">
      <div className="w-full max-w-3xl">
        <div className="mb-6 flex justify-center">
          <HipLogo variant="hero" size={160} />
        </div>
        <div key={surface} className="animate-greeting-enter">
          <h1 className="mb-1 text-center text-display font-semibold text-ink">
            {greeting}
          </h1>
          <p className="mb-4 text-center text-body text-ink-secondary">
            {t('chat.greetingSub.default', '')}
          </p>
        </div>
        <Composer
          value={text}
          onChange={(v) => setText(v)}
          onSubmit={submit}
          autoFocus
          submitDisabled={!canSend}
          leftSlot={surface === 'code' ? <><ModelPicker /><PermissionModePicker /></> : <ModelPicker />}
        />
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
