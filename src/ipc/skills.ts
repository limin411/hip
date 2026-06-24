import { invoke } from '@tauri-apps/api/core'
import type { SkillMeta } from '@hip/protocol'

export async function listSkills(): Promise<SkillMeta[]> {
  const raw = await invoke<string>('list_skills')
  if (!raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as SkillMeta[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
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
