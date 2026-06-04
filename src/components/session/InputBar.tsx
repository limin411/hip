import { useState } from 'react'
import { wsClient } from '../../ipc/ws-client'

interface Props {
  sessionId: string
  disabled: boolean
}

export function InputBar({ sessionId, disabled }: Props) {
  const [value, setValue] = useState('')

  function submit() {
    if (!value.trim() || disabled) return
    wsClient.send({ type: 'message:send', sessionId, content: value.trim(), role: 'user' })
    setValue('')
  }

  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid #1a1a1a' }}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        disabled={disabled}
        placeholder={disabled ? 'Running…' : 'Message (Enter to send, Shift+Enter for newline)'}
        rows={3}
        style={{
          width: '100%',
          resize: 'none',
          background: '#111',
          color: '#eee',
          border: '1px solid #333',
          borderRadius: 6,
          padding: 10,
          fontSize: 14,
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}
