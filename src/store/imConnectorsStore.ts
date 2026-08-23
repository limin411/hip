import { create } from 'zustand'
import type { ImConnectorPublic, ImParkedEntry, ServerMessage } from '@hip/protocol'
import { wsClient } from '@/ipc/ws-client'

interface ImConnectorsState {
  connectors: ImConnectorPublic[]
  loaded: boolean
  loading: boolean
  error: string | null
  gatewayStatuses: Record<string, { status: string; lastError?: string | null }>
  parked: Record<string, ImParkedEntry[]>
  testFeedback: { connectorId: string; ok: boolean; error?: string } | null

  load: () => Promise<void>
  upsert: (connector: Record<string, unknown>) => Promise<void>
  remove: (connectorId: string) => Promise<void>
  test: (connectorId: string) => Promise<void>
  loadParked: (connectorId: string) => Promise<void>
  resolveParked: (connectorId: string, entryId: string, action: 'allow' | 'deny') => Promise<void>
  clearTestFeedback: () => void
}

export const useImConnectorsStore = create<ImConnectorsState>((set) => ({
  connectors: [],
  loaded: false,
  loading: false,
  error: null,
  gatewayStatuses: {},
  parked: {},
  testFeedback: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      wsClient.send({ type: 'im:config:list' })
      // Result arrives via subscription (im:config:list:result).
      // Safety timeout: if the sidecar never responds, clear loading after 5s
      // so the page doesn't stay stuck on the loading indicator.
      setTimeout(() => {
        const { loaded: isNowLoaded } = useImConnectorsStore.getState()
        if (!isNowLoaded) {
          useImConnectorsStore.setState({ loading: false })
        }
      }, 5_000)
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  upsert: async (connector) => {
    try {
      wsClient.send({ type: 'im:config:upsert', connector: connector as any })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  remove: async (connectorId) => {
    try {
      wsClient.send({ type: 'im:config:delete', connectorId })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  test: async (connectorId) => {
    set({ testFeedback: null })
    try {
      wsClient.send({ type: 'im:test', connectorId })
    } catch (err) {
      set({
        testFeedback: { connectorId, ok: false, error: err instanceof Error ? err.message : String(err) },
      })
    }
  },

  loadParked: async (connectorId) => {
    try {
      wsClient.send({ type: 'im:parked:list', connectorId })
    } catch {
      /* handled by subscription */
    }
  },

  resolveParked: async (connectorId, entryId, action) => {
    try {
      wsClient.send({ type: 'im:parked:resolve', connectorId, entryId, action })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  clearTestFeedback: () => set({ testFeedback: null }),
}))

// Subscribe to IM-related server messages via wsClient.onMessage
wsClient.onMessage((msg: ServerMessage) => {
  switch (msg.type) {
    case 'im:config:list:result':
      useImConnectorsStore.setState({
        connectors: msg.connectors,
        loaded: true,
        loading: false,
      })
      break

    case 'im:config:upsert:result': {
      const { connectors } = useImConnectorsStore.getState()
      const idx = connectors.findIndex((c) => c.id === msg.connector.id)
      const next = [...connectors]
      if (idx >= 0) {
        next[idx] = msg.connector
      } else {
        next.push(msg.connector)
      }
      useImConnectorsStore.setState({ connectors: next })
      break
    }

    case 'im:config:delete:result':
      if (msg.ok) {
        const { connectors } = useImConnectorsStore.getState()
        useImConnectorsStore.setState({
          connectors: connectors.filter((c) => c.id !== msg.connectorId),
        })
      }
      break

    case 'im:gateway:status': {
      const { gatewayStatuses } = useImConnectorsStore.getState()
      useImConnectorsStore.setState({
        gatewayStatuses: {
          ...gatewayStatuses,
          [msg.connectorId]: { status: msg.status, lastError: msg.lastError },
        },
      })
      break
    }

    case 'im:parked:updated': {
      const { parked } = useImConnectorsStore.getState()
      useImConnectorsStore.setState({
        parked: { ...parked, [msg.connectorId]: msg.entries },
      })
      break
    }

    case 'im:parked:list:result': {
      const { parked } = useImConnectorsStore.getState()
      useImConnectorsStore.setState({
        parked: { ...parked, [msg.connectorId]: msg.entries },
      })
      break
    }

    case 'im:test:result':
      useImConnectorsStore.setState({
        testFeedback: { connectorId: msg.connectorId, ok: msg.ok, error: msg.error },
      })
      break
  }
})
