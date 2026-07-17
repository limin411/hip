import { setComposerQuote } from '@/components/command-palette/composerBridge'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffAnnotationStore } from '@/store/diffAnnotationStore'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Diff hunk: copy, annotate for agent, quote into composer. */
export const diffHunkProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'diffHunk') return []
  const { text, path } = req.payload
  if (!text) return []
  const sessionId = useDomainStore.getState().activeSessionId

  const items: ContextMenuItemDef[] = [
    {
      id: 'diffHunk.copy',
      label: ctx.t('contextMenu.diffHunk.copy'),
      group: 'clipboard',
      icon: 'code',
      run: () => {
        void ctx.copyText(text)
      },
    },
    {
      id: 'diffHunk.annotate',
      label: ctx.t('contextMenu.diffHunk.annotate'),
      group: 'agent',
      disabled: !sessionId,
      disabledReason: sessionId ? undefined : ctx.t('contextMenu.diffHunk.needSession'),
      run: () => {
        if (!sessionId) return
        useDiffAnnotationStore.getState().add(sessionId, {
          path: path || '(unknown)',
          body: text,
        })
      },
    },
    {
      id: 'diffHunk.quoteToComposer',
      label: ctx.t('contextMenu.diffHunk.quoteToComposer'),
      group: 'agent',
      run: () => {
        const header = path ? `${path}\n` : ''
        setComposerQuote(`${header}${text}`)
      },
    },
  ]
  return items
}
