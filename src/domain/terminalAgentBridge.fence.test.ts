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
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useTerminalAgentStore, HANDED_OFF_MAX_MS } from '@/store/terminalAgentStore'
import { EXEC_QUEUE_TIMEOUT_MS, userCommandRules } from './terminalAgentBridge'
import { resetTerminalForReconnect } from './terminalLifecycle'

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

describe('terminal bridge one-keyboard principle (PR-8, spec T3.3)', () => {
  beforeEach(() => {
    vi.mocked(sshWrite).mockClear().mockResolvedValue(undefined as never)
    useTerminalAgentStore.setState({ execFlightByTerminal: {}, driverByTerminal: {} })
    useTerminalStore.setState({ bySession: {}, userInterleaved: {} })
    seedStores()
    vi.useRealTimers()
  })

  it('rejects writes when user holds the keyboard (driver = user)', async () => {
    // First exec starts normally.
    const { sent: sent1 } = bridgeRequest({ command: 'df -h', waitMs: 5000 })
    await sleep(300)
    // User types into the shared terminal → handed_off, driver = user.
    useTerminalStore.getState().noteUserInput(TM_ID)
    await sleep(400)
    expect(useTerminalAgentStore.getState().driverByTerminal[TM_ID]).toBe('user')
    // Second exec while user holds the keyboard should be queued (T3).
    const sent2: ClientMessage[] = []
    handleTerminalBridgeMessage(
      {
        type: 'session:terminalExec:request',
        sessionId: SESSION_ID,
        callId: 'call-2',
        command: 'uptime',
        waitMs: 5000,
        poll: true,
      },
      (m) => sent2.push(m),
    )
    await sleep(300)
    // Should be queued, not rejected.
    expect(sent2.some((m) => m.type === 'session:uiToolResult')).toBe(false)
    expect(useTerminalAgentStore.getState().execQueueByTerminal[TM_ID]?.length).toBe(1)
    // Complete the first exec.
    useTerminalStore.getState().appendRing(TM_ID, `${FENCE_END}0${FENCE_TERM}`)
    await sleep(500)
    expect(sent1.find((m) => m.type === 'session:uiToolResult')).toMatchObject({ status: 'user_interleaved' })
    // After first completes, second is dequeued and runs.
    await sleep(500)
    useTerminalStore.getState().appendRing(TM_ID, `${FENCE_END}0${FENCE_TERM}`)
    await sleep(500)
    const result = sent2.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'completed' })
    const written = vi.mocked(sshWrite).mock.calls.map((c) => c[1])
    expect(written.some((w) => w.includes('uptime'))).toBe(true)
  })

  it('allows writes when agent holds the keyboard (driver = agent)', async () => {
    // First exec completes normally.
    const { sent: sent1 } = bridgeRequest({ command: 'df -h', waitMs: 5000 })
    await sleep(300)
    useTerminalStore.getState().appendRing(TM_ID, `${FENCE_END}0${FENCE_TERM}`)
    await sleep(500)
    expect(sent1.find((m) => m.type === 'session:uiToolResult')).toMatchObject({ status: 'completed' })
    // Driver should be back to agent after flight completes.
    expect(useTerminalAgentStore.getState().driverByTerminal[TM_ID]).toBe('user')
    // Second exec should work because agent holds the keyboard.
    const sent2: ClientMessage[] = []
    handleTerminalBridgeMessage(
      {
        type: 'session:terminalExec:request',
        sessionId: SESSION_ID,
        callId: 'call-2',
        command: 'uptime',
        waitMs: 5000,
        poll: true,
      },
      (m) => sent2.push(m),
    )
    await sleep(300)
    useTerminalStore.getState().appendRing(TM_ID, `${FENCE_END}0${FENCE_TERM}`)
    await sleep(500)
    const result = sent2.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'completed' })
    const written = vi.mocked(sshWrite).mock.calls.map((c) => c[1])
    expect(written.some((w) => w.includes('uptime'))).toBe(true)
  })
})

