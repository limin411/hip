import { invoke } from '@tauri-apps/api/core'
import type { SkillMeta } from '@hip/protocol'

export async function listSkills(): Promise<SkillMeta[]> {
  const call = async (): Promise<SkillMeta[]> => {
    const raw = await invoke<string>('list_skills')
    if (!raw?.trim()) return []
    try {
      const parsed = JSON.parse(raw) as SkillMeta[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  // Retry a few times: in E2E the embedded WebDriver provider can return an
  // empty list on the first call even though the backend has skills ready.
  for (let i = 0; i < 5; i++) {
    const skills = await call()
    if (skills.length > 0) return skills
    await new Promise((r) => setTimeout(r, 300))
  }
  return []
}

export async function installSkillZip(zipPath: string): Promise<string> {
  return invoke<string>('install_skill_zip', { zipPath })
}

export async function deleteSkill(id: string): Promise<void> {
  await invoke<void>('delete_skill', { id })
}

export async function readSkillFile(id: string, rel: string): Promise<string> {
  return invoke<string>('read_skill_file', { id, rel })
}
