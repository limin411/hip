import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The dev sidecar wrapper MUST launch the Node WS server as a SINGLE process
// (or an equivalent kill-tree unit). Tauri's child.kill() (restart_sidecar +
// app exit) only kills the direct child PID; any wrapper layer (yarn → tsx →
// node) orphans the real server, which keeps the old WS port alive so the
// client never reconnects — a saved/cleared API key then silently fails to
// take effect. Guard both the Unix (.sh) and Windows (.ps1) generators.
describe('dev sidecar wrapper generator', () => {
  const shScript = readFileSync(
    resolve(process.cwd(), 'scripts/make-sidecar-dev-bin.sh'),
    'utf8',
  )
  const psScript = readFileSync(
    resolve(process.cwd(), 'scripts/make-sidecar-dev-bin.ps1'),
    'utf8',
  )
  const jsDispatcher = readFileSync(
    resolve(process.cwd(), 'scripts/make-sidecar-dev-bin.js'),
    'utf8',
  )

  describe('Unix (make-sidecar-dev-bin.sh)', () => {
    it("exec's the entry in-process via `node --import tsx` (no child to orphan)", () => {
      expect(shScript).toContain(
        'exec "$NODE_BIN" --import tsx packages/sidecar/src/main.ts',
      )
    })

    it('does not wrap the sidecar in `yarn`, which spawns an orphan-able child tree', () => {
      expect(shScript).not.toContain('exec yarn')
    })
  })

  describe('Windows (make-sidecar-dev-bin.ps1)', () => {
    it('launches via `node --import tsx` (not yarn)', () => {
      expect(psScript).toContain('.arg("--import")')
      expect(psScript).toContain('.arg("tsx")')
      expect(psScript).toContain('.arg("packages/sidecar/src/main.ts")')
      expect(psScript).not.toMatch(/Command::new\([^)]*yarn/i)
    })

    it('uses a Job Object with KILL_ON_JOB_CLOSE so launcher kill tears down Node', () => {
      expect(psScript).toContain('CreateJobObjectW')
      expect(psScript).toContain('AssignProcessToJobObject')
      expect(psScript).toContain('JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE')
      // Must spawn+assign, not bare status() wait without a job.
      expect(psScript).toContain('.spawn()')
      expect(psScript).not.toMatch(/\.status\(\)\s*\n\s*\.unwrap_or_else/)
    })

    it('emits windows_subsystem to avoid console flash under a GUI parent', () => {
      expect(psScript).toContain('#![windows_subsystem = "windows"]')
    })

    it('writes generated sources without UTF-8 BOM', () => {
      expect(psScript).toContain('Write-Utf8NoBom')
      expect(psScript).toContain('UTF8Encoding')
      expect(psScript).not.toMatch(/Set-Content\s+-Path.*-Encoding\s+UTF8/)
    })
  })

  describe('dispatcher (make-sidecar-dev-bin.js)', () => {
    it('routes win32 to the PowerShell generator and others to bash', () => {
      expect(jsDispatcher).toContain('make-sidecar-dev-bin.ps1')
      expect(jsDispatcher).toContain('make-sidecar-dev-bin.sh')
      expect(jsDispatcher).toContain("platform() === \"win32\"")
    })
  })
})
