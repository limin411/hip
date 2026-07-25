import { create } from 'zustand'
import { toast } from 'sonner'
import type {
  ExtensionConflict,
  ExtensionRegistrySnapshot,
  ServerMessage,
} from '@hip/protocol'
import { wsClient } from '@/ipc/ws-client'
import { nanoid } from 'nanoid'

const INSPECT_TIMEOUT_MS = 12_000
/** Skip re-fetch when a successful snapshot is fresher than this (same cwd). */
const INSPECT_CACHE_MS = 8_000
const TOAST_CONFLICTS_ID = 'extension-conflicts'
const TOAST_ERROR_ID = 'extension-inspect-error'

function waitForExtensionResult<T extends ServerMessage>(
  match: (msg: ServerMessage) => msg is T,
  timeoutMs = INSPECT_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub()
      reject(new Error('extension request timed out'))
    }, timeoutMs)
    const unsub = wsClient.onMessage((msg) => {
      // Stale prod sidecar (pre–extension-registry) rejects unknown types immediately.
      // Surface that instead of waiting the full timeout for a result that never comes.
      if (
        msg.type === 'error' &&
        (msg.code === 'INVALID_MESSAGE' || msg.code === 'PARSE_ERROR')
      ) {
        clearTimeout(timer)
        unsub()
        reject(
          new Error(
            'Sidecar rejected extension request (outdated binary). Rebuild with yarn sidecar:prod-bin and restart the app.',
          ),
        )
        return
      }
      if (!match(msg)) return
      clearTimeout(timer)
      unsub()
      resolve(msg)
    })
  })
}

function conflictSignature(conflicts: ExtensionConflict[]): string {
  return conflicts
    .map(
      (c) =>
        `${c.kind}:${c.winner.configId ?? ''}:${c.loser.configId ?? ''}:${c.fingerprint ?? ''}`,
    )
    .sort()
    .join('|')
}

function conflictToastDescription(conflicts: ExtensionConflict[]): string {
  const lines = conflicts.slice(0, 4).map((c) => {
    switch (c.kind) {
      case 'mcp_capability_duplicate':
        return `MCP capability duplicate (${c.fingerprint ?? 'unknown'})`
      case 'mcp_id_shadow':
        return `MCP id shadowed (${c.winner.configId ?? c.loser.configId ?? '?'})`
      case 'mcp_name_veto':
        return `MCP disabled by veto (${c.winner.configId ?? '?'})`
      case 'skill_id_shadow':
        return `Skill shadowed (${c.winner.configId ?? c.loser.configId ?? '?'})`
      case 'skill_disabled':
        return `Skill disabled (${c.winner.configId ?? '?'})`
      default:
        return c.message
    }
  })
  if (conflicts.length > 4) lines.push(`+${conflicts.length - 4} more`)
  return lines.join('\n')
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
  inspectedAt: number | null
  /** Last conflict set we already toasted (avoid spam on remount). */
  lastConflictToastSig: string | null
  /**
   * Refresh registry snapshot for cwd (defaults to process-less: empty → sidecar cwd).
   * Concurrent calls for the same cwd share one in-flight request.
   * @param force bypass short TTL cache (e.g. after user remediation)
   */
  inspect: (cwd?: string, opts?: { force?: boolean }) => Promise<void>
  preflightEnable: (opts: {
    cwd?: string
    pluginId?: string
    pluginDir?: string
  }) => Promise<ExtensionPreflightSummary | null>
  clear: () => void
}

/** Module-level in-flight coalesce (zustand actions are recreated per set). */
let inspectInFlight: Promise<void> | null = null
let inspectInFlightKey: string | null = null

function notifyInspectError(message: string): void {
  const outdated = /outdated binary|rejected extension/i.test(message)
  toast.error(outdated ? 'Extension registry unavailable' : message, {
    id: TOAST_ERROR_ID,
    description: outdated
      ? 'Sidecar is outdated. Run yarn sidecar:prod-bin (or yarn sidecar:dev-bin) and fully restart the app.'
      : 'Could not load extension conflict state. Retry from Settings if needed.',
    duration: outdated ? 10_000 : 6_000,
  })
}

function notifyNotableConflicts(conflicts: ExtensionConflict[]): void {
  if (conflicts.length === 0) {
    toast.dismiss(TOAST_CONFLICTS_ID)
    return
  }
  toast.warning(`Extension conflicts (${conflicts.length})`, {
    id: TOAST_CONFLICTS_ID,
    description: conflictToastDescription(conflicts),
    duration: 10_000,
  })
}

export const useExtensionStore = create<ExtensionStore>((set, get) => ({
  snapshot: null,
  notableConflicts: [],
  loading: false,
  error: null,
  lastCwd: null,
  inspectedAt: null,
  lastConflictToastSig: null,

  clear: () =>
    set({
      snapshot: null,
      notableConflicts: [],
      error: null,
      lastCwd: null,
      inspectedAt: null,
      lastConflictToastSig: null,
    }),

  inspect: async (cwd, opts) => {
    const key = cwd ?? ''
    const force = opts?.force === true
    const state = get()

    if (
      !force &&
      state.snapshot &&
      state.lastCwd === (cwd ?? null) &&
      state.inspectedAt != null &&
      Date.now() - state.inspectedAt < INSPECT_CACHE_MS &&
      !state.error
    ) {
      return
    }

    if (inspectInFlight && inspectInFlightKey === key) {
      return inspectInFlight
    }

    const run = (async () => {
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
          const err = result.error ?? 'inspect failed'
          set({
            loading: false,
            error: err,
            snapshot: null,
            notableConflicts: [],
            inspectedAt: null,
          })
          notifyInspectError(err)
          return
        }
        const notable = result.notableConflicts ?? []
        const sig = conflictSignature(notable)
        const prevSig = get().lastConflictToastSig
        set({
          loading: false,
          snapshot: result.snapshot ?? null,
          notableConflicts: notable,
          error: null,
          inspectedAt: Date.now(),
          lastConflictToastSig: notable.length > 0 ? sig : null,
        })
        // Toast only when conflicts appear or change — not on every remount with same set.
        if (notable.length > 0 && sig !== prevSig) {
          notifyNotableConflicts(notable)
        } else if (notable.length === 0) {
          toast.dismiss(TOAST_CONFLICTS_ID)
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        set({
          loading: false,
          error: err,
        })
        notifyInspectError(err)
      }
    })()

    inspectInFlight = run
    inspectInFlightKey = key
    try {
      await run
    } finally {
      if (inspectInFlight === run) {
        inspectInFlight = null
        inspectInFlightKey = null
      }
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
        const err = result.error ?? 'preflight failed'
        set({ error: err })
        notifyInspectError(err)
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
      const err = e instanceof Error ? e.message : String(e)
      set({ error: err })
      notifyInspectError(err)
      return null
    }
  },
}))
