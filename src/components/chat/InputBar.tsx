import { useState } from 'react'
import { Composer } from './Composer'
import { sessionService, useActiveSessionStatus } from '@/domain'

export function InputBar() {
  const [value, setValue] = useState('')
  const status = useActiveSessionStatus()
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
        />
      </div>
    </div>
  )
}
