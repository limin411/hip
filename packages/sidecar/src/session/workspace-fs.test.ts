import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveWithin, lsDir, readForPreview } from './workspace-fs.js'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-wsfs-'))
  await fs.writeFile(path.join(root, 'README.md'), '# Hello\n\nWorld')
  await fs.mkdir(path.join(root, 'src'))
  await fs.writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1')
  // hidden entries that must never surface in the tree
  await fs.mkdir(path.join(root, '.git'))
  await fs.writeFile(path.join(root, '.env'), 'SECRET=1')
  // 1x1 PNG
  await fs.writeFile(path.join(root, 'logo.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('resolveWithin', () => {
  it('allows paths inside root', () => {
    expect(resolveWithin(root, path.join(root, 'src/a.ts'))).toBe(path.join(root, 'src/a.ts'))
  })
  it('rejects traversal escaping root', () => {
    expect(() => resolveWithin(root, path.join(root, '../../etc/passwd'))).toThrow()
  })
  it('rejects an unrelated absolute path', () => {
    expect(() => resolveWithin(root, '/etc/passwd')).toThrow()
  })
})

describe('lsDir', () => {
  it('lists immediate children, dirs first, with absolute paths', async () => {
    const entries = await lsDir(root, root)
    expect(entries[0]).toMatchObject({ name: 'src', isDir: true })
    expect(entries.slice(1).map((e) => e.name).sort()).toEqual(['README.md', 'logo.png'])
    expect(entries.every((e) => path.isAbsolute(e.path))).toBe(true)
  })
  it('hides dotfiles and dot-directories (e.g. .git, .env)', async () => {
    const entries = await lsDir(root, root)
    expect(entries.map((e) => e.name)).not.toContain('.git')
    expect(entries.map((e) => e.name)).not.toContain('.env')
    expect(entries.every((e) => !e.name.startsWith('.'))).toBe(true)
  })
})

describe('readForPreview', () => {
  it('reads text as utf8 with a mimeType', async () => {
    const r = await readForPreview(root, path.join(root, 'README.md'))
    expect(r).toMatchObject({ encoding: 'utf8', mimeType: 'text/markdown' })
    expect((r as { content: string }).content).toContain('# Hello')
  })
  it('reads images as base64 with an image mimeType', async () => {
    const r = await readForPreview(root, path.join(root, 'logo.png'))
    expect(r).toMatchObject({ encoding: 'base64', mimeType: 'image/png' })
  })
  it('throws when the path escapes root', async () => {
    await expect(readForPreview(root, '/etc/passwd')).rejects.toThrow()
  })
  it('throws when an in-cwd symlink points outside root (no content leak)', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-outside-'))
    await fs.writeFile(path.join(outside, 'secret.txt'), 'TOP-SECRET')
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'))
    try {
      await expect(readForPreview(root, path.join(root, 'link.txt'))).rejects.toThrow()
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})
