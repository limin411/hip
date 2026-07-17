import { connectSidecar, waitForServerMessage } from '../sidecar/connect.js'
import type { SessionCmdOpts } from './session.js'

export interface WorktreeCmdOpts extends SessionCmdOpts {
  sessionId: string
  branch?: string
  createBranch?: boolean
  baseRef?: string
  pathKey?: string
  worktreePath?: string
}

async function resolveSessionPrefix(
  partial: string,
  conn: Awaited<ReturnType<typeof connectSidecar>>,
): Promise<string | null> {
  const listP = waitForServerMessage(conn.client, 'session:list:result', { timeoutMs: 10_000 })
  conn.client.send({ type: 'session:list' })
  const list = await listP
  if (list.sessions.some((s) => s.id === partial)) return partial
  const matches = list.sessions.filter((s) => s.id.startsWith(partial))
  if (matches.length === 1) return matches[0]!.id
  if (matches.length > 1) {
    process.stderr.write(`ambiguous session id prefix "${partial}"\n`)
    return null
  }
  // Allow raw id even if list is stale
  return partial
}

export async function worktreeCreate(opts: WorktreeCmdOpts): Promise<number> {
  if (!opts.branch) {
    process.stderr.write('branch required\n')
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
    const sessionId = await resolveSessionPrefix(opts.sessionId, conn)
    if (!sessionId) return 1
    const resultP = waitForServerMessage(conn.client, 'git:worktree:create:result', {
      timeoutMs: 60_000,
      match: (m) => m.sessionId === sessionId,
    })
    conn.client.send({
      type: 'git:worktree:create',
      sessionId,
      branch: opts.branch,
      ...(opts.createBranch ? { createBranch: true } : {}),
      ...(opts.baseRef ? { baseRef: opts.baseRef } : {}),
      ...(opts.pathKey ? { pathKey: opts.pathKey } : {}),
    })
    const res = await resultP
    if (opts.json) {
      process.stdout.write(JSON.stringify(res) + '\n')
    } else if (res.ok) {
      process.stdout.write(`${res.path ?? ''}\n`)
    } else {
      process.stderr.write(`${res.error ?? 'create failed'}\n`)
    }
    return res.ok ? 0 : 1
  } catch (err) {
    process.stderr.write(`[worktree create] ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  } finally {
    await conn.close()
  }
}

export async function worktreeList(opts: WorktreeCmdOpts): Promise<number> {
  const conn = await connectSidecar({
    useUserHip: opts.useUserHip !== false,
    allowNoKey: true,
    port: opts.port,
    token: opts.token,
    sidecarLog: opts.sidecarLog,
    sidecar: opts.port || opts.token || opts.sidecarLog ? 'auto' : 'spawn',
  })
  try {
    const sessionId = await resolveSessionPrefix(opts.sessionId, conn)
    if (!sessionId) return 1
    const resultP = waitForServerMessage(conn.client, 'git:worktree:list:result', {
      timeoutMs: 15_000,
      match: (m) => m.sessionId === sessionId,
    })
    conn.client.send({ type: 'git:worktree:list', sessionId })
    const res = await resultP
    if (opts.json) {
      process.stdout.write(JSON.stringify(res.worktrees) + '\n')
    } else if (res.worktrees.length === 0) {
      process.stdout.write('(no worktrees)\n')
    } else {
      for (const w of res.worktrees) {
        process.stdout.write(`${w.branch || '(detached)'}\t${w.path}\t${w.head.slice(0, 8)}\n`)
      }
    }
    return 0
  } catch (err) {
    process.stderr.write(`[worktree list] ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  } finally {
    await conn.close()
  }
}

export async function worktreeRemove(opts: WorktreeCmdOpts): Promise<number> {
  if (!opts.worktreePath) {
    process.stderr.write('path required\n')
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
    const sessionId = await resolveSessionPrefix(opts.sessionId, conn)
    if (!sessionId) return 1
    const resultP = waitForServerMessage(conn.client, 'git:worktree:remove:result', {
      timeoutMs: 30_000,
      match: (m) => m.sessionId === sessionId,
    })
    conn.client.send({
      type: 'git:worktree:remove',
      sessionId,
      worktreePath: opts.worktreePath,
    })
    const res = await resultP
    if (opts.json) {
      process.stdout.write(JSON.stringify(res) + '\n')
    } else if (res.ok) {
      process.stdout.write('ok\n')
    } else {
      process.stderr.write(`${res.error ?? 'remove failed'}\n`)
    }
    return res.ok ? 0 : 1
  } catch (err) {
    process.stderr.write(`[worktree remove] ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  } finally {
    await conn.close()
  }
}

