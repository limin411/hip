// packages/sidecar/src/session/skills/dynamic-context.ts
// Dynamic context injection: resolves !`cmd` inline patterns and ```! ``` fenced
// command blocks in skill bodies by executing them as shell commands.
import { execSync } from 'node:child_process'

const MAX_BUFFER = 65536
const DEFAULT_TIMEOUT = 10000

// ── Dangerous-command blocklist ──────────────────────────────────────────────
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-r[fe]?\b/,
  /\bsudo\b/,
  /\bcurl\b.+\|\s*(?:sh|bash)\b/,
  />\/dev\/sd[a-z]/,
  /\bmkfs\./,
  /\bdd\s+if=/,
]

function isDangerousCommand(cmd: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(cmd))
}

// ── Execute a single shell command, returning its stdout (trimmed) ───────────
function executeCommand(
  cmd: string,
  skillDir: string,
  timeout: number,
): string {
  if (isDangerousCommand(cmd)) {
    return `[command blocked: unsafe pattern detected]`
  }

  try {
    const result = execSync(cmd.trim(), {
      cwd: skillDir,
      timeout,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
    })
    return result.trim()
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; stdout?: string; message?: string; killed?: boolean }
    if (execErr.killed) {
      return `[command failed: timed out after ${timeout}ms]`
    }
    const stderr = typeof execErr.stderr === 'string' ? execErr.stderr.trim() : ''
    const stdout = typeof execErr.stdout === 'string' ? execErr.stdout.trim() : ''
    const msg = stderr || stdout || execErr.message || String(err)
    return `[command failed: ${msg}]`
  }
}

// ── Resolve dynamic context in a skill body ──────────────────────────────────

/** Options for resolveDynamicContext. */
export interface ResolveDynamicContextOptions {
  /** When true, all `!cmd` execution is skipped. Default false. */
  disabled?: boolean
  /** Per-command timeout in milliseconds. Default 10000 (10s). */
  timeout?: number
}

/**
 * Scan `body` (a SKILL.md with frontmatter stripped) for inline `!`cmd`` and
 * fenced ```! ... ``` command blocks, execute each via the shell, and replace
 * the placeholder with the command's stdout (trimmed).
 *
 * - Fenced blocks whose opening fence starts with `!` (e.g. ```! or ```!bash)
 *   are ALWAYS treated as command blocks — their content is executed and the
 *   entire ```!...``` span is replaced by the output.
 * - Regular fenced blocks (```python, ```, etc.) are preserved as-is; `!`cmd``
 *   patterns inside them are NOT executed.
 * - Single-pass only: the output of a resolved command is NOT re-scanned for
 *   further `!`cmd`` patterns.
 * - When `options.disabled` is true, ALL command execution is skipped and the
 *   body is returned unchanged.
 * - Dangerous commands (rm -rf, sudo, curl|sh, etc.) are blocked.
 * - On execution error, the placeholder is replaced with a "[command failed: …]"
 *   message.
 *
 * @param body      Skill body text (frontmatter already stripped)
 * @param skillDir  Absolute path to the skill directory (used as cwd for commands)
 * @param options   Execution options
 * @returns         Body with all `!cmd` placeholders resolved
 */
export function resolveDynamicContext(
  body: string,
  skillDir: string,
  options?: ResolveDynamicContextOptions,
): string {
  if (options?.disabled) return body

  const timeout = options?.timeout ?? DEFAULT_TIMEOUT

  // ── Phase 1: Process ```! … ``` fenced command blocks AND mask regular ──
  //    fenced blocks so their contents are left untouched.
  const fencedBlocks = new Map<number, string>()
  let fenceSeq = 0

  // Match all fenced blocks: ```<info>\n<content>\n```
  // info may start with `!` (command block) or be a language name (regular block).
  const FENCED_RE = /```(!?[^\n]*)\n([\s\S]*?)\n```/g

  const afterFences = body.replace(FENCED_RE, (_full: string, info: string, content: string) => {
    const seq = fenceSeq++
    if (info.startsWith('!')) {
      // ── Command block: execute and replace with output ──
      fencedBlocks.set(seq, executeCommand(content, skillDir, timeout))
    } else {
      // ── Regular fenced block: preserve as-is ──
      fencedBlocks.set(seq, '```' + info + '\n' + content + '\n```')
    }
    // Placeholder: must contain no backticks and no `!` to avoid false matches
    // in Phase 2. The __FC__ prefix is unlikely in real skill bodies.
    return `__FC_${seq}__`
  })

  // ── Phase 2: Process inline !`cmd` patterns on the template (which now ──
  //    only contains regular-body text + __FC_N__ placeholders).
  const INLINE_RE = /!`([^`]+)`/g

  const resolved = afterFences.replace(INLINE_RE, (_full: string, cmd: string) => {
    return executeCommand(cmd, skillDir, timeout)
  })

  // ── Phase 3: Restore regular fenced blocks + resolved command outputs ──
  return resolved.replace(/__FC_(\d+)__/g, (_full: string, seqStr: string) => {
    const seq = Number(seqStr)
    return fencedBlocks.has(seq) ? fencedBlocks.get(seq)! : _full
  })
}
