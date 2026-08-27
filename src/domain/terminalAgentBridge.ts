/**
 * UI-mediated shared-PTY bridge (spec §5.2/§9.1).
 *
 * The sidecar never writes the visible SSH terminal. It sends bridge requests;
 * this module asserts the terminal is connected, writes the command into the
 * shared xterm's PTY channel, watches the ring for the completion heuristic,
 * and answers `session:uiToolResult` / `session:uiToolRead:result`.
 */
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { useDomainStore } from './sessionStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalStore } from '@/store/terminalStore'
import {
  useTerminalAgentStore,
  HANDED_OFF_MAX_MS,
  type PendingUiConfirm,
  type TerminalExecFlight,
} from '@/store/terminalAgentStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import {
  commandRuleDecision,
  matchesCommandRule,
  rulePatternFromCommand,
  PRESET_TERMINAL_RULES,
  type CommandRule,
} from './terminalRules'
import { sshWrite } from '@/ipc/ssh'
import { sftpReadFile, sftpWriteFile } from '@/ipc/sftp'
import { isTerminalSession } from '@/lib/sessions'

export const EXEC_OUTPUT_CAP = 64 * 1024
export const EXEC_SILENCE_MS = 500
export const EXEC_POLL_MS = 150
/** FIFO queue: poll interval and per-request wait cap (T3). */
export const EXEC_QUEUE_POLL_MS = 200
export const EXEC_QUEUE_TIMEOUT_MS = 30_000

/** Last line looks like a shell prompt (weak completion signal, spec §5.2). */
export function hasPromptTail(output: string): boolean {
  if (!output.trim()) return false
  const lines = output.replace(/\r/g, '').split('\n')
  const last = lines[lines.length - 1] ?? ''
  return /[$#%>]\s*$/.test(last)
}

/**
 * Detect if the terminal is currently inside a non-bash interactive sub-shell
 * (mysql, python, redis-cli, etc.). The OSC-633 fence uses bash `printf`
 * syntax that these sub-shells cannot parse, so the fence must be skipped.
 */
export function isLikelySubShell(output: string): boolean {
  const lines = output.replace(/\r/g, '').split('\n')
  const last = lines[lines.length - 1] ?? ''
  return /^\s*(?:mysql>\s*|MariaDB\s*\[.*?\]>\s*|>>>\s*|redis>\s*|\(Pdb\)\s*|In\s*\[\d+\]:\s*)/.test(last)
}

export function clipExecOutput(text: string, cap = EXEC_OUTPUT_CAP): string {
  if (text.length <= cap) return text
  return text.slice(0, cap) + `\n…(output truncated to ${Math.round(cap / 1024)}KB)`
}

/** Danger commands that require a UI second confirmation even in full mode (§6). */
const DANGER_PATTERNS: RegExp[] = [
  /\brm\s+(?:-{1,2}[a-z]*[rf][a-z]*[rf][a-z]*|-{2}recursive\b)/,
  /\bmkfs(?:\.\w+)?\b/,
  /\bdd\s+(?:if|of)=/,
  /\bshutdown\b/,
]

/**
 * @deprecated 由 terminalRules 规则集取代（T4）。保留导出供调用方/旧测试迁移。
 */
export function isDangerousCommand(command: string): boolean {
  return DANGER_PATTERNS.some((re) => re.test(command))
}

/** Interactive TUI commands the agent launches but hands the keyboard over (T2). */
const TUI_PATTERNS: RegExp[] = [
  /\b(?:vim|nvim)\b/,
  /\b(?:top|htop)\b/,
  /\bpasswd\b/,
  /\bssh\b/,
]

export function isInteractiveTuiCommand(command: string): boolean {
  return TUI_PATTERNS.some((re) => re.test(command))
}

/** Opt-in exit-code wrapper (P1): prints a machine-readable marker after the command. */
export function wrapForEc(command: string): string {
  return `${command}; printf '\\n__HIP_EC_EXIT=%s\\n' "$?"`
}

export function extractExitCode(output: string): number | null {
  const m = /__HIP_EC_EXIT=(\d+)/.exec(output)
  return m ? Number(m[1]) : null
}

/**
 * Command fence (spec T1 / terminal-shared-pty PR-1): wraps the command so its
 * completion is signaled by an invisible OSC 633 marker carrying the real exit
 * code — no prompt-tail guessing. The marker bytes are ignored by xterm
 * (unregistered OSC → OscHandlerFallback, verified in PR-0), so the user sees
 * only the command itself and its output.
 *
 * The wrapper text is pure ASCII literal escapes (`$'\x1b…'`): the ESC bytes are
 * produced by printf at execution time, so readline never sees raw control bytes
 * in its input buffer (embedding raw ESC in the written text would corrupt the
 * visible command line).
 */
export const FENCE_START = '\x1b]633;A\x1b\\'
export const FENCE_END = '\x1b]633;D;'
export const FENCE_TERM = '\x1b\\'
const FENCE_EXIT_RE = /\x1b\]633;D;(\d+)\x1b\\/g

