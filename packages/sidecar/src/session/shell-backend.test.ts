// packages/sidecar/src/session/shell-backend.test.ts
import { describe, it, expect } from 'vitest'
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

  it('honors wrapperArgv (sandbox-style prefix) instead of the plain shell', async () => {
    const out = await new Promise<string>((resolve) => {
      const chunks: string[] = []
      // wrapper that echoes its own marker then runs sh -c with the command
      const shell = spawnShell({
        command: 'echo inner-ok',
        cwd: process.cwd(),
        wrapperArgv: ['/bin/sh', '-c', 'echo wrapped-ok'],
        onStdout: (c) => chunks.push(c),
      })
      shell.done.then(() => resolve(chunks.join('')))
    })
    expect(out.trim()).toBe('wrapped-ok')
  })

  it('reports exit code through done', async () => {
    const shell = spawnShell({ command: 'exit 3', cwd: process.cwd() })
    const r = await shell.done
    expect(r.exitCode).toBe(3)
    expect(r.timedOut).toBe(false)
  })
})
