#!/usr/bin/env node
import { Command } from 'commander'
import { printVersion } from './commands/version.js'
import { runDoctor } from './commands/doctor.js'
import { runCommand } from './commands/run.js'
import { printAuthStatus } from './commands/config.js'
import { sessionCreate, sessionDelete, sessionList, sessionSend, sessionShow } from './commands/session.js'
import { worktreeCreate, worktreeList, worktreeRemove } from './commands/worktree.js'
import { runRepl } from './commands/repl.js'
import type { HipRunOptions, HitlMode, PermissionModeCli, PresetName, SidecarMode, StreamMode } from './types.js'
import { CLI_VERSION } from './version.js'

async function main(): Promise<void> {
  const program = new Command()
  program
    .name('hip')
    .description('hip CLI — thin client for the hip sidecar (headless / harness)')
    .version(CLI_VERSION)

  program
    .command('version')
    .description('Print CLI and sidecar package versions')
    .action(() => {
      printVersion()
    })

  program
    .command('doctor')
    .description('Resolve sidecar entry, spawn, handshake, and report ready/hasApiKey')
    .action(async () => {
      const code = await runDoctor()
      process.exitCode = code
    })

  const config = program.command('config').description('Inspect local hip CLI configuration')
  config
    .command('auth-status')
    .description('Show which API keys are configured (values never printed)')
    .action(() => {
      process.exitCode = printAuthStatus()
    })

  const session = program
    .command('session')
    .description('List / show / create / send / delete sessions (uses ~/.hip db by default)')
  session
    .command('create')
    .description('Create a session (code surface when --cwd is set)')
    .option('-c, --cwd <path>', 'Working directory (absolute after resolve)')
    .option('--provider <id>', 'LLM provider', 'deepseek')
    .option('--model <id>', 'Model id', 'deepseek-chat')
    .option('--base-url <url>', 'Provider base URL')
    .option('--permission-mode <mode>', 'chat|edit|full')
    .option('--surface <s>', 'chat|code')
    .option('--json', 'Emit JSON')
    .option('--isolate', 'Use temp isolation DB instead of user ~/.hip')
    .option('--port <n>', 'Attach port', (v) => Number(v))
    .option('--token <t>', 'Attach token')
    .option('--sidecar-log <path>', 'Attach via handshake log')
    .action(async (flags: Record<string, unknown>) => {
      process.exitCode = await sessionCreate({
        cwd: flags.cwd as string | undefined,
        provider: flags.provider as string | undefined,
        model: flags.model as string | undefined,
        baseURL: flags.baseUrl as string | undefined,
        permissionMode: flags.permissionMode as 'chat' | 'edit' | 'full' | undefined,
        surface: flags.surface as 'chat' | 'code' | undefined,
        json: flags.json === true,
        useUserHip: flags.isolate !== true,
        port: flags.port as number | undefined,
        token: flags.token as string | undefined,
        sidecarLog: flags.sidecarLog as string | undefined,
      })
    })
  session
    .command('send')
    .description('Send one user message and wait for the turn to settle')
    .argument('<id>', 'Session id or unique prefix')
    .argument('<prompt>', 'User prompt')
    .option('--hitl <mode>', 'auto|fail|prompt', 'auto')
    .option('--timeout <sec>', 'Overall timeout seconds (0 = none)', (v) => Number(v), 0)
    .option('--json', 'Emit JSON result')
    .option('--isolate', 'Use temp isolation DB')
    .option('--port <n>', 'Attach port', (v) => Number(v))
    .option('--token <t>', 'Attach token')
    .option('--sidecar-log <path>', 'Attach via handshake log')
    .action(async (id: string, prompt: string, flags: Record<string, unknown>) => {
      process.exitCode = await sessionSend(id, prompt, {
        hitl: flags.hitl as 'auto' | 'fail' | 'prompt' | undefined,
        timeoutSec: flags.timeout as number | undefined,
        json: flags.json === true,
        useUserHip: flags.isolate !== true,
        port: flags.port as number | undefined,
        token: flags.token as string | undefined,
        sidecarLog: flags.sidecarLog as string | undefined,
      })
    })
  session
    .command('list')
    .description('List persisted sessions')
    .option('--json', 'Emit JSON array')
    .option('--isolate', 'Use temp isolation DB instead of user ~/.hip')
    .option('--port <n>', 'Attach port', (v) => Number(v))
    .option('--token <t>', 'Attach token')
    .option('--sidecar-log <path>', 'Attach via handshake log')
    .action(async (flags: Record<string, unknown>) => {
      process.exitCode = await sessionList({
        json: flags.json === true,
        useUserHip: flags.isolate !== true,
        port: flags.port as number | undefined,
        token: flags.token as string | undefined,
        sidecarLog: flags.sidecarLog as string | undefined,
      })
    })
  session
    .command('show')
    .description('Show session messages (id or unique prefix)')
    .argument('<id>', 'Session id or unique prefix')
    .option('--json', 'Emit full JSON')
    .option('--limit <n>', 'Show only last N messages', (v) => Number(v))
    .option('--isolate', 'Use temp isolation DB')
    .option('--port <n>', 'Attach port', (v) => Number(v))
    .option('--token <t>', 'Attach token')
    .option('--sidecar-log <path>', 'Attach via handshake log')
    .action(async (id: string, flags: Record<string, unknown>) => {
      process.exitCode = await sessionShow(id, {
        json: flags.json === true,
        limit: flags.limit as number | undefined,
        useUserHip: flags.isolate !== true,
        port: flags.port as number | undefined,
        token: flags.token as string | undefined,
        sidecarLog: flags.sidecarLog as string | undefined,
      })
    })
  session
    .command('delete')
    .description('Delete a session (requires --yes)')
    .argument('<id>', 'Session id or unique prefix')
    .option('--yes', 'Confirm deletion')
    .option('--delete-derived-memories', 'Also delete memories derived from the session')
    .option('--json', 'Emit JSON result')
    .option('--isolate', 'Use temp isolation DB')
    .option('--port <n>', 'Attach port', (v) => Number(v))
    .option('--token <t>', 'Attach token')
    .option('--sidecar-log <path>', 'Attach via handshake log')
    .action(async (id: string, flags: Record<string, unknown>) => {
      process.exitCode = await sessionDelete(id, {
        yes: flags.yes === true,
        deleteDerivedMemories: flags.deleteDerivedMemories === true,
        json: flags.json === true,
        useUserHip: flags.isolate !== true,
        port: flags.port as number | undefined,
        token: flags.token as string | undefined,
        sidecarLog: flags.sidecarLog as string | undefined,
      })
    })

  const worktree = program.command('worktree').description('Git worktree ops (managed under ~/.hip/worktrees)')
  worktree
    .command('create')
    .description('Create a managed worktree from a session cwd')
    .requiredOption('-s, --session <id>', 'Host session id (must have git cwd)')
    .requiredOption('-b, --branch <name>', 'Branch name')
    .option('--create-branch', 'Create branch before worktree add')
    .option('--base-ref <ref>', 'Start point for --create-branch')
    .option('--path-key <key>', 'Relative path under managed worktrees dir')
    .option('--json', 'Emit JSON result')
    .option('--isolate', 'Use temp isolation DB')
    .option('--port <n>', 'Attach port', (v) => Number(v))
    .option('--token <t>', 'Attach token')
    .option('--sidecar-log <path>', 'Attach via handshake log')
    .action(async (flags: Record<string, unknown>) => {
      process.exitCode = await worktreeCreate({
        sessionId: flags.session as string,
        branch: flags.branch as string,
        createBranch: flags.createBranch === true,
        baseRef: flags.baseRef as string | undefined,
        pathKey: flags.pathKey as string | undefined,
        json: flags.json === true,
        useUserHip: flags.isolate !== true,
        port: flags.port as number | undefined,
        token: flags.token as string | undefined,
        sidecarLog: flags.sidecarLog as string | undefined,
      })
    })
  worktree
    .command('list')
    .description('List worktrees for the repo bound to a session')
    .requiredOption('-s, --session <id>', 'Session id with git cwd')
    .option('--json', 'Emit JSON')
    .option('--isolate', 'Use temp isolation DB')
    .option('--port <n>', 'Attach port', (v) => Number(v))
    .option('--token <t>', 'Attach token')
    .option('--sidecar-log <path>', 'Attach via handshake log')
    .action(async (flags: Record<string, unknown>) => {
      process.exitCode = await worktreeList({
        sessionId: flags.session as string,
        json: flags.json === true,
        useUserHip: flags.isolate !== true,
        port: flags.port as number | undefined,
        token: flags.token as string | undefined,
        sidecarLog: flags.sidecarLog as string | undefined,
      })
    })
  worktree
    .command('remove')
    .description('Remove a managed worktree path')
    .requiredOption('-s, --session <id>', 'Session id with git cwd')
    .requiredOption('-p, --path <path>', 'Absolute worktree path under managed dir')
    .option('--json', 'Emit JSON')
    .option('--isolate', 'Use temp isolation DB')
    .option('--port <n>', 'Attach port', (v) => Number(v))
    .option('--token <t>', 'Attach token')
    .option('--sidecar-log <path>', 'Attach via handshake log')
    .action(async (flags: Record<string, unknown>) => {
      process.exitCode = await worktreeRemove({
        sessionId: flags.session as string,
        worktreePath: flags.path as string,
        json: flags.json === true,
        useUserHip: flags.isolate !== true,
        port: flags.port as number | undefined,
        token: flags.token as string | undefined,
        sidecarLog: flags.sidecarLog as string | undefined,
      })
    })

  program
    .command('repl')
    .description('Interactive multi-turn chat (TTY; uses ~/.hip by default)')
    .option('-c, --cwd <path>', 'Working directory')
    .option('--provider <id>', 'LLM provider', 'deepseek')
    .option('--model <id>', 'Model id', 'deepseek-chat')
    .option('--base-url <url>', 'Provider base URL')
    .option('--permission-mode <mode>', 'chat|edit|full', 'edit')
    .option('--disable-plan', 'Disable plan heuristics')
    .option('--hitl <mode>', 'auto|fail|prompt', 'prompt')
    .option('--stream <mode>', 'text|tools|all|none', 'all')
    .option('--isolate', 'Temp isolation instead of user ~/.hip')
    .option('--system <text>', 'System prompt')
    .option('--port <n>', 'Attach port', (v) => Number(v))
    .option('--token <t>', 'Attach token')
    .option('--sidecar-log <path>', 'Attach via handshake log')
    .action(async (flags: Record<string, unknown>) => {
      process.exitCode = await runRepl({
        cwd: flags.cwd as string | undefined,
        provider: flags.provider as string | undefined,
        model: flags.model as string | undefined,
        baseURL: flags.baseUrl as string | undefined,
        permissionMode: flags.permissionMode as PermissionModeCli | undefined,
        disablePlan: flags.disablePlan === true,
        hitl: flags.hitl as HitlMode | undefined,
        stream: flags.stream as StreamMode | undefined,
        useUserHip: flags.isolate !== true,
        systemPrompt: flags.system as string | undefined,
        port: flags.port as number | undefined,
        token: flags.token as string | undefined,
        sidecarLog: flags.sidecarLog as string | undefined,
      })
    })

  program
    .command('run')
    .description('Run one headless agent turn (Harness ABI)')
    .argument('[prompt]', 'User prompt')
    .option('-f, --file <path>', 'Read prompt from file')
    .option('-c, --cwd <path>', 'Working directory (absolute after resolve)')
    .option('--provider <id>', 'LLM provider id', 'deepseek')
    .option('--model <id>', 'Model id', 'deepseek-chat')
    .option('--base-url <url>', 'Provider base URL')
    .option('--agent <id>', 'External ACP agent id (not AgentProfile)')
    .option('--permission-mode <mode>', 'chat|edit|full')
    .option('--disable-plan', 'Disable heuristic plan entry (default for headless)')
    .option('--force-plan', 'Allow plan mode heuristics')
    .option('--incognito', 'Session incognito (no memory inject/extract)')
    .option('--system <text>', 'System prompt override')
    .option('--timeout <sec>', 'Overall timeout seconds (0 = none)', (v) => Number(v), 0)
    .option('--json', 'Emit HipRunResult JSON (stdout last line unless --output)')
    .option('--output <path>', 'Write HipRunResult JSON to file')
    .option('--out-dir <dir>', 'Write artifacts (result.json, trace.jsonl, patch.diff, usage.json)')
    .option('--stream <mode>', 'text|tools|all|none — human stream; JSON uses --json/--output', 'text')
    .option('--preset <name>', 'harness|interactive|readonly')
    .option('--hitl <mode>', 'auto|fail|prompt')
    .option('--sidecar <mode>', 'spawn|attach|auto', 'spawn')
    .option('--port <n>', 'Attach port', (v) => Number(v))
    .option('--token <t>', 'Attach WS token')
    .option('--sidecar-log <path>', 'Sidecar log path (handshake parse / child log)')
    .option('--db <mode>', 'file|memory', 'file')
    .option('--use-user-hip', 'Use user ~/.hip instead of temp isolation')
    .option('--keep-user-home', 'Isolate HIP_* but keep process HOME')
    .option('--no-parent-watch', 'Do not set HIP_PARENT_WATCH (debug only)')
    .option('--max-plan-approvals <n>', 'Auto plan approvals', (v) => Number(v), 1)
    .option('--allow-no-key', 'Allow ready without API key (doctor-like)')
    .option('--require-git', 'Fail if cwd is not a git repository')
    .option('--trace-raw', 'Do not redact secrets in trace.jsonl')
    .action(async (prompt: string | undefined, flags: Record<string, unknown>) => {
      const opts: HipRunOptions = {
        prompt,
        file: flags.file as string | undefined,
        cwd: flags.cwd as string | undefined,
        provider: flags.provider as string | undefined,
        model: flags.model as string | undefined,
        baseURL: flags.baseUrl as string | undefined,
        agent: flags.agent as string | undefined,
        permissionMode: flags.permissionMode as PermissionModeCli | undefined,
        disablePlan: flags.disablePlan === true ? true : flags.forcePlan === true ? false : undefined,
        forcePlan: flags.forcePlan === true,
        incognito: flags.incognito === true ? true : undefined,
        systemPrompt: flags.system as string | undefined,
        timeoutSec: flags.timeout as number | undefined,
        json: flags.json === true,
        output: flags.output as string | undefined,
        outDir: flags.outDir as string | undefined,
        stream: flags.stream as StreamMode | undefined,
        preset: flags.preset as PresetName | undefined,
        hitl: flags.hitl as HitlMode | undefined,
        sidecar: flags.sidecar as SidecarMode | undefined,
        port: flags.port as number | undefined,
        token: flags.token as string | undefined,
        sidecarLog: flags.sidecarLog as string | undefined,
        db: flags.db as 'file' | 'memory' | undefined,
        useUserHip: flags.useUserHip === true,
        keepUserHome: flags.keepUserHome === true,
        noParentWatch: flags.noParentWatch === true,
        maxPlanApprovals: flags.maxPlanApprovals as number | undefined,
        allowNoKey: flags.allowNoKey === true,
        requireGit: flags.requireGit === true,
        traceRaw: flags.traceRaw === true,
      }
      const code = await runCommand(opts)
      process.exitCode = code
    })

  await program.parseAsync(process.argv)
}

main().catch((err) => {
  console.error('[hip]', err)
  process.exitCode = 1
})
