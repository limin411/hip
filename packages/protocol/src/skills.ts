/** Skills (Claude-format SKILL.md folders). */
// ──────────────────────────────────────────────────────────────────
// Skills (Claude-format SKILL.md folders under ~/.hip/skills)
// ──────────────────────────────────────────────────────────────────

/** One installed skill, scanned from ~/.hip/skills/<id>/SKILL.md frontmatter. */
/** Multi-level skill scope: global (~/.hip/skills), project (.hip/skills), plugin, or product builtin. */
export type SkillScope = 'global' | 'project' | 'plugin' | 'builtin'

/** One installed skill, scanned from ~/.hip/skills/<id>/SKILL.md frontmatter. */
export interface SkillMeta {
  id: string                          // folder slug under ~/.hip/skills
  name: string                        // frontmatter `name`
  description: string                 // frontmatter `description`
  dir: string                         // absolute skill directory
  hasScripts: boolean                 // true iff the skill ships a scripts/ dir (run_script hint)
  scope?: SkillScope                  // which level the skill was loaded from (defaults to 'global')
  pluginId?: string                   // set when scope='plugin' to link back to the owning plugin
  /** If false, skill is NOT auto-listed in system prompt (must be $ invoked). Default true. */
  autoInvoke?: boolean
  /** If false, skill is hidden from / command menu. Default true. */
  userInvocable?: boolean
  /** Tools pre-approved while this skill is active. */
  allowedTools?: string[]
  /** Tools explicitly denied while this skill is active. */
  disallowedTools?: string[]
  /** Execution context: 'inline' (default) or 'fork' (isolated subagent). */
  context?: 'inline' | 'fork'
  /** Glob patterns — skill only auto-listed when cwd matches. */
  paths?: string[]
  /** Model override for this skill. */
  model?: string
  /** Reasoning effort level. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** Named arguments the skill accepts. */
  arguments?: Array<{ name: string; description: string; required?: boolean }>
  /** Shell for !`cmd` execution. Default 'bash'. */
  shell?: 'bash' | 'powershell'
  /** If true, !`cmd` blocks are NOT executed. */
  disableShellExecution?: boolean
  /** Whether skill has references/ directory. */
  hasReferences?: boolean
  /** Whether skill has assets/ directory. */
  hasAssets?: boolean
}

/** Skill enable/disable overrides, persisted to ~/.hip/config/hip.toml under `skills`.
 *  A missing id is treated as enabled. */
export interface SkillsConfig { enabled: Record<string, boolean> }

/** auth.json key name AND env var name for a provider's API key. Single source of the rule. */
export function providerKeyEnv(providerID: string): string {
  return `HIP_MODEL_${providerID.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`
}
