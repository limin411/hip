import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { scratchDirFor, ensureScratchDir, removeScratchDir, defaultScratchRoot } from './scratch.js'

let root: string
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'hip-scratch-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('scratch', () => {
  it('scratchDirFor joins root + sessionId without IO', () => {
    expect(scratchDirFor('abc', root)).toBe(path.join(root, 'abc'))
  })
  it('ensureScratchDir creates the directory', () => {
    const dir = ensureScratchDir('s1', root)
    expect(existsSync(dir)).toBe(true)
  })
  it('removeScratchDir deletes it and is a no-op when absent', () => {
    const dir = ensureScratchDir('s2', root)
    removeScratchDir('s2', root)
    expect(existsSync(dir)).toBe(false)
    expect(() => removeScratchDir('never', root)).not.toThrow()
  })
  it('scratchDirFor rejects ids that would escape the root', () => {
    expect(() => scratchDirFor('../evil', root)).toThrow()
    expect(() => scratchDirFor('a/b', root)).toThrow()
    expect(() => scratchDirFor('', root)).toThrow()
  })
})

describe('defaultScratchRoot', () => {
  const saved = process.env.HIP_SCRATCH_ROOT
  afterEach(() => {
    if (saved === undefined) delete process.env.HIP_SCRATCH_ROOT
    else process.env.HIP_SCRATCH_ROOT = saved
  })

  it('honors HIP_SCRATCH_ROOT when set', () => {
    process.env.HIP_SCRATCH_ROOT = '/custom/scratch/root'
    expect(defaultScratchRoot()).toBe('/custom/scratch/root')
  })

  it('falls back to ~/.hip/scratch when unset', () => {
    delete process.env.HIP_SCRATCH_ROOT
    expect(defaultScratchRoot()).toBe(path.join(os.homedir(), '.hip', 'scratch'))
  })
})
