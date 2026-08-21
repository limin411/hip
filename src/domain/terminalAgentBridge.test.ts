import { describe, it, expect } from 'vitest'
import {
  clipExecOutput,
  extractExitCode,
  extractFenceExitCode,
  extractExecExitCode,
  hasPromptTail,
  isDangerousCommand,
  isInteractiveTuiCommand,
  isLikelySubShell,
  wrapForEc,
  wrapForFence,
  FENCE_END,
  FENCE_TERM,
  EXEC_OUTPUT_CAP,
} from './terminalAgentBridge'

describe('completion heuristic', () => {
  it('recognizes prompt-like tails', () => {
    expect(hasPromptTail('Filesystem  Size\n/dev/sda1  100G\n$ ')).toBe(true)
    expect(hasPromptTail('root@box:/var/www#')).toBe(true)
    expect(hasPromptTail('done')).toBe(false)
    expect(hasPromptTail('')).toBe(false)
  })
})

describe('sub-shell detection', () => {
  it('detects mysql prompt', () => {
    expect(isLikelySubShell('mysql> ')).toBe(true)
    expect(isLikelySubShell('some output\nmysql> ')).toBe(true)
  })
  it('detects MariaDB prompt', () => {
    expect(isLikelySubShell('MariaDB [testdb]> ')).toBe(true)
  })
  it('detects python prompt', () => {
    expect(isLikelySubShell('>>> ')).toBe(true)
    expect(isLikelySubShell('Hello\n>>> ')).toBe(true)
  })
  it('detects redis prompt', () => {
    expect(isLikelySubShell('redis> ')).toBe(true)
  })
  it('detects pdb prompt', () => {
    expect(isLikelySubShell('(Pdb) ')).toBe(true)
  })
  it('detects IPython prompt', () => {
    expect(isLikelySubShell('In [42]: ')).toBe(true)
  })
  it('does not false-positive on normal bash prompts', () => {
    expect(isLikelySubShell('user@host:~$ ')).toBe(false)
    expect(isLikelySubShell('root@host# ')).toBe(false)
    expect(isLikelySubShell('$ ')).toBe(false)
    expect(isLikelySubShell('')).toBe(false)
  })
  it('does not false-positive on redirect operators', () => {
    expect(isLikelySubShell('hello > ')).toBe(false)
  })
})

describe('output cap', () => {
  it('clips to 64KB with a note', () => {
    const big = 'x'.repeat(EXEC_OUTPUT_CAP + 10)
    const out = clipExecOutput(big)
    expect(out.startsWith('x'.repeat(EXEC_OUTPUT_CAP))).toBe(true)
    expect(out).toMatch(/truncated to 64KB/)
  })
})

describe('danger/TUI guards', () => {
  it('flags destructive commands for UI second confirmation', () => {
    expect(isDangerousCommand('rm -rf /var/lib')).toBe(true)
    expect(isDangerousCommand('sudo rm -fr /tmp/x')).toBe(true)
    expect(isDangerousCommand('mkfs.ext4 /dev/sdb1')).toBe(true)
    expect(isDangerousCommand('dd if=/dev/zero of=/dev/sda bs=1M')).toBe(true)
    expect(isDangerousCommand('shutdown -h now')).toBe(true)
    expect(isDangerousCommand('ls -la')).toBe(false)
  })

  it('blocks interactive TUIs', () => {
    expect(isInteractiveTuiCommand('vim /etc/hosts')).toBe(true)
    expect(isInteractiveTuiCommand('top')).toBe(true)
    expect(isInteractiveTuiCommand('passwd')).toBe(true)
    expect(isInteractiveTuiCommand('ssh prod-box')).toBe(true)
    expect(isInteractiveTuiCommand('df -h')).toBe(false)
  })
})

describe('__HIP_EC wrapper (P1)', () => {
  it('appends an exit-code marker and parses it back', () => {
    const wrapped = wrapForEc('df -h')
    expect(wrapped).toContain('df -h')
    expect(wrapped).toContain('__HIP_EC_EXIT')
    expect(extractExitCode('out\n__HIP_EC_EXIT=3\n')).toBe(3)
    expect(extractExitCode('no marker')).toBeNull()
  })
})

describe('command fence (terminal-shared-pty T1)', () => {
  it('wraps the command with OSC 633 markers, keeping the command visible', () => {
    const wrapped = wrapForFence('df -h')
    // Pure ASCII literal escapes — raw ESC bytes would corrupt readline input.
    expect(wrapped.startsWith("printf $'\\x1b]633;A\\x1b\\\\';")).toBe(true)
    expect(wrapped).toContain('df -h')
    expect(wrapped).toContain("printf $'\\x1b]633;D;%s\\x1b\\\\' \"$?\"")
    for (const ch of wrapped) {
      expect(ch.charCodeAt(0), `raw control byte in wrapper: ${JSON.stringify(wrapped)}`).toBeGreaterThanOrEqual(0x20)
    }
  })

  it('extracts the last fence exit code; null without a marker', () => {
    expect(extractFenceExitCode(`${FENCE_END}0${FENCE_TERM}`)).toBe(0)
    expect(extractFenceExitCode(`out\n${FENCE_END}3${FENCE_TERM}\n$ `)).toBe(3)
    // Multiple markers (wrapped commands back to back) → the last one wins.
    expect(
      extractFenceExitCode(`${FENCE_END}0${FENCE_TERM}\n${FENCE_END}1${FENCE_TERM}`),
    ).toBe(1)
    expect(extractFenceExitCode('plain output without markers')).toBeNull()
  })

  it('prefers the fence marker over the legacy __HIP_EC marker', () => {
    expect(extractExecExitCode(`${FENCE_END}2${FENCE_TERM}\n__HIP_EC_EXIT=7`)).toBe(2)
    expect(extractExecExitCode('__HIP_EC_EXIT=7')).toBe(7)
  })
})
