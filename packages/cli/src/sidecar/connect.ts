import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { HipWsClient } from '../client/ws-client.js'
import { waitReady } from '../client/turn-runner.js'
import { bootstrapIsolation } from './env-bootstrap.js'
import { spawnSidecar, stopSpawned, type SpawnedSidecar } from './spawn.js'
import { resolveAttachTarget } from './attach.js'
import { DiscoveryError, readDiscovery } from './discovery.js'

export interface ConnectOpts {
  /**
   * Product default is `attach` (discovery file / explicit port).
   * `spawn` only when HIP_CLI_DEV_SPAWN=1 (isolated).
   */
  sidecar?: 'spawn' | 'attach' | 'auto' | 'discovery'
  port?: number
  token?: string
  sidecarLog?: string
  /** Use real ~/.hip paths (default true for session commands). */
  useUserHip?: boolean
  noParentWatch?: boolean
  allowNoKey?: boolean
  dbMemory?: boolean
  env?: NodeJS.ProcessEnv
  debug?: boolean
  /** WS client role query param (default cli). */
  clientRole?: 'cli' | 'gui' | 'unknown'
}

export interface SidecarConnection {
  client: HipWsClient
  hasApiKey: boolean
  /** Close WS and stop spawned child if any. */
  close: () => Promise<void>
  spawned: boolean
  /** Live GUI presence from ready/clients:changed (product attach). */
  guiPresent: boolean
  connectionId?: string
}

function devSpawnAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.HIP_CLI_DEV_SPAWN === '1' || env.HIP_CLI_DEV_SPAWN === 'true'
}

/**
 * Open a WS connection to the product sidecar (attach-only by default).
 */
export async function connectSidecar(opts: ConnectOpts = {}): Promise<SidecarConnection> {
  const client = new HipWsClient()
  let spawned: SpawnedSidecar | null = null
  let childEnv = opts.env ?? process.env
  const role = opts.clientRole ?? 'cli'

  const explicitAttach =
    opts.port != null || Boolean(opts.token?.trim()) || Boolean(opts.sidecarLog?.trim())
  const mode = opts.sidecar ?? 'attach'

  let port: number
  let token: string

  if (mode === 'spawn') {
    if (!devSpawnAllowed(childEnv)) {
      throw Object.assign(
        new Error(
          'hip CLI does not spawn the product sidecar; start the hip desktop app first (or set HIP_CLI_DEV_SPAWN=1 for isolated dev spawn only)',
        ),
        { code: 'APP_NOT_RUNNING' },
      )
    }
    // Dev spawn is isolation-only — never product ~/.hip.
    if (opts.useUserHip) {
      throw Object.assign(
        new Error('HIP_CLI_DEV_SPAWN cannot use product ~/.hip (refusing --use-user-hip / product DB)'),
        { code: 'INVALID_ARGS' },
      )
    }
    const iso = bootstrapIsolation({
      dbMemory: opts.dbMemory ?? true,
      setHome: true,
      env: childEnv,
    })
    childEnv = iso.env
    if (opts.dbMemory !== false) childEnv = { ...childEnv, HIP_DB_PATH: ':memory:' }

    spawned = await spawnSidecar({
      env: childEnv,
      parentWatch: !opts.noParentWatch,
      debug: opts.debug || process.env.HIP_CLI_DEBUG === '1',
      sidecarLogPath: opts.sidecarLog,
    })
    port = spawned.port
    token = spawned.token
  } else if (explicitAttach || mode === 'auto') {
    // Explicit flags / env attach (dev/debug) or auto with flags.
    if (explicitAttach || opts.port || opts.token || opts.sidecarLog || childEnv.HIP_SIDECAR_PORT) {
      try {
        const target = resolveAttachTarget({
          port: opts.port,
          token: opts.token,
          sidecarLog: opts.sidecarLog,
          env: childEnv,
        })
        port = target.port
        token = target.token
      } catch {
        // Fall through to discovery for product path.
        const doc = readDiscovery(childEnv)
        port = doc.port
        token = doc.token
      }
    } else {
      const doc = readDiscovery(childEnv)
      port = doc.port
      token = doc.token
    }
  } else {
    // Product default: discovery attach only.
    const doc = readDiscovery(childEnv)
    port = doc.port
    token = doc.token
  }

  let guiPresent = false
  let connectionId: string | undefined
  const readyP = waitReady((h) => client.onMessage(h), {
    allowNoKey: opts.allowNoKey ?? true,
    timeoutMs: 15_000,
  })

  // Track clients:changed for long-lived repl HITL.
  client.onMessage((msg) => {
    if (msg.type === 'ready') {
      connectionId = msg.connectionId
      guiPresent = Boolean(msg.clients?.some((c) => c.role === 'gui'))
    } else if (msg.type === 'clients:changed') {
      guiPresent = msg.clients.some((c) => c.role === 'gui')
    }
  })

  try {
    await client.connect(port, token, { clientRole: role })
  } catch (err) {
    // One re-read on auth fail if discovery path.
    if ((err as { code?: string }).code === 'WS_AUTH_FAILED' && !explicitAttach && !spawned) {
      try {
        const doc = readDiscovery(childEnv)
        await client.connect(doc.port, doc.token, { clientRole: role })
      } catch (err2) {
        throw err2
      }
    } else {
      throw err
    }
  }

  const ready = await readyP
  guiPresent = Boolean(
    (ready as { clients?: Array<{ role: string }> }).clients?.some((c) => c.role === 'gui') || guiPresent,
  )

  return {
    client,
    hasApiKey: ready.hasApiKey,
    spawned: Boolean(spawned),
    guiPresent,
    connectionId,
    close: async () => {
      client.close()
      if (spawned) await stopSpawned(spawned, 3000)
    },
  }
}

/** Wait for a server message of a given type (optional predicate). Hardened for multi-client. */
export function waitForServerMessage<T extends ServerMessage['type']>(
  client: HipWsClient,
  type: T,
  opts: {
    timeoutMs?: number
    match?: (msg: Extract<ServerMessage, { type: T }>) => boolean
    /** When waiting for a session-scoped result, ignore errors for other sessions. */
    sessionId?: string
    /** Default true under multi-client: ignore foreign session errors. */
    ignoreForeignErrors?: boolean
  } = {},
): Promise<Extract<ServerMessage, { type: T }>> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const ignoreForeign = opts.ignoreForeignErrors !== false
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub()
      reject(Object.assign(new Error(`timeout waiting for ${type}`), { code: 'TIMEOUT' }))
    }, timeoutMs)
    const unsub = client.onMessage((msg) => {
      if (msg.type !== type) {
        if (msg.type === 'error') {
          const errSession = 'sessionId' in msg ? msg.sessionId : undefined
          if (ignoreForeign && errSession && opts.sessionId && errSession !== opts.sessionId) {
            return
          }
          if (ignoreForeign && errSession && !opts.sessionId) {
            // Global RPC wait (list): ignore session-scoped turn errors.
            return
          }
          clearTimeout(timer)
          unsub()
          reject(Object.assign(new Error(msg.message), { code: msg.code }))
        }
        return
      }
      const m = msg as Extract<ServerMessage, { type: T }>
      if (opts.match && !opts.match(m)) return
      clearTimeout(timer)
      unsub()
      resolve(m)
    })
  })
}

export function send(client: HipWsClient, msg: ClientMessage): void {
  client.send(msg)
}

export { DiscoveryError, readDiscovery }
