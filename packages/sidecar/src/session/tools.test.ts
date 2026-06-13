import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTools } from './tools.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-tools-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function byName(root: string, name: string) {
  return buildTools(root).find((t) => t.name === name)!
}

describe('file tools', () => {
  it('write_file creates a file under root and read_file reads it back', async () => {
    const w = await byName(root, 'write_file').invoke({ path: '/index.html', content: '<h1>hi</h1>' })
    expect(readFileSync(join(root, 'index.html'), 'utf8')).toBe('<h1>hi</h1>')
    expect(String(w)).toMatch(/index\.html/)
    const r = await byName(root, 'read_file').invoke({ path: '/index.html' })
    expect(String(r)).toContain('<h1>hi</h1>')
  })

  it('edit_file replaces an exact string', async () => {
    writeFileSync(join(root, 'a.txt'), 'foo bar foo')
    await byName(root, 'edit_file').invoke({ path: '/a.txt', oldString: 'bar', newString: 'BAZ' })
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('foo BAZ foo')
  })

  it('ls lists immediate children', async () => {
    writeFileSync(join(root, 'x.txt'), '')
    mkdirSync(join(root, 'sub'))
    const out = String(await byName(root, 'ls').invoke({ path: '/' }))
    expect(out).toContain('x.txt')
    expect(out).toContain('sub')
  })

  it('rejects a path that escapes the root', async () => {
    await expect(byName(root, 'write_file').invoke({ path: '/../escape.txt', content: 'x' }))
      .resolves.toMatch(/escape|outside|root/i)
  })

  it('rejects reading through a symlink that escapes the root', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'hip-outside-'))
    writeFileSync(join(outside, 'secret.txt'), 'TOP SECRET')
    try {
      symlinkSync(outside, join(root, 'link')) // root/link -> outside
      const r = String(await byName(root, 'read_file').invoke({ path: '/link/secret.txt' }))
      expect(r).toMatch(/escapes|not found|error/i)
      expect(r).not.toContain('TOP SECRET')
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })

  it('rejects writing through a symlinked parent that escapes the root', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'hip-outside-'))
    try {
      symlinkSync(outside, join(root, 'link'))
      const w = String(await byName(root, 'write_file').invoke({ path: '/link/evil.txt', content: 'x' }))
      expect(w).toMatch(/escapes|error/i)
    } finally { rmSync(outside, { recursive: true, force: true }) }
  })

  it('grep skips node_modules', async () => {
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'pkg', 'a.js'), 'NEEDLE here')
    writeFileSync(join(root, 'app.js'), 'NEEDLE in app')
    const out = String(await byName(root, 'grep').invoke({ pattern: 'NEEDLE' }))
    expect(out).toContain('/app.js')
    expect(out).not.toContain('node_modules')
  })

  it('write_todos returns a one-line confirmation with the count', async () => {
    const out = String(
      await byName(root, 'write_todos').invoke({
        todos: [
          { content: 'read the spec', status: 'completed' },
          { content: 'implement the tool', status: 'in_progress' },
          { content: 'write tests', status: 'pending' },
        ],
      }),
    )
    expect(out).toMatch(/3/)
    expect(out).toMatch(/todo/i)
    expect(out.split('\n')).toHaveLength(1)
  })

  it('write_todos accepts an empty list (clears the plan)', async () => {
    const out = String(await byName(root, 'write_todos').invoke({ todos: [] }))
    expect(out).toMatch(/0/)
  })

  it('write_todos rejects an invalid status', async () => {
    await expect(
      byName(root, 'write_todos').invoke({ todos: [{ content: 'x', status: 'blocked' }] }),
    ).rejects.toThrow()
  })
})
