import { describe, it, expect, vi } from 'vitest'
import type {
  ServerMessage,
  UiToolReadResultPayload,
  UiToolResultPayload,
  UiToolWriteResultPayload,
} from '@hip/protocol'
import { buildTerminalTools, TERMINAL_EXEC_DEFAULT_WAIT_MS } from './terminal.js'
import type { ApprovalDecision } from './helpers.js'

function makeBridge() {
  const pendingUiTool = new Map<
    string,
    (
      result: UiToolResultPayload | UiToolReadResultPayload | UiToolWriteResultPayload,
    ) => void
  >()
  const sent: ServerMessage[] = []
  return {
    bridge: {
      send: (m: ServerMessage) => {
        sent.push(m)
        // Auto-resolve with a completed result unless the test overrides.
        if (m.type === 'session:terminalExec:request') {
          queueMicrotask(() => {
            pendingUiTool.get(m.callId)?.({
              type: 'session:uiToolResult',
              sessionId: m.sessionId,
              callId: m.callId,
              ok: true,
              status: 'completed',
              output: '$ ',
            })
          })
        } else if (m.type === 'session:uiToolRead:request') {
          queueMicrotask(() => {
            pendingUiTool.get(m.callId)?.({
              type: 'session:uiToolRead:result',
              sessionId: m.sessionId,
              callId: m.callId,
              ok: true,
              output: 'tail-output',
              cursor: 42,
            })
          })
        }
      },
      pendingUiTool,
    },
    sent,
  }
}

function approval(decision: ApprovalDecision) {
  return vi.fn(async () => decision)
}

describe('terminal tools', () => {
  it('terminal_exec is unavailable without an approval transport (chat)', async () => {
    const { bridge } = makeBridge()
    const [exec] = buildTerminalTools({ sessionId: 's1', bridge })
    const out = await exec.invoke({ command: 'df -h' })
    expect(out).toMatch(/not permitted/)
  })

  it('terminal_exec sends the bridge request after approval and formats completed', async () => {
    const { bridge, sent } = makeBridge()
    const requestApproval = approval({ kind: 'allow_once' })
    const [exec] = buildTerminalTools({ sessionId: 's1', requestApproval, bridge })
    const out = await exec.invoke({ command: 'df -h', wait_ms: 5000 })
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'terminal_exec', kind: 'execute' }),
    )
    const req = sent.find((m) => m.type === 'session:terminalExec:request')
    expect(req).toMatchObject({
      type: 'session:terminalExec:request',
      sessionId: 's1',
      command: 'df -h',
      waitMs: 5000,
      poll: true,
    })
    expect(out).toMatch(/status: completed/)
    expect(out).toMatch(/mayStillRun: false/)
    expect(out).toMatch(/\$ /)
  })

  it('rejected approval never sends the write request', async () => {
    const { bridge, sent } = makeBridge()
    const requestApproval = approval({ kind: 'reject_once' })
    const [exec] = buildTerminalTools({ sessionId: 's1', requestApproval, bridge })
    const out = await exec.invoke({ command: 'df -h' })
    expect(sent.some((m) => m.type === 'session:terminalExec:request')).toBe(false)
    expect(out).toMatch(/rejected/)
  })

  it('full mode auto-approval still resolves through the bridge', async () => {
    const { bridge, sent } = makeBridge()
    const requestApproval = approval({ kind: 'allow_once' })
    const [exec] = buildTerminalTools({ sessionId: 's1', requestApproval, bridge })
    const out = await exec.invoke({ command: 'df -h' })
    expect(sent.some((m) => m.type === 'session:terminalExec:request')).toBe(true)
    expect(out).toMatch(/status: completed/)
  })

  it('timed_out results warn the model not to claim success', async () => {
    const pendingUiTool = new Map<
      string,
      (
        result: UiToolResultPayload | UiToolReadResultPayload | UiToolWriteResultPayload,
      ) => void
    >()
    const sent: ServerMessage[] = []
    const bridge = {
      send: (m: ServerMessage) => {
        sent.push(m)
        if (m.type === 'session:terminalExec:request') {
          queueMicrotask(() => {
            pendingUiTool.get(m.callId)?.({
              type: 'session:uiToolResult',
              sessionId: m.sessionId,
              callId: m.callId,
              ok: true,
              status: 'timed_out',
              mayStillRun: true,
              output: 'partial',
            })
          })
        }
      },
      pendingUiTool,
    }
    const requestApproval = approval({ kind: 'allow_once' })
    const [exec] = buildTerminalTools({ sessionId: 's1', requestApproval, bridge })
    const out = await exec.invoke({ command: 'tail -f /var/log/x.log' })
    expect(out).toMatch(/status: timed_out/)
    expect(out).toMatch(/mayStillRun: true/)
    expect(out).toMatch(/MAY STILL BE RUNNING/)
  })

  it('terminal_read resolves via the read bridge without approval', async () => {
    const { bridge, sent } = makeBridge()
    const [, read] = buildTerminalTools({ sessionId: 's1', bridge })
    const out = await read.invoke({ cursor: 5 })
    const req = sent.find((m) => m.type === 'session:uiToolRead:request')
    expect(req).toMatchObject({ kind: 'terminal_read', cursor: 5 })
    expect(out).toContain('tail-output')
    expect(out).toContain('cursor: 42')
  })

  it('clamps wait_ms to the allowed range', async () => {
    const { bridge, sent } = makeBridge()
    const requestApproval = approval({ kind: 'allow_once' })
    const [exec] = buildTerminalTools({ sessionId: 's1', requestApproval, bridge })
    await exec.invoke({ command: 'df -h', wait_ms: 999999 })
    const req = sent.find((m) => m.type === 'session:terminalExec:request') as {
      waitMs: number
    }
    expect(req.waitMs).toBeLessThanOrEqual(120000)
    await exec.invoke({ command: 'df -h', wait_ms: 10 })
    const req2 = sent.filter((m) => m.type === 'session:terminalExec:request').at(-1) as {
      waitMs: number
    }
    expect(req2.waitMs).toBeGreaterThanOrEqual(1000)
    expect(TERMINAL_EXEC_DEFAULT_WAIT_MS).toBe(15000)
  })

  it('sftp_write sends the write request after approval and reports success', async () => {
    const pendingUiTool = new Map<
      string,
      (result: UiToolResultPayload | UiToolReadResultPayload | UiToolWriteResultPayload) => void
    >()
    const sent: ServerMessage[] = []
    const bridge = {
      send: (m: ServerMessage) => {
        sent.push(m)
        if (m.type === 'session:uiToolWrite:request') {
          queueMicrotask(() => {
            pendingUiTool.get(m.callId)?.({
              type: 'session:uiToolWrite:result',
              sessionId: m.sessionId,
              callId: m.callId,
              ok: true,
            })
          })
        }
      },
      pendingUiTool,
    }
    const requestApproval = approval({ kind: 'allow_once' })
    const [,,, write] = buildTerminalTools({ sessionId: 's1', requestApproval, bridge })
    const out = await write.invoke({ path: '/etc/hosts', content: '127.0.0.1 localhost' })
    const req = sent.find((m) => m.type === 'session:uiToolWrite:request')
    expect(req).toMatchObject({
      type: 'session:uiToolWrite:request',
      path: '/etc/hosts',
      force: false,
    })
    expect(out).toMatch(/Wrote \/etc\/hosts/)
  })
})
