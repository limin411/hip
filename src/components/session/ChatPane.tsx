import type { Message } from '@hip/protocol'

interface Props {
  messages: Message[]
}

export function ChatPane({ messages }: Props) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
      {messages.length === 0 && (
        <div style={{ color: '#333', fontSize: 13 }}>Send a message to begin.</div>
      )}
      {messages.map((m) => (
        <div key={m.id} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>{m.role}</div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{m.content}</div>
        </div>
      ))}
    </div>
  )
}
