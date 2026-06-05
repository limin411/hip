import { useEffect } from 'react'
import type { ServerMessage } from '@hip/protocol'
import { wsClient } from '../ipc/ws-client'
import { useSessionStore } from '../store/sessionStore'

export function useSessionSync() {
  const setAgentStarted = useSessionStore((s) => s.setAgentStarted)
  const appendToken = useSessionStore((s) => s.appendToken)
  const setAgentFinished = useSessionStore((s) => s.setAgentFinished)
  const addMessage = useSessionStore((s) => s.addMessage)

  useEffect(() => {
    return wsClient.onMessage((msg: ServerMessage) => {
      switch (msg.type) {
        case 'session:created':
          break
        case 'agent:started':
          setAgentStarted(msg.sessionId, msg.agentId, msg.role)
          break
        case 'token:stream':
          appendToken(msg.sessionId, msg.agentId, msg.delta)
          break
        case 'agent:finished':
          setAgentFinished(msg.sessionId, msg.agentId)
          break
        case 'message:complete':
          addMessage(msg.sessionId, msg.message)
          break
        case 'error':
          console.error('[ws] server error', msg)
          break
      }
    })
  }, [setAgentStarted, appendToken, setAgentFinished, addMessage])
}
