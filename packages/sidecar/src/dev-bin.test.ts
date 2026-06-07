import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The dev sidecar wrapper MUST launch the Node WS server as a SINGLE process.
// Tauri's child.kill() (restart_sidecar + app exit) only kills the direct child
// PID; any wrapper layer (yarn → tsx → node) orphans the real server, which keeps
// the old WS port alive so the client never reconnects — a saved/cleared API key
// then silently fails to take effect. Guard the invariant in make-sidecar-dev-bin.sh.
describe('dev sidecar wrapper generator', () => {
  const script = readFileSync(
    resolve(process.cwd(), 'scripts/make-sidecar-dev-bin.sh'),
    'utf8',
  )

  it("exec's the entry in-process via `node --import tsx` (no child to orphan)", () => {
    expect(script).toContain('exec node --import tsx packages/sidecar/src/main.ts')
  })

  it('does not wrap the sidecar in `yarn`, which spawns an orphan-able child tree', () => {
    expect(script).not.toContain('exec yarn')
  })
})
