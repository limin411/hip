import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, ChevronDown } from 'lucide-react'
import { Textarea } from '@/components/ui/Textarea'
import { sessionService } from '@/domain'

const MODELS = ['deepseek-chat']

export function InputBar() {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [model, setModel] = useState(MODELS[0])
  function submit() {
    const text = value.trim()
    if (!text) return
    // TODO: 模型选择（model）暂未接入 sessionService / SessionConfig —— 与既有 mock 行为一致，目前仅为占位 UI
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
          <label className="flex items-center gap-1 text-[12px] text-ink-secondary">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="cursor-pointer appearance-none bg-transparent pr-4 text-[12px] text-ink-secondary focus:outline-none"
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="-ml-4 pointer-events-none text-ink-tertiary" />
          </label>
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