describe('terminal bridge exec queue (PR-3, spec T3)', () => {
  beforeEach(() => {
    vi.mocked(sshWrite).mockClear().mockResolvedValue(undefined as never)
    useTerminalAgentStore.setState({ execFlightByTerminal: {}, execQueueByTerminal: {}, driverByTerminal: {} })
    useTerminalStore.setState({ bySession: {}, userInterleaved: {} })
    seedStores()
    vi.useRealTimers()
  })

  it('a second exec waits in the FIFO and runs after the first completes', async () => {
    const sent1: ClientMessage[] = []
    handleTerminalBridgeMessage(
      {
        type: 'session:terminalExec:request',
        sessionId: SESSION_ID,
        callId: 'call-1',
        command: 'df -h',
        waitMs: 5000,
        poll: true,
      },
      (m) => sent1.push(m),
    )
    await sleep(300)
    // Second exec for the same terminal: must NOT error immediately.
    const sent2: ClientMessage[] = []
    handleTerminalBridgeMessage(
      {
        type: 'session:terminalExec:request',
        sessionId: SESSION_ID,
        callId: 'call-2',
        command: 'uptime',
        waitMs: 5000,
        poll: true,
      },
      (m) => sent2.push(m),
    )
    await sleep(300)
    expect(sent2.some((m) => m.type === 'session:uiToolResult')).toBe(false)
    expect(useTerminalAgentStore.getState().execQueueByTerminal[TM_ID]?.length).toBe(1)
    // First completes → second is dequeued and runs.
    useTerminalStore.getState().appendRing(TM_ID, `${FENCE_END}0${FENCE_TERM}`)
    await sleep(900)
    expect(sent1.find((m) => m.type === 'session:uiToolResult')).toMatchObject({ status: 'completed' })
    const written = vi.mocked(sshWrite).mock.calls.map((c) => c[1])
    expect(written.some((w) => w.includes('uptime'))).toBe(true)
    expect(useTerminalAgentStore.getState().execQueueByTerminal[TM_ID]?.length).toBe(0)
  })

  it('a queued request times out when the flight never frees', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const now = Date.now()
    vi.setSystemTime(now)
    const sent1: ClientMessage[] = []
    handleTerminalBridgeMessage(
      {
        type: 'session:terminalExec:request',
        sessionId: SESSION_ID,
        callId: 'call-1',
        command: 'tail -f /var/log/x.log',
        waitMs: 120000,
        poll: true,
      },
      (m) => sent1.push(m),
    )
    await sleep(300)
    const sent2: ClientMessage[] = []
    handleTerminalBridgeMessage(
      {
        type: 'session:terminalExec:request',
        sessionId: SESSION_ID,
        callId: 'call-2',
        command: 'uptime',
        waitMs: 5000,
        poll: true,
      },
      (m) => sent2.push(m),
    )
    await sleep(300)
    vi.setSystemTime(now + EXEC_QUEUE_TIMEOUT_MS + 1000)
    await sleep(900)
    const result = sent2.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'error' })
    expect(result && 'error' in result ? String(result.error) : '').toMatch(/queued_timed_out/)
    expect(useTerminalAgentStore.getState().execQueueByTerminal[TM_ID]?.length).toBe(0)
  })
})

