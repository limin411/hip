import { mkdir, writeFile, readdir, stat, unlink } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_LINES = 2000
/**
 * Default max tool-result bytes kept inline for the model.
 * 40 KB ≈ 10k tokens (aligned with grok-build DEFAULT_TOOL_OUTPUT_BYTES).
 * Full content still spills to ~/.hip/data/tool-output/ when over limit.
 */
const DEFAULT_MAX_BYTES = 40 * 1024 // 40 KB
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const CLEANUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const FILE_PREFIX = 'tool_'
const WX_RETRY_LIMIT = 10

function defaultOutputDir(): string {
  return path.join(os.homedir(), '.hip', 'data', 'tool-output')
}

// ── Types ────────────────────────────────────────────────────────────────────

/** Result of bounding a tool output. */
export interface BoundResult {
  /** Bounded preview (head+marker+tail), or the original if within limits. */
  output: string
  /** True iff the original exceeded a threshold and was written to a managed file. */
  truncated: boolean
  /** Paths to managed full-content files (empty when not truncated). */
  outputPaths: string[]
}

/** Constructor options for {@link ToolOutputStore}. */
export interface ToolOutputStoreOptions {
  maxLines?: number
  maxBytes?: number
  outputDir?: string
  /** Override the managed-file ID generator (used for deterministic testing). */
  generateId?: () => string
}

// ── ToolOutputStore ──────────────────────────────────────────────────────────

/**
 * Bounds tool outputs to dual thresholds (line count + byte count).
 *
 * Oversized content is written to a managed file under `~/.hip/data/tool-output/`;
 * a bounded preview (head lines + truncation marker + tail lines) is returned for
 * the LLM context. If the preview itself exceeds the byte budget, head and tail are
 * trimmed to fit (UTF-8 safe — a partial multi-byte sequence at the cut becomes
 * U+FFFD, acceptable for a preview).
 *
 * Cleanup: an hourly interval scans the managed-files directory and deletes files
 * older than 7 days. The timer is `unref()`ed so it never keeps the process alive.
 *
 * Bounding happens at the ToolRunner level, NOT in individual tool definitions.
 */
export class ToolOutputStore {
  private readonly maxLines: number
  private readonly maxBytes: number
  private readonly outputDir: string
  private readonly generateId: () => string
  private cleanupTimer: NodeJS.Timeout | null = null
  private counter = 0

  constructor(opts: ToolOutputStoreOptions = {}) {
    this.maxLines = opts.maxLines ?? DEFAULT_MAX_LINES
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
    this.outputDir = opts.outputDir ?? defaultOutputDir()
    this.generateId = opts.generateId ?? (() => `${Date.now()}_${this.counter++}`)
    this.startCleanupInterval()
  }

  /**
   * Bound a tool output. If it exceeds either threshold, the full content is
   * written to a managed file (exclusive `wx` write, retrying on collision) and a
   * head+marker+tail preview is returned. If the managed-file write fails (e.g.
   * disk full, permission denied), the original output is returned unbounded —
   * graceful degradation that prefers sending the full output over losing it.
   */
  async bound(input: {
    sessionId: string
    toolCallId: string
    output: string
  }): Promise<BoundResult> {
    // Coerce null/undefined to '' at the boundary (defensive — the type says string).
    const output = input.output ?? ''
    const lines = output.split('\n')
    const lineCount = lines.length
    const byteLength = Buffer.byteLength(output, 'utf-8')

    if (lineCount <= this.maxLines && byteLength <= this.maxBytes) {
      return { output, truncated: false, outputPaths: [] }
    }

    let filePath: string
    try {
      filePath = await this.writeManagedFile(output)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `[ToolOutputStore] failed to write managed file for ${input.toolCallId}: ${msg}; returning unbounded output`,
      )
      return { output, truncated: false, outputPaths: [] }
    }

