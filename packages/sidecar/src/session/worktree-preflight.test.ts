import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { assertWorktreeCleanForRemoval, WorktreeDirtyError } from './worktree-preflight.js'

const execFileP = promisify(execFile)

async function initRepo(dir: string): Promise<void> {
  await execFileP('git', ['init'], { cwd: dir })
  await execFileP('git', ['config', 'user.email', 't@t.com'], { cwd: dir })
  await execFileP('git', ['config', 'user.name', 't'], { cwd: dir })
  await fs.writeFile(path.join(dir, 'a.txt'), 'a\n', 'utf8')
  await execFileP('git', ['add', 'a.txt'], { cwd: dir })
  await execFileP('git', ['commit', '-m', 'init'], { cwd: dir })
}

describe('assertWorktreeCleanForRemoval (P5 H4)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-wt-pre-'))
    await initRepo(dir)
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('allows clean tree', async () => {
    await expect(assertWorktreeCleanForRemoval(dir, false)).resolves.toBeUndefined()
  })

  it('throws WorktreeDirtyError when dirty', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'dirty\n', 'utf8')
    await expect(assertWorktreeCleanForRemoval(dir, false)).rejects.toBeInstanceOf(WorktreeDirtyError)
  })

  it('skips check when force', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'dirty\n', 'utf8')
    await expect(assertWorktreeCleanForRemoval(dir, true)).resolves.toBeUndefined()
  })
})
