import { useEffect, useRef } from 'react'
import { useActiveSessionId, useActiveMessages } from '@/domain'
import { MessageBubble } from './MessageBubble'

export function ChatPane() {
  const activeSessionId = useActiveSessionId()
  const messages = useActiveMessages()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = bottomRef.current
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-ink-tertiary">
        发送一条消息开始对话
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6">
        {messages.map((m, i) => (
          <MessageBubble
            key={`${activeSessionId}-${m.id}-${i}`}
            message={m}
            streaming={m.role === 'assistant' && i === messages.length - 1}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
