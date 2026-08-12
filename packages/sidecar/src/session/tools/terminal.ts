/**
 * Terminal-surface tools (shared-PTY bridge, spec §5).
 *
 * The sidecar never writes the PTY itself — the UI owns the visible xterm. These
 * tools send bridge requests over WS, wait for the UI to answer, and return the
 * result to the model with an explicit uncertainty status (D10).
 */
import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type {
  ServerMessage,
  UiToolReadResultPayload,
  UiToolResultPayload,
  UiToolWriteResultPayload,
} from '@hip/protocol'
import { z } from 'zod'
import { clipText, isApproved } from './helpers.js'
import type { ApprovalFn } from './helpers.js'

export const TERMINAL_EXEC_DEFAULT_WAIT_MS = 15_000
export const TERMINAL_EXEC_MAX_WAIT_MS = 120_000
export const TERMINAL_OUTPUT_CAP = 64 * 1024
export const SFTP_READ_CAP = 256 * 1024

export interface TerminalUiBridge {
  send: (msg: ServerMessage) => void
  pendingUiTool: Map<
    string,
    (
      result:
        | UiToolResultPayload
        | UiToolReadResultPayload
        | UiToolWriteResultPayload,
    ) => void
  >
}

export interface TerminalToolOpts {
  sessionId: string
  requestApproval?: ApprovalFn
  bridge?: TerminalUiBridge
  signal?: AbortSignal
}

function clampWaitMs(value: unknown): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : TERMINAL_EXEC_DEFAULT_WAIT_MS
  return Math.max(1_000, Math.min(TERMINAL_EXEC_MAX_WAIT_MS, Math.round(raw)))
}

