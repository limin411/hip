/**
 * terminalAgentBridge fence 集成测试（terminal-shared-pty PR-1，spec T1）。
 *
 * 用真实 zustand stores + mock sshWrite 驱动 handleTerminalBridgeMessage：
 *   - fence 默认路径：D marker 出现 → completed + exitCode（不等 prompt/silence）
 *   - fence:false → 行为回归现状（prompt-tail 兜底 / timed_out）
 *   - 写入文本为 wrapForFence 围栏格式（命令本体可见）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ClientMessage, ServerMessage, SessionConfig } from '@hip/protocol'
import { handleTerminalBridgeMessage, FENCE_END, FENCE_TERM } from './terminalAgentBridge'
import { useDomainStore } from './sessionStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalStore } from '@/store/terminalStore'
import { useTerminalAgentStore, HANDED_OFF_MAX_MS } from '@/store/terminalAgentStore'

vi.mock('@/ipc/ssh', () => ({
  sshWrite: vi.fn(),
  sftpReadFile: vi.fn(),
  sftpWriteFile: vi.fn(),
}))

import { sshWrite } from '@/ipc/ssh'

const TM_ID = 'tm_fence_test'
const SESSION_ID = 's_fence_test'

function seedStores() {
  useDomainStore.setState({
    sessions: [
      {
        id: SESSION_ID,
        title: 'fence test',
        updatedAtMs: 1,
        createdAtMs: 1,
        pinned: false,
        config: {
          surface: 'terminal',
          managedTerminalId: TM_ID,
          hostId: 'h1',
        } as SessionConfig,
        messages: [],
      },
    ],
  } as never)
  useManagedTerminalStore.setState({
    terminals: [
      {
        id: TM_ID,
        kind: 'ssh',
        title: 'prod-box',
        hostId: 'h1',
        status: 'connected',
        createdAt: 1,
      },
    ],
  } as never)
  useTerminalStore.getState().ensureSession(TM_ID)
}

function bridgeRequest(overrides: Partial<Extract<ServerMessage, { type: 'session:terminalExec:request' }>> = {}): {
  sent: ClientMessage[]
  msg: Extract<ServerMessage, { type: 'session:terminalExec:request' }>
} {
  const sent: ClientMessage[] = []
  const msg = {
    type: 'session:terminalExec:request',
    sessionId: SESSION_ID,
    callId: 'call-1',
    command: 'df -h',
    waitMs: 5000,
    poll: true,
    ...overrides,
  } as Extract<ServerMessage, { type: 'session:terminalExec:request' }>
  handleTerminalBridgeMessage(msg, (m) => sent.push(m))
  return { sent, msg }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('terminal bridge fence (PR-1)', () => {
  beforeEach(() => {
    vi.mocked(sshWrite).mockClear().mockResolvedValue(undefined as never)
    useTerminalAgentStore.setState({ execFlightByTerminal: {} })
    // Fresh ring per test — a stale marker/body from a previous test must not leak.
    useTerminalStore.setState({ bySession: {}, userInterleaved: {} })
    seedStores()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the fenced command into the shared PTY', async () => {
    const { msg } = bridgeRequest()
    await sleep(250)
    const written = vi.mocked(sshWrite).mock.calls[0]?.[1] ?? ''
    expect(written).toContain('df -h')
    // Fence wrapper: ASCII-literal escapes (no raw ESC bytes) so readline stays intact.
    expect(written.startsWith("printf $'\\x1b]633;A\\x1b\\\\';")).toBe(true)
    expect(written).toContain("printf $'\\x1b]633;D;%s\\x1b\\\\' \"$?\"")
    void msg
  })

  it('completes with the real exit code as soon as the fence D marker appears', async () => {
    const { sent } = bridgeRequest()
    await sleep(300)
    useTerminalStore.getState().appendRing(TM_ID, `${FENCE_END}0${FENCE_TERM}`)
    await sleep(500)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({
      type: 'session:uiToolResult',
      ok: true,
      status: 'completed',
      exitCode: 0,
    })
  })

  it('carries a nonzero fence exit code', async () => {
    const { sent } = bridgeRequest()
    await sleep(300)
    useTerminalStore.getState().appendRing(TM_ID, `${FENCE_END}2${FENCE_TERM}`)
    await sleep(500)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'completed', exitCode: 2 })
  })

  it('still falls back to prompt-tail completion when fence is disabled', async () => {
    const { sent } = bridgeRequest({ fence: false })
    await sleep(300)
    useTerminalStore.getState().appendRing(TM_ID, 'Filesystem  Size\n$ ')
    // prompt-tail check runs after EXEC_SILENCE_MS (500ms) of quiet; give it room.
    await sleep(1100)
    console.log('DBG sent:', JSON.stringify(sent))
    console.log('DBG ring:', JSON.stringify(useTerminalStore.getState().getSession(TM_ID)?.ring))
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'completed' })
    // No fence marker → no exitCode field in the payload (prompt-tail path).
    expect(result && 'exitCode' in result ? (result as { exitCode?: number }).exitCode : null).toBeNull()
  })

  it('times out without a fence marker and no prompt tail (mayStillRun)', async () => {
    const { sent } = bridgeRequest({ waitMs: 1000 })
    await sleep(1500)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'timed_out', mayStillRun: true })
  })
})

describe('terminal bridge handed-off state machine (PR-2, spec T2)', () => {
  beforeEach(() => {
    vi.mocked(sshWrite).mockClear().mockResolvedValue(undefined as never)
    useTerminalAgentStore.setState({ execFlightByTerminal: {}, driverByTerminal: {} })
    useTerminalStore.setState({ bySession: {}, userInterleaved: {} })
    seedStores()
    vi.useRealTimers()
  })

  it('user typing flips the flight to handed_off and pauses the deadline', async () => {
    const { sent } = bridgeRequest({ waitMs: 800 })
    await sleep(300)
    // User types into the shared terminal while the agent drives.
    useTerminalStore.getState().noteUserInput(TM_ID)
    await sleep(400)
    const flight = useTerminalAgentStore.getState().execFlightByTerminal[TM_ID]
    expect(flight?.phase).toBe('handed_off')
    expect(useTerminalAgentStore.getState().driverByTerminal[TM_ID]).toBe('user')
    // Deadline paused: waitMs 800ms has long passed but no timed_out yet.
    await sleep(700)
    expect(sent.some((m) => m.type === 'session:uiToolResult')).toBe(false)
  })

  it('handing back resumes the flight and completes with user_interleaved', async () => {
    const { sent } = bridgeRequest({ waitMs: 800 })
    await sleep(300)
    useTerminalStore.getState().noteUserInput(TM_ID)
    await sleep(400)
    useTerminalAgentStore.getState().resumeExecFlight(TM_ID)
    await sleep(200)
    useTerminalStore.getState().appendRing(TM_ID, `${FENCE_END}0${FENCE_TERM}`)
    await sleep(500)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'user_interleaved', exitCode: 0 })
    expect(useTerminalAgentStore.getState().execFlightByTerminal[TM_ID]).toBeNull()
  })

  it('interactive TUI commands launch, hand over immediately, and complete on exit', async () => {
    const { sent } = bridgeRequest({ command: 'vim /etc/hosts' })
    await sleep(350)
    const flight = useTerminalAgentStore.getState().execFlightByTerminal[TM_ID]
    expect(flight?.phase).toBe('handed_off')
    // User exits vim → the fence D marker appears → completed (user_interleaved).
    useTerminalStore.getState().appendRing(TM_ID, `${FENCE_END}0${FENCE_TERM}`)
    await sleep(500)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'user_interleaved', exitCode: 0 })
    expect(sent.some((m) => m.type === 'session:uiToolResult' && 'status' in m && m.status === 'rejected')).toBe(false)
  })

  it('a stalled handed-off flight is closed as handed_off_resumed after the pause limit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const now = Date.now()
    vi.setSystemTime(now)
    const { sent } = bridgeRequest({ waitMs: 10000 })
    await sleep(300)
    useTerminalStore.getState().noteUserInput(TM_ID)
    await sleep(400)
    // Advance past HANDED_OFF_MAX_MS without handing back.
    vi.setSystemTime(now + HANDED_OFF_MAX_MS + 1000)
    await sleep(700)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'handed_off_resumed', mayStillRun: true })
  })
})