/** Wrap one command with fence markers (default exec path). */
export function wrapForFence(command: string): string {
  return `printf $'\\x1b]633;A\\x1b\\\\'; ${command}; printf $'\\x1b]633;D;%s\\x1b\\\\' "$?"`
}

/** Last `OSC 633 ; D ; <code> ST` in the output; null when no fence marker. */
export function extractFenceExitCode(output: string): number | null {
  FENCE_EXIT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  let last: string | null = null
  while ((m = FENCE_EXIT_RE.exec(output)) !== null) last = m[1]
  return last === null ? null : Number(last)
}

/** Fence exit code first, legacy __HIP_EC marker as fallback. */
export function extractExecExitCode(output: string): number | null {
  return extractFenceExitCode(output) ?? extractExitCode(output)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function errorMessage(err: unknown): string {
  return typeof err === 'string'
    ? err
    : err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err ?? 'terminal bridge error')
}

/** Resolve the managed terminal for a terminal-surface session (null when invalid). */
export function terminalIdForSession(sessionId: string): string | null {
  const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
  if (!sess || !isTerminalSession(sess.config)) return null
  return sess.config.managedTerminalId ?? null
}

/** Abort callbacks for in-flight execs, keyed by tm_* (flight cancel P1). */
const flightAborters = new Map<string, () => void>()

export function abortExecFlight(terminalId: string): void {
  flightAborters.get(terminalId)?.()
}

/** Confirm-card wait cap (T4): unanswered danger/overwrite prompts are rejected. */
export const CONFIRM_TIMEOUT_MS = 60_000

/** User rules from hip.toml `[terminal]` (T4). */
export function userCommandRules(): CommandRule[] {
  const t = useHipConfigStore.getState().config.terminal
  const rules: CommandRule[] = []
  for (const p of t?.approveRules ?? []) rules.push({ action: 'allow', pattern: p })
  for (const p of t?.denyRules ?? []) rules.push({ action: 'deny', pattern: p })
  return rules
}

function matchedAskRule(command: string, userRules: CommandRule[]): string {
  for (const r of [...userRules, ...PRESET_TERMINAL_RULES]) {
    if (r.action === 'ask' && matchesCommandRule(command, r.pattern)) return r.pattern
  }
  return rulePatternFromCommand(command)
}

/** Ask the UI confirm card; resolves false on timeout or reject. */
export function requestUiConfirm(
  tmId: string,
  confirm: Omit<PendingUiConfirm, 'terminalId' | 'resolve'>,
): Promise<{ ok: boolean; sticky?: 'allow' | 'deny' }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      useTerminalAgentStore.getState().settleConfirm(tmId, { ok: false })
      resolve({ ok: false })
    }, CONFIRM_TIMEOUT_MS)
    useTerminalAgentStore.getState().requestConfirm(tmId, {
      terminalId: tmId,
      ...confirm,
      resolve: (d) => {
        clearTimeout(timer)
        resolve(d)
      },
    })
  })
}

