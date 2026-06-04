import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { wsClient } from '../ipc/ws-client'

export type WsStatus = 'connecting' | 'connected' | 'error' | 'disconnected'

async function getSidecarPort(): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const port = await invoke<number | null>('get_sidecar_port')
    if (port !== null) return port
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('sidecar port not available after 10 s')
}

export function useWebSocket() {
  const [status, setStatus] = useState<WsStatus>('disconnected')

  useEffect(() => {
    let cancelled = false

    async function init() {
      setStatus('connecting')
      try {
        const port = await getSidecarPort()
        if (cancelled) return
        await wsClient.connect(port)
        if (!cancelled) setStatus('connected')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    init()
    return () => {
      cancelled = true
      wsClient.disconnect()
      setStatus('disconnected')
    }
  }, [])

  return { status }
}
