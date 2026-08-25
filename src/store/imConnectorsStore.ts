import { create } from 'zustand'
import type { ImConnectorPublic, ImParkedEntry, ServerMessage } from '@hip/protocol'
import { wsClient } from '@/ipc/ws-client'

interface SaveResult {
  ok: boolean
  connectorId?: string
  error?: string
}

interface ImConnectorsState {
  connectors: ImConnectorPublic[]
  loaded: boolean
  loading: boolean
  saving: boolean
  error: string | null
  wsConnected: boolean
  gatewayStatuses: Record<string, { status: string; lastError?: string | null }>
  parked: Record<string, ImParkedEntry[]>
  testFeedback: { connectorId: string; ok: boolean; error?: string } | null
  saveResult: SaveResult | null

  load: () => Promise<void>
  upsert: (connector: Record<string, unknown>) => Promise<SaveResult>
  remove: (connectorId: string) => Promise<void>
  test: (connectorId: string) => Promise<void>
  loadParked: (connectorId: string) => Promise<void>
  resolveParked: (connectorId: string, entryId: string, action: 'allow' | 'deny') => Promise<void>
  clearTestFeedback: () => void
  clearSaveResult: () => void
}

export const useImConnectorsStore = create<ImConnectorsState>((set) => ({
  connectors: [],
  loaded: false,
  loading: false,
  saving: false,
  error: null,
  wsConnected: false,
  gatewayStatuses: {},
  parked: {},
  testFeedback: null,
  saveResult: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      wsClient.send({ type: 'im:config:list' })
      // Safety timeout: if the sidecar never responds, clear loading after 5s.
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
    if (!useImConnectorsStore.getState().wsConnected) {
      const err = 'Sidecar not connected'
      set({ error: err })
      return { ok: false, error: err }
    }
    set({ saving: true, error: null, saveResult: null })
    try {
      wsClient.send({ type: 'im:config:upsert', connector: connector as any })
      // Result arrives via subscription. Safety timeout.
      return await new Promise<SaveResult>((resolve) => {
        const timeout = setTimeout(() => {
          unsub()
          set({ saving: false })
          resolve({ ok: false, error: 'Save timed out' })
        }, 10_000)
        const unsub = useImConnectorsStore.subscribe((state, prev) => {
          // Detect connector list change (upsert:result handler ran)
          if (state.connectors !== prev.connectors) {
            clearTimeout(timeout)
            unsub()
            const saved = state.connectors.find((c) =>
              state.connectors.length > prev.connectors.length
                ? !prev.connectors.some((p) => p.id === c.id)
                : c.id === (connector as Record<string, unknown>).id,
            )
            const result: SaveResult = { ok: true, connectorId: saved?.id }
            set({ saving: false, saveResult: result })
            resolve(result)
          }
          // Detect error change (upsert failed)
          if (state.error && state.error !== prev.error) {
            clearTimeout(timeout)
            unsub()
            const result: SaveResult = { ok: false, error: state.error }
            set({ saving: false, saveResult: result })
            resolve(result)
          }
        })
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      set({ saving: false, error: msg })
      return { ok: false, error: msg }
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
  clearSaveResult: () => set({ saveResult: null }),
}))

// Track WebSocket connection status
wsClient.onStatus((status) => {
  useImConnectorsStore.setState({ wsConnected: status === 'connected' })
})

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
