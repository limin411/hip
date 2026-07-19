/**
 * Built-in product skills (progressive disclosure).
 *
 * Peers:
 * - Hermes: always-on help pointer + `hermes-agent` skill for product depth
 * - pi: system prompt lists doc paths; agent reads only when asked about the product
 * - hip skills: L1 metadata → use_skill L2 body → L3 references via read_file
 *
 * Content is embedded (ncc does not ship loose markdown). We materialize to
 * `~/.hip/builtin-skills/<id>/` so use_skill / read_file can use absolute paths
 * outside the project root (same seam as ~/.hip/skills).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SkillMeta } from '@hip/protocol'
import {
  CONFIG_REFERENCE_MD,
  HIP_SKILL_DESCRIPTION,
  HIP_SKILL_ID,
  HIP_SKILL_MD,
  HIP_SKILL_NAME,
  MEMORY_REFERENCE_MD,
  PRODUCT_SKILL_VERSION,
} from './content.js'

function hipDataRoot(): string {
  return process.env.HIP_DATA_DIR?.trim() || join(homedir(), '.hip')
}

/** On-disk root for materialised built-in skills. */
export function builtinSkillsRoot(): string {
  return join(hipDataRoot(), 'builtin-skills')
}

/**
 * Ensure the hip product skill is on disk at the expected version.
 * Idempotent; never throws to callers of getBuiltinSkills (errors are swallowed there).
 */
export function ensureHipProductSkillDir(): string {
  const dir = join(builtinSkillsRoot(), HIP_SKILL_ID)
  const stamp = join(dir, '.version')
  const skillMd = join(dir, 'SKILL.md')
  if (existsSync(stamp) && existsSync(skillMd)) {
    try {
      if (readFileSync(stamp, 'utf8').trim() === PRODUCT_SKILL_VERSION) return dir
    } catch {
      /* rewrite below */
    }
  }

  const refs = join(dir, 'references')
  mkdirSync(refs, { recursive: true })
  writeFileSync(skillMd, HIP_SKILL_MD, 'utf8')
  writeFileSync(join(refs, 'memory.md'), MEMORY_REFERENCE_MD, 'utf8')
  writeFileSync(join(refs, 'config-and-data.md'), CONFIG_REFERENCE_MD, 'utf8')
  writeFileSync(stamp, `${PRODUCT_SKILL_VERSION}\n`, 'utf8')
  return dir
}

/** Built-in product skills always available to the managed (non-external) agent. */
export function getBuiltinSkills(): SkillMeta[] {
  try {
    const dir = ensureHipProductSkillDir()
    return [
      {
        id: HIP_SKILL_ID,
        name: HIP_SKILL_NAME,
        description: HIP_SKILL_DESCRIPTION,
        dir,
        hasScripts: false,
        hasReferences: true,
        hasAssets: false,
        scope: 'global',
        autoInvoke: true,
        userInvocable: true,
      },
    ]
  } catch {
    return []
  }
}

/**
 * Compact always-on pointer (Hermes-style). Instructs the model to load the
 * product skill only for product questions — not for ordinary coding work.
 */
export const PRODUCT_HELP_GUIDANCE =
  'When the user asks about hip itself — setup, Settings, Chat vs Code surfaces, permission modes ' +
  '(chat/edit/full), skills, plugins, MCP, memory, agents, the product CLI, or local data under ~/.hip — ' +
  'call use_skill({ name: "hip" }) and follow its guide (and references/ for depth). ' +
  'Do not invent product UI labels or config keys; prefer the skill over guessing. ' +
  'For ordinary project work, do not load the hip skill.'
