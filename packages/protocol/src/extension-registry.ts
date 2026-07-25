/** Extension registry: single source of truth for skill / MCP conflict resolution. */
import type { McpServerConfig } from './mcp-config.js'
import type { SkillMeta } from './skills.js'

// ─── Sources & conflicts ────────────────────────────────────────────────────

/** Where a skill or MCP candidate came from. */
export type ExtensionSourceKind =
  | 'builtin'
  | 'user_skill'
  | 'project_skill'
  | 'plugin_skill'
  | 'user_mcp'
  | 'project_mcp'
  | 'plugin_mcp'

export interface ExtensionSourceRef {
  kind: ExtensionSourceKind
  /** Plugin slug when kind is plugin_* */
  pluginId?: string
  /** Absolute path (skill dir, plugin root, etc.) when known */
  path?: string
  /** Skill id or MCP server id */
  configId?: string
}

export type ExtensionConflictKind =
  | 'skill_id_shadow'
  | 'mcp_id_shadow'
  | 'mcp_capability_duplicate'
  | 'mcp_name_veto'
  | 'skill_disabled'

export interface ExtensionConflict {
  kind: ExtensionConflictKind
  winner: ExtensionSourceRef
  loser: ExtensionSourceRef
  /** Capability fingerprint when kind is mcp_capability_duplicate */
  fingerprint?: string
  message: string
}

export interface SkillResolution {
  id: string
  active: boolean
  meta: SkillMeta
  winner: ExtensionSourceRef
  shadowedBy?: ExtensionSourceRef
}

export interface McpResolution {
  id: string
  active: boolean
  config: McpServerConfig
  winner: ExtensionSourceRef
  fingerprint: string
  shadowedBy?: ExtensionSourceRef
}

export interface ExtensionRegistrySnapshot {
  skills: SkillResolution[]
  mcpServers: McpResolution[]
  conflicts: ExtensionConflict[]
  generatedAt: number
}

// ─── Candidates (inputs to pure resolve) ────────────────────────────────────

/**
 * Skill precedence tier (lower = higher priority):
 * project (0) > user/global (1) > plugin (2) > builtin (3)
 */
export type SkillTier = 0 | 1 | 2 | 3

export const SKILL_TIER = {
  project: 0,
  user: 1,
  plugin: 2,
  builtin: 3,
} as const satisfies Record<string, SkillTier>

/**
 * MCP precedence tier (lower = higher priority):
 * hip.toml user/project (0) > plugin (1)
 */
export type McpTier = 0 | 1

export const MCP_TIER = {
  config: 0,
  plugin: 1,
} as const satisfies Record<string, McpTier>

export interface SkillCandidate {
  id: string
  meta: SkillMeta
  source: ExtensionSourceRef
  tier: SkillTier
  /** Within the same tier, lower order wins (e.g. plugin registry order). */
  order: number
}

export interface McpCandidate {
  id: string
  config: McpServerConfig
  source: ExtensionSourceRef
  tier: McpTier
  order: number
  /**
   * When true, this candidate only claims the id (name veto) and is never active.
   * Used for hip.toml entries with `enabled = false`.
   */
  vetoOnly?: boolean
  /**
   * When true, this server may remain active even if another active server
   * shares the same capability fingerprint.
   */
  allowDuplicate?: boolean
}

// ─── Capability fingerprint ─────────────────────────────────────────────────

/** Extract npm package name from stdio args (e.g. `npx -y chrome-devtools-mcp@1.6.0`). */
export function extractNpmPackageHint(args: string[] | undefined): string | undefined {
  if (!args?.length) return undefined
  for (const a of args) {
    if (!a || a.startsWith('-')) continue
    if (a.endsWith('.js') || a.endsWith('.mjs') || a.endsWith('.cjs') || a.endsWith('.ts')) continue
    // Absolute / relative paths
    if (a.startsWith('/') || a.startsWith('./') || a.startsWith('../') || /^[A-Za-z]:[\\/]/.test(a)) {
      continue
    }
    // @scope/name or @scope/name@version
    if (a.startsWith('@')) {
      const m = a.match(/^(@[^/]+\/[^@]+)(?:@.+)?$/)
      if (m?.[1]) return m[1]
      continue
    }
    // bare package or package@version (must look package-like)
    if (/^[\w.-]+(?:@[\w.^~>=<*|.-]+)?$/.test(a)) {
      return a.replace(/@[^@]+$/, '')
    }
  }
  return undefined
}

