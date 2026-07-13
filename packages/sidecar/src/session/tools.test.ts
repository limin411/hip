import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildTools } from './tools.js'

const execFileP = promisify(execFile)
const git = (cwd: string, ...args: string[]) => execFileP('git', args, { cwd })
async function makeRepo(dir: string): Promise<void> {
  await git(dir, 'init')
  await git(dir, 'add', '-A')
  await git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init', '--allow-empty')
  await git(dir, 'branch', '-m', 'main')
}
function byNameCwd(root: string, name: string) {
  return buildTools(root, undefined, root).find((t) => t.name === name)!
}

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

  it('ls accepts an absolute path under the root', async () => {
    const sub = mkdtempSync(join(tmpdir(), 'hip-ls-abs-'))
    writeFileSync(join(sub, 'inside.txt'), '')
    try {
      const tools = buildTools(sub)
      const ls = tools.find((t) => t.name === 'ls')!
      const out = String(await ls.invoke({ path: sub }))
      expect(out).toContain('inside.txt')
    } finally {
      rmSync(sub, { recursive: true, force: true })
    }
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

  it('grep skips $RECYCLE.BIN', async () => {
    mkdirSync(join(root, '$RECYCLE.BIN', 'old'), { recursive: true })
    writeFileSync(join(root, '$RECYCLE.BIN', 'old', 'a.js'), 'NEEDLE in recycle')
    writeFileSync(join(root, 'app.js'), 'NEEDLE in app')
    const out = String(await byName(root, 'grep').invoke({ pattern: 'NEEDLE' }))
    expect(out).toContain('/app.js')
    expect(out).not.toMatch(/RECYCLE/i)
  })

  it('grep accepts a file path without ENOTDIR', async () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'export const FOO = 1\nexport const BAR = 2\n')
    writeFileSync(join(root, 'src', 'b.ts'), 'export const FOO = 99\n')
    const out = String(
      await byName(root, 'grep').invoke({ pattern: 'FOO', path: '/src/a.ts' }),
    )
    expect(out).not.toMatch(/ENOTDIR|not a directory|scandir/i)
    expect(out).toContain('a.ts')
    expect(out).toContain('FOO')
    expect(out).not.toContain('b.ts')
  })

  it('grep accepts PCRE-style (?i) and caseInsensitive', async () => {
    writeFileSync(join(root, 'ZuolinConfig.java'), 'class ZuolinConfig {}')
    const viaInline = String(await byName(root, 'grep').invoke({ pattern: '(?i)zuolin|zuo_lin|zuo-lin' }))
    expect(viaInline).toMatch(/ZuolinConfig/)
    expect(viaInline).toMatch(/Note:.*\(\?i\)/)
    const viaFlag = String(await byName(root, 'grep').invoke({ pattern: 'zuolin', caseInsensitive: true }))
    expect(viaFlag).toMatch(/ZuolinConfig/)
  })

  it('grep invalid pattern includes caseInsensitive hint', async () => {
    const out = String(await byName(root, 'grep').invoke({ pattern: '(unclosed' }))
    expect(out).toMatch(/invalid regex/i)
    expect(out).toMatch(/caseInsensitive/)
  })

  it('read_file honors 1-based offset and limit', async () => {
    writeFileSync(join(root, 'big.txt'), ['L1', 'L2', 'L3', 'L4', 'L5'].join('\n'))
    const mid = String(
      await byName(root, 'read_file').invoke({ path: '/big.txt', offset: 2, limit: 2 }),
    )
    expect(mid).toContain('L2')
    expect(mid).toContain('L3')
    expect(mid).not.toMatch(/^L1/)
    expect(mid).toMatch(/lines 2-3 of 5/)
    expect(mid).toMatch(/offset=4/)

    const cont = String(
      await byName(root, 'read_file').invoke({ path: '/big.txt', offset: 4, limit: 10 }),
    )
    expect(cont).toContain('L4')
    expect(cont).toContain('L5')
    expect(cont).not.toMatch(/use offset=/)
  })

  it('glob caseInsensitive matches mixed-case filenames', async () => {
    writeFileSync(join(root, 'SyncDataConfig.java'), 'class SyncDataConfig {}')
    const sensitive = String(
      await byName(root, 'glob').invoke({ pattern: '**/*sync*', caseInsensitive: false }),
    )
    // Case-sensitive: lowercase "sync" does not match "SyncDataConfig"
    expect(sensitive).toMatch(/No files match|^\s*$/)
    expect(sensitive).not.toContain('SyncDataConfig')

    const insensitive = String(
      await byName(root, 'glob').invoke({ pattern: '**/*sync*', caseInsensitive: true }),
    )
    expect(insensitive).toContain('SyncDataConfig')
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

describe('task tool gating (depth-1)', () => {
  it('buildTools(root) has no task tool', () => {
    const names = buildTools(root).map((t) => t.name)
    expect(names).not.toContain('task')
    expect(names).toEqual(expect.arrayContaining(['read_file', 'write_file', 'edit_file', 'ls', 'glob', 'grep']))
  })

  it('buildTools(root, spawn) appends a task tool that invokes spawn', async () => {
    const calls: string[] = []
    const spawn = async (description: string) => { calls.push(description); return `done: ${description}` }
    const tools = buildTools(root, spawn)
    const task = tools.find((t) => t.name === 'task')
    expect(task).toBeDefined()
    const out = String(await task!.invoke({ description: 'investigate the bug' }))
    expect(calls).toEqual(['investigate the bug'])
    expect(out).toBe('done: investigate the bug')
  })

  it('passes mode through to spawnSubagent', async () => {
    const calls: Array<{ desc: string; mode?: string }> = []
    const spawn = async (description: string, mode?: 'foreground' | 'background') => {
      calls.push({ desc: description, mode })
      return `done: ${description}`
    }
    const tools = buildTools(root, spawn)
    const task = tools.find((t) => t.name === 'task')
    expect(task).toBeDefined()

    const outFg = String(await task!.invoke({ description: 'fg task', mode: 'foreground' }))
    expect(outFg).toBe('done: fg task')
    expect(calls[0]).toEqual({ desc: 'fg task', mode: 'foreground' })

    const outBg = String(await task!.invoke({ description: 'bg task', mode: 'background' }))
    expect(outBg).toBe('done: bg task')
    expect(calls[1]).toEqual({ desc: 'bg task', mode: 'background' })
  })

  it('passes pause marker results through task without rewriting as empty-output Error', async () => {
    const { formatPausedToolResult } = await import('./subagent-result.js')
    const paused = formatPausedToolResult('Need path?', 'partial progress')
    const spawn = async () => paused
    const tools = buildTools(root, spawn)
    const task = tools.find((t) => t.name === 'task')
    expect(task).toBeDefined()
    const out = String(await task!.invoke({ description: 'blocked' }))
    expect(out).toBe(paused)
    expect(out).toMatch(/^\[hip:subagent_paused\]/)
    expect(out).not.toMatch(/produced empty output/)
  })

  it('passes pause marker results through dispatch_agent without rewrite', async () => {
    const { formatPausedToolResult } = await import('./subagent-result.js')
    const paused = formatPausedToolResult('Approve?', 'looked around')
    const tools = buildTools(root, async () => 'unused', undefined, {
      agents: [{ id: 'researcher', name: 'Researcher', description: 'research' }],
      run: async () => paused,
      signal: new AbortController().signal,
    })
    const dispatch = tools.find((t) => t.name === 'dispatch_agent')
    expect(dispatch).toBeDefined()
    const out = String(await dispatch!.invoke({ agent: 'researcher', task: 'find x' }))
    expect(out).toBe(paused)
    expect(out).not.toMatch(/produced empty output/)
  })
})

describe('git tools (cwd-gated)', () => {
  it('buildTools(root) WITHOUT a cwd has no git tools', () => {
    const names = buildTools(root).map((t) => t.name)
    expect(names).not.toContain('git_commit')
    expect(names).not.toContain('git_create_branch')
    expect(names).not.toContain('git_switch_branch')
    expect(names).not.toContain('git_worktree_create')
    expect(names).not.toContain('git_worktree_list')
    expect(names).not.toContain('git_worktree_remove')
  })

  it('buildTools(root, undefined, cwd) registers all six git tools', () => {
    const names = buildTools(root, undefined, root).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['git_commit', 'git_create_branch', 'git_switch_branch', 'git_worktree_create', 'git_worktree_list', 'git_worktree_remove']))
  })

  it('git_commit stages + commits and returns a short-sha confirmation', async () => {
    await makeRepo(root)
    writeFileSync(join(root, 'x.txt'), 'hi')
    const out = String(await byNameCwd(root, 'git_commit').invoke({ message: 'add x' }))
    expect(out).toMatch(/committed [0-9a-f]{7}/)
    expect((await git(root, 'log', '-1', '--format=%s')).stdout.trim()).toBe('add x')
  })

  it('git_commit returns an Error string when there is nothing to commit', async () => {
    await makeRepo(root) // clean tree, nothing staged
    const out = String(await byNameCwd(root, 'git_commit').invoke({ message: 'noop' }))
    expect(out).toMatch(/^Error:/)
  })

  it('git_create_branch creates a branch without switching', async () => {
    await makeRepo(root)
    const out = String(await byNameCwd(root, 'git_create_branch').invoke({ branchName: 'feature' }))
    expect(out).toMatch(/feature/)
    expect((await git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()).toBe('main')
  })

  it('git_switch_branch moves HEAD to an existing branch', async () => {
    await makeRepo(root)
    await git(root, 'branch', 'feature')
    const out = String(await byNameCwd(root, 'git_switch_branch').invoke({ branchName: 'feature' }))
    expect(out).toMatch(/feature/)
    expect((await git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()).toBe('feature')
  })

  it('git_switch_branch returns an Error string for a missing branch', async () => {
    await makeRepo(root)
    const out = String(await byNameCwd(root, 'git_switch_branch').invoke({ branchName: 'nope' }))
    expect(out).toMatch(/^Error:/)
  })

  describe('worktree tools', () => {
    let wtDir: string
    let prevWtEnv: string | undefined

    beforeEach(() => {
      wtDir = mkdtempSync(join(tmpdir(), 'hip-wt-'))
      prevWtEnv = process.env.HIP_WORKTREES_DIR
      process.env.HIP_WORKTREES_DIR = wtDir
    })
    afterEach(() => {
      if (prevWtEnv === undefined) delete process.env.HIP_WORKTREES_DIR
      else process.env.HIP_WORKTREES_DIR = prevWtEnv
      rmSync(wtDir, { recursive: true, force: true })
    })

    it('git_worktree_create succeeds for an existing branch', async () => {
      await makeRepo(root)
      await git(root, 'branch', 'feat-wt')
      const out = String(await byNameCwd(root, 'git_worktree_create').invoke({ branch: 'feat-wt' }))
      expect(out).toMatch(/Worktree created at/)
      expect(out).toContain('feat-wt')
    })

    it('git_worktree_create returns an Error string for a missing branch', async () => {
      await makeRepo(root)
      const out = String(await byNameCwd(root, 'git_worktree_create').invoke({ branch: 'nonexistent' }))
      expect(out).toMatch(/^Error:/)
    })

    it('git_worktree_list returns a JSON array of worktrees', async () => {
      await makeRepo(root)
      await git(root, 'branch', 'feat-ls')
      await byNameCwd(root, 'git_worktree_create').invoke({ branch: 'feat-ls' })
      const out = String(await byNameCwd(root, 'git_worktree_list').invoke({}))
      const parsed = JSON.parse(out) as Array<{ path: string; branch: string; head: string }>
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed.length).toBeGreaterThanOrEqual(2) // main + feat-ls
      expect(parsed.some((w) => w.branch === 'feat-ls')).toBe(true)
    })

    it('git_worktree_remove succeeds for an existing worktree', async () => {
      await makeRepo(root)
      await git(root, 'branch', 'feat-rm')
      const createOut = String(await byNameCwd(root, 'git_worktree_create').invoke({ branch: 'feat-rm' }))
      expect(createOut).toMatch(/Worktree created at/)
      // Extract the path from the success message
      const match = createOut.match(/Worktree created at (.+)/)
      expect(match).toBeTruthy()
      const wtPath = match![1]
      const removeOut = String(await byNameCwd(root, 'git_worktree_remove').invoke({ worktreePath: wtPath }))
      expect(removeOut).toMatch(/Removed worktree/)
      // Confirm it's gone from list
      const listOut = String(await byNameCwd(root, 'git_worktree_list').invoke({}))
      const parsed = JSON.parse(listOut) as Array<{ branch: string }>
      expect(parsed.some((w) => w.branch === 'feat-rm')).toBe(false)
    })

    it('git_worktree_remove returns an Error string for a nonexistent path', async () => {
      await makeRepo(root)
      const out = String(await byNameCwd(root, 'git_worktree_remove').invoke({ worktreePath: join(wtDir, 'nope') }))
      expect(out).toMatch(/^Error:/)
    })
  })
})