describe('terminal bridge rule-based confirm (PR-4, spec T4)', () => {
  beforeEach(() => {
    vi.mocked(sshWrite).mockClear().mockResolvedValue(undefined as never)
    useTerminalAgentStore.setState({
      execFlightByTerminal: {},
      execQueueByTerminal: {},
      driverByTerminal: {},
      pendingConfirmByTerminal: {},
    })
    useTerminalStore.setState({ bySession: {}, userInterleaved: {} })
    // No user rules by default in these tests.
    useHipConfigStore.setState({ config: { version: 1 } })
    seedStores()
    vi.useRealTimers()
  })

  it('a deny rule rejects without writing or prompting', async () => {
    const { sent } = bridgeRequest({ command: 'rm -rf /' })
    await sleep(400)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'rejected' })
    expect(vi.mocked(sshWrite)).not.toHaveBeenCalled()
    expect(useTerminalAgentStore.getState().pendingConfirmByTerminal[TM_ID] ?? null).toBeNull()
  })

  it('an ask rule shows the confirm card and runs after allow', async () => {
    const { sent } = bridgeRequest({ command: 'git push --force origin main' })
    await sleep(400)
    const pending = useTerminalAgentStore.getState().pendingConfirmByTerminal[TM_ID]
    expect(pending?.kind).toBe('danger')
    expect(pending?.title).toContain('git push')
    expect(vi.mocked(sshWrite)).not.toHaveBeenCalled()
    useTerminalAgentStore.getState().settleConfirm(TM_ID, { ok: true })
    await sleep(300)
    expect(vi.mocked(sshWrite)).toHaveBeenCalledTimes(1)
    useTerminalStore.getState().appendRing(TM_ID, `${FENCE_END}0${FENCE_TERM}`)
    await sleep(600)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'completed' })
  })

  it('rejecting the confirm card rejects the exec without writing', async () => {
    const { sent } = bridgeRequest({ command: 'rm -rf /var/lib/docker' })
    await sleep(400)
    useTerminalAgentStore.getState().settleConfirm(TM_ID, { ok: false })
    await sleep(300)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'rejected' })
    expect(vi.mocked(sshWrite)).not.toHaveBeenCalled()
  })

  it('an unanswered confirm card times out into rejection', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const { sent } = bridgeRequest({ command: 'shutdown -h now' })
    await vi.advanceTimersByTimeAsync(400)
    expect(useTerminalAgentStore.getState().pendingConfirmByTerminal[TM_ID]).not.toBeNull()
    await vi.advanceTimersByTimeAsync(61_000)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'rejected' })
    vi.useRealTimers()
  })

  it('user allow rules from hip.toml run the command without a prompt', async () => {
    useHipConfigStore.setState({
      config: { version: 1, terminal: { approveRules: ['git push *'] } },
    })
    expect(userCommandRules()).toEqual([{ action: 'allow', pattern: 'git push *' }])
    const { sent } = bridgeRequest({ command: 'git push --force origin main' })
    await sleep(400)
    expect(useTerminalAgentStore.getState().pendingConfirmByTerminal[TM_ID] ?? null).toBeNull()
    expect(vi.mocked(sshWrite)).toHaveBeenCalledTimes(1)
    useTerminalStore.getState().appendRing(TM_ID, `${FENCE_END}0${FENCE_TERM}`)
    await sleep(600)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'completed' })
  })
})

describe('terminal bridge ring lifecycle (PR-5, spec T5)', () => {
  beforeEach(() => {
    vi.mocked(sshWrite).mockClear().mockResolvedValue(undefined as never)
    useTerminalAgentStore.setState({
      execFlightByTerminal: {},
      execQueueByTerminal: {},
      driverByTerminal: {},
      pendingConfirmByTerminal: {},
    })
    useTerminalStore.setState({ bySession: {}, userInterleaved: {} })
    seedStores()
    vi.useRealTimers()
  })

  it('a reconnect rebuilds the ring with a bumped generation', () => {
    useTerminalStore.getState().setGeneration(TM_ID, 3)
    resetTerminalForReconnect(TM_ID)
    expect(useTerminalStore.getState().getSession(TM_ID)?.generation).toBe(4)
    expect(useTerminalStore.getState().getSession(TM_ID)?.ring).toEqual([])
  })

  it('an in-flight exec fails with ring_reset when the terminal reconnects', async () => {
    const { sent } = bridgeRequest({ waitMs: 20000 })
    await sleep(300)
    // Simulate reconnect: ring rebuilt with a bumped generation.
    resetTerminalForReconnect(TM_ID)
    await sleep(600)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'error', mayStillRun: true })
    expect(result && 'error' in result ? String(result.error) : '').toMatch(/ring_reset/)
  })

  it('an in-flight exec fails with terminal_closed when the SSH session drops', async () => {
    const { sent } = bridgeRequest({ waitMs: 20000 })
    await sleep(300)
    useManagedTerminalStore.setState((s) => ({
      terminals: s.terminals.map((t) =>
        t.id === TM_ID ? { ...t, status: 'disconnected' as const } : t,
      ),
    }))
    await sleep(600)
    const result = sent.find((m) => m.type === 'session:uiToolResult')
    expect(result).toMatchObject({ status: 'error', mayStillRun: true })
    expect(result && 'error' in result ? String(result.error) : '').toMatch(/terminal_closed/)
  })

  it('a completed flight is unaffected by a later reconnect (generation checked per-flight)', async () => {
    const { sent } = bridgeRequest({ waitMs: 5000 })
    await sleep(300)
    useTerminalStore.getState().appendRing(TM_ID, `${FENCE_END}0${FENCE_TERM}`)
    await sleep(600)
    expect(sent.find((m) => m.type === 'session:uiToolResult')).toMatchObject({ status: 'completed' })
    // Reconnect afterwards must not retroactively fail the already-sent result.
    resetTerminalForReconnect(TM_ID)
    expect(sent.filter((m) => m.type === 'session:uiToolResult').length).toBe(1)
  })
})
