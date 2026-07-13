import { describe, it, expect } from 'vitest'
import { isUselessSubagentText, synthesizeSubagentResult } from './subagent-result.js'

const DSML = `<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="run_script">
<｜｜DSML｜｜parameter name="command" string="true">echo hi</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>`

describe('isUselessSubagentText', () => {
  it('flags empty, placeholder, and DSML-only', () => {
    expect(isUselessSubagentText('')).toBe(true)
    expect(isUselessSubagentText('  ')).toBe(true)
    expect(isUselessSubagentText('(sub-agent produced no output)')).toBe(true)
    expect(isUselessSubagentText(DSML)).toBe(true)
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
  })
})
