import { spawn } from 'node:child_process'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { generateAgentConfig } from '../agents/generate.js'
import { isApproved, SCRIPT_TIMEOUT_MS, SCRIPT_OUTPUT_CAP } from './helpers.js'
import type { ApprovalFn } from './helpers.js'

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

export function buildRunScriptTool(
  requestApproval: ApprovalFn,
  cwd: string,
): StructuredToolInterface {
  const scriptCwd = cwd
  return tool(
    async ({ command, reason }) => {
      const decision = await requestApproval({
        title: 'Run script',
        toolName: 'run_script',
        kind: 'execute',
        content: reason ? `${command}\n\n# ${reason}` : command,
      })
      if (!isApproved(decision)) return '用户拒绝执行该脚本（command was rejected by the user; nothing ran）。'
      const isWin = process.platform === 'win32'
      const shell = isWin ? 'cmd' : 'sh'
      const shellArgs = isWin ? ['/c', command] : ['-c', command]
      return await new Promise<string>((resolve) => {
        // Detached on non-Windows so the shell gets its own process group; killing -pid on timeout
        // reaps any grandchildren the script spawned (a bare child.kill leaves orphans).
        const child = spawn(shell, shellArgs, { cwd: scriptCwd, env: process.env, detached: !isWin })
        let out = ''
        let capped = false
        const onChunk = (b: Buffer) => {
          if (capped) return
          out += b.toString('utf8')
          if (out.length > SCRIPT_OUTPUT_CAP) { out = out.slice(0, SCRIPT_OUTPUT_CAP); capped = true }
        }
        child.stdout.on('data', onChunk)
        child.stderr.on('data', onChunk)
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          if (!isWin && child.pid) {
            try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* already gone */ } }
          } else {
            try { child.kill('SIGKILL') } catch { /* already gone */ }
          }
        }, SCRIPT_TIMEOUT_MS)
        timer.unref?.()
        child.on('error', (err) => {
          clearTimeout(timer)
          resolve(`Error: failed to spawn shell: ${err.message}`)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          const tail = capped ? '\n…(output truncated to 64KB)' : ''
          const note = timedOut ? '\n(timed out after 120s; process killed)' : ''
          resolve(`exitCode: ${code ?? 'null'}${note}\n${out}${tail}`)
        })
      })
    },
    {
      name: 'run_script',
      description:
        'Run a shell command in the project directory. EVERY call is gated by an explicit user ' +
        'approval prompt — explain WHY in `reason`. Use for skill-bundled scripts and build/test ' +
        'commands. Returns the exit code and combined stdout/stderr (truncated to 64KB, 120s timeout). ' +
        'If the user rejects, the command does not run.',
      schema: z.object({ command: z.string(), reason: z.string().optional() }),
    },
  )
}

export function buildScriptTools(
  generateAgentEnabled: boolean,
  requestApproval: ApprovalFn | undefined,
  cwd: string,
  mode: string,
): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = []

  if (generateAgentEnabled) {
    tools.push(buildGenerateAgentTool())
  }

  // run_script is dropped in chat (read-only) mode: a shell command would let a "read-only" agent
  // mutate the project, defeating the mode. Outside chat it is registered whenever an approval fn
  // is wired (every call is still HITL-gated).
  if (requestApproval && mode !== 'chat') {
    tools.push(buildRunScriptTool(requestApproval, cwd))
  }

  return tools
}
