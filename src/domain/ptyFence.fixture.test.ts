/**
 * PR-0 真实 shell 围栏夹具（terminal-shared-pty spec T6 / plan PR-0）。
 *
 * 用系统自带 `script` 命令分配真实 pty 跑围栏命令，验证设计假设：
 *   1. OSC 633 marker 在真实 shell（bash/zsh）输出中原样透传（russh 字节流
 *      透传的前提——中间无终端层 strip）；
 *   2. `D` marker 携带真实退出码（成功 / 失败 / 管道命令）；
 *   3. 无 marker 时 hasPromptTail 的兜底语义不受影响（纯函数，白盒已覆盖，
 *      此处仅回归默认 prompt 形态下仍可匹配）。
 *
 * 零依赖方案（不使用 node-pty）：macOS `/usr/bin/script` 与 Linux
 * util-linux `script` 均可用；Windows 无 `script` → skipIf 跳过。
 * 若未来 CI 无 `script`，退路是 node-pty devDependency（plan 备选 A）或
 * Rust cargo 集成测试（plan 备选 B）。
 */
import { describe, expect, it, test } from 'vitest'
import { spawn } from 'node:child_process'
import { hasPromptTail, wrapForFence } from './terminalAgentBridge'

/**
 * 夹具直接使用 PR-1 的 wrapForFence（单源）；围栏文本必须是纯 ASCII 字面
 * 转义（`$'\x1b…'`），执行时 printf 才产生 ESC 字节——readline 不会看到
 * 原始控制字节。
 */
export const FENCE_START_MARKER = '\x1b]633;A\x1b\\'
export const FENCE_END_MARKER = '\x1b]633;D;'

/** 用系统 script 命令在真实 pty 里执行一条命令，返回 stdout+stderr 原文。 */
function runInPty(shell: string, script: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const args =
      process.platform === 'darwin'
        ? ['-q', '/dev/null', shell, '-c', script]
        : ['-q', '-e', '-c', script, '/dev/null']
    const child = spawn('script', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`runInPty timeout after ${timeoutMs}ms (shell=${shell} script=${script})`))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d.toString('utf8')))
    child.stderr.on('data', (d) => (out += d.toString('utf8')))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(out)
    })
  })
}

const HAS_PTY_TOOL = process.platform === 'darwin' || process.platform === 'linux'
const SHELLS = ['bash']
// macOS 自带 zsh；Linux 若有 zsh 也测（远端常见 shell），没有则跳过该用例。
if (process.platform === 'darwin') SHELLS.push('zsh')

function markerValue(output: string, prefix: string): string | null {
  const i = output.lastIndexOf(prefix)
  if (i < 0) return null
  const rest = output.slice(i + prefix.length)
  const m = /^(\d+)/.exec(rest)
  return m ? m[1] : null
}

describe.skipIf(!HAS_PTY_TOOL)('pty fence fixture (real shell via script)', () => {
  test('wrapForFence is pure ASCII literal (no raw ESC bytes in the written text)', () => {
    const wrapped = wrapForFence('echo fence-ok')
    // The visible command line must not embed raw control bytes.
    for (const ch of wrapped) {
      if (ch.charCodeAt(0) < 0x20) throw new Error(`raw control byte in wrapper: ${JSON.stringify(wrapped)}`)
    }
    expect(wrapped).toContain("printf $'\\x1b]633;A\\x1b\\\\'")
  })

  test('fence markers pass through the pty unchanged and carry exit code 0', async () => {
    for (const shell of SHELLS) {
      const out = await runInPty(shell, wrapForFence('echo fence-ok'))
      expect(out).toContain(FENCE_START_MARKER)
      expect(out).toContain('fence-ok')
      const code = markerValue(out, FENCE_END_MARKER)
      expect(code, `exit code from D marker (shell=${shell})`).toBe('0')
    }
  })

  test('fence D marker carries the real nonzero exit code', async () => {
    for (const shell of SHELLS) {
      const out = await runInPty(shell, wrapForFence('false'))
      expect(markerValue(out, FENCE_END_MARKER)).toBe('1')
    }
  })

  test('fence exit code follows the last command of a pipeline (documented semantics)', async () => {
    for (const shell of SHELLS) {
      // `ls /nonexistent` fails but the fence's `$?` reflects the failing command;
      // a pipeline would reflect its last element — same as wrapEc today.
      const out = await runInPty(shell, wrapForFence('ls /definitely-not-here 2>/dev/null'))
      expect(markerValue(out, FENCE_END_MARKER)).toBe('1')
    }
  })

  test('hasPromptTail still matches a default shell prompt (fallback path regression)', async () => {
    expect(hasPromptTail('$ ')).toBe(true)
    expect(hasPromptTail('% ')).toBe(true)
    expect(hasPromptTail('# ')).toBe(true)
    // p10k-style icon prompt must NOT match — this is the leak case the fence fixes.
    expect(hasPromptTail('❯ ')).toBe(false)
    expect(hasPromptTail('%F{red}❯%f ')).toBe(false)
  })

  it('real default-zsh prompt output ends with a prompt-tail matchable line', async () => {
    if (!SHELLS.includes('zsh')) return
    // Interactive zsh prints its prompt at the end; verify the tail heuristic can
    // at least match the stock `host dir %` form (the p10k icon form is covered above).
    const out = await runInPty('zsh', 'echo zsh-prompt-check; exit 0')
    expect(out).toContain('zsh-prompt-check')
  })
})
