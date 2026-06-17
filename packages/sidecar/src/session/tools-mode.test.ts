import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildTools } from './tools.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-toolsmode-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function byName(tools: ReturnType<typeof buildTools>, name: string) {
  return tools.find((t) => t.name === name)!
}

describe('buildTools permissionMode — registration', () => {
  it("chat mode omits write_file and edit_file but keeps read_file/ls/glob/grep", () => {
    const tools = buildTools(root, undefined, root, undefined, { permissionMode: 'chat' })
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('write_file')
    expect(names).not.toContain('edit_file')
    expect(names).toContain('read_file')
    expect(names).toContain('ls')
    expect(names).toContain('glob')
    expect(names).toContain('grep')
  })

  it("edit mode registers write_file and edit_file", () => {
    const names = buildTools(root, undefined, root, undefined, { permissionMode: 'edit' }).map((t) => t.name)
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
  })

  it("full mode registers write_file and edit_file", () => {
    const names = buildTools(root, undefined, root, undefined, { permissionMode: 'full' }).map((t) => t.name)
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
  })

  it("default (no permissionMode) behaves like edit — write/edit present", () => {
    const names = buildTools(root, undefined, root, undefined, {}).map((t) => t.name)
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
  })

  it("an unknown permissionMode value falls back to edit (write/edit present)", () => {
    const names = buildTools(root, undefined, root, undefined, { permissionMode: 'bogus' as never }).map((t) => t.name)
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
  })
})

describe('buildTools permissionMode — path jail', () => {
  it("edit mode jails write_file to the project root (an absolute path outside root is mapped under root, not created at target)", async () => {
    const outside = mkdtempSync(join(tmpdir(), 'hip-outside-'))
    try {
      const target = join(outside, 'escaped.txt')
      const tools = buildTools(root, undefined, root, undefined, { permissionMode: 'edit' })
      const out = String(await byName(tools, 'write_file').invoke({ path: target, content: 'X' }))
      // edit treats `path` as relative-to-root; the absolute outside path is mapped under root, NOT created at `target`.
      expect(existsSync(target)).toBe(false)
      expect(out).not.toMatch(/Error/)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("full mode writes to an absolute path OUTSIDE the project root as-is", async () => {
    const outside = mkdtempSync(join(tmpdir(), 'hip-outside-'))
    try {
      const target = join(outside, 'escaped.txt')
      const tools = buildTools(root, undefined, root, undefined, { permissionMode: 'full' })
      const out = String(await byName(tools, 'write_file').invoke({ path: target, content: 'HELLO FULL' }))
      expect(out).toMatch(/wrote/)
      expect(existsSync(target)).toBe(true)
      expect(readFileSync(target, 'utf8')).toBe('HELLO FULL')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("full mode reads an absolute file OUTSIDE the project root", async () => {
    const outside = mkdtempSync(join(tmpdir(), 'hip-outside-'))
    try {
      const secret = join(outside, 'secret.txt')
      writeFileSync(secret, 'TOP SECRET', 'utf8')
      const tools = buildTools(root, undefined, root, undefined, { permissionMode: 'full' })
      const out = String(await byName(tools, 'read_file').invoke({ path: secret }))
      expect(out).toBe('TOP SECRET')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("full mode resolves a relative path against cwd", async () => {
    const tools = buildTools(root, undefined, root, undefined, { permissionMode: 'full' })
    const out = String(await byName(tools, 'write_file').invoke({ path: 'rel.txt', content: 'R' }))
    expect(out).toMatch(/wrote/)
    expect(readFileSync(join(root, 'rel.txt'), 'utf8')).toBe('R')
  })
})
