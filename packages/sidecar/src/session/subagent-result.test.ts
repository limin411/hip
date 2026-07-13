import { describe, it, expect } from 'vitest'
import {
  SUBAGENT_PAUSE_MARKER,
  formatPausedToolResult,
  isSubagentPausedText,
  isUselessSubagentText,
  synthesizeSubagentResult,
} from './subagent-result.js'

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

describe('formatPausedToolResult / isSubagentPausedText', () => {
  it('formats question-only as first-line marker', () => {
    const out = formatPausedToolResult('Approve the plan?')
    expect(out).toBe(`${SUBAGENT_PAUSE_MARKER} Approve the plan?`)
    expect(out.startsWith(SUBAGENT_PAUSE_MARKER)).toBe(true)
    expect(out).not.toMatch(/^Error:/)
    expect(isSubagentPausedText(out)).toBe(true)
  })

  it('appends optional partial body after the marker line', () => {
    const out = formatPausedToolResult('Need path?', 'partial progress here')
    expect(out).toBe(`${SUBAGENT_PAUSE_MARKER} Need path?\npartial progress here`)
    expect(isSubagentPausedText(out)).toBe(true)
  })

  it('detects only first-line marker (not mid-body)', () => {
    expect(isSubagentPausedText(null)).toBe(false)
    expect(isSubagentPausedText('')).toBe(false)
    expect(isSubagentPausedText('normal prose')).toBe(false)
    expect(isSubagentPausedText(`prefix\n${SUBAGENT_PAUSE_MARKER} buried`)).toBe(false)
  })

  it('trims question whitespace on the marker line', () => {
    expect(formatPausedToolResult('  Q?  ')).toBe(`${SUBAGENT_PAUSE_MARKER} Q?`)
  })

  it('detects task_batch [id] prefix on the first line', () => {
    const paused = formatPausedToolResult('Need path?', 'partial')
    expect(isSubagentPausedText(`[0] ${paused}`)).toBe(true)
    expect(isUselessSubagentText(`[0] ${paused}`)).toBe(false)
  })

  it('matches first-line pause marker only (A-core extras)', () => {
    expect(isSubagentPausedText(`${SUBAGENT_PAUSE_MARKER} Which API?`)).toBe(true)
    expect(isSubagentPausedText(`${SUBAGENT_PAUSE_MARKER} q\npartial findings`)).toBe(true)
    expect(isSubagentPausedText('Error: unknown tool')).toBe(false)
    expect(isSubagentPausedText(`prefix ${SUBAGENT_PAUSE_MARKER}`)).toBe(false)
  })
})

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

  it('does not treat pause marker results as useless empty output', () => {
    const paused = formatPausedToolResult('Which file?', 'looked at src/')
    expect(isSubagentPausedText(paused)).toBe(true)
    expect(isUselessSubagentText(paused)).toBe(false)
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

  it('short-circuits pause marker — no reconstruct even with DSML partial + tools', () => {
    const paused = formatPausedToolResult('Which path?', `partial with unfinished calls\n${DSML}`)
    const out = synthesizeSubagentResult(paused, [
      { name: 'grep', status: 'finished', output: 'should-not-appear' },
    ])
    expect(out).toBe(paused)
    expect(out).toMatch(/^\[hip:subagent_paused\]/)
    expect(out).not.toMatch(/reconstructed from tool results/)
    expect(out).not.toContain('should-not-appear')
  })
})
