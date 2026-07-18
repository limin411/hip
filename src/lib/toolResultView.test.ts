import { describe, expect, it } from 'vitest'
import { buildToolResultModel } from './toolResultView'

describe('buildToolResultModel (P2 U12)', () => {
  it('classifies edit with meta.diff as diff kind', () => {
    const m = buildToolResultModel({
      name: 'edit_file',
      input: JSON.stringify({ path: '/a.ts', oldString: 'a', newString: 'b' }),
      output: 'edited /a.ts',
      status: 'finished',
      meta: { diff: '@@ -1 +1 @@\n-a\n+b\n', paths: ['/a.ts'] },
    })
    expect(m.kind).toBe('diff')
    expect(m.diff).toContain('+b')
    expect(m.path).toBe('/a.ts')
  })

  it('splits grep output into lines', () => {
    const m = buildToolResultModel({
      name: 'grep',
      input: JSON.stringify({ pattern: 'foo' }),
      output: 'a.ts:1:foo\nb.ts:2:foo',
      status: 'finished',
    })
    expect(m.kind).toBe('lines')
    expect(m.lines).toHaveLength(2)
  })

  it('parses shell exit code when present', () => {
    const m = buildToolResultModel({
      name: 'run_script',
      input: JSON.stringify({ command: 'false' }),
      output: 'failed\nexit_code=1',
      status: 'finished',
    })
    expect(m.kind).toBe('shell')
    expect(m.exitCode).toBe(1)
    expect(m.isError).toBe(true)
  })

  it('marks error status', () => {
    const m = buildToolResultModel({
      name: 'read_file',
      input: JSON.stringify({ path: '/x' }),
      status: 'error',
      error: 'ENOENT',
    })
    expect(m.isError).toBe(true)
    expect(m.errorText).toBe('ENOENT')
  })
})
