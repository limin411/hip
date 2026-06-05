import { useSessionStore } from '../../store/sessionStore'
import { wsClient } from '../../ipc/ws-client'

const DEFAULT_CONFIG = {
  llmProvider: 'anthropic' as const,
  model: 'claude-opus-4-8',
  tools: [] as string[],
}

export function SessionTabs() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const setActive = useSessionStore((s) => s.setActive)
  const destroySession = useSessionStore((s) => s.destroySession)
  const createSession = useSessionStore((s) => s.createSession)

  function newSession() {
    const id = createSession(DEFAULT_CONFIG)
    wsClient.send({ type: 'session:create', id, config: DEFAULT_CONFIG })
  }

  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #222', background: '#111' }}>
      {sessions.map((s) => (
        <div
          key={s.id}
          onClick={() => setActive(s.id)}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            cursor: 'pointer',
            background: s.id === activeSessionId ? '#1e1e1e' : 'transparent',
            borderRight: '1px solid #222',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <span>Session {s.id.slice(0, 6)}</span>
          <span
            onClick={(e) => {
              e.stopPropagation()
              destroySession(s.id)
            }}
            style={{ color: '#555', cursor: 'pointer' }}
          >
            ×
          </span>
        </div>
      ))}
      <button
        onClick={newSession}
        style={{
          padding: '6px 12px',
          background: 'none',
          border: 'none',
          color: '#666',
          cursor: 'pointer',
          fontSize: 16,
        }}
      >
        ＋
      </button>
    </div>
  )
}
