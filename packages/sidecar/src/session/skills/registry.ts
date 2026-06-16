// packages/sidecar/src/session/skills/registry.ts
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SkillMeta, SkillsConfig } from '@hip/protocol'
import { parseFrontmatter } from './frontmatter.js'

/** Read the enabled/disabled map from HIP_SKILLS_PATH. Missing/corrupt → {} (everything enabled). */
function readEnabledMap(): Record<string, boolean> {
  const file = process.env.HIP_SKILLS_PATH?.trim()
  if (!file) return {}
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as SkillsConfig
    return cfg?.enabled && typeof cfg.enabled === 'object' ? cfg.enabled : {}
  } catch {
    return {}
  }
}

/** True when <dir>/scripts exists and is a directory. */
function detectScripts(dir: string): boolean {
  try {
    return statSync(join(dir, 'scripts')).isDirectory()
  } catch {
    return false
  }
}

/**
 * Scan HIP_SKILLS_DIR/<folder>/SKILL.md, parse YAML frontmatter (name/description),
 * cross-reference the HIP_SKILLS_PATH enabled map (a skill missing from the map counts
 * as enabled), and return the enabled SkillMeta[] sorted by id. Folders without a
 * SKILL.md, or whose frontmatter has no `name`, are skipped. Called every turn; never throws.
 */
export function readEnabledSkills(): SkillMeta[] {
  const root = process.env.HIP_SKILLS_DIR?.trim()
  if (!root || !existsSync(root)) return []

  const enabled = readEnabledMap()
  const out: SkillMeta[] = []

  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }

  for (const folder of entries) {
    const dir = join(root, folder)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const skillMd = join(dir, 'SKILL.md')
    if (!existsSync(skillMd)) continue

    let raw: string
    try {
      raw = readFileSync(skillMd, 'utf8')
    } catch {
      continue
    }
    const { data } = parseFrontmatter(raw)
    const name = data.name?.trim()
    if (!name) continue

    const id = folder
    if (enabled[id] === false) continue

    out.push({
      id,
      name,
      description: data.description?.trim() ?? '',
      dir,
      hasScripts: detectScripts(dir),
    })
  }

  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}
