import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, RefreshCw } from 'lucide-react'
import type { Message } from '@hip/protocol'
import { copyText } from '@/ipc/clipboard'
import { sessionService } from '@/domain'

const BTN = 'flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink-secondary'

export function MessageActions({ message, isLastAssistant }: { message: Message; isLastAssistant: boolean }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    if (await copyText(message.content)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <>
      {/* Hover reveal needs an ancestor with className="group" (MessageBubble's wrapper provides it). */}
      <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button onClick={onCopy} data-testid="msg-copy" title={t('chat.copy')} aria-label={t('chat.copy')} className={BTN}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        {isLastAssistant && (
          <button onClick={() => sessionService.regenerate()} data-testid="msg-regenerate" title={t('chat.regenerate')} aria-label={t('chat.regenerate')} className={BTN}>
            <RefreshCw size={14} />
          </button>
        )}
      </div>
    </>
  )
}
