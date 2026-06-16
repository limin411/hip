import { invoke } from '@tauri-apps/api/core'
import type { SkillMeta, SkillsConfig } from '@hip/protocol'

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

export async function getSkillsConfig(): Promise<SkillsConfig> {
  const raw = await invoke<string>('get_skills_config')
  if (!raw.trim()) return { enabled: {} }
  try {
    const parsed = JSON.parse(raw) as SkillsConfig
    return parsed && typeof parsed.enabled === 'object' && parsed.enabled !== null
      ? { enabled: parsed.enabled }
      : { enabled: {} }
  } catch {
    return { enabled: {} }
  }
}

export async function setSkillsConfig(cfg: SkillsConfig): Promise<void> {
  await invoke<void>('set_skills_config', { json: JSON.stringify(cfg, null, 2) })
}
