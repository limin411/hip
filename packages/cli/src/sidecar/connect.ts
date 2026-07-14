import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { HipWsClient } from '../client/ws-client.js'
import { waitReady } from '../client/turn-runner.js'
import { bootstrapIsolation } from './env-bootstrap.js'
import { spawnSidecar, stopSpawned, type SpawnedSidecar } from './spawn.js'
import { resolveAttachTarget } from './attach.js'
import { userHipEnv } from './user-hip.js'

export interface ConnectOpts {
  /** Prefer attach when port/token/log set. Default spawn. */
  sidecar?: 'spawn' | 'attach' | 'auto'
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
}

export interface SidecarConnection {
  client: HipWsClient
  hasApiKey: boolean
  /** Close WS and stop spawned child if any. */
  close: () => Promise<void>
  spawned: boolean
}

/**
 * Open a WS connection to a spawned or attached sidecar.
 */
export async function connectSidecar(opts: ConnectOpts = {}): Promise<SidecarConnection> {
  const client = new HipWsClient()
  let spawned: SpawnedSidecar | null = null
  let childEnv = opts.env ?? process.env

  const mode = opts.sidecar ?? 'spawn'
  let port: number
  let token: string

  if (mode === 'attach' || (mode === 'auto' && (opts.port || opts.token || opts.sidecarLog))) {
    const target = resolveAttachTarget({
      port: opts.port,
      token: opts.token,
      sidecarLog: opts.sidecarLog,
      env: childEnv,
    })
    port = target.port
    token = target.token
  } else {
    if (opts.useUserHip) {
      childEnv = userHipEnv(childEnv)
    } else {
      const iso = bootstrapIsolation({
        dbMemory: opts.dbMemory,
        setHome: true,
        env: childEnv,
      })
      childEnv = iso.env
    }
    if (opts.dbMemory) childEnv = { ...childEnv, HIP_DB_PATH: ':memory:' }

    spawned = await spawnSidecar({
      env: childEnv,
      parentWatch: !opts.noParentWatch,
      debug: opts.debug || process.env.HIP_CLI_DEBUG === '1',
      sidecarLogPath: opts.sidecarLog,
    })
    port = spawned.port
    token = spawned.token
  }

  const readyP = waitReady((h) => client.onMessage(h), {
    allowNoKey: opts.allowNoKey ?? true,
    timeoutMs: 15_000,
  })
  await client.connect(port, token)
  const ready = await readyP

  return {
    client,
    hasApiKey: ready.hasApiKey,
    spawned: Boolean(spawned),
    close: async () => {
      client.close()
      if (spawned) await stopSpawned(spawned, 3000)
    },
  }
}

/** Wait for a server message of a given type (optional predicate). */
export function waitForServerMessage<T extends ServerMessage['type']>(
  client: HipWsClient,
  type: T,
  opts: {
    timeoutMs?: number
    match?: (msg: Extract<ServerMessage, { type: T }>) => boolean
  } = {},
): Promise<Extract<ServerMessage, { type: T }>> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub()
      reject(Object.assign(new Error(`timeout waiting for ${type}`), { code: 'TIMEOUT' }))
    }, timeoutMs)
    const unsub = client.onMessage((msg) => {
      if (msg.type !== type) {
        if (msg.type === 'error') {
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
