import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { generateAgentConfig } from '../agents/generate.js'
import { isApproved, SCRIPT_TIMEOUT_MS, SCRIPT_OUTPUT_CAP } from './helpers.js'
import type { ApprovalFn } from './helpers.js'
import type { BackgroundManager } from '../background-manager.js'
import { runShellForeground } from '../shell-backend.js'

export function buildGenerateAgentTool(): StructuredToolInterface {
  return tool(
    async ({ description, model }) => {
      try {
        const config = await generateAgentConfig(description, model)
        return JSON.stringify(config, null, 2)
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'generate_agent',
      description:
        'Generate an AgentConfig from a natural-language description by calling generateAgentConfig. ' +
        'Returns the generated agent config as a JSON object with fields: id, name, description, ' +
        'kind, command, args, prompt, enabled, and optionally allowedSkills, allowedMcpServers, boundModel.',
      schema: z.object({
        description: z.string().describe('natural-language description of the agent role'),
        model: z.string().optional().describe('optional model ID to use for generation'),
      }),
    },
  )
}

export interface RunScriptToolOpts {
  requestApproval: ApprovalFn
  cwd: string
  /** When set, enables background: true path. */
  runtime?: BackgroundManager
  /** Idle activity pulse during FG execution. */
  onActivity?: () => void
  /** AbortSignal for FG cancel. */
  signal?: AbortSignal
  originTurnId?: string | null
  shellBackgroundEnabled?: boolean
}

export function buildRunScriptTool(opts: RunScriptToolOpts): StructuredToolInterface {
  const {
    requestApproval,
    cwd,
    runtime,
    onActivity,
    signal,
    originTurnId,
    shellBackgroundEnabled = true,
  } = opts

  return tool(
    async ({ command, reason, background, timeout_ms }) => {
      const decision = await requestApproval({
        title: 'Run script',
        toolName: 'run_script',
        kind: 'execute',
        content: reason ? `${command}\n\n# ${reason}` : command,
      })
      if (!isApproved(decision)) {
        return '用户拒绝执行该脚本（command was rejected by the user; nothing ran）。'
      }

      // Background path
      if (background && shellBackgroundEnabled && runtime) {
        const started = runtime.spawnShell({
          command,
          cwd,
          description: reason ?? command.slice(0, 80),
          originTurnId: originTurnId ?? null,
        })
        if ('error' in started) return started.error
        return JSON.stringify({
          task_id: started.taskId,
          kind: 'shell',
          status: 'running',
          message:
            'Background shell started. Use task_output / wait_tasks; stop with task_stop.',
        })
      }
      if (background && !runtime) {
        return 'Error: background shells are not available in this session'
      }

      const timeoutMs =
        typeof timeout_ms === 'number' && timeout_ms > 0 ? timeout_ms : SCRIPT_TIMEOUT_MS

      // FG activity pulse for IdleWatchdog
      let pulse: ReturnType<typeof setInterval> | undefined
      if (onActivity) {
        onActivity()
        pulse = setInterval(() => onActivity(), 5_000)
        pulse.unref?.()
      }

      try {
        const result = await runShellForeground({
          command,
          cwd,
          timeoutMs,
          outputCap: SCRIPT_OUTPUT_CAP,
          signal,
        })
        const tail = result.truncated ? '\n…(output truncated to 64KB)' : ''
        const note = result.timedOut
          ? `\n(timed out after ${Math.round(timeoutMs / 1000)}s; process killed)`
          : ''
        return `exitCode: ${result.exitCode ?? 'null'}${note}\n${result.output}${tail}`
      } finally {
        if (pulse) clearInterval(pulse)
      }
    },
    {
      name: 'run_script',
      description:
        'Run a shell command in the project directory. EVERY call is gated by an explicit user ' +
        'approval prompt — explain WHY in `reason`. Use for skill-bundled scripts and build/test ' +
        'commands. Returns the exit code and combined stdout/stderr (truncated to 64KB). ' +
        'Set `background: true` for long-running work (dev servers, stress tests) — returns task_id immediately; ' +
        'use task_output / wait_tasks / task_stop. Optional `timeout_ms` for foreground only (default 120000). ' +
        'If the user rejects, the command does not run.',
      schema: z.object({
        command: z.string(),
        reason: z.string().optional(),
        background: z
          .boolean()
          .optional()
          .describe('Run in background and return task_id immediately (for long-running commands)'),
        timeout_ms: z
          .number()
          .optional()
          .describe('Foreground timeout in ms (default 120000). Ignored when background is true.'),
      }),
    },
  )
}

export function buildScriptTools(
  generateAgentEnabled: boolean,
  requestApproval: ApprovalFn | undefined,
  cwd: string,
  mode: string,
  runtime?: BackgroundManager,
  extras?: {
    onActivity?: () => void
    signal?: AbortSignal
    originTurnId?: string | null
    shellBackgroundEnabled?: boolean
  },
): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = []

  if (generateAgentEnabled) {
    tools.push(buildGenerateAgentTool())
  }

  if (requestApproval && mode !== 'chat') {
    tools.push(
      buildRunScriptTool({
        requestApproval,
        cwd,
        runtime,
        onActivity: extras?.onActivity,
        signal: extras?.signal,
        originTurnId: extras?.originTurnId,
        shellBackgroundEnabled: extras?.shellBackgroundEnabled,
      }),
    )
  }

  return tools
}
