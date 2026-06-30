import { mkdir, writeFile, rename, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * PlanMode — lightweight state machine for tracking whether the agent is
 * currently operating in plan-mode (proposing changes without executing).
 *
 * Plan files are stored as plain Markdown under ~/.hip/plans/<sessionId>.md.
 * File operations are async (fs/promises) and writes are atomic (tmp + rename).
 *
 * Used by EnterPlanModeTool and ExitPlanModeTool.
 */
export class PlanMode {
  private _isActive = false
  private _planFilePath: string | null = null

  /** Whether plan-mode is currently active. */
  get isActive(): boolean {
    return this._isActive
  }

  /** The absolute path to the plan file (null when not active). */
  get planFilePath(): string | null {
    return this._planFilePath
  }

  /**
   * Enter plan-mode for the given session.
   *
   * Creates ~/.hip/plans/<sanitized-sessionId>.md with empty content.
   * Throws if already active — call exit() first.
   */
  async enter(sessionId: string): Promise<void> {
    if (this._isActive) {
      throw new Error('PlanMode is already active. Call exit() before entering again.')
    }

    const safeId = sanitizeSessionId(sessionId)
    const plansDir = join(homedir(), '.hip', 'plans')
    const planPath = join(plansDir, `${safeId}.md`)

    await mkdir(plansDir, { recursive: true })
    await writeFile(planPath, '', 'utf-8')

    this._planFilePath = planPath
    this._isActive = true
  }

  /**
   * Write plan content to disk atomically.
   *
   * Writes to a temp file first, then renames — no partial reads.
   */
  async writePlan(content: string): Promise<void> {
    if (!this._planFilePath) {
      throw new Error('PlanMode is not active. Call enter() first.')
    }

    const tmpPath = `${this._planFilePath}.tmp`
    await writeFile(tmpPath, content, 'utf-8')
    await rename(tmpPath, this._planFilePath)
  }

  /**
   * Read the current plan content from disk.
   *
   * Returns an empty string when not active or when the file does not exist.
   */
  async readPlan(): Promise<string> {
    if (!this._planFilePath) {
      return ''
    }

    try {
      return await readFile(this._planFilePath, 'utf-8')
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return ''
      }
      throw err
    }
  }

  /** Exit plan-mode. Preserves the plan file on disk. */
  exit(): void {
    this._isActive = false
    this._planFilePath = null
  }

  /** Cancel plan-mode (same behaviour as exit). Preserves the plan file on disk. */
  cancel(): void {
    this.exit()
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Replace characters that are not alphanumeric with underscores so the
 * session ID can be used as a safe filename.
 */
function sanitizeSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_')
}

/**
 * Narrow an unknown error to the shape of a NodeJS system error.
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}
