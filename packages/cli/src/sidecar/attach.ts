import { readFileSync, existsSync } from 'node:fs'
import { parseHandshakeFromLog } from './resolve-entry.js'

export interface AttachTarget {
  port: number
  token: string
}

export function resolveAttachTarget(opts: {
  port?: number
  token?: string
  sidecarLog?: string
  env?: NodeJS.ProcessEnv
}): AttachTarget {
  const env = opts.env ?? process.env
  const token = opts.token?.trim() || env.HIP_SIDECAR_TOKEN?.trim()
  const portRaw = opts.port ?? (env.HIP_SIDECAR_URL ? undefined : Number(env.HIP_SIDECAR_PORT))
  let port = typeof portRaw === 'number' && Number.isFinite(portRaw) ? portRaw : undefined

  if (env.HIP_SIDECAR_URL?.trim()) {
    try {
      const u = new URL(env.HIP_SIDECAR_URL)
      port = port ?? Number(u.port)
      const t = u.searchParams.get('token')
      if (t && !token) {
        return { port: port!, token: t }
      }
    } catch {
      /* ignore bad url */
    }
  }

  if (port && token) return { port, token }

  const logPath = opts.sidecarLog?.trim() || env.HIP_SIDECAR_LOG?.trim()
  if (logPath && existsSync(logPath)) {
    const text = readFileSync(logPath, 'utf8')
    const hit = parseHandshakeFromLog(text)
    if (hit) {
      return {
        port: port ?? hit.port,
        token: token ?? hit.token,
      }
    }
  }

  if (port && !token) {
    throw Object.assign(new Error('attach requires token (--token / HIP_SIDECAR_TOKEN / --sidecar-log)'), {
      code: 'WS_AUTH_FAILED',
    })
  }
  throw Object.assign(new Error('attach requires --port/--token or --sidecar-log with handshake line'), {
    code: 'WS_AUTH_FAILED',
  })
}