function basenameCmd(command: string): string {
  const norm = command.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return i >= 0 ? norm.slice(i + 1) : norm
}

/**
 * Stable capability fingerprint for MCP duplicate detection.
 * Same package / same HTTP endpoint → same fingerprint even when ids differ.
 */
export function mcpCapabilityFingerprint(config: McpServerConfig): string {
  if (config.transport === 'http' || config.transport === 'sse') {
    const raw = (config.url ?? '').trim()
    try {
      const u = new URL(raw)
      const path = u.pathname.replace(/\/+$/, '') || '/'
      return `${config.transport}:${u.origin}${path}`
    } catch {
      return `${config.transport}:${raw}`
    }
  }
  const cmd = basenameCmd(config.command ?? '')
  const pkg = extractNpmPackageHint(config.args)
  if (pkg) return `stdio:pkg:${pkg}`
  const significant = (config.args ?? [])
    .filter((a) => a && !a.startsWith('-'))
    .map((a) => basenameCmd(a))
  return `stdio:cmd:${cmd}:${significant.join(',')}`
}

// ─── Pure resolve ───────────────────────────────────────────────────────────

/**
 * Resolve skill candidates: one active winner per id.
 * Disabled ids (from hip.toml [[skills]] enabled=false) never become active.
 */
export function resolveSkillCandidates(
  candidates: SkillCandidate[],
  disabledIds: ReadonlySet<string> = new Set(),
): { skills: SkillResolution[]; conflicts: ExtensionConflict[] } {
  const byId = new Map<string, SkillCandidate[]>()
  for (const c of candidates) {
    const list = byId.get(c.id) ?? []
    list.push(c)
    byId.set(c.id, list)
  }

  const skills: SkillResolution[] = []
  const conflicts: ExtensionConflict[] = []

  for (const [id, list] of byId) {
    list.sort((a, b) => a.tier - b.tier || a.order - b.order)
    const winner = list[0]!
    if (disabledIds.has(id)) {
      skills.push({
        id,
        active: false,
        meta: winner.meta,
        winner: winner.source,
      })
      conflicts.push({
        kind: 'skill_disabled',
        winner: winner.source,
        loser: winner.source,
        message: `Skill "${id}" is disabled in hip.toml`,
      })
      continue
    }
    skills.push({
      id,
      active: true,
      meta: winner.meta,
      winner: winner.source,
    })
    for (let i = 1; i < list.length; i++) {
      const loser = list[i]!
      conflicts.push({
        kind: 'skill_id_shadow',
        winner: winner.source,
        loser: loser.source,
        message: `Skill "${id}" from ${loser.source.kind} shadowed by ${winner.source.kind}`,
      })
    }
  }

  skills.sort((a, b) => a.id.localeCompare(b.id))
  return { skills, conflicts }
}

/**
 * Resolve MCP candidates:
 * 1. Per id: lowest tier, then order; vetoOnly claims id without activating
 * 2. Among actives: same capability fingerprint → keep higher precedence (unless allowDuplicate)
 */
