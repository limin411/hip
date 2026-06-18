import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { scratchDirFor } from './scratch.js'
import { surfaceOf } from './surface.js'

let root: string
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'hip-surface-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('surfaceOf', () => {
  it('honors an explicit surface field', () => {
    expect(surfaceOf({ surface: 'chat', cwd: '/Users/me/project' }, 's1', root)).toBe('chat')
    expect(surfaceOf({ surface: 'code', cwd: scratchDirFor('s1', root) }, 's1', root)).toBe('code')
  })
  it('infers chat from a scratch cwd when the field is absent (legacy row)', () => {
    expect(surfaceOf({ cwd: scratchDirFor('s1', root) }, 's1', root)).toBe('chat')
  })
  it('infers code from a real project cwd when the field is absent', () => {
    expect(surfaceOf({ cwd: '/Users/me/project' }, 's1', root)).toBe('code')
  })
  it('defaults to code when neither field nor cwd is present', () => {
    expect(surfaceOf({}, 's1', root)).toBe('code')
  })
})
