import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, RefreshCw } from 'lucide-react'
import type { Message } from '@hip/protocol'
import { copyText } from '@/ipc/clipboard'
import { sessionService } from '@/domain'

const BTN =
  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20'

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
    <div className="flex items-center gap-0.5">
      <button onClick={onCopy} data-testid="msg-copy" title={t('chat.copy')} aria-label={t('chat.copy')} className={BTN}>
        {copied ? <Check size={14} className="block" /> : <Copy size={14} className="block" />}
      </button>
      {isLastAssistant && (
        <button onClick={() => sessionService.regenerate()} data-testid="msg-regenerate" title={t('chat.regenerate')} aria-label={t('chat.regenerate')} className={BTN}>
          <RefreshCw size={14} className="block" />
        </button>
      )}
    </div>
  )
}
