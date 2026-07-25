import { create } from 'zustand'
import type {
  ExtensionConflict,
  ExtensionRegistrySnapshot,
  ServerMessage,
} from '@hip/protocol'
import { wsClient } from '@/ipc/ws-client'
import { nanoid } from 'nanoid'

function waitForExtensionResult<T extends ServerMessage>(
  match: (msg: ServerMessage) => msg is T,
  timeoutMs = 15_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub()
      reject(new Error('extension request timed out'))
    }, timeoutMs)
    const unsub = wsClient.onMessage((msg) => {
      if (!match(msg)) return
      clearTimeout(timer)
      unsub()
      resolve(msg)
    })
  })
}

export interface ExtensionPreflightSummary {
  pluginId: string
  pluginDir: string
  hasConflicts: boolean
  skillConflictCount: number
  mcpIdConflictCount: number
  capabilityConflictCount: number
  recommendations: string[]
  skillConflicts: Array<{ skillId: string }>
  mcpIdConflicts: Array<{ id: string }>
  capabilityConflicts: Array<{ fingerprint: string; existingId: string; incomingId: string }>
  /** Pending enable target (for modal). */
  pendingPluginId?: string
  pendingPluginName?: string
}

interface ExtensionStore {
  snapshot: ExtensionRegistrySnapshot | null
  notableConflicts: ExtensionConflict[]
  loading: boolean
  error: string | null
  lastCwd: string | null
  /** Refresh registry snapshot for cwd (defaults to process-less: empty → sidecar cwd). */
  inspect: (cwd?: string) => Promise<void>
  preflightEnable: (opts: {
    cwd?: string
    pluginId?: string
    pluginDir?: string
  }) => Promise<ExtensionPreflightSummary | null>
  clear: () => void
}

export const useExtensionStore = create<ExtensionStore>((set) => ({
  snapshot: null,
  notableConflicts: [],
  loading: false,
  error: null,
  lastCwd: null,

  clear: () =>
    set({
      snapshot: null,
      notableConflicts: [],
      error: null,
      lastCwd: null,
    }),

  inspect: async (cwd) => {
    const requestId = nanoid()
    set({ loading: true, error: null, lastCwd: cwd ?? null })
    try {
      const pending = waitForExtensionResult(
        (m): m is Extract<ServerMessage, { type: 'extension:inspect:result' }> =>
          m.type === 'extension:inspect:result' && m.requestId === requestId,
      )
      wsClient.send({ type: 'extension:inspect', requestId, cwd })
      const result = await pending
      if (!result.ok) {
        set({
          loading: false,
          error: result.error ?? 'inspect failed',
          snapshot: null,
          notableConflicts: [],
        })
        return
      }
      set({
        loading: false,
        snapshot: result.snapshot ?? null,
        notableConflicts: result.notableConflicts ?? [],
        error: null,
      })
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  },

  preflightEnable: async (opts) => {
    const requestId = nanoid()
    try {
      const pending = waitForExtensionResult(
        (m): m is Extract<ServerMessage, { type: 'extension:preflight:result' }> =>
          m.type === 'extension:preflight:result' && m.requestId === requestId,
      )
      wsClient.send({
        type: 'extension:preflight',
        requestId,
        cwd: opts.cwd,
        pluginId: opts.pluginId,
        pluginDir: opts.pluginDir,
      })
      const result = await pending
      if (!result.ok || !result.preflight) {
        set({ error: result.error ?? 'preflight failed' })
        return null
      }
      const p = result.preflight
      return {
        pluginId: p.pluginId,
        pluginDir: p.pluginDir,
        hasConflicts: p.hasConflicts,
        skillConflictCount: p.skillConflicts.length,
        mcpIdConflictCount: p.mcpIdConflicts.length,
        capabilityConflictCount: p.capabilityConflicts.length,
        recommendations: p.recommendations,
        skillConflicts: p.skillConflicts.map((c) => ({ skillId: c.skillId })),
        mcpIdConflicts: p.mcpIdConflicts.map((c) => ({ id: c.id })),
        capabilityConflicts: p.capabilityConflicts.map((c) => ({
          fingerprint: c.fingerprint,
          existingId: c.existingId,
          incomingId: c.incomingId,
        })),
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },
}))
