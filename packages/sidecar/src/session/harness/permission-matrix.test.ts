/**
 * Sprint A — permissionMode × tool availability matrix (no real shell).
 */
import { describe, it, expect } from 'vitest'
import { buildAllTools } from '../tools/index.js'

const autoApprove = async () => ({ kind: 'allow' as const })

function names(mode: 'chat' | 'edit' | 'full'): string[] {
  return buildAllTools('/tmp/proj', async () => 'ok', '/tmp/proj', undefined, {
    permissionMode: mode,
    // run_script is only registered when an approval seam is provided (HITL/full).
    requestApproval: mode === 'chat' ? undefined : autoApprove,
  }).map((t) => t.name)
}

describe('permission matrix (A4)', () => {
  it('chat: no write_file/edit_file/run_script', () => {
    const n = names('chat')
    expect(n).toContain('read_file')
    expect(n).toContain('ls')
    expect(n).not.toContain('write_file')
    expect(n).not.toContain('edit_file')
    expect(n).not.toContain('run_script')
  })

  it('edit: has write tools and run_script when approval path allows tool presence', () => {
    const n = names('edit')
    expect(n).toContain('write_file')
    expect(n).toContain('edit_file')
    expect(n).toContain('read_file')
    // run_script is present in edit (HITL at invoke time)
    expect(n).toContain('run_script')
  })

  it('full: has write + run_script', () => {
    const n = names('full')
    expect(n).toContain('write_file')
    expect(n).toContain('run_script')
  })

  it('task spawn is available when spawnSubagent is provided in all modes', () => {
    for (const mode of ['chat', 'edit', 'full'] as const) {
      const n = names(mode)
      expect(n).toContain('task')
    }
  })
})
