/**
 * CircuitBreaker — stalls detection + token budget enforcement.
 *
 * Called after each agent step. Tracks tokens, steps, and consecutive
 * no-file-change steps. Produces three kinds of decisions:
 *  - 'continue' : everything is within limits
 *  - 'warn'     : no progress detected (consecutive no-file-change threshold hit)
 *  - 'terminate': a hard limit (token budget / step limit / repeated warnings) reached
 *
 * warnCount persists across file-change resets so that a repeatedly stalling
 * workflow eventually terminates even if it makes occasional file touches.
 */

export interface BreakerConfig {
  /** Max consecutive steps without any file change (write_file / edit_file). */
  maxNoFileChangeSteps: number
  /** Hard token budget for the entire workflow run. */
  maxTokens: number
  /** Max total steps across all agents in the run. */
  maxSteps: number
  /** Number of 'warn' decisions before escalation to 'terminate'. */
  maxWarns: number
}

const DEFAULT_CONFIG: BreakerConfig = {
  maxNoFileChangeSteps: 10,
  maxTokens: 200_000,
  maxSteps: 100,
  maxWarns: 3,
}

export interface BreakerSnapshot {
  steps: number
  totalTokens: number
  consecutiveNoFileChange: number
  warnCount: number
  lastFileChangedAt: number | null
}

export interface BreakerDecision {
  action: 'continue' | 'warn' | 'terminate'
  reason?: string
}

export class CircuitBreaker {
  private snapshot: BreakerSnapshot
  private cfg: BreakerConfig

  constructor(cfg: Partial<BreakerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg }
    this.snapshot = {
      steps: 0,
      totalTokens: 0,
      consecutiveNoFileChange: 0,
      warnCount: 0,
      lastFileChangedAt: null,
    }
  }

  /** Call after each agent step. Returns whether to continue. */
  step(tokensUsed: number, fileChanged: boolean): BreakerDecision {
    this.snapshot.steps++
    this.snapshot.totalTokens += tokensUsed

    if (fileChanged) {
      this.snapshot.consecutiveNoFileChange = 0
      this.snapshot.lastFileChangedAt = Date.now()
    } else {
      this.snapshot.consecutiveNoFileChange++
    }

    return this.evaluate()
  }

  private evaluate(): BreakerDecision {
    // 1. Token budget
    if (this.snapshot.totalTokens >= this.cfg.maxTokens) {
      return {
        action: 'terminate',
        reason: `Token budget exhausted: ${this.snapshot.totalTokens} >= ${this.cfg.maxTokens}`,
      }
    }

    // 2. Step limit
    if (this.snapshot.steps >= this.cfg.maxSteps) {
      return {
        action: 'terminate',
        reason: `Step limit reached: ${this.snapshot.steps} >= ${this.cfg.maxSteps}`,
      }
    }

    // 3. No-progress detection
    if (this.snapshot.consecutiveNoFileChange >= this.cfg.maxNoFileChangeSteps) {
      // Escalate warn -> terminate after maxWarns
      if (this.snapshot.warnCount >= this.cfg.maxWarns) {
        return {
          action: 'terminate',
          reason: `No file changes for ${this.snapshot.consecutiveNoFileChange} steps after ${this.cfg.maxWarns} warnings`,
        }
      }
      this.snapshot.warnCount++
      return {
        action: 'warn',
        reason: `No file changes in the last ${this.snapshot.consecutiveNoFileChange} steps. Progress may be stalled.`,
      }
    }

    return { action: 'continue' }
  }

  getSnapshot(): BreakerSnapshot {
    return { ...this.snapshot }
  }

  reset(): void {
    this.snapshot = {
      steps: 0,
      totalTokens: 0,
      consecutiveNoFileChange: 0,
      warnCount: 0,
      lastFileChangedAt: null,
    }
  }
}
