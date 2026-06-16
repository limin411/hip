import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

beforeEach(() => invoke.mockReset())

describe('skills IPC', () => {
  it('listSkills parses the JSON array payload', async () => {
    const { listSkills } = await import('./skills.js')
    invoke.mockResolvedValueOnce(
      JSON.stringify([{ id: 'pdf', name: 'PDF', description: 'd', dir: '/x/pdf', hasScripts: true }]),
    )
    const skills = await listSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ id: 'pdf', hasScripts: true })
    expect(invoke).toHaveBeenCalledWith('list_skills')
  })

  it('listSkills returns [] on blank/corrupt', async () => {
    const { listSkills } = await import('./skills.js')
    invoke.mockResolvedValueOnce('')
    expect(await listSkills()).toEqual([])
    invoke.mockResolvedValueOnce('{ broken')
    expect(await listSkills()).toEqual([])
  })

  it('installSkillZip passes the path and returns the installed id', async () => {
    const { installSkillZip } = await import('./skills.js')
    invoke.mockResolvedValueOnce('pdf-tools')
    const id = await installSkillZip('/tmp/x.zip')
    expect(id).toBe('pdf-tools')
    expect(invoke).toHaveBeenCalledWith('install_skill_zip', { zipPath: '/tmp/x.zip' })
  })

  it('deleteSkill passes the id', async () => {
    const { deleteSkill } = await import('./skills.js')
    invoke.mockResolvedValueOnce(undefined)
    await deleteSkill('pdf')
    expect(invoke).toHaveBeenCalledWith('delete_skill', { id: 'pdf' })
  })

  it('readSkillFile passes id + rel', async () => {
    const { readSkillFile } = await import('./skills.js')
    invoke.mockResolvedValueOnce('# Body')
    const body = await readSkillFile('pdf', 'SKILL.md')
    expect(body).toBe('# Body')
    expect(invoke).toHaveBeenCalledWith('read_skill_file', { id: 'pdf', rel: 'SKILL.md' })
  })

  it('getSkillsConfig parses + returns default on blank/corrupt', async () => {
    const { getSkillsConfig } = await import('./skills.js')
    invoke.mockResolvedValueOnce(JSON.stringify({ enabled: { pdf: false } }))
    expect((await getSkillsConfig()).enabled).toEqual({ pdf: false })
    invoke.mockResolvedValueOnce('')
    expect((await getSkillsConfig()).enabled).toEqual({})
    invoke.mockResolvedValueOnce('{ broken')
    expect((await getSkillsConfig()).enabled).toEqual({})
  })

  it('setSkillsConfig stringifies and invokes set_skills_config', async () => {
    const { setSkillsConfig } = await import('./skills.js')
    invoke.mockResolvedValueOnce(undefined)
    await setSkillsConfig({ enabled: { pdf: true } })
    expect(invoke).toHaveBeenCalledWith('set_skills_config', {
      json: JSON.stringify({ enabled: { pdf: true } }, null, 2),
    })
  })
})
