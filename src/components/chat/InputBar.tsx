import { useState } from 'react'
import { Composer } from './Composer'
import { ModelPicker } from './ModelPicker'
import { PermissionModePicker } from './PermissionModePicker'
import { sessionService, useActiveSession, useActiveSessionStatus, useConnectionStatus } from '@/domain'
import { surfaceOf } from '@/lib/sessions'

export function InputBar() {
  const [value, setValue] = useState('')
  const status = useActiveSessionStatus()
  const connection = useConnectionStatus()
  const active = useActiveSession()
  const isCode = active ? surfaceOf(active.config) === 'code' : false
  // Any non-connected state (connecting/disconnected/error) means cancel() can't reach the sidecar
  // (it would only queue), so we disable Stop and show "reconnecting…". The ws-client retries
  // continuously, and the real recourse for a hard disconnect is the title-bar reconnect button.
  const reconnecting = status === 'running' && connection !== 'connected'
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
          reconnecting={reconnecting}
          leftSlot={isCode ? <><ModelPicker /><PermissionModePicker /></> : <ModelPicker />}
        />
      </div>
    </div>
  )
}