    const preview = this.buildPreview(lines, lineCount, filePath)
    return { output: preview, truncated: true, outputPaths: [filePath] }
  }

  /** Start the hourly cleanup interval (idempotent). */
  startCleanupInterval(intervalMs: number = CLEANUP_INTERVAL_MS): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => {
      void this.cleanupOnce()
    }, intervalMs)
    this.cleanupTimer.unref()
  }

  /** Stop the cleanup interval (idempotent). */
  stopCleanupInterval(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Scan the managed-files directory once and delete files whose mtime is older
   * than the 7-day retention window. Best-effort: all errors are swallowed
   * (cleanup is non-critical and must never crash the agent loop).
   */
  async cleanupOnce(): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(this.outputDir)
    } catch {
      return // directory missing or unreadable — nothing to do
    }
    const now = Date.now()
    await Promise.all(
      entries.map(async (name) => {
        if (!name.startsWith(FILE_PREFIX)) return
        const filePath = path.join(this.outputDir, name)
        try {
          const s = await stat(filePath)
          if (now - s.mtimeMs > CLEANUP_RETENTION_MS) {
            await unlink(filePath)
          }
        } catch {
          // best-effort — file may have been removed concurrently
        }
      }),
    )
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /**
   * Write the full content to a managed file. Uses `flag: 'wx'` (exclusive) to
   * detect collisions; on EEXIST, retries with a fresh ID (up to
   * {@link WX_RETRY_LIMIT} times).
   */
  private async writeManagedFile(content: string): Promise<string> {
    await mkdir(this.outputDir, { recursive: true })
    for (let attempt = 0; attempt < WX_RETRY_LIMIT; attempt++) {
      const id = this.generateId()
      const filePath = path.join(this.outputDir, `${FILE_PREFIX}${id}`)
      try {
        await writeFile(filePath, content, { flag: 'wx' })
        return filePath
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EEXIST') continue // collision — try a new ID
        throw err // real I/O error — propagate to caller for graceful degradation
      }
    }
    throw new Error(
      `ToolOutputStore: failed to write managed file after ${WX_RETRY_LIMIT} attempts (all IDs collided)`,
    )
  }

  /**
   * Build the bounded preview: head(maxLines/2) + marker + tail(maxLines/2).
   * If the preview still exceeds maxBytes (e.g. a few very long lines), byte-trim
   * the head and tail around the marker.
   */
  private buildPreview(
    lines: string[],
    lineCount: number,
    filePath: string,
  ): string {
    const headCount = Math.ceil(this.maxLines / 2)
    const tailCount = Math.floor(this.maxLines / 2)

    const head = lines.slice(0, headCount).join('\n')
    const tailStart = Math.max(0, lineCount - tailCount)
    const tail = lines.slice(tailStart).join('\n')
    const byteLength = Buffer.byteLength(lines.join('\n'), 'utf-8')
    const marker =
      `\n... output truncated (${lineCount} lines, ~${byteLength} bytes); full content saved to ${filePath}. ` +
      `Re-read sections with read_file(path, offset, limit). Prefer edit_file for localized changes instead of rewriting the whole file. ...\n`

    const preview = head + marker + tail
    if (Buffer.byteLength(preview, 'utf-8') > this.maxBytes) {
      return this.byteTrim(head, tail, marker)
    }
    return preview
  }

  /**
   * Byte-trim head+tail to fit maxBytes. UTF-8 safe: Buffer.subarray + decode
   * replaces any partial multi-byte sequence at the cut with U+FFFD, which is
   * acceptable for a truncated preview and never produces invalid UTF-8.
   */
  private byteTrim(head: string, tail: string, marker: string): string {
    const markerBytes = Buffer.byteLength(marker, 'utf-8')
    const available = Math.max(0, this.maxBytes - markerBytes)

    const headBuf = Buffer.from(head, 'utf-8')
    const tailBuf = Buffer.from(tail, 'utf-8')

    // Split the remaining byte budget evenly, capped by each side's actual size.
    const halfBudget = Math.floor(available / 2)
    const maxHead = Math.min(headBuf.length, halfBudget)
    const maxTail = Math.min(tailBuf.length, available - maxHead)

    const trimmedHead = headBuf.subarray(0, maxHead).toString('utf-8')
    const trimmedTail = tailBuf.subarray(tailBuf.length - maxTail).toString('utf-8')

    return trimmedHead + marker + trimmedTail
  }
}
