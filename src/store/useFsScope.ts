import { useActiveSession } from '@/domain'
import { useDraftStore } from '@/store/draftStore'

/**
 * The current filesystem scope for the Files panel:
 * - a committed session (keyed by session id, root = its cwd), or
 * - a project-mode draft (keyed by cwd, root = cwd, served via cwd-keyed FS), or
 * - none (chat-mode draft pre-commit, or nothing selected).
 */
export interface FsScope {
  scopeId: string | null
  cwd?: string
  isDraft: boolean
  chatDraft: boolean
}

export function useFsScope(): FsScope {
  const active = useActiveSession()
  const draft = useDraftStore((s) => s.draft)
  if (active) return { scopeId: active.id, cwd: active.config.cwd, isDraft: false, chatDraft: false }
  if (draft?.mode === 'project' && draft.cwd) return { scopeId: draft.cwd, cwd: draft.cwd, isDraft: true, chatDraft: false }
  return { scopeId: null, cwd: undefined, isDraft: false, chatDraft: draft?.mode === 'chat' }
}
