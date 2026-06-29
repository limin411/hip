import type { StructuredToolInterface } from '@langchain/core/tools'
import type { PermissionMode } from '@hip/protocol'
import { buildFileTools } from './file.js'
import { buildPlanningTools } from './planning.js'
import { buildGitTools } from './git.js'
import { buildSkillTools } from './skill.js'
import { buildWebTools } from './web.js'
import { buildSubagentTools, buildTaskBatchTools } from './subagent.js'
import { buildScriptTools } from './script.js'
import { buildPluginInstallTool } from './plugin.js'
import { buildMediaTools } from './media.js'
import { real, realInSkill, resolveFull } from './helpers.js'
import type { BuildToolsOpts, DispatchSpec } from './helpers.js'

export type { ApprovalDecision, ApprovalFn, DispatchSpec, BuildToolsOpts } from './helpers.js'
export { substituteSkillBody, SELF_GATED_TOOLS, isApproved } from './helpers.js'

/**
 * Build the full tool set for a hip session. Each tool is sandboxed to `root`.
 * Delegates to category-organized tool builders under tools/.
 *
 * Returns an array of LangChain StructuredToolInterface instances.
 */
export function buildAllTools(
  root: string,
  spawnSubagent?: (description: string, mode?: 'foreground' | 'background', taskId?: string, signal?: AbortSignal) => Promise<string>,
  cwd?: string,
  dispatch?: DispatchSpec,
  opts: BuildToolsOpts = {},
  retrySubagent?: (agentId: string) => Promise<string>,
  stopBackgroundTask?: (taskId: string, reason?: string) => string,
  getBackgroundTaskOutput?: (taskId: string) => string,
): StructuredToolInterface[] {
  // Enabled-skill dirs (~/.hip/skills/<id>), DISJOINT from the project root. read_file may ALSO reach
  // bundled reference files under these (read-only); every other path stays jailed to `root` via real().
  const skillDirs = (opts.skills ?? []).map((s) => s.dir)
  // Mode (default + dirty-data → 'edit'). 'full' un-jails file paths; 'chat' is read-only.
  const mode: PermissionMode = opts.permissionMode === 'chat' || opts.permissionMode === 'full' ? opts.permissionMode : 'edit'
  const isFull = mode === 'full'
  const pathRoot = cwd ?? root
  /** Resolve a model path under the active mode: 'full' un-jails (absolute as-is, relative vs cwd);
   *  otherwise the symlink-guarded jail to `root`. */
  const resolvePath = (p: string): Promise<string> => (isFull ? Promise.resolve(resolveFull(pathRoot, p)) : real(root, p))

  // ── File tools ──────────────────────────────────────────────────────────────────
  const fileTools = buildFileTools(resolvePath, root, skillDirs, isFull, pathRoot)

  // ── Planning tool ───────────────────────────────────────────────────────────────
  const planningTools = buildPlanningTools()

  // ── Assemble base (PermissionMode filters write/edit) ──────────────────────────
  // 'chat' = read-only: drop write_file/edit_file. (read_file/ls/glob/grep + write_todos stay.)
  const base: StructuredToolInterface[] = mode === 'chat'
    ? [fileTools.readFile, fileTools.ls, fileTools.glob, fileTools.grep, ...planningTools]
    : [fileTools.writeFile, fileTools.readFile, fileTools.editFile, fileTools.ls, fileTools.glob, fileTools.grep, ...planningTools]

  // ── Git tools (only for a real on-disk cwd) ────────────────────────────────────
  base.push(...buildGitTools(cwd))

  // ── Skill / script / MCP extras (apply on hip's own loop, every assembly path) ─
  const extras: StructuredToolInterface[] = []

  // use_skill
  extras.push(...buildSkillTools(opts.skills, opts.sessionId))

  // web_search + web_fetch
  if (opts.webSearchEnabled) {
    extras.push(...buildWebTools(opts.networkPolicy, opts.sessionId))
  }

  // generate_agent + run_script
  extras.push(...buildScriptTools(
    !!opts.generateAgentEnabled,
    opts.requestApproval,
    cwd ?? root,
    mode,
  ))

  // plugin_install — dropped in chat mode
  if (mode !== 'chat') {
    extras.push(buildPluginInstallTool())
  }

  // MCP tools
  if (opts.mcpTools && opts.mcpTools.length > 0) extras.push(...opts.mcpTools)

  // Media tools (read_media)
  extras.push(...buildMediaTools({ enabled: opts.mediaEnabled }))

  // ── Assemble result ────────────────────────────────────────────────────────────
  const taskBatchTools = buildTaskBatchTools(spawnSubagent)
  let result: StructuredToolInterface[]
  if (!spawnSubagent) {
    result = [...base, ...extras]
  } else {
    const { subagentTools } = buildSubagentTools(spawnSubagent, dispatch, retrySubagent, stopBackgroundTask, getBackgroundTaskOutput)
    result = [...base, ...subagentTools, ...extras]
  }
  result.push(...taskBatchTools)

  // ── Profile-based filtering ────────────────────────────────────────────────────
  // Apply AFTER PermissionMode (PermissionMode gates first, then allowedTools/blockedTools
  // further restrict). MCP tools are managed by MCP server enablement and are not narrowed
  // by allowedTools; they can still be blocked.
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    const allowed = new Set(opts.allowedTools)
    result = result.filter((t) => allowed.has(t.name) || t.name.startsWith('mcp__'))
  }
  if (opts.blockedTools && opts.blockedTools.length > 0) {
    const blocked = new Set(opts.blockedTools)
    result = result.filter((t) => !blocked.has(t.name))
  }

  return result
}
