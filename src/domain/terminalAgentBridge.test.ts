import { describe, it, expect } from 'vitest'
import {
  clipExecOutput,
  extractExitCode,
  hasPromptTail,
  isDangerousCommand,
  isInteractiveTuiCommand,
  wrapForEc,
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
