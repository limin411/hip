import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { TaskSpec, VerifyCommandResult } from './types.js'

export function runVerifyCommands(
  task: TaskSpec,
  cwd: string,
  outDir: string,
): { ran: boolean; skippedReason?: string; results: VerifyCommandResult[] } {
  const commands = task.verify?.commands
  if (!commands || commands.length === 0) {
    return { ran: false, skippedReason: 'no verify.commands', results: [] }
  }

  fs.mkdirSync(path.join(outDir, 'verify'), { recursive: true })
  const timeoutSec = task.verify?.timeout_sec ?? 180
  const results: VerifyCommandResult[] = []

  for (let i = 0; i < commands.length; i++) {
    const c = commands[i]
    const workDir = c.cwd ? path.resolve(cwd, c.cwd) : cwd
    const started = Date.now()
    const res = spawnSync(c.cmd[0], c.cmd.slice(1), {
      cwd: workDir,
      env: { ...process.env, ...c.env },
      encoding: 'utf8',
      timeout: timeoutSec * 1000,
    })
    const durationMs = Date.now() - started
    const stdout = res.stdout ?? ''
    const stderr = res.stderr ?? ''
    const logPath = path.join(outDir, 'verify', `${String(i).padStart(2, '0')}.log`)
    fs.writeFileSync(
      logPath,
      [
        `cmd: ${c.cmd.join(' ')}`,
        `cwd: ${workDir}`,
        `exit: ${res.status ?? 'null'}`,
        `signal: ${res.signal ?? ''}`,
        '--- stdout ---',
        stdout,
        '--- stderr ---',
        stderr,
      ].join('\n'),
    )
    results.push({
      cmd: c.cmd,
      exitCode: res.status ?? (res.error ? 1 : 0),
      durationMs,
      logPath,
      stdout,
      stderr,
    })
  }

  return { ran: true, results }
}