export function resolveMcpCandidates(
  candidates: McpCandidate[],
): { mcpServers: McpResolution[]; conflicts: ExtensionConflict[] } {
  const byId = new Map<string, McpCandidate[]>()
  for (const c of candidates) {
    const list = byId.get(c.id) ?? []
    list.push(c)
    byId.set(c.id, list)
  }

  const conflicts: ExtensionConflict[] = []
  const provisional: McpResolution[] = []

  for (const [id, list] of byId) {
    list.sort((a, b) => a.tier - b.tier || a.order - b.order)
    const winner = list[0]!
    const fp = mcpCapabilityFingerprint(winner.config)

    if (winner.vetoOnly) {
      provisional.push({
        id,
        active: false,
        config: winner.config,
        winner: winner.source,
        fingerprint: fp,
      })
      for (let i = 1; i < list.length; i++) {
        const loser = list[i]!
        conflicts.push({
          kind: 'mcp_name_veto',
          winner: winner.source,
          loser: loser.source,
          message: `MCP id "${id}" is claimed disabled in hip.toml; ${loser.source.kind} cannot fill it`,
        })
      }
      continue
    }

    provisional.push({
      id,
      active: winner.config.enabled !== false,
      config: winner.config,
      winner: winner.source,
      fingerprint: fp,
    })

    for (let i = 1; i < list.length; i++) {
      const loser = list[i]!
      conflicts.push({
        kind: 'mcp_id_shadow',
        winner: winner.source,
        loser: loser.source,
        message: `MCP id "${id}" from ${loser.source.kind} shadowed by ${winner.source.kind}`,
      })
    }
  }

  // Capability fingerprint pass among currently active servers
  const active = provisional.filter((r) => r.active)
  const byFp = new Map<string, McpResolution[]>()
  for (const r of active) {
    const list = byFp.get(r.fingerprint) ?? []
    list.push(r)
    byFp.set(r.fingerprint, list)
  }

  const demoted = new Set<string>()
  for (const [fp, list] of byFp) {
    if (list.length < 2) continue
    // Sort by original candidate precedence: config tier before plugin (source kind)
    list.sort((a, b) => {
      const ta = a.winner.kind === 'plugin_mcp' ? 1 : 0
      const tb = b.winner.kind === 'plugin_mcp' ? 1 : 0
      if (ta !== tb) return ta - tb
      return a.id.localeCompare(b.id)
    })
    const keep = list[0]!
    // If keep allows duplicates, skip demotion for this group
    // (allowDuplicate is on config via optional field — check candidate path via config)
    const keepAllows = (keep.config as McpServerConfig & { allowDuplicate?: boolean }).allowDuplicate === true
    if (keepAllows) continue

    for (let i = 1; i < list.length; i++) {
      const loser = list[i]!
      const loserAllows = (loser.config as McpServerConfig & { allowDuplicate?: boolean }).allowDuplicate === true
      if (loserAllows) continue
      demoted.add(loser.id)
      conflicts.push({
        kind: 'mcp_capability_duplicate',
        winner: keep.winner,
        loser: loser.source,
        fingerprint: fp,
        message: `MCP "${loser.id}" duplicates capability of "${keep.id}" (${fp}); only one stays active`,
      })
    }
  }

  const mcpServers: McpResolution[] = provisional.map((r) => {
    if (demoted.has(r.id) && r.active) {
      return {
        ...r,
        active: false,
        shadowedBy: active.find((x) => x.fingerprint === r.fingerprint && !demoted.has(x.id))?.winner,
      }
    }
    return r
  })

  mcpServers.sort((a, b) => a.id.localeCompare(b.id))
  return { mcpServers, conflicts }
}

/** Build a full snapshot from already-resolved skill + MCP lists. */
export function buildExtensionRegistrySnapshot(
  skills: SkillResolution[],
  mcpServers: McpResolution[],
  conflicts: ExtensionConflict[],
  now = Date.now(),
): ExtensionRegistrySnapshot {
  return {
    skills,
    mcpServers,
    conflicts,
    generatedAt: now,
  }
}

/** Active MCP configs from a snapshot (for McpManager.reconcile / ACP forward). */
export function activeMcpConfigs(snapshot: ExtensionRegistrySnapshot): McpServerConfig[] {
  return snapshot.mcpServers.filter((r) => r.active).map((r) => r.config)
}

/** Active skill metas from a snapshot. */
export function activeSkillMetas(snapshot: ExtensionRegistrySnapshot): SkillMeta[] {
  return snapshot.skills.filter((r) => r.active).map((r) => r.meta)
}
