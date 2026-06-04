import { useEffect } from 'react'
import type { ServerMessage } from '@hip/protocol'
import { wsClient } from '../ipc/ws-client'
import { useSessionStore } from '../store/sessionStore'

export function useSessionSync() {
  const store = useSessionStore()

  useEffect(() => {
    return wsClient.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'session:created':
          break
        case 'agent:started':
          store.setAgentStarted(msg.sessionId, msg.agentId, msg.role)
          break
        case 'token:stream':
          store.appendToken(msg.sessionId, msg.agentId, msg.delta)
          break
        case 'agent:finished':
          store.setAgentFinished(msg.sessionId, msg.agentId)
          break
        case 'message:complete':
          store.addMessage(msg.sessionId, msg.message)
          break
        case 'error':
          console.error('[ws] server error', msg)
          break
      }
    })
  }, [store])
}
