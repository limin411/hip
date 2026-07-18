import { describe, expect, it } from 'vitest'
import { OpenFileContextInjector, renderOpenFileContext } from './open-file-context.js'

describe('OpenFileContextInjector (P4 E4)', () => {
  it('renders nothing without path', async () => {
    const inj = new OpenFileContextInjector()
    const r = await inj.inject({ cwd: '/x', permissionMode: 'edit', skills: [], tokenBudgetPercent: 100 })
    expect(r.systemMessages).toEqual([])
  })

  it('includes path for fix-this targeting', async () => {
    const inj = new OpenFileContextInjector()
    const r = await inj.inject({
      cwd: '/x',
      permissionMode: 'edit',
      skills: [],
      tokenBudgetPercent: 100,
      openFilePath: 'src/a.ts',
      openFileExcerpt: 'export const x = 1',
    } as never)
    expect(r.systemMessages[0]).toContain('src/a.ts')
    expect(r.systemMessages[0]).toContain('export const x = 1')
  })

  it('renderOpenFileContext pure helper', () => {
    expect(renderOpenFileContext('/foo.ts')).toContain('/foo.ts')
    expect(renderOpenFileContext('/foo.ts')).toMatch(/fix this/i)
  })
})
