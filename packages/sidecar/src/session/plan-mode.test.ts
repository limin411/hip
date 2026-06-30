import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rmSync, existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { mockHomedir } = vi.hoisted(() => ({
  mockHomedir: vi.fn(),
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    homedir: mockHomedir,
  }
})

import { PlanMode } from './plan-mode.js'

describe('PlanMode', () => {
  let tempHome: string
  let planMode: PlanMode

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'hip-planmode-'))
    mockHomedir.mockReturnValue(tempHome)
    planMode = new PlanMode()
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
  })

  // ── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('initializes isActive === false', () => {
      expect(planMode.isActive).toBe(false)
    })

    it('initializes planFilePath === null', () => {
      expect(planMode.planFilePath).toBeNull()
    })
  })

  // ── enter(sessionId) ─────────────────────────────────────────────────────

  describe('enter(sessionId)', () => {
    it('creates the plan file under ~/.hip/plans/<sessionId>.md', async () => {
      await planMode.enter('test-session')

      const expectedPath = join(tempHome, '.hip', 'plans', 'test_session.md')
      expect(planMode.planFilePath).toBe(expectedPath)
      expect(existsSync(expectedPath)).toBe(true)
    })

    it('sets isActive === true after enter', async () => {
      await planMode.enter('test-session')
      expect(planMode.isActive).toBe(true)
    })

    it('populates planFilePath after enter', async () => {
      await planMode.enter('test-session')
      expect(planMode.planFilePath).not.toBeNull()
      expect(planMode.planFilePath).toContain('test_session')
    })

    it('writes an empty plan file', async () => {
      await planMode.enter('test-session')
      const content = readFileSync(planMode.planFilePath!, 'utf-8')
      expect(content).toBe('')
    })

    it('creates the parent directories (~/.hip/plans/)', async () => {
      const plansDir = join(tempHome, '.hip', 'plans')
      await planMode.enter('some-session')
      expect(existsSync(plansDir)).toBe(true)
    })

    it('sanitizes sessionId — replaces spaces with underscores', async () => {
      await planMode.enter('hello world')
      expect(planMode.planFilePath).toContain('hello_world')
      expect(planMode.planFilePath).not.toContain(' ')
    })

    it('sanitizes sessionId — replaces special characters with underscores', async () => {
      await planMode.enter('session!@#$%')
      // Path should contain the safe prefix and suffix, no special chars
      const filename = planMode.planFilePath!.split('/').pop()!
      // All non-alphanumeric except '.' in extension should be '_'
      // 'session!@#$%' → 'session_____'
      expect(filename).toMatch(/^[a-zA-Z0-9_]+\.md$/)
      expect(filename).toBe('session_____.md')
    })

    it('throws when enter() is called while already active', async () => {
      await planMode.enter('session-1')
      await expect(planMode.enter('session-2')).rejects.toThrow(
        /already active/,
      )
    })
  })

  // ── exit() ────────────────────────────────────────────────────────────────

  describe('exit()', () => {
    it('sets isActive === false', async () => {
      await planMode.enter('test-session')
      planMode.exit()
      expect(planMode.isActive).toBe(false)
    })

    it('sets planFilePath === null', async () => {
      await planMode.enter('test-session')
      planMode.exit()
      expect(planMode.planFilePath).toBeNull()
    })

    it('preserves the plan file on disk', async () => {
      await planMode.enter('test-session')
      const filePath = planMode.planFilePath!
      planMode.exit()
      expect(existsSync(filePath)).toBe(true)
    })

    it('is a no-op when not active (no throw)', () => {
      expect(() => planMode.exit()).not.toThrow()
      expect(planMode.isActive).toBe(false)
      expect(planMode.planFilePath).toBeNull()
    })

    it('can be called twice without error', async () => {
      await planMode.enter('test-session')
      planMode.exit()
      expect(() => planMode.exit()).not.toThrow()
    })
  })

  // ── cancel() ──────────────────────────────────────────────────────────────

  describe('cancel()', () => {
    it('sets isActive === false', async () => {
      await planMode.enter('test-session')
      planMode.cancel()
      expect(planMode.isActive).toBe(false)
    })

    it('sets planFilePath === null', async () => {
      await planMode.enter('test-session')
      planMode.cancel()
      expect(planMode.planFilePath).toBeNull()
    })

    it('preserves the plan file on disk (same as exit)', async () => {
      await planMode.enter('test-session')
      const filePath = planMode.planFilePath!
      planMode.cancel()
      expect(existsSync(filePath)).toBe(true)
    })
  })

  // ── writePlan / readPlan roundtrip ────────────────────────────────────────

  describe('writePlan / readPlan roundtrip', () => {
    beforeEach(async () => {
      await planMode.enter('test-session')
    })

    it('writes content and reads it back', async () => {
      const content = '# My Plan\n\nThis is the plan content.'
      await planMode.writePlan(content)
      const result = await planMode.readPlan()
      expect(result).toBe(content)
    })

    it('handles empty content', async () => {
      await planMode.writePlan('')
      const result = await planMode.readPlan()
      expect(result).toBe('')
    })

    it('handles multiline Markdown content', async () => {
      const md = [
        '# Plan',
        '',
        '## Phase 1',
        '- Item A',
        '- Item B',
        '',
        '## Phase 2',
        '```ts',
        'const x = 1',
        '```',
      ].join('\n')
      await planMode.writePlan(md)
      const result = await planMode.readPlan()
      expect(result).toBe(md)
    })

    it('second write overwrites first', async () => {
      await planMode.writePlan('first version')
      await planMode.writePlan('second version')
      const result = await planMode.readPlan()
      expect(result).toBe('second version')
    })

    it('atomic write — no .tmp file left behind', async () => {
      await planMode.writePlan('atomic')
      const tmpPath = planMode.planFilePath + '.tmp'
      expect(existsSync(tmpPath)).toBe(false)
    })

    it('atomic write — final file has correct content', async () => {
      const content = 'final content'
      await planMode.writePlan(content)
      const onDisk = readFileSync(planMode.planFilePath!, 'utf-8')
      expect(onDisk).toBe(content)
    })
  })

  // ── readPlan edge cases ───────────────────────────────────────────────────

  describe('readPlan edge cases', () => {
    it('returns empty string when plan mode was never entered', async () => {
      const result = await planMode.readPlan()
      expect(result).toBe('')
    })

    it('returns empty string after exit (planFilePath is null)', async () => {
      await planMode.enter('test-session')
      await planMode.writePlan('some content')
      planMode.exit()

      const result = await planMode.readPlan()
      expect(result).toBe('')
    })

    it('returns empty string when file is missing (ENOENT)', async () => {
      // Simulate path set but file deleted
      await planMode.enter('test-session')
      const filePath = planMode.planFilePath!
      rmSync(filePath)
      const result = await planMode.readPlan()
      expect(result).toBe('')
    })
  })

  // ── Integration: full lifecycle ──────────────────────────────────────────

  describe('full lifecycle', () => {
    it('enter → write → read → exit (happy path)', async () => {
      await planMode.enter('my-session')
      expect(planMode.isActive).toBe(true)

      await planMode.writePlan('# Phase 1\n- Do A\n- Do B')
      const read = await planMode.readPlan()
      expect(read).toBe('# Phase 1\n- Do A\n- Do B')

      const filePath = planMode.planFilePath!
      planMode.exit()
      expect(planMode.isActive).toBe(false)
      expect(planMode.planFilePath).toBeNull()
      expect(existsSync(filePath)).toBe(true)
    })

    it('enter → exit → enter again (new session)', async () => {
      await planMode.enter('session-A')
      await planMode.writePlan('A plan')
      planMode.exit()

      // Re-enter with a different session
      await planMode.enter('session-B')
      expect(planMode.isActive).toBe(true)
      expect(planMode.planFilePath).toContain('session_B')

      const content = await planMode.readPlan()
      expect(content).toBe('') // fresh empty file
    })
  })
})
