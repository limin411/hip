import type { Message } from '@hip/protocol'
import { toast } from 'sonner'
import { setComposerQuote } from '@/components/command-palette/composerBridge'
import { sessionService } from '@/domain'
import { exportSessionDebugBundle } from '@/lib/exportSessionDebug'
import { normalizeMessageContent } from '@/lib/normalizeMessageContent'
import { stripRoundtableFrame } from '@/lib/roundtable'
import type {
  ContextMenuBuildContext,
  ContextMenuItemDef,
  ContextProvider,
  ContextRequest,
} from '../types'

/**
 * Display/copy text matching the bubble (never leaks roundtable system framing).
 * User: strip `<!--hip.roundtable.v1-->` wire frame if present.
 * Assistant: normalize markdown/content for display.
 */
export function messageCopyText(message: Message): string {
  if (message.role === 'user') return stripRoundtableFrame(message.content)
  return normalizeMessageContent(message.content)
}

/** Quote body prepended on send (markdown blockquote + trailing blank line). */
export function formatQuoteForComposer(text: string): string {
  const lines = text.split('\n')
  const quoted = lines.map((line) => `> ${line}`).join('\n')
  return `${quoted}\n\n`
}

function isMessageRequest(req: ContextRequest): req is ContextRequest<'message'> {
  return req.kind === 'message'
}

export const messageProvider: ContextProvider = (req, ctx) => {
  if (!isMessageRequest(req)) return []

  const { message, isLastAssistant, sessionId } = req.payload
  const items: ContextMenuItemDef[] = []

  items.push({
    id: 'message.copy',
    label: ctx.t('contextMenu.message.copy'),
    group: 'clipboard',
    run: () => {
      void ctx.copyText(messageCopyText(message))
    },
  })

  items.push({
    id: 'message.quote',
    label: ctx.t('contextMenu.message.quote'),
    group: 'edit',
    run: () => {
      const ok = setComposerQuote(messageCopyText(message))
      if (!ok) {
        toast.message(ctx.t('contextMenu.message.quoteNoComposer'))
      }
    },
  })

  items.push({
    id: 'message.copyId',
    label: ctx.t('contextMenu.message.copyId'),
    group: 'debug',
    run: () => {
      void ctx.copyText(message.id)
    },
  })

  if (isLastAssistant) {
    const disabled =
      ctx.sessionStatus === 'running' && !ctx.sessionInterrupt
    items.push({
      id: 'message.regenerate',
      label: ctx.t('contextMenu.message.regenerate'),
      group: 'primary',
      disabled,
      disabledReason: disabled
        ? ctx.t('contextMenu.message.regenerateDisabled')
        : undefined,
      run: () => {
        sessionService.regenerate()
      },
    })
  }

  // Debug bundle when a session can produce one (active session with loaded data).
  if (canOfferDebugBundle(sessionId, ctx)) {
    items.push({
      id: 'session.exportDebugBundle',
      label: ctx.t('contextMenu.session.exportDebugBundle'),
      group: 'debug',
      run: () => {
        void (async () => {
          const json = sessionService.getSessionDebugBundleJson()
          if (!json) return
          const sid = ctx.activeSessionId ?? 'session'
          const result = await exportSessionDebugBundle(json, sid)
          if (result === 'saved') {
            toast.success(ctx.t('chat.exportDebugDone'))
          } else if (result === 'failed') {
            toast.error(ctx.t('chat.exportDebugFailed'))
          }
        })()
      },
    })
  }

  return items
}

/**
 * Cheap visibility gate — do not serialize the full debug bundle on every right-click.
 * getSessionDebugBundleJson only reads the active session; offer when payload targets it
 * (or omits sessionId and an active session exists). Serialization happens only in run().
 */
function canOfferDebugBundle(
  sessionId: string | null,
  ctx: ContextMenuBuildContext,
): boolean {
  const activeId = ctx.activeSessionId
  if (!activeId) return false
  if (sessionId != null && sessionId !== activeId) return false
  return true
}
