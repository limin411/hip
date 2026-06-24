// packages/sidecar/src/session/skills/registry.ts
import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type { SkillMeta } from '@hip/protocol'
import { resolveEffectiveConfig } from '../../config/hip-config.js'
import { parseFrontmatter } from './frontmatter.js'

/** Build the enabled/disabled map from hip.toml (global + project). Missing/corrupt → {} (everything enabled). */
function readEnabledMap(cwd: string): Record<string, boolean> {
  try {
    const entries = resolveEffectiveConfig(cwd).skills ?? []
    const map: Record<string, boolean> = {}
    for (const e of entries) {
      map[e.id] = e.enabled
    }
    return map
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

/** True when the given sub-directory exists under dir. Never throws. */
function detectDir(dir: string, sub: string): boolean {
  try {
    return existsSync(join(dir, sub)) && statSync(join(dir, sub)).isDirectory()
  } catch {
    return false
  }
}

/** Extract extended SkillMeta fields from parsed frontmatter data.
 *  Core fields (id, name, description, dir, scope) are set by the caller.
 *  All optional fields have sensible defaults applied. */
export function extractSkillMetaFromData(
  dir: string,
  data: Record<string, unknown>,
): Omit<SkillMeta, 'id' | 'name' | 'description' | 'dir' | 'scope'> {
  return {
    hasScripts: detectScripts(dir),
    hasReferences: detectDir(dir, 'references'),
    hasAssets: detectDir(dir, 'assets'),
    autoInvoke: data.autoInvoke !== undefined ? Boolean(data.autoInvoke) : true,
    userInvocable: data.userInvocable !== undefined ? Boolean(data.userInvocable) : true,
    allowedTools: Array.isArray(data.allowedTools)
      ? data.allowedTools.map((t: unknown) => String(t).trim()).filter(Boolean)
      : undefined,
    disallowedTools: Array.isArray(data.disallowedTools)
      ? data.disallowedTools.map((t: unknown) => String(t).trim()).filter(Boolean)
      : undefined,
    context: data.context === 'fork' ? 'fork' : 'inline',
    paths: Array.isArray(data.paths)
      ? data.paths.map((p: unknown) => String(p).trim()).filter(Boolean)
      : undefined,
    model: typeof data.model === 'string' ? data.model.trim() : undefined,
    effort: typeof data.effort === 'string'
      ? (['low', 'medium', 'high', 'xhigh', 'max'].includes(data.effort as string)
          ? data.effort as SkillMeta['effort']
          : undefined)
      : undefined,
    arguments: Array.isArray(data.arguments)
      ? data.arguments.map((a: unknown) => {
          if (typeof a === 'object' && a !== null) {
            const arg = a as Record<string, unknown>
            return {
              name: typeof arg.name === 'string' ? arg.name.trim() : '',
              description: typeof arg.description === 'string' ? arg.description.trim() : '',
              required: arg.required !== undefined ? Boolean(arg.required) : undefined,
            }
          }
          return { name: '', description: '', required: undefined }
        }).filter(a => a.name)
      : undefined,
    shell: data.shell === 'powershell' ? 'powershell' : (data.shell === 'bash' ? 'bash' : undefined),
    disableShellExecution: data.disableShellExecution !== undefined ? Boolean(data.disableShellExecution) : false,
  }
}

/**
 * Walk up from start until we find a directory that contains .hip/skills/ OR .git/
 * (project root). Returns the first directory with .hip/skills/, else the git root,
 * else start. Never throws.
 */
function findProjectRoot(start: string): string {
  let current = resolve(start)
  const root = sep === '\\' ? current.split(sep)[0] + sep : '/'
  while (true) {
    const hipSkills = join(current, '.hip', 'skills')
    try {
      if (existsSync(hipSkills) && statSync(hipSkills).isDirectory()) return current
    } catch { /* ignore */ }
    const git = join(current, '.git')
    try {
      if (existsSync(git) && statSync(git).isDirectory()) return current
    } catch { /* ignore */ }
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}

/** Scan a single skills root directory, parse frontmatter, cross-reference the
 *  enabled map, and return SkillMeta[] (unsorted). Folders without a SKILL.md,
 *  or whose frontmatter has no `name`, are skipped. Never throws. */
function scanSkillDir(root: string, enabled: Record<string, boolean>, scope: 'global' | 'project'): SkillMeta[] {
  const out: SkillMeta[] = []

  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return out
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
    const name = typeof data.name === 'string' ? data.name.trim() : undefined
    if (!name) continue

    const id = folder
    if (enabled[id] === false) continue

    out.push({
      id,
      name,
      description: typeof data.description === 'string' ? data.description.trim() : '',
      dir,
      scope,
      ...extractSkillMetaFromData(dir, data),
    })
  }

  return out
}

/** Scan .hip/skills/ relative to the project root discovered from cwd.
 *  Returns skills with scope set to project. Walks up the directory tree to find the
 *  project root (git root or first .hip/skills/ dir). Never throws. */
export function readProjectSkills(cwd: string): SkillMeta[] {
  const root = findProjectRoot(cwd)
  const projectSkillsDir = join(root, '.hip', 'skills')
  if (!existsSync(projectSkillsDir)) return []
  const enabled = readEnabledMap(cwd)
  const skills = scanSkillDir(projectSkillsDir, enabled, 'project')
  skills.sort((a, b) => a.id.localeCompare(b.id))
  return skills
}

/** Merge global + project skill arrays by priority (project overrides global).
 *  When multiple skills share the same id, the higher-priority one wins.
 *  Plugin skills always win (merged separately in session.ts). */
export function mergeSkills(global: SkillMeta[], project: SkillMeta[]): SkillMeta[] {
  const seen = new Map<string, SkillMeta>()
  for (const s of global) seen.set(s.id, s)
  for (const s of project) seen.set(s.id, s)
  const out = [...seen.values()]
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

/**
 * Scan HIP_SKILLS_DIR for SKILL.md files, parse YAML frontmatter (name/description),
 * cross-reference the hip.toml enabled map (a skill missing from the map counts
 * as enabled), and return the enabled SkillMeta[] sorted by id. Folders without a
 * SKILL.md, or whose frontmatter has no name, are skipped. Called every turn; never throws.
 *
 * When cwd is provided, also scans .hip/skills/ relative to the project root and
 * merges project skills over global skills (project overrides global for same id).
 */
export function readEnabledSkills(cwd?: string): SkillMeta[] {
  const root = process.env.HIP_SKILLS_DIR?.trim()
  if (!root || !existsSync(root)) {
    // No global skills dir — try project-only scan
    if (cwd) return readProjectSkills(cwd)
    return []
  }

  const enabled = readEnabledMap(cwd ?? process.cwd())
  const global = scanSkillDir(root, enabled, 'global')
  global.sort((a, b) => a.id.localeCompare(b.id))

  if (!cwd) return global

  const project = readProjectSkills(cwd)
  return mergeSkills(global, project)
}

/** Read the Markdown body of a SKILL.md (frontmatter stripped). Missing/unreadable returns "". */
export function readSkillBody(dir: string): string {
  try {
    const raw = readFileSync(join(dir, 'SKILL.md'), 'utf8')
    return parseFrontmatter(raw).body
  } catch {
    return ''
  }
}

/**
 * Relative paths (forward-slashed) of every file under a skill dir, recursively —
 * the file manifest handed to the model by use_skill. Missing/unreadable dir → [].
 */
export function listSkillFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string, prefix: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = join(current, entry)
      const rel = prefix ? `${prefix}/${entry}` : entry
      let isDir = false
      try {
        isDir = statSync(abs).isDirectory()
      } catch {
        continue
      }
      if (isDir) walk(abs, rel)
      else out.push(rel)
    }
  }
  walk(dir, '')
  return out
}
