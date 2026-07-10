import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadProjectAgentsMd,
  loadProjectMemoryMd,
  ProjectAgentsMdInjector,
} from './project-agents-md.js'

describe('project-agents-md', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hip-agents-md-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('loads AGENTS.md when present', async () => {
    await writeFile(join(dir, 'AGENTS.md'), '# Rules\n- use yarn\n')
    const r = loadProjectAgentsMd(dir)
    expect(r?.name).toBe('AGENTS.md')
    expect(r?.content).toContain('use yarn')
  })

  it('prefers AGENTS.md over CLAUDE.md', async () => {
    await writeFile(join(dir, 'AGENTS.md'), 'from agents')
    await writeFile(join(dir, 'CLAUDE.md'), 'from claude')
    expect(loadProjectAgentsMd(dir)?.content).toBe('from agents')
  })

  it('falls back to CLAUDE.md / Claude.md', async () => {
    await writeFile(join(dir, 'CLAUDE.md'), 'claude only')
    // macOS default FS is case-insensitive; name may report as Claude.md or CLAUDE.md
    const name = loadProjectAgentsMd(dir)?.name
    expect(name?.toLowerCase()).toBe('claude.md')
    expect(loadProjectAgentsMd(dir)?.content).toContain('claude only')
  })

  it('loads .hip/MEMORY.md', async () => {
    await mkdir(join(dir, '.hip'), { recursive: true })
    await writeFile(join(dir, '.hip', 'MEMORY.md'), 'remember X')
    expect(loadProjectMemoryMd(dir)?.content).toContain('remember X')
  })

  it('injector emits system messages for agents + memory', async () => {
    await writeFile(join(dir, 'AGENTS.md'), 'agent rules')
    await mkdir(join(dir, '.hip'), { recursive: true })
    await writeFile(join(dir, '.hip', 'MEMORY.md'), 'memory notes')
    const inj = new ProjectAgentsMdInjector()
    const r = await inj.inject({
      cwd: dir,
      permissionMode: 'edit',
      skills: [],
      tokenBudgetPercent: 100,
    })
    expect(r.systemMessages).toHaveLength(2)
    expect(r.systemMessages[0]).toContain('agent rules')
    expect(r.systemMessages[1]).toContain('memory notes')
  })

  it('injector is silent when no files exist', async () => {
    const inj = new ProjectAgentsMdInjector()
    const r = await inj.inject({
      cwd: dir,
      permissionMode: 'edit',
      skills: [],
      tokenBudgetPercent: 100,
    })
    expect(r.systemMessages).toEqual([])
  })
})
