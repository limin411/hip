import { describe, it, expect, vi, beforeEach } from 'vitest'

const listSkills = vi.fn()
const installSkillZip = vi.fn()
const deleteSkill = vi.fn()
const getSkillsConfig = vi.fn()
const setSkillsConfig = vi.fn()
vi.mock('@/ipc/skills', () => ({
  listSkills: (...a: unknown[]) => listSkills(...a),
  installSkillZip: (...a: unknown[]) => installSkillZip(...a),
  deleteSkill: (...a: unknown[]) => deleteSkill(...a),
  getSkillsConfig: (...a: unknown[]) => getSkillsConfig(...a),
  setSkillsConfig: (...a: unknown[]) => setSkillsConfig(...a),
}))

const META = { id: 'pdf', name: 'PDF', description: 'd', dir: '/x/pdf', hasScripts: true }

beforeEach(async () => {
  listSkills.mockReset().mockResolvedValue([])
  installSkillZip.mockReset().mockResolvedValue('pdf')
  deleteSkill.mockReset().mockResolvedValue(undefined)
  getSkillsConfig.mockReset().mockResolvedValue({ enabled: {} })
  setSkillsConfig.mockReset().mockResolvedValue(undefined)
  const { useSkillsStore } = await import('./skillsStore.js')
  useSkillsStore.setState({ skills: [], enabled: {}, loaded: false })
})

describe('skillsStore', () => {
  it('load() hydrates skills + enabled map', async () => {
    listSkills.mockResolvedValueOnce([META])
    getSkillsConfig.mockResolvedValueOnce({ enabled: { pdf: false } })
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
    expect(setSkillsConfig).toHaveBeenCalledWith({ enabled: { pdf: false } })
  })

  it('install(zip) installs then reloads the list', async () => {
    installSkillZip.mockResolvedValueOnce('pdf')
    listSkills.mockResolvedValueOnce([META])
    getSkillsConfig.mockResolvedValueOnce({ enabled: {} })
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
    expect(setSkillsConfig).toHaveBeenCalledWith({ enabled: {} })
  })
})
