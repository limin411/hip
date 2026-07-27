/**
 * Materialize built-in operational skills under ~/.hip/builtin-skills/<id>/.
 * Same integrity model as product skills (version:fingerprint + byte match).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SkillMeta } from '@hip/protocol'
import {
  CODING_SKILL_DESCRIPTION,
  CODING_SKILL_FILES,
  CODING_SKILL_ID,
  CODING_SKILL_NAME,
  OPS_SKILL_VERSION,
} from './content.js'

function hipDataRoot(): string {
  return process.env.HIP_DATA_DIR?.trim() || join(homedir(), '.hip')
}

function builtinSkillsRoot(): string {
  return join(hipDataRoot(), 'builtin-skills')
}

function fingerprint(files: ReadonlyArray<{ rel: string; body: string }>, version: string): string {
  const h = createHash('sha256')
  h.update(version)
  for (const f of files) {
    h.update('\0')
    h.update(f.rel)
    h.update('\0')
    h.update(f.body)
  }
  return h.digest('hex').slice(0, 24)
}

function stampValue(version: string, files: ReadonlyArray<{ rel: string; body: string }>): string {
  return `${version}:${fingerprint(files, version)}`
}

function onDiskMatches(
  dir: string,
  version: string,
  files: ReadonlyArray<{ rel: string; body: string }>,
): boolean {
  const stampPath = join(dir, '.stamp')
  if (!existsSync(stampPath)) return false
  try {
    if (readFileSync(stampPath, 'utf8').trim() !== stampValue(version, files)) return false
  } catch {
    return false
  }
  for (const f of files) {
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

function ensureSkillDir(
  id: string,
  version: string,
  files: ReadonlyArray<{ rel: string; body: string }>,
): string {
  const dir = join(builtinSkillsRoot(), id)
  if (onDiskMatches(dir, version, files)) return dir
  for (const f of files) {
    const abs = join(dir, f.rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.body, 'utf8')
  }
  writeFileSync(join(dir, '.stamp'), `${stampValue(version, files)}\n`, 'utf8')
  return dir
}

/** Operational built-in skills (coding/delegation/git depth). */
export function getOpsBuiltinSkills(): SkillMeta[] {
  try {
    const dir = ensureSkillDir(CODING_SKILL_ID, OPS_SKILL_VERSION, CODING_SKILL_FILES)
    return [
      {
        id: CODING_SKILL_ID,
        name: CODING_SKILL_NAME,
        description: CODING_SKILL_DESCRIPTION,
        dir,
        hasScripts: false,
        hasReferences: false,
        hasAssets: false,
        scope: 'builtin',
        autoInvoke: true,
        userInvocable: true,
      },
    ]
  } catch {
    return []
  }
}

export { CODING_SKILL_ID }
