import type { StructuredToolInterface } from '@langchain/core/tools'
import type { PermissionMode } from '@hip/protocol'
import type { PlanMode } from '../plan-mode.js'
import { buildFileTools } from './file.js'
import { buildPlanningTools } from './planning.js'
import { buildGitTools } from './git.js'
import { buildSkillTools } from './skill.js'
import { buildWebTools } from './web.js'
import { buildSubagentTools, buildTaskBatchTools } from './subagent.js'
import { buildScriptTools } from './script.js'
import { buildPluginInstallTool } from './plugin.js'
import { buildMediaTools } from './media.js'
import { buildParallelWorktreeTools } from './parallel-worktree.js'
import { buildTaskRuntimeExtraTools } from './task-runtime-tools.js'
import { EnterPlanModeTool } from './enter-plan-mode.js'
import { ExitPlanModeTool } from './exit-plan-mode.js'
import { real, realInSkill, resolveFull } from './helpers.js'
import type { BuildToolsOpts, DispatchSpec } from './helpers.js'
import {
  filterSkillsForProfile,
  resolveAgentRuntimeProfile,
} from '../agent-runtime-profile.js'

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
  getBackgroundTaskOutput?: (taskId: string, timeoutMs?: number) => string | Promise<string>,
  planMode?: PlanMode,
): StructuredToolInterface[] {
  // Surface × permissionMode profile (Chat clamps git/plugin even when writes allowed).
  const profile = resolveAgentRuntimeProfile({
    surface: opts.surface,
    permissionMode: opts.permissionMode,
    sessionId: opts.sessionId,
    cwd: cwd ?? root,
  })
  const skills = filterSkillsForProfile(opts.skills, profile)
  // Enabled-skill dirs (~/.hip/skills/<id>), DISJOINT from the project root. read_file may ALSO reach
  // bundled reference files under these (read-only); every other path stays jailed to `root` via real().
  const skillDirs = skills.map((s) => s.dir)
  // Mode (default + dirty-data → 'edit'). 'full' un-jails file paths; 'chat' is read-only.
  const mode: PermissionMode = profile.permissionMode
  const isFull = profile.toolPolicy.pathJail === 'none'
  const pathRoot = cwd ?? root
  /** Resolve a model path under the active mode: 'full' un-jails (absolute as-is, relative vs cwd);
   *  otherwise the symlink-guarded jail to `root`. */
  const resolvePath = (p: string): Promise<string> => (isFull ? Promise.resolve(resolveFull(pathRoot, p)) : real(root, p))

  // ── File tools ──────────────────────────────────────────────────────────────────
  const fileTools = buildFileTools(resolvePath, root, skillDirs, isFull, pathRoot)

  // ── Planning tool ───────────────────────────────────────────────────────────────
  const planningTools = buildPlanningTools()

  // ── Assemble base (profile.toolPolicy filters write/edit) ───────────────────────
  const base: StructuredToolInterface[] = !profile.toolPolicy.allowWrites
    ? [fileTools.readFile, fileTools.ls, fileTools.glob, fileTools.grep, ...planningTools]
    : [
        fileTools.writeFile,
        fileTools.readFile,
        fileTools.editFile,
        fileTools.applyPatch,
        fileTools.ls,
        fileTools.glob,
        fileTools.grep,
        ...planningTools,
      ]

  // ── Git tools (only for a real on-disk cwd; dropped on Chat / read-only) ───────
  if (profile.toolPolicy.allowGit) {
    base.push(
      ...buildGitTools(cwd, {
        sessionId: opts.sessionId,
        onWorktreeChanged: opts.onWorktreeChanged,
      }),
    )
  }

  // ── Plan-mode tool ─────────────────────────────────────────────────────────────
  if (planMode && opts.sessionId) {
    base.push(new EnterPlanModeTool(planMode, opts.sessionId))
    base.push(new ExitPlanModeTool(planMode))
  }

  // ── Skill / script / MCP extras (apply on hip's own loop, every assembly path) ─
  const extras: StructuredToolInterface[] = []

  // use_skill (surface-filtered skill list)
  extras.push(...buildSkillTools(skills, opts.sessionId))

  // web_search + web_fetch
  if (opts.webSearchEnabled) {
    extras.push(...buildWebTools(opts.networkPolicy, opts.sessionId))
  }

  // generate_agent + run_script
  // buildScriptTools still keys off protocol mode for run_script; pass chat when disallowed.
  const scriptMode: PermissionMode = profile.toolPolicy.allowRunScript
    ? mode === 'full' ? 'full' : 'edit'
    : 'chat'
  extras.push(...buildScriptTools(
    !!opts.generateAgentEnabled,
    opts.requestApproval,
    cwd ?? root,
    scriptMode,
    opts.taskRuntime,
    {
      onActivity: opts.onActivity,
      signal: opts.signal,
      originTurnId: opts.originTurnId,
      shellBackgroundEnabled: opts.shellBackgroundEnabled,
    },
  ))

  // wait_tasks / monitor / scheduler (TaskRuntime)
  if (opts.taskRuntime) {
    extras.push(
      ...buildTaskRuntimeExtraTools({
        runtime: opts.taskRuntime,
        cron: opts.cronManager ?? ({
          create: () => 'cron-noop',
          list: () => [],
          delete: () => false,
        } as import('../cron.js').CronManager),
        requestApproval: opts.requestApproval,
        cwd: cwd ?? root,
        mode: scriptMode,
        monitorEnabled: opts.monitorEnabled,
        schedulerEnabled: opts.schedulerWakeEnabled !== false && !!opts.cronManager,
      }),
    )
  }

  // plugin_install — dropped on Chat / read-only
  if (profile.toolPolicy.allowPluginInstall) {
    extras.push(buildPluginInstallTool())
  }

  // MCP tools
  if (opts.mcpTools && opts.mcpTools.length > 0) extras.push(...opts.mcpTools)

  // Media tools (read_media)
  extras.push(...buildMediaTools({ enabled: opts.mediaEnabled }))

  // parallel_worktrees — agent proposes N isolated worktrees; user confirms count via HITL
  // (optionIds n1–n4 / reject). UI localizes option labels client-side by optionId (PR8 / D19);
  // create path stays unified with host fan-out via WorktreeService (D26) — do not re-split.
  if (
    profile.toolPolicy.allowParallelWorktrees &&
    cwd &&
    opts.sessionId &&
    opts.requestChoice &&
    opts.spawnInWorktree
  ) {
    extras.push(
      ...buildParallelWorktreeTools({
        cwd,
        sessionId: opts.sessionId,
        requestChoice: opts.requestChoice,
        spawnInWorktree: opts.spawnInWorktree,
        onRunStarted: opts.onParallelRunStarted,
        onWorktreeChanged: opts.onWorktreeChanged,
      }),
    )
  }

  // ── Assemble result ────────────────────────────────────────────────────────────
  // Pass dispatch so task_batch can route per-task agent ids (explore/plan/coder).
  const taskBatchTools = buildTaskBatchTools(spawnSubagent, dispatch)
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
