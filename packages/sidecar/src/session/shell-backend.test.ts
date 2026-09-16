// packages/sidecar/src/session/shell-backend.test.ts
import { describe, it, expect } from 'vitest'
import { IS_POSIX } from '../test/env.js'
import { spawnShell } from './shell-backend.js'

describe('spawnShell', () => {
  it('executes a plain command', async () => {
    const out = await new Promise<string>((resolve) => {
      const chunks: string[] = []
      const shell = spawnShell({
        command: 'echo plain-ok',
        cwd: process.cwd(),
        onStdout: (c) => chunks.push(c),
      })
      shell.done.then(() => resolve(chunks.join('')))
    })
    expect(out.trim()).toBe('plain-ok')
  })

  it.skipIf(!IS_POSIX)('honors wrapperArgv (sandbox-style prefix) instead of the plain shell', async () => {
    const out = await new Promise<string>((resolve) => {
      const chunks: string[] = []
      // wrapper that echoes its own marker then runs sh -c with the command
      const shell = spawnShell({
        command: 'echo inner-ok',
        cwd: process.cwd(),
        wrapperArgv: IS_POSIX
          ? ['/bin/sh', '-c', 'echo wrapped-ok']
          : [process.env.ComSpec || 'cmd.exe', '/c', 'echo wrapped-ok'],
        onStdout: (c) => chunks.push(c),
      })
      shell.done.then(() => resolve(chunks.join('')))
    })
    expect(out.trim()).toBe('wrapped-ok')
  })

  // GUARDRAIL: on Windows the whole command was handed to `cmd /c` as a quoted
  // argv element, and Node escaped the inner quotes with backslashes — which
  // cmd.exe does not understand. `node -e "console.log(1)"` was cut at the
  // space inside the quotes and ran (silently) as garbage: exit 0, no output.
  // Verbatim arguments are the only way to get cmd.exe to parse it the way a
  // human typing at a prompt would.
  it('passes a command containing quotes through to the shell intact', async () => {
    const out = await new Promise<string>((resolve) => {
      const chunks: string[] = []
      const shell = spawnShell({
        command: `${process.execPath} -e "console.log('QUOTED-OK')"`,
        cwd: process.cwd(),
        onStdout: (c) => chunks.push(c),
        onStderr: (c) => chunks.push(c),
      })
      shell.done.then(() => resolve(chunks.join('')))
    })
    expect(out).toContain('QUOTED-OK')
  }, 30_000)

  it('reports exit code through done', async () => {
    const shell = spawnShell({ command: 'exit 3', cwd: process.cwd() })
    const r = await shell.done
    expect(r.exitCode).toBe(3)
    expect(r.timedOut).toBe(false)
  })
})
