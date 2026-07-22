import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { real } from './helpers.js'

describe('real() path resolution', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-real-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('maps project-root form /file.html under root', async () => {
    const abs = await real(root, '/out.html')
    expect(abs).toBe(path.join(root, 'out.html'))
  })

  it('maps relative paths under root', async () => {
    const abs = await real(root, 'docs/a.md')
    expect(abs).toBe(path.join(root, 'docs/a.md'))
  })

  it('keeps absolute paths already under root for non-existent leaves (write target)', async () => {
    // Regression: previously realpath(leaf) failed → path was re-joined as
    // root + "Users/.../file" and preview looked for the original abs path.
    const target = path.join(root, 'report.md')
    const abs = await real(root, target)
    expect(abs).toBe(path.resolve(target))
    // Must not nest root into itself
    expect(abs.startsWith(path.join(root, path.basename(root)))).toBe(false)
    expect(abs).not.toContain(path.join(root, root.replace(/^\//, '')))
  })

  it('keeps absolute paths under root when the file already exists', async () => {
    const target = path.join(root, 'exists.md')
    await fs.writeFile(target, '# hi\n')
    const abs = await real(root, target)
    expect(path.resolve(abs)).toBe(path.resolve(target))
  })

  it('jails absolute paths outside the root (POSIX-style leading slash)', async () => {
    const abs = await real(root, '/etc/passwd')
    // Sandboxed: becomes <root>/etc/passwd, never the real system file.
    expect(abs.startsWith(path.resolve(root) + path.sep) || abs.startsWith(root + path.sep)).toBe(true)
    expect(abs).toContain(`${path.sep}etc${path.sep}passwd`)
    expect(abs).not.toBe('/etc/passwd')
  })
})
