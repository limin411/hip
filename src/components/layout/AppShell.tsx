import { useWebSocket } from '../../hooks/useWebSocket'
import { useSessionSync } from '../../hooks/useSession'
import { SessionTabs } from './SessionTabs'
import { SessionView } from '../session/SessionView'
import { useSessionStore } from '../../store/sessionStore'

export function AppShell() {
  const { status } = useWebSocket()
  useSessionSync()
  const activeSessionId = useSessionStore((s) => s.activeSessionId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d0d0d', color: '#eee' }}>
      <div style={{ padding: '2px 8px', fontSize: 11, color: '#555', borderBottom: '1px solid #1a1a1a' }}>
        sidecar: {status}
      </div>
      <SessionTabs />
      {activeSessionId && <SessionView sessionId={activeSessionId} />}
      {!activeSessionId && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}>
          No session — press ＋ to start
        </div>
      )}
    </div>
  )
}
