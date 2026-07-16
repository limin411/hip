import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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

  it("chat mode drops run_script even when an approval fn is wired (a read-only agent must not mutate)", () => {
    const names = buildTools(root, undefined, root, undefined, {
      permissionMode: 'chat',
      requestApproval: async () => ({ kind: 'allow_once' }),
    }).map((t) => t.name)
    expect(names).not.toContain('run_script')
  })

  it("chat mode omits git mutation tools (commit/branch/worktree)", () => {
    const names = buildTools(root, undefined, root, undefined, { permissionMode: 'chat' }).map((t) => t.name)
    expect(names).not.toContain('git_commit')
    expect(names).not.toContain('git_create_branch')
    expect(names).not.toContain('git_switch_branch')
    expect(names).not.toContain('git_worktree_create')
    expect(names).not.toContain('git_worktree_list')
    expect(names).not.toContain('git_worktree_remove')
  })

  it("edit mode registers git tools when cwd is set", () => {
    const names = buildTools(root, undefined, root, undefined, { permissionMode: 'edit' }).map((t) => t.name)
    expect(names).toContain('git_commit')
    expect(names).toContain('git_create_branch')
    expect(names).toContain('git_switch_branch')
    expect(names).toContain('git_worktree_create')
    expect(names).toContain('git_worktree_list')
    expect(names).toContain('git_worktree_remove')
  })

  it("edit mode keeps run_script when an approval fn is wired", () => {
    const names = buildTools(root, undefined, root, undefined, {
      permissionMode: 'edit',
      requestApproval: async () => ({ kind: 'allow_once' }),
    }).map((t) => t.name)
    expect(names).toContain('run_script')
  })

  it("full mode keeps run_script when an approval fn is wired", () => {
    const names = buildTools(root, undefined, root, undefined, {
      permissionMode: 'full',
      requestApproval: async () => ({ kind: 'allow_once' }),
    }).map((t) => t.name)
    expect(names).toContain('run_script')
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

  it("full mode maps bare / under cwd (project root), never the OS drive/FS root alone", async () => {
    writeFileSync(join(root, 'root-marker.txt'), 'ROOT')
    const tools = buildTools(root, undefined, root, undefined, { permissionMode: 'full' })
    const lsRoot = String(await byName(tools, 'ls').invoke({ path: '/' }))
    expect(lsRoot).toContain('root-marker.txt')
    expect(lsRoot).not.toMatch(/ENOTDIR|Error:/)
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

  it("full mode glob scans the un-jailed root (cwd) and returns paths relative to it", async () => {
    // cwd is a parent dir; root (the file-tool jail base) is a child of it. In full mode glob must
    // scan cwd (un-jailed), not the jail root — so a sibling file above `root` is found.
    const cwd = mkdtempSync(join(tmpdir(), 'hip-fullglob-cwd-'))
    try {
      const sub = join(cwd, 'inner')
      mkdirSync(sub)
      writeFileSync(join(cwd, 'outside.md'), '# out', 'utf8') // above the jail root
      writeFileSync(join(sub, 'inside.md'), '# in', 'utf8')   // inside the jail root
      const tools = buildTools(sub, undefined, cwd, undefined, { permissionMode: 'full' })
      const out = String(await byName(tools, 'glob').invoke({ pattern: '**/*.md' }))
      // walk + rel are based on cwd (the un-jailed root): both the above-root and in-root files appear,
      // relative to cwd.
      expect(out).toContain('/outside.md')
      expect(out).toContain('/inner/inside.md')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it("edit mode glob stays jailed to root (a file above root is NOT scanned)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hip-editglob-cwd-'))
    try {
      const sub = join(cwd, 'inner')
      mkdirSync(sub)
      writeFileSync(join(cwd, 'outside.md'), '# out', 'utf8') // above the jail root
      writeFileSync(join(sub, 'inside.md'), '# in', 'utf8')   // inside the jail root (sub == root)
      const tools = buildTools(sub, undefined, cwd, undefined, { permissionMode: 'edit' })
      const out = String(await byName(tools, 'glob').invoke({ pattern: '**/*.md' }))
      // edit mode walks `root` (== sub): only the in-root file is found; the above-root file is invisible.
      expect(out).toContain('/inside.md')
      expect(out).not.toContain('outside.md')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
