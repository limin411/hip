import { useState } from 'react'
import { Composer } from './Composer'
import { sessionService, useActiveSession, useActiveSessionId, useActiveSessionStatus } from '@/domain'

export function InputBar() {
  const [value, setValue] = useState('')
  const status = useActiveSessionStatus()
  const session = useActiveSession()
  const activeSessionId = useActiveSessionId()
  const thinking = session?.config.thinking ?? true
  const submit = () => {
    const text = value.trim()
    if (!text) return
    sessionService.sendMessage(text)
    setValue('')
  }
  return (
    <div className="shrink-0 px-5 pb-5">
      <div className="mx-auto max-w-3xl">
        <Composer
          value={value}
          onChange={setValue}
          onSubmit={submit}
          running={status === 'running'}
          onStop={() => sessionService.cancel()}
          thinking={thinking}
          thinkingDisabled={status === 'running'}
          onToggleThinking={activeSessionId ? (next) => sessionService.setThinking(activeSessionId, next) : undefined}
        />
      </div>
    </div>
  )
}