async function runExec(
  msg: Extract<ServerMessage, { type: 'session:terminalExec:request' }>,
  send: (m: ClientMessage) => void,
): Promise<void> {
  const { sessionId, callId } = msg
  const tmId = terminalIdForSession(sessionId)
  if (!tmId) {
    send({ type: 'session:uiToolResult', sessionId, callId, ok: false, status: 'error', error: 'terminal session not bound' })
    return
  }
  const term = useManagedTerminalStore.getState().getTerminal(tmId)
  if (!term) {
    send({ type: 'session:uiToolResult', sessionId, callId, ok: false, status: 'error', error: 'terminal record not found' })
    return
  }
  if (term.status !== 'connected') {
    send({
      type: 'session:uiToolResult',
      sessionId,
      callId,
      ok: true,
      status: 'error',
      mayStillRun: false,
      error: `terminal is ${term.status}; reconnect to run commands`,
    })
    return
  }

  // FIFO queue (T3): a second exec for the same terminal waits in line instead
  // of failing — the head of the queue starts once the single flight is free.
  useTerminalAgentStore.getState().enqueueExec(tmId, {
    ...msg,
    queuedAt: Date.now(),
  })
  for (;;) {
    const queue = useTerminalAgentStore.getState().execQueueByTerminal[tmId] ?? []
    const head = queue[0]
    if (!head || head.callId !== callId) {
      // Not at the head yet — another request is running (or ahead of us).
      if (!queue.some((q) => q.callId === callId)) return
      await sleep(EXEC_QUEUE_POLL_MS)
      continue
    }
    if (Date.now() - head.queuedAt >= EXEC_QUEUE_TIMEOUT_MS) {
      useTerminalAgentStore.getState().dequeueExec(tmId, callId)
      send({
        type: 'session:uiToolResult',
        sessionId,
        callId,
        ok: false,
        status: 'error',
        error:
          'queued_timed_out: another command held this terminal for too long; retry when it finishes',
      })
      return
    }
    if (!useTerminalAgentStore.getState().execFlightByTerminal[tmId]) {
      useTerminalAgentStore.getState().dequeueExec(tmId, callId)
      await runFlight(tmId, msg, send)
      return
    }
    await sleep(EXEC_QUEUE_POLL_MS)
  }
}