/** Await a bridge answer; resolve 'aborted' on signal/turn cancel. */
function waitForUi(
  bridge: TerminalUiBridge,
  callId: string,
  signal?: AbortSignal,
): Promise<UiToolResultPayload | UiToolReadResultPayload | UiToolWriteResultPayload> {
  return new Promise((resolve) => {
    const onAbort = () => {
      bridge.pendingUiTool.delete(callId)
      resolve({
        type: 'session:uiToolResult',
        sessionId: '',
        callId,
        ok: false,
        status: 'aborted',
        error: 'aborted',
      })
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    bridge.pendingUiTool.set(callId, (result) => {
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    })
  })
}

function formatExecResult(result: UiToolResultPayload): string {
  if (!result.ok) {
    return `terminal_exec failed (${result.status}): ${result.error ?? 'unknown error'}`
  }
  const lines = [
    `status: ${result.status}`,
    `mayStillRun: ${result.mayStillRun === true}`,
  ]
  if (result.exitCode !== undefined && result.exitCode !== null) {
    lines.push(`exitCode: ${result.exitCode}`)
  }
  if (result.output) lines.push('--- terminal output ---', result.output)
  if (result.status === 'timed_out') {
    lines.push(
      'The command MAY STILL BE RUNNING. Never claim success. Poll terminal_read or ask the user.',
    )
  } else if (result.status === 'user_interleaved') {
    lines.push(
      'User input interleaved with the command output; treat the result cautiously and confirm with the user if uncertain.',
    )
  } else if (result.status === 'rejected') {
    lines.push('The command was rejected by the user and was NOT written to the terminal.')
  }
  return lines.join('\n')
}

/** Build the terminal-surface tool set: terminal_exec / terminal_read / sftp_read. */
export function buildTerminalTools(opts: TerminalToolOpts): StructuredToolInterface[] {
  const { sessionId, requestApproval, bridge, signal } = opts

  const execTool = tool(
    async (input: {
      command: string
      reason?: string
      wait_ms?: number
      poll?: boolean
      wrapEc?: boolean
      fence?: boolean
    }) => {
      if (!bridge) return 'Error: terminal bridge is not available for this session'
      if (!requestApproval) return 'Error: terminal_exec is not permitted in this permission mode'
      const command = input.command.trim()
      if (!command) return 'Error: command is required'
      const waitMs = clampWaitMs(input.wait_ms)
      const decision = await requestApproval({
        title: 'Run in SSH terminal',
        toolName: 'terminal_exec',
        kind: 'execute',
        content: input.reason ? `${command}\n\n# ${input.reason}` : command,
        meta: { waitMs, callId: `terminal-exec-${randomUUID().slice(0, 8)}` },
      })
      if (!isApproved(decision)) {
        return formatExecResult({
          type: 'session:uiToolResult',
          sessionId,
          callId: `terminal-exec-${randomUUID().slice(0, 8)}`,
          ok: true,
          status: 'rejected',
          mayStillRun: false,
        })
      }

      const callId = `terminal-exec-${randomUUID().slice(0, 8)}`
      const pending = waitForUi(bridge, callId, signal)
      bridge.send({
        type: 'session:terminalExec:request',
        sessionId,
        callId,
        command,
        waitMs,
        poll: input.poll !== false,
        ...(input.wrapEc === true ? { wrapEc: true } : {}),
        ...(input.fence !== false ? { fence: true } : {}),
      })
      const raw = await pending
      if (raw.type === 'session:uiToolRead:result') {
        return 'Error: unexpected read bridge answer for terminal_exec'
      }
      return formatExecResult(raw)
    },
    {
      name: 'terminal_exec',
      description:
        'Run one command in the SSH managed terminal the user is looking at (shared PTY). ' +
        'The command is typed into the visible terminal after user approval. By default the ' +
        'command is wrapped in an invisible fence (OSC 633 semantics): the UI signals ' +
        'completion with the real exit code instead of guessing from the prompt. ' +
        'Returns the captured output with an explicit status: completed / timed_out / ' +
        'user_interleaved / rejected / error / aborted. ' +
        'A timed_out result means the command MAY STILL BE RUNNING — never claim success; poll terminal_read or ask the user. ' +
        'Prefer non-interactive flags (-y, --noconfirm, DEBIAN_FRONTEND=noninteractive). ' +
        'Commands ending in exit/exec are incompatible with the fence (the marker never prints); set fence:false for them.',
      schema: z.object({
        command: z.string().describe('single shell command to run (no trailing newline)'),
        reason: z.string().optional().describe('why this command is needed (shown in the approval prompt)'),
        wait_ms: z.number().optional().describe('max milliseconds to wait for output (default 15000, max 120000)'),
        poll: z.boolean().optional().describe('poll the terminal ring before returning (default true)'),
        wrapEc: z.boolean().optional().describe('legacy __HIP_EC wrapper; prefer the default fence'),
        fence: z.boolean().optional().describe('invisible OSC-633 completion fence (default true); set false for exit/exec-ending commands'),
      }),
    },
  )

  const readTool = tool(
    async (input: { cursor?: number; max_bytes?: number }) => {
      if (!bridge) return 'Error: terminal bridge is not available for this session'
      const callId = `terminal-read-${randomUUID().slice(0, 8)}`
      const pending = waitForUi(bridge, callId, signal)
      bridge.send({
        type: 'session:uiToolRead:request',
        sessionId,
        callId,
        kind: 'terminal_read',
        ...(typeof input.cursor === 'number' ? { cursor: input.cursor } : {}),
        ...(typeof input.max_bytes === 'number' ? { maxBytes: input.max_bytes } : {}),
      })
      const raw = await pending
      if (raw.type === 'session:uiToolResult') {
        return raw.ok ? (raw.output ?? '') : `terminal_read failed: ${raw.error ?? 'unknown'}`
      }
      if (!raw.ok) return `terminal_read failed: ${raw.error ?? 'unknown'}`
      const out = clipText(raw.output ?? '', TERMINAL_OUTPUT_CAP)
      return raw.cursor !== undefined
        ? `${out}\n(cursor: ${raw.cursor})`
        : out
    },
    {
      name: 'terminal_read',
      description:
        'Read recent output from the SSH managed terminal ring (read-only, no HITL). ' +
        'Use after terminal_exec timed_out to poll for more output, or to inspect the current terminal state.',
      schema: z.object({
        cursor: z.number().optional().describe('absolute ring cursor to read from (omit for the tail)'),
        max_bytes: z.number().optional().describe('max bytes to return (default 64KB)'),
      }),
    },
  )

  const sftpReadTool = tool(
    async (input: { path: string; max_bytes?: number }) => {
      if (!bridge) return 'Error: terminal bridge is not available for this session'
      const callId = `sftp-read-${randomUUID().slice(0, 8)}`
      const pending = waitForUi(bridge, callId, signal)
      bridge.send({
        type: 'session:uiToolRead:request',
        sessionId,
        callId,
        kind: 'sftp_read',
        path: input.path,
        ...(typeof input.max_bytes === 'number' ? { maxBytes: input.max_bytes } : {}),
      })
      const raw = await pending
      if (raw.type === 'session:uiToolResult') {
        return raw.ok ? (raw.output ?? '') : `sftp_read failed: ${raw.error ?? 'unknown'}`
      }
      if (!raw.ok) return `sftp_read failed: ${raw.error ?? 'unknown'}`
      return clipText(raw.output ?? '', SFTP_READ_CAP)
    },
    {
      name: 'sftp_read',
      description:
        'Read a text file from the remote SSH host via SFTP (read-only, no HITL, capped at 256KB). ' +
        'Use an absolute remote path. Never assume the file exists at a local path.',
      schema: z.object({
        path: z.string().describe('absolute remote file path'),
        max_bytes: z.number().optional().describe('max bytes to return (default 256KB)'),
      }),
    },
  )

  const sftpWriteTool = tool(
    async (input: { path: string; content: string; force?: boolean; reason?: string }) => {
      if (!bridge) return 'Error: terminal bridge is not available for this session'
      if (!requestApproval) return 'Error: sftp_write is not permitted in this permission mode'
      if (!input.path.trim()) return 'Error: path is required'
      const decision = await requestApproval({
        title: 'Write remote file (SFTP)',
        toolName: 'sftp_write',
        kind: 'write',
        content: input.reason
          ? `${input.path}\n\n# ${input.reason}`
          : input.path,
        meta: { callId: `sftp-write-${randomUUID().slice(0, 8)}` },
      })
      if (!isApproved(decision)) {
        return 'sftp_write rejected by the user; nothing was written.'
      }
      const callId = `sftp-write-${randomUUID().slice(0, 8)}`
      const pending = waitForUi(bridge, callId, signal)
      bridge.send({
        type: 'session:uiToolWrite:request',
        sessionId,
        callId,
        path: input.path,
        content: input.content,
        force: input.force === true,
      })
      const raw = await pending
      if (raw.type === 'session:uiToolResult' || raw.type === 'session:uiToolRead:result') {
        return `Error: unexpected bridge answer for sftp_write: ${raw.type}`
      }
      return raw.ok
        ? `Wrote ${input.path} via SFTP.`
        : `sftp_write failed: ${raw.error ?? 'unknown error'}`
    },
    {
      name: 'sftp_write',
      description:
        'Write a text file to the remote SSH host via SFTP (HITL-approved, P2). ' +
        'Requires approval; overwriting an existing file asks for a second confirmation in the UI.',
      schema: z.object({
        path: z.string().describe('absolute remote file path'),
        content: z.string().describe('file content to write'),
        force: z.boolean().optional().describe('skip the overwrite confirmation when true'),
        reason: z.string().optional().describe('why this write is needed (approval prompt)'),
      }),
    },
  )

  return [execTool, readTool, sftpReadTool, sftpWriteTool]
}
