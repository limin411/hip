import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Commit log row (ChangesView): copy full SHA and commit message. */
export const commitProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'commit') return []
  const { sha, message } = req.payload
  const items: ContextMenuItemDef[] = []

  if (sha) {
    items.push({
      id: 'commit.copySha',
      label: ctx.t('contextMenu.commit.copySha'),
      group: 'clipboard',
      icon: 'git-branch',
      run: () => {
        void ctx.copyText(sha)
      },
    })
  }

  if (message) {
    items.push({
      id: 'commit.copyMessage',
      label: ctx.t('contextMenu.commit.copyMessage'),
      group: 'clipboard',
      run: () => {
        void ctx.copyText(message)
      },
    })
  }

  return items
}
