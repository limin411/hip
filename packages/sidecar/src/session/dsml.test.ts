import { describe, it, expect } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { parseDsmlToolCalls, isDsmlOnlyOrEmpty, hasDsmlToolCalls } from './dsml.js'
import { recoverDsmlToolCalls } from './model-runner.js'

/** Fixture from logs/bug.json (fullwidth bar DSML). */
const BUG_DSML = `<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="run_script">
<｜｜DSML｜｜parameter name="command" string="true">cd /d D:\\\\0_code_project && dir /s /b *Zuolin*.* 2>nul</｜｜DSML｜｜parameter>
<｜｜DSML｜｜parameter name="reason" string="true">Search for any file containing Zuolin in the name</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>`

const DEGRADED_DSML =
  'I will search first.<||DSML||tool_calls><||DSML||invoke name="grep"><||DSML||parameter name="pattern" string="true">zuolin</||DSML||parameter></||DSML||invoke></||DSML||tool_calls>'

describe('parseDsmlToolCalls', () => {
  it('parses bug.json fullwidth DSML run_script', () => {
    const r = parseDsmlToolCalls(BUG_DSML)
    expect(r.recovered).toBe(true)
    expect(r.toolCalls).toHaveLength(1)
    expect(r.toolCalls[0].name).toBe('run_script')
    expect(r.toolCalls[0].args.command).toMatch(/Zuolin/)
    expect(r.toolCalls[0].args.reason).toMatch(/Search/)
    expect(r.content.trim()).toBe('')
  })

  it('parses degraded ASCII ||DSML|| with leading prose', () => {
    const r = parseDsmlToolCalls(DEGRADED_DSML)
    expect(r.recovered).toBe(true)
    expect(r.toolCalls[0].name).toBe('grep')
    expect(r.toolCalls[0].args.pattern).toBe('zuolin')
    expect(r.content).toContain('I will search first')
  })

  it('is identity when no DSML present', () => {
    const r = parseDsmlToolCalls('plain answer with no tools')
    expect(r.recovered).toBe(false)
    expect(r.toolCalls).toHaveLength(0)
    expect(r.content).toBe('plain answer with no tools')
  })
})

describe('isDsmlOnlyOrEmpty', () => {
  it('treats pure DSML block as useless even when parameter bodies are long', () => {
    expect(isDsmlOnlyOrEmpty(BUG_DSML)).toBe(true)
  })

  it('keeps normal prose', () => {
    expect(isDsmlOnlyOrEmpty('Found ZuolinConfig and DataSyncService.')).toBe(false)
  })
})

describe('recoverDsmlToolCalls', () => {
  it('attaches tool_calls when content has DSML and structured calls are empty', () => {
    const msg = new AIMessage({ content: BUG_DSML })
    const out = recoverDsmlToolCalls(msg)
    expect(out.tool_calls?.length).toBe(1)
    expect(out.tool_calls?.[0].name).toBe('run_script')
    expect(typeof out.content === 'string' ? out.content : '').not.toMatch(/DSML/)
  })

  it('does not override existing structured tool_calls', () => {
    const msg = new AIMessage({
      content: BUG_DSML,
      tool_calls: [{ id: 'c1', name: 'ls', args: { path: '/' }, type: 'tool_call' }],
    })
    const out = recoverDsmlToolCalls(msg)
    expect(out.tool_calls).toHaveLength(1)
    expect(out.tool_calls?.[0].name).toBe('ls')
  })
})

describe('hasDsmlToolCalls', () => {
  it('detects bug fixture', () => {
    expect(hasDsmlToolCalls(BUG_DSML)).toBe(true)
    expect(hasDsmlToolCalls('no markup')).toBe(false)
  })
})
