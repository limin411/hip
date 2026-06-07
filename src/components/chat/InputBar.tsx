import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp } from 'lucide-react'
import { Textarea } from '@/components/ui/Textarea'
import { sessionService } from '@/domain'

const ACTIVE_MODEL = 'deepseek-chat'

export function InputBar() {
  const { t } = useTranslation()
  const [value, setValue] = useState('')

  function submit() {
    const text = value.trim()
    if (!text) return
    sessionService.sendMessage(text)
    setValue('')
  }

  return (
    <div className="shrink-0 px-5 pb-5">
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-surface p-2 shadow-pop focus-within:ring-2 focus-within:ring-accent/30">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder={t('chat.inputPlaceholder')}
          className="border-0 px-2 py-1 focus-visible:ring-0"
        />
        <div className="flex items-center justify-between px-1 pt-1">
          <span className="text-[12px] text-ink-tertiary">{ACTIVE_MODEL}</span>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            title={t('chat.send')}
          >
            <ArrowUp size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}
