import { describe, it, expect } from 'vitest'
import { isUselessSubagentText, synthesizeSubagentResult } from './subagent-result.js'

const DSML = `<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="run_script">
<｜｜DSML｜｜parameter name="command" string="true">echo hi</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>`

/** Prose + unfinished DSML (logs/bug.json worker handoff shape). */
const PROSE_PLUS_DSML =
  'Let me explore the project structure and focus on the Zuolin-related sync files.' +
  'Let me also check for configuration files and the station module\'s Zuolin references:' +
  DSML

describe('isUselessSubagentText', () => {
  it('flags empty, placeholder, and DSML-only', () => {
    expect(isUselessSubagentText('')).toBe(true)
    expect(isUselessSubagentText('  ')).toBe(true)
    expect(isUselessSubagentText('(sub-agent produced no output)')).toBe(true)
    expect(isUselessSubagentText(DSML)).toBe(true)
  })

  it('flags long prose that still embeds DSML tool_calls (must not leak to supervisor)', () => {
    expect(isUselessSubagentText(PROSE_PLUS_DSML)).toBe(true)
  })

  it('keeps real prose', () => {
    expect(isUselessSubagentText('Zuolin sync uses DataSyncService.syncDataPark().')).toBe(false)
  })
})

describe('synthesizeSubagentResult', () => {
  it('returns prose when useful', () => {
    expect(synthesizeSubagentResult('done', [])).toBe('done')
  })

  it('reconstructs from tool trajectory when text is empty', () => {
    const out = synthesizeSubagentResult('', [
      { name: 'grep', status: 'finished', output: '/permission/ExtenrnalController.java:9: ZuolinConfig' },
      { name: 'read_file', status: 'finished', output: 'public interface DataSyncService' },
    ])
    expect(out).toMatch(/reconstructed from tool results/)
    expect(out).toContain('grep')
    expect(out).toContain('ZuolinConfig')
    expect(out).toContain('DataSyncService')
  })

  it('returns error when empty text and no tools', () => {
    const out = synthesizeSubagentResult('', [])
    expect(out).toMatch(/^Error: sub-agent produced empty output/)
  })

  it('reconstructs when text is DSML-only', () => {
    const out = synthesizeSubagentResult(DSML, [
      { name: 'ls', status: 'finished', output: 'SyncDataConfig.java' },
    ])
    expect(out).toMatch(/reconstructed/)
    expect(out).toContain('SyncDataConfig')
    expect(out).not.toMatch(/DSML/)
  })

  it('strips DSML and reconstructs when prose+DSML is the final handoff', () => {
    const out = synthesizeSubagentResult(PROSE_PLUS_DSML, [
      { name: 'grep', status: 'finished', output: 'DataSyncServiceImpl.java: ZuolinConfig' },
      { name: 'ls', status: 'finished', output: 'SyncDataConfig.java' },
    ])
    expect(out).not.toMatch(/DSML/)
    expect(out).not.toMatch(/tool_calls/)
    expect(out).toContain('Zuolin-related sync')
    expect(out).toMatch(/reconstructed/)
    expect(out).toContain('DataSyncServiceImpl')
  })

  it('returns stripped prose when DSML present but no tools', () => {
    const out = synthesizeSubagentResult(PROSE_PLUS_DSML, [])
    expect(out).not.toMatch(/DSML/)
    expect(out).toContain('Zuolin-related sync')
  })
})
