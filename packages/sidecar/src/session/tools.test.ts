import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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
})
