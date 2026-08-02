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
import { useTerminalAgentStore, type TerminalExecFlight } from '@/store/terminalAgentStore'
import { sshWrite } from '@/ipc/ssh'
import { sftpReadFile } from '@/ipc/sftp'
import { isTerminalSession } from '@/lib/sessions'

export const EXEC_OUTPUT_CAP = 64 * 1024
export const EXEC_SILENCE_MS = 500
export const EXEC_POLL_MS = 150

/** Last line looks like a shell prompt (weak completion signal, spec §5.2). */
export function hasPromptTail(output: string): boolean {
  if (!output.trim()) return false
  const lines = output.replace(/\r/g, '').split('\n')
  const last = lines[lines.length - 1] ?? ''
  return /[$#%>]\s*$/.test(last)
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

/** Interactive TUI commands the agent must not drive automatically (§6). */
const TUI_PATTERNS: RegExp[] = [
  /\b(?:vim|nvim)\b/,
  /\b(?:top|htop)\b/,
  /\bpasswd\b/,
  /\bssh\b/,
]

export function isDangerousCommand(command: string): boolean {
  return DANGER_PATTERNS.some((re) => re.test(command))
}

export function isInteractiveTuiCommand(command: string): boolean {
  return TUI_PATTERNS.some((re) => re.test(command))
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

async function runExec(
  msg: Extract<ServerMessage, { type: 'session:terminalExec:request' }>,
  send: (m: ClientMessage) => void,
): Promise<void> {
  const { sessionId, callId, command, waitMs } = msg
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
  const existing = useTerminalAgentStore.getState().execFlightByTerminal[tmId]
  if (existing) {
    send({
      type: 'session:uiToolResult',
      sessionId,
      callId,
      ok: false,
      status: 'error',
      error: 'another command is already running on this terminal',
    })
    return
  }

  // P1 guard folded into the bridge: interactive TUIs are never driven automatically.
  if (isInteractiveTuiCommand(command)) {
    send({
      type: 'session:uiToolResult',
      sessionId,
      callId,
      ok: true,
      status: 'rejected',
      mayStillRun: false,
      error:
        'interactive command (vim/nvim/top/htop/passwd/ssh) blocked — run it manually in the terminal',
    })
    return
  }

  const ring0 = useTerminalStore.getState().getSession(tmId)
  const startCursor = ring0 ? ring0.trimOffset + ring0.ring.length : 0
  const deadline = Date.now() + waitMs
  const flight: TerminalExecFlight = {
    callId,
    sessionId,
    command,
    startedAt: Date.now(),
    deadline,
  }
  useTerminalAgentStore.getState().setExecFlight(tmId, flight)

  let finished = false
  const finish = (
    status: 'completed' | 'timed_out' | 'user_interleaved' | 'rejected' | 'error' | 'aborted',
    opts: { output?: string; mayStillRun?: boolean; error?: string } = {},
  ) => {
    if (finished) return
    finished = true
    flightAborters.delete(tmId)
    useTerminalAgentStore.getState().setExecFlight(tmId, null)
    const { output } = useTerminalStore.getState().getRingSince(tmId, startCursor)
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
      ...(opts.error ? { error: opts.error } : {}),
    })
  }
  flightAborters.set(tmId, () => {
    useTerminalStore.getState().consumeUserInterleaved(tmId)
    finish('aborted', { mayStillRun: true, error: 'waiting aborted by user' })
  })

  try {
    // Danger commands get a UI second confirmation even after sidecar auto-approval.
    if (isDangerousCommand(command) && !window.confirm(`Run dangerous command?\n\n${command}`)) {
      finish('rejected', { mayStillRun: false, error: 'dangerous command rejected by user' })
      return
    }
    await sshWrite(tmId, `${command}\n`)
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
    const sess = useTerminalStore.getState().getSession(tmId)
    const len = sess?.ring.length ?? 0
    if (len !== lastLen) {
      lastOutputAt = Date.now()
      lastLen = len
    }
    const live = useManagedTerminalStore.getState().getTerminal(tmId)
    if (!live || live.status !== 'connected') {
      finish('aborted', { mayStillRun: true, error: 'terminal disconnected during execution' })
      return
    }
    if (Date.now() >= deadline) {
      const interleaved = useTerminalStore.getState().consumeUserInterleaved(tmId)
      finish(interleaved ? 'user_interleaved' : 'timed_out', { mayStillRun: true })
      return
    }
    if (Date.now() - lastOutputAt >= EXEC_SILENCE_MS) {
      const { output } = useTerminalStore.getState().getRingSince(tmId, startCursor)
      if (hasPromptTail(output)) {
        const interleaved = useTerminalStore.getState().consumeUserInterleaved(tmId)
        finish(interleaved ? 'user_interleaved' : 'completed', { output })
        return
      }
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
  return false
}
