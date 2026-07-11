import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { resolveProjectKey } from './project-key.js'

describe('resolveProjectKey', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hip-proj-key-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('non-git temp dir works via realpath', () => {
    writeFileSync(join(dir, 'file.txt'), 'x')
    const { projectKey, projectKeyHash } = resolveProjectKey(dir)
    const expected = realpathSync(dir)
    expect(projectKey).toBe(expected)
    expect(projectKeyHash).toBe(createHash('sha256').update(expected, 'utf8').digest('hex'))
    expect(projectKeyHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('same path yields stable hash', () => {
    const a = resolveProjectKey(dir)
    const b = resolveProjectKey(dir)
    expect(a).toEqual(b)
  })
})
