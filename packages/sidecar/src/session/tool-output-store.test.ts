import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ToolOutputStore } from './tool-output-store.js'
import type { ToolOutputStoreOptions } from './tool-output-store.js'
import { TOOL_BLOB_CAP, clip } from './tool-trace.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

// ── Baseline: existing tool-trace.ts must be unchanged ───────────────────────
// The new ToolOutputStore must NOT alter the current crude TOOL_BLOB_CAP path.
// These tests pin the legacy behavior so a regression is caught immediately.

describe('tool-trace.ts baseline (unchanged by ToolOutputStore)', () => {
  it('TOOL_BLOB_CAP is still 4096', () => {
    expect(TOOL_BLOB_CAP).toBe(4096)
  })

  it('clip() shortens blobs over the cap and reports truncated', () => {
    const r = clip('x'.repeat(5000))
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBe(4096)
  })

  it('clip() passes through blobs under the cap', () => {
    const r = clip('short')
    expect(r.truncated).toBe(false)
    expect(r.text).toBe('short')
  })
})

// ── ToolOutputStore ──────────────────────────────────────────────────────────

describe('ToolOutputStore', () => {
  let tmpDir: string
  let stores: ToolOutputStore[]

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-tool-output-'))
    stores = []
  })

  afterEach(async () => {
    for (const s of stores) s.stopCleanupInterval()
    stores = []
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  /** Build a store rooted at tmpDir; track it for interval cleanup in afterEach. */
  function makeStore(opts?: ToolOutputStoreOptions): ToolOutputStore {
    const store = new ToolOutputStore({ outputDir: tmpDir, ...opts })
    stores.push(store)
    return store
  }

  // ── Within limits: pass-through ────────────────────────────────────────

  it('returns 100-line output as-is when under both thresholds', async () => {
    const store = makeStore()
    const output = Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n')
    const r = await store.bound({ sessionId: 's1', toolCallId: 't1', output })
    expect(r.truncated).toBe(false)
    expect(r.outputPaths).toEqual([])
    expect(r.output).toBe(output)
  })

  it('handles empty string', async () => {
    const store = makeStore()
    const r = await store.bound({ sessionId: 's1', toolCallId: 't1', output: '' })
    expect(r.truncated).toBe(false)
    expect(r.output).toBe('')
    expect(r.outputPaths).toEqual([])
  })

  // ── Line threshold bounding ────────────────────────────────────────────

  it('truncates 3000 lines to head(1000) + marker + tail(1000)', async () => {
    const store = makeStore({ maxLines: 2000 })
    const output = Array.from({ length: 3000 }, (_, i) => `line-${i}`).join('\n')
    const r = await store.bound({ sessionId: 's1', toolCallId: 't1', output })

    expect(r.truncated).toBe(true)
    expect(r.outputPaths).toHaveLength(1)

    const previewLines = r.output.split('\n')

    // Head: first 1000 lines of original preserved at the start.
    expect(previewLines[0]).toBe('line-0')
    expect(previewLines[999]).toBe('line-999')

    // Marker line sits between head and tail; includes re-read / edit guidance.
    expect(r.output).toContain('output truncated')
    expect(r.output).toContain(r.outputPaths[0])
    expect(r.output).toMatch(/offset.*limit|read_file/i)
    expect(r.output).toMatch(/edit_file/i)

    // Tail: last 1000 lines of original preserved at the end.
    expect(previewLines[previewLines.length - 1000]).toBe('line-2000')
    expect(previewLines[previewLines.length - 1]).toBe('line-2999')
  })

  it('writes full content to the managed file (exact match)', async () => {
    const store = makeStore()
    const output = Array.from({ length: 3000 }, (_, i) => `line-${i}`).join('\n')
    const r = await store.bound({ sessionId: 's1', toolCallId: 't1', output })
    expect(r.outputPaths).toHaveLength(1)

    const fileContent = await fs.readFile(r.outputPaths[0], 'utf-8')
    expect(fileContent).toBe(output)
  })

  it('outputPaths file is under the configured outputDir and prefixed tool_', async () => {
    const store = makeStore()
    const output = 'x'.repeat(120 * 1024) // above default 100KB byte threshold
    const r = await store.bound({ sessionId: 's1', toolCallId: 't1', output })
    expect(r.outputPaths).toHaveLength(1)
    expect(r.outputPaths[0].startsWith(tmpDir)).toBe(true)
    expect(path.basename(r.outputPaths[0]).startsWith('tool_')).toBe(true)
  })

  // ── Byte threshold bounding ────────────────────────────────────────────

  it('truncates 60KB single-line output via byte threshold (under line threshold)', async () => {
    const store = makeStore({ maxBytes: 50 * 1024 })
    const output = 'x'.repeat(60 * 1024) // 60 KB, 1 line (< maxLines=2000)
    const r = await store.bound({ sessionId: 's1', toolCallId: 't1', output })

    expect(r.truncated).toBe(true)
    expect(r.outputPaths).toHaveLength(1)
    expect(Buffer.byteLength(r.output, 'utf-8')).toBeLessThanOrEqual(50 * 1024)
    expect(r.output).toContain('output truncated')

    const fileContent = await fs.readFile(r.outputPaths[0], 'utf-8')
    expect(fileContent).toBe(output)
  })

  // ── Cleanup ───────────────────────────────────────────────────────────

  it('cleanup deletes files older than 7 days and keeps newer ones', async () => {
    const store = makeStore()

    // Old file: 8 days ago — past retention.
    const oldFile = path.join(tmpDir, 'tool_old')
    await fs.writeFile(oldFile, 'old')
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await fs.utimes(oldFile, old, old)

    // New file: just created — within retention.
    const newFile = path.join(tmpDir, 'tool_new')
    await fs.writeFile(newFile, 'new')

    await store.cleanupOnce()

    await expect(fs.access(oldFile)).rejects.toThrow()
    await expect(fs.access(newFile)).resolves.toBeUndefined()
  })

  it('cleanup leaves non-tool_ files alone', async () => {
    const store = makeStore()
    const other = path.join(tmpDir, 'README')
    await fs.writeFile(other, 'keep me')
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    await fs.utimes(other, old, old)

    await store.cleanupOnce()

    await expect(fs.access(other)).resolves.toBeUndefined()
  })

  // ── Adversarial: malformed input ──────────────────────────────────────

  it('handles 10MB output without crashing and bounds the preview', async () => {
    const store = makeStore()
    const output = 'x'.repeat(10 * 1024 * 1024) // 10 MB single line
    const r = await store.bound({ sessionId: 's1', toolCallId: 't1', output })

    expect(r.truncated).toBe(true)
    expect(r.outputPaths).toHaveLength(1)
    expect(Buffer.byteLength(r.output, 'utf-8')).toBeLessThanOrEqual(100 * 1024)

    // The managed file MUST contain the full 10MB (not just a path promise).
    const fileContent = await fs.readFile(r.outputPaths[0], 'utf-8')
    expect(fileContent).toBe(output)
    expect(Buffer.byteLength(fileContent, 'utf-8')).toBe(10 * 1024 * 1024)
  }, 30000)

  it('handles null input by coercing to empty string (no crash)', async () => {
    const store = makeStore()
    const r = await store.bound({
      sessionId: 's1',
      toolCallId: 't1',
      output: null as unknown as string,
    })
    expect(r.truncated).toBe(false)
    expect(r.output).toBe('')
    expect(r.outputPaths).toEqual([])
  })

  // ── Adversarial: stale state (wx conflict) ────────────────────────────

  it('retries with a new ID when the target file already exists', async () => {
    let n = 0
    const store = makeStore({ generateId: () => `fixed-${n++}` })

    // Pre-create the first file the store will try (tool_fixed-0).
    await fs.writeFile(path.join(tmpDir, 'tool_fixed-0'), 'stale')

    const output = Array.from({ length: 3000 }, (_, i) => `l-${i}`).join('\n')
    const r = await store.bound({ sessionId: 's1', toolCallId: 't1', output })

    expect(r.truncated).toBe(true)
    // It should have fallen through to tool_fixed-1.
    expect(r.outputPaths[0]).toContain('tool_fixed-1')

    // The original stale file must still be untouched.
    const stale = await fs.readFile(path.join(tmpDir, 'tool_fixed-0'), 'utf-8')
    expect(stale).toBe('stale')

    // The new file MUST contain the full content (not just exist).
    const content = await fs.readFile(r.outputPaths[0], 'utf-8')
    expect(content).toBe(output)
  })

  // ── Adversarial: disk write failure (graceful degradation) ────────────

  it('returns unbounded output when the managed-file write fails', async () => {
    // Make outputDir unwritable: the parent path is a regular file, so
    // mkdir(recursive) throws ENOTDIR.
    const blocker = path.join(tmpDir, 'blocker')
    await fs.writeFile(blocker, 'x')
    const badDir = path.join(blocker, 'sub')

    const store = makeStore({ outputDir: badDir })
    const output = Array.from({ length: 3000 }, (_, i) => `l-${i}`).join('\n')
    const r = await store.bound({ sessionId: 's1', toolCallId: 't1', output })

    // Should not crash; returns unbounded (truncated=false because bounding failed).
    expect(r.truncated).toBe(false)
    expect(r.outputPaths).toEqual([])
    expect(r.output).toBe(output)
  })

  // ── Adversarial: misleading success (verify file content, not just path)

  it('managed file content is byte-identical to input (not just path returned)', async () => {
    const store = makeStore()
    // Include multi-byte UTF-8 to catch encoding bugs.
    const output = Array.from({ length: 2500 }, (_, i) => `line-${i}-中文-🏆`).join('\n')
    const r = await store.bound({ sessionId: 's1', toolCallId: 't1', output })

    expect(r.truncated).toBe(true)
    expect(r.outputPaths).toHaveLength(1)

    const fileContent = await fs.readFile(r.outputPaths[0], 'utf-8')
    // Byte-level identity, not just string equality.
    const fileBuf = await fs.readFile(r.outputPaths[0])
    const inputBuf = Buffer.from(output, 'utf-8')
    expect(fileBuf.equals(inputBuf)).toBe(true)
  })
})
