import type { ExtensionRegistrySnapshot, ServerMessage } from '@hip/protocol'
import { connectSidecar, waitForServerMessage } from '../sidecar/connect.js'

export interface ExtensionCmdOpts {
  json?: boolean
  cwd?: string
  port?: number
  token?: string
  sidecarLog?: string
}

function reqId(): string {
  return `cli-ext-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function printHuman(snapshot: ExtensionRegistrySnapshot, notable: unknown[]): void {
  const activeSkills = snapshot.skills.filter((s) => s.active)
  const inactiveSkills = snapshot.skills.filter((s) => !s.active)
  const activeMcp = snapshot.mcpServers.filter((m) => m.active)
  const inactiveMcp = snapshot.mcpServers.filter((m) => !m.active)

  process.stdout.write('hip extension inspect\n')
  process.stdout.write(`generatedAt: ${new Date(snapshot.generatedAt).toISOString()}\n\n`)

  process.stdout.write(`Skills active (${activeSkills.length}):\n`)
  for (const s of activeSkills) {
    const scope = s.winner.kind.replace(/_skill$/, '')
    const plug = s.winner.pluginId ? ` plugin=${s.winner.pluginId}` : ''
    process.stdout.write(`  ✓ ${s.id}  [${scope}]${plug}  ${s.meta.name}\n`)
  }
  if (inactiveSkills.length > 0) {
    process.stdout.write(`Skills inactive (${inactiveSkills.length}):\n`)
    for (const s of inactiveSkills.slice(0, 20)) {
      process.stdout.write(`  · ${s.id}  [${s.winner.kind}]\n`)
    }
    if (inactiveSkills.length > 20) process.stdout.write(`  … +${inactiveSkills.length - 20} more\n`)
  }

  process.stdout.write(`\nMCP active (${activeMcp.length}):\n`)
  for (const m of activeMcp) {
    const src = m.winner.kind.replace(/_mcp$/, '')
    const plug = m.winner.pluginId ? ` plugin=${m.winner.pluginId}` : ''
    process.stdout.write(`  ✓ ${m.id}  [${src}]${plug}  ${m.config.name}  fp=${m.fingerprint}\n`)
  }
  if (inactiveMcp.length > 0) {
    process.stdout.write(`MCP inactive (${inactiveMcp.length}):\n`)
    for (const m of inactiveMcp.slice(0, 20)) {
      const why = m.shadowedBy
        ? `shadowed by ${m.shadowedBy.kind}${m.shadowedBy.configId ? `:${m.shadowedBy.configId}` : ''}`
        : 'inactive'
      process.stdout.write(`  · ${m.id}  ${why}  fp=${m.fingerprint}\n`)
    }
    if (inactiveMcp.length > 20) process.stdout.write(`  … +${inactiveMcp.length - 20} more\n`)
  }

  const conflicts = snapshot.conflicts
  process.stdout.write(`\nConflicts total=${conflicts.length} notable=${Array.isArray(notable) ? notable.length : 0}\n`)
  for (const c of conflicts.slice(0, 30)) {
    process.stdout.write(
      `  ! ${c.kind}: winner=${c.winner.kind}${c.winner.configId ? `:${c.winner.configId}` : ''} ` +
        `loser=${c.loser.kind}${c.loser.configId ? `:${c.loser.configId}` : ''}` +
        (c.fingerprint ? ` fp=${c.fingerprint}` : '') +
        '\n',
    )
  }
  if (conflicts.length > 30) process.stdout.write(`  … +${conflicts.length - 30} more\n`)
}

/**
 * Inspect extension registry via product sidecar (attach to running hip app).
 */
export async function extensionInspect(opts: ExtensionCmdOpts = {}): Promise<number> {
  const requestId = reqId()
  const cwd = opts.cwd?.trim() || process.cwd()

  try {
    const conn = await connectSidecar({
      useUserHip: true,
      allowNoKey: true,
      port: opts.port,
      token: opts.token,
      sidecarLog: opts.sidecarLog,
      sidecar: opts.port || opts.token || opts.sidecarLog ? 'auto' : 'attach',
      clientRole: 'cli',
    })
    try {
      const resultP = waitForServerMessage(conn.client, 'extension:inspect:result', {
        timeoutMs: 15_000,
        match: (m) => m.requestId === requestId,
      })
      conn.client.send({ type: 'extension:inspect', requestId, cwd })
      const res = (await resultP) as Extract<ServerMessage, { type: 'extension:inspect:result' }>
      if (!res.ok || !res.snapshot) {
        process.stderr.write(`[extension inspect] ${res.error ?? 'failed'}\n`)
        return 3
      }
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            {
              snapshot: res.snapshot,
              notableConflicts: res.notableConflicts ?? [],
            },
            null,
            2,
          ) + '\n',
        )
      } else {
        printHuman(res.snapshot, res.notableConflicts ?? [])
      }
      return 0
    } finally {
      await conn.close()
    }
  } catch (err) {
    const code = (err as { code?: string }).code
    process.stderr.write(
      `[extension inspect] ${code ? code + ' ' : ''}${err instanceof Error ? err.message : String(err)}\n`,
    )
    if (code === 'APP_NOT_RUNNING') {
      process.stderr.write('Start the hip desktop app, then retry.\n')
    }
    return 3
  }
}
