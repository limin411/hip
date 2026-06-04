import { useSessionStore } from '../../store/sessionStore'
import { ChatPane } from './ChatPane'
import { AgentTree } from './AgentTree'
import { InputBar } from './InputBar'

interface Props {
  sessionId: string
}

export function SessionView({ sessionId }: Props) {
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === sessionId))
  if (!session) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <ChatPane messages={session.messages} />
      <AgentTree agents={session.agents} />
      <InputBar sessionId={sessionId} disabled={session.status === 'running'} />
    </div>
  )
}
