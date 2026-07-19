/**
 * Built-in product skills (progressive disclosure).
 *
 * Peers:
 * - Hermes: always-on help pointer + product skill for depth
 * - pi: system prompt lists doc paths; agent reads only when asked
 * - hip skills: L1 metadata → use_skill L2 body → L3 references via read_file
 *
 * Product copy SoT: docs/product/ → scripts/generate-product-content.mjs → content.ts
 * Content is embedded in content.ts (ncc does not ship loose markdown). We materialize to
 * `~/.hip/builtin-skills/<id>/` so use_skill / read_file can use absolute paths
 * outside the project root (same seam as ~/.hip/skills).
 *
 * Integrity: `.stamp` holds `version:fingerprint`. Any on-disk file that does not
 * byte-match embedded content triggers a full rewrite (dirty-disk repair).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SkillMeta } from '@hip/protocol'
import {
  HIP_SKILL_DESCRIPTION,
  HIP_SKILL_ID,
  HIP_SKILL_NAME,
  PRODUCT_CAPABILITY_MAP,
  PRODUCT_HELP_FALLBACK,
  PRODUCT_HELP_GUIDANCE,
  PRODUCT_SKILL_FILES,
  PRODUCT_SKILL_VERSION,
} from './content.js'
import { getOpsBuiltinSkills } from '../ops/materialize.js'

export {
  PRODUCT_CAPABILITY_MAP,
  PRODUCT_HELP_FALLBACK,
  PRODUCT_HELP_GUIDANCE,
} from './content.js'

function hipDataRoot(): string {
  return process.env.HIP_DATA_DIR?.trim() || join(homedir(), '.hip')
}

/** On-disk root for materialised built-in skills. */
export function builtinSkillsRoot(): string {
  return join(hipDataRoot(), 'builtin-skills')
}

/** SHA-256 fingerprint of version + all materialised bodies (canonical order). */
export function productContentFingerprint(): string {
  const h = createHash('sha256')
  h.update(PRODUCT_SKILL_VERSION)
  for (const f of PRODUCT_SKILL_FILES) {
    h.update('\0')
    h.update(f.rel)
    h.update('\0')
    h.update(f.body)
  }
  return h.digest('hex').slice(0, 24)
}

export function productStampValue(): string {
  return `${PRODUCT_SKILL_VERSION}:${productContentFingerprint()}`
}

function onDiskMatchesEmbedded(dir: string): boolean {
  const stampPath = join(dir, '.stamp')
  if (!existsSync(stampPath)) return false
  try {
    if (readFileSync(stampPath, 'utf8').trim() !== productStampValue()) return false
  } catch {
    return false
  }
  for (const f of PRODUCT_SKILL_FILES) {
    const p = join(dir, f.rel)
    if (!existsSync(p)) return false
    try {
      if (readFileSync(p, 'utf8') !== f.body) return false
    } catch {
      return false
    }
  }
  return true
}

/**
 * Ensure the hip product skill is on disk and byte-matches embedded content.
 * Idempotent; never throws to callers of getBuiltinSkills (errors are swallowed there).
 */
export function ensureHipProductSkillDir(): string {
  const dir = join(builtinSkillsRoot(), HIP_SKILL_ID)
  if (onDiskMatchesEmbedded(dir)) return dir

  for (const f of PRODUCT_SKILL_FILES) {
    const abs = join(dir, f.rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.body, 'utf8')
  }
  writeFileSync(join(dir, '.stamp'), `${productStampValue()}\n`, 'utf8')
  // Drop legacy .version from v1 materialization if present (best-effort).
  try {
    const legacy = join(dir, '.version')
    if (existsSync(legacy)) writeFileSync(legacy, `${PRODUCT_SKILL_VERSION}\n`, 'utf8')
  } catch {
    /* ignore */
  }
  return dir
}

/** Built-in product skill only (hip help). */
export function getProductBuiltinSkills(): SkillMeta[] {
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
 * All built-in skills for the managed agent: product help + operational coding depth.
 * Callers merge with user/project/plugin skills (later wins on same id).
 */
export function getBuiltinSkills(): SkillMeta[] {
  return [...getProductBuiltinSkills(), ...getOpsBuiltinSkills()]
}

/** True when the session skill list can resolve use_skill({ name: "hip" }). */
export function isHipProductSkillAvailable(skills: SkillMeta[] | undefined): boolean {
  if (!skills || skills.length === 0) return false
  return skills.some((s) => s.id === HIP_SKILL_ID || s.name === HIP_SKILL_NAME)
}

/** Pick L0 help line based on whether use_skill("hip") can succeed. */
export function productHelpBlock(skillAvailable: boolean): string {
  return skillAvailable ? PRODUCT_HELP_GUIDANCE : PRODUCT_HELP_FALLBACK
}