/** The single-flight exec body (write + completion polling). */
async function runFlight(
  tmId: string,
  msg: Extract<ServerMessage, { type: 'session:terminalExec:request' }>,
  send: (m: ClientMessage) => void,
): Promise<void> {
  const { sessionId, callId, command, waitMs } = msg
  const wrapEc = msg.wrapEc === true

  // Interactive TUIs are no longer rejected (T2): the agent may start vim/htop/
  // passwd/ssh, but the keyboard is handed to the user immediately after write.
  const tuiLaunch = isInteractiveTuiCommand(command)

  const ring0 = useTerminalStore.getState().getSession(tmId)

  // Auto-detect sub-shells (mysql, python, node, redis, etc.): the OSC-633
  // fence uses bash `printf` syntax that these sub-shells cannot parse, so
  // skip the fence and fall back to prompt-tail completion detection.
  const tailOutput = ring0
    ? useTerminalStore.getState().getRingSince(tmId, Math.max(0, ring0.trimOffset + ring0.ring.length - 512)).output
    : ''
  const useFence = msg.fence !== false && !isLikelySubShell(tailOutput)
  const startCursor = ring0 ? ring0.trimOffset + ring0.ring.length : 0
  const startGeneration = ring0?.generation ?? 0
  const deadline = Date.now() + waitMs
  const flight: TerminalExecFlight = {
    callId,
    sessionId,
    command,
    startedAt: Date.now(),
    deadline,
    phase: 'running',
  }
  useTerminalAgentStore.getState().setExecFlight(tmId, flight)

  let finished = false
  /** Local mirror of the store flight's handed-off marker (closure-safe). */
  let handedOffAt: number | undefined
  const finish = (
    status:
      | 'completed'
      | 'timed_out'
      | 'user_interleaved'
      | 'handed_off_resumed'
      | 'rejected'
      | 'error'
      | 'aborted',
    opts: { output?: string; mayStillRun?: boolean; error?: string } = {},
  ) => {
    if (finished) return
    finished = true
    flightAborters.delete(tmId)
    useTerminalAgentStore.getState().setExecFlight(tmId, null)
    const { output } = useTerminalStore.getState().getRingSince(tmId, startCursor)
    const exitCode = extractExecExitCode(output)
    send({
      type: 'session:uiToolResult',
      sessionId,
      callId,
      ok: status !== 'error',
      status,
      ...(opts.output !== undefined || output
        ? { output: clipExecOutput(opts.output ?? output) }
        : {}),
      ...(opts.mayStillRun !== undefined ? { mayStillRun: opts.mayStillRun } : {}),
      ...(exitCode !== null ? { exitCode } : {}),
      ...(opts.error ? { error: opts.error } : {}),
    })
  }
  flightAborters.set(tmId, () => {
    finish('aborted', { mayStillRun: true, error: 'waiting aborted by user' })
  })

  // Enter handed_off: keyboard ownership → user, deadline pause starts (T2).
  const enterHandedOff = () => {
    if (handedOffAt !== undefined) return
    handedOffAt = Date.now()
    const liveFlight = useTerminalAgentStore.getState().execFlightByTerminal[tmId]
    useTerminalAgentStore.getState().setExecFlight(tmId, {
      ...(liveFlight ?? flight),
      phase: 'handed_off',
      handedOffAt,
    })
    useTerminalAgentStore.getState().setDriver(tmId, 'user')
  }

  try {
    // Danger commands get a UI second confirmation even after sidecar auto-approval.
    // Rule-based danger gating (T4): deny → reject; ask → UI confirm card;
    // allow → run without a second prompt. Replaces window.confirm + regex.
    const userRules: CommandRule[] = userCommandRules()
    const ruleDecision = commandRuleDecision(command, { userRules })
    if (ruleDecision === 'deny') {
      finish('rejected', {
        mayStillRun: false,
        error: 'command blocked by a deny rule — nothing was written to the terminal',
      })
      return
    }
    if (ruleDecision === 'ask') {
      const decision = await requestUiConfirm(tmId, {
        kind: 'danger',
        title: command,
        detail: `matched rule: ${matchedAskRule(command, userRules)}`,
      })
      if (!decision.ok) {
        finish('rejected', {
          mayStillRun: false,
          error: 'dangerous command rejected by user',
        })
        return
      }
    }
    // One-keyboard principle (T3.3): reject writes while the user holds the keyboard.
    // This prevents the agent from writing while the user is typing (handed_off state).
    const currentDriver = useTerminalAgentStore.getState().driverByTerminal[tmId]
    if (currentDriver === 'user') {
      finish('error', {
        mayStillRun: false,
        error: 'handed_off: user holds the keyboard — wait for the user to hand back control',
      })
      return
    }
    await sshWrite(tmId, `${useFence ? wrapForFence(command) : wrapEc ? wrapForEc(command) : command}\n`)
  } catch (err) {
    finish('error', { mayStillRun: false, error: errorMessage(err) })
    return
  }

  let lastOutputAt = Date.now()
  let lastLen = ring0?.ring.length ?? 0
  for (;;) {
    if (finished) return
    await sleep(EXEC_POLL_MS)
    if (finished) return
    const live = useManagedTerminalStore.getState().getTerminal(tmId)
    if (!live || live.status !== 'connected') {
      finish('error', {
        mayStillRun: true,
        error: `terminal_closed: terminal is ${live?.status ?? 'missing'} — reconnect the SSH session before retrying`,
      })
      return
    }
    // Ring generation drift (T5): reconnect / pty restart rebuilds the ring and
    // invalidates our write cursor — explicit ring_reset instead of a generic abort.
    const curGen = useTerminalStore.getState().getSession(tmId)?.generation
    if (curGen !== undefined && curGen !== startGeneration) {
      finish('error', {
        mayStillRun: true,
        error:
          'ring_reset: terminal was reconnected and its output buffer reset — re-read the terminal before continuing',
      })
      return
    }
    const liveFlight = useTerminalAgentStore.getState().execFlightByTerminal[tmId]
    const phase = liveFlight?.phase ?? 'running'
    // Keyboard take-over: user typed while the agent drove (T2). TUI launches
    // (vim/htop/passwd/ssh) hand over immediately after write — never driven
    // automatically, but no longer rejected either.
    if (phase === 'running' && (useTerminalStore.getState().consumeUserInterleaved(tmId) || tuiLaunch)) {
      enterHandedOff()
      continue
    }
    if (
      phase === 'handed_off' &&
      Date.now() - ((liveFlight as TerminalExecFlight).handedOffAt ?? Date.now()) >= HANDED_OFF_MAX_MS
    ) {
      finish('handed_off_resumed', {
        mayStillRun: true,
        error: 'user did not hand the keyboard back within the pause limit',
      })
      return
    }
    const sess = useTerminalStore.getState().getSession(tmId)
    const len = sess?.ring.length ?? 0
    if (len !== lastLen) {
      lastOutputAt = Date.now()
      lastLen = len
    }
    // Completion signals: fence D-marker (authoritative, T1) → prompt-tail fallback.
    const { output } = useTerminalStore.getState().getRingSince(tmId, startCursor)
    const fenceDone = useFence && extractFenceExitCode(output) !== null
    const promptDone = Date.now() - lastOutputAt >= EXEC_SILENCE_MS && hasPromptTail(output)
    if (fenceDone || promptDone) {
      finish(handedOffAt !== undefined ? 'user_interleaved' : 'completed', { output })
      return
    }
    // Deadline — paused while handed_off (resume extends it by the pause).
    if (phase !== 'handed_off' && Date.now() >= deadline) {
      finish(handedOffAt !== undefined ? 'user_interleaved' : 'timed_out', { mayStillRun: true })
      return
    }
  }
}

