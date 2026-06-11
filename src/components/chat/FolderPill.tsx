import { Folder, X } from 'lucide-react'
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
      <div
        className="flex items-center overflow-hidden rounded-md border border-accent/30 bg-accent-subtle text-meta text-accent-strong"
        data-testid="folder-chip"
      >
        <button
          onClick={pick}
          data-testid="change-folder"
          title={bound}
          className="flex items-center gap-1.5 py-1 pl-2.5 pr-1.5 transition-colors hover:bg-accent-active"
        >
          <Folder size={13} className="text-accent-strong" />
          {basename(bound)}
        </button>
        <button
          onClick={() => useDraftStore.getState().clearProject()}
          data-testid="clear-folder"
          title={t('chat.clearFolder')}
          aria-label={t('chat.clearFolder')}
          className="flex items-center py-1 pl-1 pr-1.5 transition-colors hover:bg-accent-active"
        >
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={pick}
      data-testid="pick-folder"
      className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-meta text-ink-secondary transition-colors hover:bg-surface-muted"
    >
      <Folder size={13} className="text-ink-tertiary" />
      {t('chat.pickFolder')}
      <span className="text-ink-tertiary">· {t('chat.orJustChat')}</span>
    </button>
  )
}
