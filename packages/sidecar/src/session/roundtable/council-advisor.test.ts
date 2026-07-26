import { describe, it, expect } from 'vitest'
import { COUNCIL_ADVISOR_TOOLS } from './council-advisor.js'

describe('COUNCIL_ADVISOR_TOOLS', () => {
  it('includes network search and read-only tools', () => {
    expect(COUNCIL_ADVISOR_TOOLS).toContain('web_search')
    expect(COUNCIL_ADVISOR_TOOLS).toContain('web_fetch')
    expect(COUNCIL_ADVISOR_TOOLS).toContain('read_file')
    expect(COUNCIL_ADVISOR_TOOLS).toContain('grep')
  })

  it('does not include write or exec tools', () => {
    expect(COUNCIL_ADVISOR_TOOLS).not.toContain('write_file')
    expect(COUNCIL_ADVISOR_TOOLS).not.toContain('edit_file')
    expect(COUNCIL_ADVISOR_TOOLS).not.toContain('run_script')
    expect(COUNCIL_ADVISOR_TOOLS).not.toContain('task')
    expect(COUNCIL_ADVISOR_TOOLS).not.toContain('dispatch_agent')
  })
})
