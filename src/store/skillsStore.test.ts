import { describe, it, expect, vi, beforeEach } from 'vitest'

const listSkills = vi.fn()
const installSkillZip = vi.fn()
const deleteSkill = vi.fn()
vi.mock('@/ipc/skills', () => ({
  listSkills: (...a: unknown[]) => listSkills(...a),
  installSkillZip: (...a: unknown[]) => installSkillZip(...a),
  deleteSkill: (...a: unknown[]) => deleteSkill(...a),
}))

const hipConfigState = {
  config: { version: 1, skills: [] as { id: string; enabled: boolean }[] },
  loaded: false,
  load: vi.fn(),
  updateSection: vi.fn(),
}
vi.mock('@/store/hipConfigStore', () => ({
  useHipConfigStore: {
    getState: () => hipConfigState,
  },
}))

const META = { id: 'pdf', name: 'PDF', description: 'd', dir: '/x/pdf', hasScripts: true }

beforeEach(async () => {
  listSkills.mockReset().mockResolvedValue([])
  installSkillZip.mockReset().mockResolvedValue('pdf')
  deleteSkill.mockReset().mockResolvedValue(undefined)
  hipConfigState.config = { version: 1, skills: [] }
  hipConfigState.loaded = false
  hipConfigState.load.mockReset().mockResolvedValue(undefined)
  hipConfigState.updateSection.mockReset().mockResolvedValue(undefined)
  const { useSkillsStore } = await import('./skillsStore.js')
  useSkillsStore.setState({ skills: [], enabled: {}, loaded: false })
})

describe('skillsStore', () => {
  it('load() hydrates skills + enabled map', async () => {
    listSkills.mockResolvedValueOnce([META])
    hipConfigState.config.skills = [{ id: 'pdf', enabled: false }]
    const { useSkillsStore } = await import('./skillsStore.js')
    await useSkillsStore.getState().load()
    const s = useSkillsStore.getState()
    expect(s.skills).toHaveLength(1)
    expect(s.enabled).toEqual({ pdf: false })
    expect(s.loaded).toBe(true)
  })

  it('toggle(id, on) persists the enabled map and updates state', async () => {
    const { useSkillsStore } = await import('./skillsStore.js')
    useSkillsStore.setState({ skills: [META], enabled: {}, loaded: true })
    await useSkillsStore.getState().toggle('pdf', false)
    expect(useSkillsStore.getState().enabled.pdf).toBe(false)
    expect(hipConfigState.updateSection).toHaveBeenCalledWith('skills', expect.any(Function))
    // Verify the updater function's behavior
    const fn = hipConfigState.updateSection.mock.calls[0][1] as (prev: unknown[]) => unknown[]
    const result = fn([])
    expect(result).toEqual([{ id: 'pdf', enabled: false }])
  })

  it('toggle(id, on) updates an existing entry in place without reordering', async () => {
    const { useSkillsStore } = await import('./skillsStore.js')
    await useSkillsStore.getState().toggle('b', false)
    const fn = hipConfigState.updateSection.mock.calls[0][1] as (
      prev: { id: string; enabled: boolean }[],
    ) => { id: string; enabled: boolean }[]
    const result = fn([
      { id: 'a', enabled: true },
      { id: 'b', enabled: true },
      { id: 'c', enabled: true },
    ])
    expect(result).toEqual([
      { id: 'a', enabled: true },
      { id: 'b', enabled: false },
      { id: 'c', enabled: true },
    ])
  })

  it('install(zip) installs then reloads the list', async () => {
    installSkillZip.mockResolvedValueOnce('pdf')
    listSkills.mockResolvedValueOnce([META])
    hipConfigState.config.skills = []
    const { useSkillsStore } = await import('./skillsStore.js')
    await useSkillsStore.getState().install('/tmp/x.zip')
    expect(installSkillZip).toHaveBeenCalledWith('/tmp/x.zip')
    expect(useSkillsStore.getState().skills).toHaveLength(1)
  })

  it('remove(id) deletes, drops from list, and clears its enabled entry', async () => {
    const { useSkillsStore } = await import('./skillsStore.js')
    useSkillsStore.setState({ skills: [META], enabled: { pdf: false }, loaded: true })
    await useSkillsStore.getState().remove('pdf')
    expect(deleteSkill).toHaveBeenCalledWith('pdf')
    expect(useSkillsStore.getState().skills).toHaveLength(0)
    expect(useSkillsStore.getState().enabled.pdf).toBeUndefined()
    expect(hipConfigState.updateSection).toHaveBeenCalledWith('skills', expect.any(Function))
    // Verify the updater function's behavior
    const fn = hipConfigState.updateSection.mock.calls[0][1] as (prev: unknown[]) => unknown[]
    const result = fn([{ id: 'pdf', enabled: true }])
    expect(result).toEqual([])
  })
})
