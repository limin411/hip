import type { ContextProvider } from '../types'

/** Sidebar recent-doc row: remove from the recent list (V2-N1). */
export const knowledgeRecentProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'knowledgeRecent') return []
  const { onRemove } = req.payload

  return [
    {
      id: 'knowledgeRecent.remove',
      label: ctx.t('knowledge.recent.remove'),
      group: 'danger',
      danger: true,
      run: () => {
        onRemove()
      },
    },
  ]
}
