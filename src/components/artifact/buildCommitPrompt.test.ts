import { describe, expect, it } from 'vitest'
import { buildCommitPrompt } from './buildCommitPrompt'

describe('buildCommitPrompt', () => {
  const base = {
    branch: 'main',
    uncommittedPaths: ['a.ts', 'b.ts'],
    messageByAgent: '(agent message)',
    filesByAgent: '(agent files)',
    template:
      'branch={{branch}}\nmessage={{message}}\nfilesNote={{filesNote}}\nfiles={{files}}',
  }

  it('uses provided message and files note', () => {
    const p = buildCommitPrompt({
      ...base,
      message: 'fix bug',
      filesNote: 'only a.ts',
    })
    expect(p).toContain('message=fix bug')
    expect(p).toContain('filesNote=only a.ts')
    expect(p).toContain('files=a.ts\nb.ts')
    expect(p).toContain('branch=main')
  })

  it('falls back to agent instructions when message/files are empty', () => {
    const p = buildCommitPrompt({
      ...base,
      message: '   ',
      filesNote: '',
    })
    expect(p).toContain('message=(agent message)')
    expect(p).toContain('filesNote=(agent files)')
  })
})
