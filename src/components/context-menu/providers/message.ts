import type { Message } from '@hip/protocol'
import { insertComposerText } from '@/components/command-palette/composerBridge'
import { sessionService } from '@/domain'
import { normalizeMessageContent } from '@/lib/normalizeMessageContent'
import type {
  ContextMenuBuildContext,
  ContextMenuItemDef,
  ContextProvider,
  ContextRequest,
} from '../types'

/** Display/copy text: user raw content; assistant normalized (matches bubble display). */
export function messageCopyText(message: Message): string {
  return message.role === 'user' ? message.content : normalizeMessageContent(message.content)
}

/** Quote body for composer insert (markdown blockquote + trailing blank line). */
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
      insertComposerText(formatQuoteForComposer(messageCopyText(message)))
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
      id: 'session.copyDebugBundle',
      label: ctx.t('contextMenu.session.copyDebugBundle'),
      group: 'debug',
      run: () => {
        const json = sessionService.getSessionDebugBundleJson()
        if (json) void ctx.copyText(json)
      },
    })
  }

  return items
}

function canOfferDebugBundle(
  sessionId: string | null,
  ctx: ContextMenuBuildContext,
): boolean {
  const id = sessionId ?? ctx.activeSessionId
  if (!id) return false
  // getSessionDebugBundleJson only reads the active session — only offer when it matches.
  if (ctx.activeSessionId && id !== ctx.activeSessionId) return false
  return sessionService.getSessionDebugBundleJson() != null
}
