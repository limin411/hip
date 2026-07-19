import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acpReadTextFile,
  acpWriteTextFile,
  type FsBridgeContext,
} from './acp-fs-bridge.js'

let root: string
const dirs: string[] = []

function ctx(partial: Partial<FsBridgeContext> & { permissionMode: FsBridgeContext['permissionMode'] }): FsBridgeContext {
  return {
    cwd: root,
    readMaxBytes: 2_000_000,
    ...partial,
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acp-fs-'))
  dirs.push(root)
  writeFileSync(join(root, 'hello.txt'), 'line1\nline2\nline3\n')
})

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ok */ }
  }
})

describe('acpReadTextFile', () => {
  it('reads a file under edit jail', async () => {
    const r = await acpReadTextFile({ path: 'hello.txt' }, ctx({ permissionMode: 'edit' }))
    expect(r.content).toContain('line1')
  })

  it('supports 1-based line + limit', async () => {
    const r = await acpReadTextFile({ path: 'hello.txt', line: 2, limit: 1 }, ctx({ permissionMode: 'edit' }))
    expect(r.content).toBe('line2')
  })

  it('rejects jail escape under edit (../ outside root)', async () => {
    // hip tools treat leading-/ as project-root form; escape is via relative parent paths.
    await expect(
      acpReadTextFile({ path: '../outside-escape.txt' }, ctx({ permissionMode: 'edit' })),
    ).rejects.toMatchObject({ code: 'permission_denied', message: expect.stringContaining('ACP fs: permission denied') })
  })

  it('allows absolute outside path under full (same as resolveFull)', async () => {
    // full mode can reach outside project via absolute path
    const outside = join(root, '..', `outside-${Date.now()}.txt`)
    writeFileSync(outside, 'outside-body')
    dirs.push(outside) // not a dir; cleaned via unlink attempt below
    try {
      const r = await acpReadTextFile({ path: outside }, ctx({ permissionMode: 'full' }))
      expect(r.content).toBe('outside-body')
    } finally {
      try { rmSync(outside, { force: true }) } catch { /* ok */ }
    }
  })

  it('returns not_found for missing file', async () => {
    await expect(
      acpReadTextFile({ path: 'nope.txt' }, ctx({ permissionMode: 'edit' })),
    ).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('ACP fs: not found') })
  })

  it('returns too_large when file exceeds readMaxBytes', async () => {
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(100))
    await expect(
      acpReadTextFile({ path: 'big.txt' }, ctx({ permissionMode: 'edit', readMaxBytes: 10 })),
    ).rejects.toMatchObject({
      code: 'too_large',
      message: expect.stringMatching(/ACP fs: file exceeds read limit \(10 bytes\)/),
    })
  })
})

describe('acpWriteTextFile', () => {
  it('denies write in chat mode', async () => {
    await expect(
      acpWriteTextFile({ path: 'w.txt', content: 'nope' }, ctx({ permissionMode: 'chat' })),
    ).rejects.toMatchObject({
      code: 'permission_denied',
      message: expect.stringContaining('ACP fs: permission denied'),
    })
    expect(() => readFileSync(join(root, 'w.txt'))).toThrow()
  })

  it('allows write in edit mode inside jail', async () => {
    await acpWriteTextFile({ path: 'out.txt', content: 'hi' }, ctx({ permissionMode: 'edit' }))
    expect(readFileSync(join(root, 'out.txt'), 'utf8')).toBe('hi')
  })

  it('rejects write outside jail in edit mode', async () => {
    await expect(
      acpWriteTextFile({ path: '../escape.txt', content: 'x' }, ctx({ permissionMode: 'edit' })),
    ).rejects.toMatchObject({
      code: 'permission_denied',
      message: expect.stringContaining('ACP fs: permission denied'),
    })
  })

  it('allows write outside cwd in full mode', async () => {
    const outside = join(root, '..', `full-write-${Date.now()}.txt`)
    try {
      await acpWriteTextFile({ path: outside, content: 'full' }, ctx({ permissionMode: 'full' }))
      expect(readFileSync(outside, 'utf8')).toBe('full')
    } finally {
      try { rmSync(outside, { force: true }) } catch { /* ok */ }
    }
  })

  it('reads under chat jail (write denied but read ok)', async () => {
    const r = await acpReadTextFile({ path: 'hello.txt' }, ctx({ permissionMode: 'chat' }))
    expect(r.content).toContain('line1')
  })
})

describe('symlink escape (edit)', () => {
  it('rejects read through symlink that escapes root', async () => {
    // Skip on platforms without symlink privilege
    const outsideDir = mkdtempSync(join(tmpdir(), 'acp-fs-out-'))
    dirs.push(outsideDir)
    writeFileSync(join(outsideDir, 'secret.txt'), 'secret')
    const link = join(root, 'link-out')
    try {
      symlinkSync(outsideDir, link)
    } catch {
      return // environment cannot create symlinks
    }
    await expect(
      acpReadTextFile({ path: 'link-out/secret.txt' }, ctx({ permissionMode: 'edit' })),
    ).rejects.toMatchObject({ code: 'permission_denied' })
  })
})
