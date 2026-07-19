/**
 * ACP client FS bridge: real read/write with hip path-jail alignment.
 * Modes: chat → real jail + deny write; edit → real jail + allow write;
 * full → same un-jailed resolveFull as hip tools (no extra symlink guard).
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { PermissionMode } from '@hip/protocol'
import { real, resolveFull } from '../tools/helpers.js'

export type AcpFsErrorCode = 'permission_denied' | 'not_found' | 'too_large' | 'io_error'

export class AcpFsError extends Error {
  constructor(
    readonly code: AcpFsErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AcpFsError'
  }
}

export interface FsBridgeContext {
  /** Absolute session cwd; chat surface = scratch path from SessionConfig.cwd */
  cwd: string
  permissionMode: PermissionMode
  readMaxBytes: number
}

/** Stable message prefixes for agent dogfood / taxonomy. */
export function acpFsMessage(code: AcpFsErrorCode, detail: string): string {
  switch (code) {
    case 'permission_denied':
      return `ACP fs: permission denied: ${detail}`
    case 'not_found':
      return `ACP fs: not found: ${detail}`
    case 'too_large':
      return `ACP fs: file exceeds read limit (${detail} bytes)`
    case 'io_error':
      return `ACP fs: io error: ${detail}`
  }
}

function deny(pathHint: string): never {
  throw new AcpFsError('permission_denied', acpFsMessage('permission_denied', pathHint))
}

/** Resolve path for the given permission mode (shared with hip tools policy). */
export async function resolveAcpFsPath(
  mode: PermissionMode,
  cwd: string,
  p: string,
): Promise<string> {
  if (mode === 'full') return resolveFull(cwd, p)
  // chat + edit: real() jail + symlink check
  return real(cwd, p)
}

export async function acpReadTextFile(
  req: { path: string; line?: number | null; limit?: number | null },
  ctx: FsBridgeContext,
): Promise<{ content: string }> {
  let abs: string
  try {
    abs = await resolveAcpFsPath(ctx.permissionMode, ctx.cwd, req.path)
  } catch {
    deny(req.path)
  }

  let raw: string
  try {
    const st = await fs.stat(abs)
    if (st.size > ctx.readMaxBytes) {
      throw new AcpFsError(
        'too_large',
        acpFsMessage('too_large', String(ctx.readMaxBytes)),
      )
    }
    raw = await fs.readFile(abs, 'utf8')
  } catch (e: unknown) {
    if (e instanceof AcpFsError) throw e
    const err = e as NodeJS.ErrnoException
    if (err?.code === 'ENOENT') {
      throw new AcpFsError('not_found', acpFsMessage('not_found', req.path))
    }
    throw new AcpFsError(
      'io_error',
      acpFsMessage('io_error', err?.message ?? String(e)),
    )
  }

  // Belt-and-suspenders: UTF-8 expansion can exceed byte size of non-utf8 encodings; re-check.
  if (Buffer.byteLength(raw, 'utf8') > ctx.readMaxBytes) {
    throw new AcpFsError(
      'too_large',
      acpFsMessage('too_large', String(ctx.readMaxBytes)),
    )
  }

  // ACP 1-based line + max lines (no silent truncate of whole-file reads beyond limit above).
  const line = req.line
  const limit = req.limit
  if ((line != null && line > 0) || (limit != null && limit > 0)) {
    const lines = raw.split('\n')
    const start = line != null && line > 0 ? Math.floor(line) - 1 : 0
    const end =
      limit != null && limit > 0
        ? Math.min(lines.length, start + Math.floor(limit))
        : lines.length
    raw = lines.slice(start, end).join('\n')
  }

  return { content: raw }
}

export async function acpWriteTextFile(
  req: { path: string; content: string },
  ctx: FsBridgeContext,
): Promise<Record<string, never>> {
  if (ctx.permissionMode === 'chat') {
    deny(req.path)
  }

  let abs: string
  try {
    abs = await resolveAcpFsPath(ctx.permissionMode, ctx.cwd, req.path)
  } catch {
    deny(req.path)
  }

  try {
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, req.content, 'utf8')
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    if (err?.code === 'ENOENT') {
      throw new AcpFsError('not_found', acpFsMessage('not_found', req.path))
    }
    throw new AcpFsError(
      'io_error',
      acpFsMessage('io_error', err?.message ?? String(e)),
    )
  }
  return {}
}
