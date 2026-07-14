import type { Message, SessionSummary } from '@hip/protocol'
import { connectSidecar, waitForServerMessage } from '../sidecar/connect.js'
import { defaultUserDbPath } from '../sidecar/user-hip.js'

export interface SessionCmdOpts {
  json?: boolean
  useUserHip?: boolean
  port?: number
  token?: string
  sidecarLog?: string
  limit?: number
  yes?: boolean
  deleteDerivedMemories?: boolean
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toISOString().replace('T', ' ').slice(0, 19)
  } catch {
    return String(ts)
  }
}

function printTable(sessions: SessionSummary[]): void {
  if (sessions.length === 0) {
    process.stdout.write('(no sessions)\n')
    return
  }
  const rows = sessions.map((s) => ({
    id: s.id.slice(0, 8),
    fullId: s.id,
    surface: s.surface,
    msgs: String(s.messageCount),
    updated: fmtTime(s.updatedAt),
    title: (s.title || '(untitled)').slice(0, 40),
    preview: (s.preview || '').replace(/\s+/g, ' ').slice(0, 48),
  }))
  process.stdout.write(
    `${'ID'.padEnd(10)} ${'SURF'.padEnd(6)} ${'MSGS'.padStart(4)} ${'UPDATED'.padEnd(20)} TITLE\n`,
  )
  for (const r of rows) {
    process.stdout.write(
      `${r.id.padEnd(10)} ${r.surface.padEnd(6)} ${r.msgs.padStart(4)} ${r.updated.padEnd(20)} ${r.title}\n`,
    )
    if (r.preview) process.stdout.write(`  ${r.preview}\n`)
  }
  process.stdout.write(`\n${sessions.length} session(s)  db≈ ${defaultUserDbPath()}\n`)
  process.stdout.write('(full id: hip session show <id>)\n')
}

export async function sessionList(opts: SessionCmdOpts = {}): Promise<number> {
  const conn = await connectSidecar({
    useUserHip: opts.useUserHip !== false,
    allowNoKey: true,
    port: opts.port,
    token: opts.token,
    sidecarLog: opts.sidecarLog,
    sidecar: opts.port || opts.token || opts.sidecarLog ? 'auto' : 'spawn',
  })
  try {
    const resultP = waitForServerMessage(conn.client, 'session:list:result', { timeoutMs: 10_000 })
    conn.client.send({ type: 'session:list' })
    const res = await resultP
    if (opts.json) {
      process.stdout.write(JSON.stringify(res.sessions) + '\n')
    } else {
      printTable(res.sessions)
    }
    return 0
  } catch (err) {
    process.stderr.write(`[session list] ${err instanceof Error ? err.message : String(err)}\n`)
    return 3
  } finally {
    await conn.close()
  }
}

function resolveSessionId(partial: string, sessions: SessionSummary[]): string | null {
  if (sessions.some((s) => s.id === partial)) return partial
  const matches = sessions.filter((s) => s.id.startsWith(partial))
  if (matches.length === 1) return matches[0]!.id
  if (matches.length > 1) {
    process.stderr.write(`ambiguous id prefix "${partial}" (${matches.length} matches)\n`)
    return null
  }
  return null
}

export async function sessionShow(idArg: string, opts: SessionCmdOpts = {}): Promise<number> {
  const conn = await connectSidecar({
    useUserHip: opts.useUserHip !== false,
    allowNoKey: true,
    port: opts.port,
    token: opts.token,
    sidecarLog: opts.sidecarLog,
    sidecar: opts.port || opts.token || opts.sidecarLog ? 'auto' : 'spawn',
  })
  try {
    const listP = waitForServerMessage(conn.client, 'session:list:result', { timeoutMs: 10_000 })
    conn.client.send({ type: 'session:list' })
    const list = await listP
    const id = resolveSessionId(idArg, list.sessions) ?? idArg

    const loadedP = waitForServerMessage(conn.client, 'session:loaded', {
      timeoutMs: 15_000,
      match: (m) => m.sessionId === id,
    })
    conn.client.send({ type: 'session:load', sessionId: id })
    const loaded = await loadedP

    const limit = opts.limit && opts.limit > 0 ? opts.limit : undefined
    const messages = limit ? loaded.messages.slice(-limit) : loaded.messages

    if (opts.json) {
      process.stdout.write(
        JSON.stringify({
          sessionId: loaded.sessionId,
          config: loaded.config,
          messageCount: loaded.messages.length,
          messages,
        }) + '\n',
      )
      return 0
    }

    process.stdout.write(`session ${loaded.sessionId}\n`)
    if (loaded.config) {
      process.stdout.write(
        `model ${loaded.config.llmProvider}/${loaded.config.model}  cwd=${loaded.config.cwd ?? '—'}  surface=${loaded.config.surface ?? '—'}\n`,
      )
    }
    process.stdout.write(`messages ${loaded.messages.length}${limit ? ` (showing last ${messages.length})` : ''}\n\n`)
    for (const m of messages) {
      printMessage(m)
    }
    return 0
  } catch (err) {
    process.stderr.write(`[session show] ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  } finally {
    await conn.close()
  }
}

function printMessage(m: Message): void {
  const role = m.role.padEnd(9)
  const ts = fmtTime(m.timestamp)
  const content = (m.content || '').trim()
  const head = content.slice(0, 200)
  const more = content.length > 200 ? '…' : ''
  process.stdout.write(`[${ts}] ${role} ${head}${more}\n`)
  if (m.stopped) process.stdout.write('  (stopped)\n')
}

export async function sessionDelete(idArg: string, opts: SessionCmdOpts = {}): Promise<number> {
  if (!opts.yes) {
    process.stderr.write('Refusing to delete without --yes\n')
    return 2
  }
  const conn = await connectSidecar({
    useUserHip: opts.useUserHip !== false,
    allowNoKey: true,
    port: opts.port,
    token: opts.token,
    sidecarLog: opts.sidecarLog,
    sidecar: opts.port || opts.token || opts.sidecarLog ? 'auto' : 'spawn',
  })
  try {
    const listP = waitForServerMessage(conn.client, 'session:list:result', { timeoutMs: 10_000 })
    conn.client.send({ type: 'session:list' })
    const list = await listP
    const id = resolveSessionId(idArg, list.sessions)
    if (!id) {
      process.stderr.write(`session not found: ${idArg}\n`)
      return 1
    }

    const deletedP = waitForServerMessage(conn.client, 'session:deleted', {
      timeoutMs: 15_000,
      match: (m) => m.sessionId === id,
    })
    conn.client.send({
      type: 'session:delete',
      sessionId: id,
      deleteDerivedMemories: opts.deleteDerivedMemories,
    })
    await deletedP
    if (opts.json) {
      process.stdout.write(JSON.stringify({ deleted: id }) + '\n')
    } else {
      process.stdout.write(`deleted ${id}\n`)
    }
    return 0
  } catch (err) {
    process.stderr.write(`[session delete] ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  } finally {
    await conn.close()
  }
}
