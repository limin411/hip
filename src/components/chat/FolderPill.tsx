import { Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDraftStore } from '@/store/draftStore'
import { useUiStore } from '@/store/uiStore'
import { pickDirectory } from '@/ipc/dialog'

function basename(p: string): string {
  const a = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return a[a.length - 1] || p
}

export function FolderPill() {
  const { t } = useTranslation()
  const draft = useDraftStore((s) => s.draft)
  const bound = draft?.mode === 'project' && draft.cwd ? draft.cwd : null

  const pick = async () => {
    const dir = await pickDirectory()
    if (!dir) return
    useDraftStore.getState().pickProject(dir)
    // "pick a folder → Files panel opens" (D1)
    useUiStore.getState().setPanelOpen(true)
    useUiStore.getState().setTab('files')
  }

  if (bound) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-ink-secondary">
        <button
          onClick={pick}
          data-testid="change-folder"
          title={bound}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-surface-muted"
        >
          <Folder size={13} className="text-accent" />
          {basename(bound)}
        </button>
        <button
          onClick={() => useDraftStore.getState().clearProject()}
          data-testid="clear-folder"
          title={t('chat.clearFolder')}
          aria-label={t('chat.clearFolder')}
          className="text-ink-tertiary hover:text-ink"
        >
          {t('chat.clearFolder')}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={pick}
      data-testid="pick-folder"
      className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-surface-muted"
    >
      <Folder size={13} className="text-ink-tertiary" />
      {t('chat.pickFolder')}
      <span className="text-ink-tertiary">· {t('chat.orJustChat')}</span>
    </button>
  )
}