async function runRead(
  msg: Extract<ServerMessage, { type: 'session:uiToolRead:request' }>,
  send: (m: ClientMessage) => void,
): Promise<void> {
  const { sessionId, callId, kind } = msg
  const tmId = terminalIdForSession(sessionId)
  if (!tmId) {
    send({ type: 'session:uiToolRead:result', sessionId, callId, ok: false, error: 'terminal session not bound' })
    return
  }
  if (kind === 'terminal_read') {
    const sess = useTerminalStore.getState().getSession(tmId)
    const end = sess ? sess.trimOffset + sess.ring.length : 0
    const cursor = typeof msg.cursor === 'number' ? msg.cursor : Math.max(0, end - 4096)
    const { output, truncated } = useTerminalStore.getState().getRingSince(tmId, cursor)
    send({
      type: 'session:uiToolRead:result',
      sessionId,
      callId,
      ok: true,
      output: clipExecOutput(truncated ? `…(ring trimmed; showing retained output)\n${output}` : output),
      cursor: end,
    })
    return
  }
  // sftp_read
  if (!msg.path) {
    send({ type: 'session:uiToolRead:result', sessionId, callId, ok: false, error: 'path is required' })
    return
  }
  try {
    const output = await sftpReadFile(tmId, msg.path, msg.maxBytes ?? 256 * 1024)
    send({ type: 'session:uiToolRead:result', sessionId, callId, ok: true, output })
  } catch (err) {
    send({ type: 'session:uiToolRead:result', sessionId, callId, ok: false, error: errorMessage(err) })
  }
}

async function runWrite(
  msg: Extract<ServerMessage, { type: 'session:uiToolWrite:request' }>,
  send: (m: ClientMessage) => void,
): Promise<void> {
  const { sessionId, callId, path, content, force } = msg
  const tmId = terminalIdForSession(sessionId)
  if (!tmId) {
    send({ type: 'session:uiToolWrite:result', sessionId, callId, ok: false, error: 'terminal session not bound' })
    return
  }
  const term = useManagedTerminalStore.getState().getTerminal(tmId)
  if (!term || term.status !== 'connected') {
    send({
      type: 'session:uiToolWrite:result',
      sessionId,
      callId,
      ok: false,
      error: `terminal is ${term?.status ?? 'missing'}; reconnect to write files`,
    })
    return
  }
  if (!force) {
    // Overwrite of an existing path needs a UI second confirmation (T4 confirm card).
    let exists = false
    try {
      await sftpReadFile(tmId, path, 1)
      exists = true
    } catch {
      exists = false
    }
    if (exists) {
      const decision = await requestUiConfirm(tmId, {
        kind: 'overwrite',
        title: path,
      })
      if (!decision.ok) {
        send({
          type: 'session:uiToolWrite:result',
          sessionId,
          callId,
          ok: false,
          error: 'overwrite rejected by user',
        })
        return
      }
    }
  }
  try {
    await sftpWriteFile(tmId, path, content, force)
    send({ type: 'session:uiToolWrite:result', sessionId, callId, ok: true })
  } catch (err) {
    send({
      type: 'session:uiToolWrite:result',
      sessionId,
      callId,
      ok: false,
      error: errorMessage(err),
    })
  }
}

/**
 * Route sidecar bridge requests. Returns true when the message was consumed
 * (the caller must not treat it as a regular store message).
 */
export function handleTerminalBridgeMessage(
  msg: ServerMessage,
  send: (m: ClientMessage) => void,
): boolean {
  if (msg.type === 'session:terminalExec:request') {
    void runExec(msg, send)
    return true
  }
  if (msg.type === 'session:uiToolRead:request') {
    void runRead(msg, send)
    return true
  }
  if (msg.type === 'session:uiToolWrite:request') {
    void runWrite(msg, send)
    return true
  }
  return false
}
