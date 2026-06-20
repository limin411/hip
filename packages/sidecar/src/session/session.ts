import type { ServerMessage, SessionConfig, AgentRole, Message, AgentRun, FsEntry, TurnUsage, DiffBase, DiffFile, DiffState, DiffSummary, Checkpoint, CommitLogEntry, CheckpointMode, Branch, PermissionMode, WorkflowDef, Hook, SkillMeta, AgentConfig, McpServerConfig } from '@hip/protocol'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import { clip, stringify, trajectoryToRuns, trajectoryToTimeline, ReasoningTracker, type TraceRun, type TraceRecorder } from './tool-trace.js'
import { verifyWrites } from './verify.js'
import { IdleWatchdog } from './idle-watchdog.js'
import { getActiveModel, isOpenAICompatible } from '../config/providers.js'
import { resolveApiKey } from '../config/auth-file.js'
import { buildGraph, type GraphEmit, type GraphCtx } from './graph.js'
import { SessionApprovalCache } from './tool-runner/approval-cache.js'
import { defaultToolPolicy } from './tool-runner/tool-policy.js'
import { ToolRunner } from './tool-runner/tool-runner.js'
import { buildTools, SELF_GATED_TOOLS } from './tools.js'
import { mcpManager, DEFAULT_LAZY_THRESHOLD } from './mcp/manager.js'
import { readAgentsConfig } from './agents/index.js'
import type { ApprovalFn } from './tools.js'
import { buildSystemPrompt } from './system-prompt.js'
import { RealModelRunner, type ModelRunner } from './model-runner.js'
import { buildChatModel, createSummarizer } from './model-factory.js'
import { runSubagent } from './subagent.js'
import { recursionLimit, CHILD_MAX_STEPS } from './loop-control.js'
import { addUsage, sumUsage } from './usage.js'
import type { Summarizer } from './compaction.js'
import { PAUSE_QUESTION } from './doom-loop.js'
import type { ExternalAgentHooks } from './agents/types.js'
import { HookRegistry } from './hooks/registry.js'
import type { AgentRunner } from '../orchestrator/ports.js'
import { createAgentInvoker, type AgentInvoker } from './agents/invoker.js'
import type { SessionStore } from '../persistence/store.js'
import * as workspaceFs from './workspace-fs.js'
import { GitOperations } from './git-operations.js'
import { PermissionManager } from './permission-manager.js'
import { AgentProviderManager } from './agent-provider.js'
import { ConfigManager } from './config-manager.js'
import { deriveTitle, sanitizeTitle, buildDefaultTitleGenerator, type TitleGenerator } from './title-generator.js'
import { runWorkflowTurn as runWorkflowTurnFn } from './workflow-runner.js'

export { sanitizeTitle } from './title-generator.js'
export type { TitleGenerator } from './title-generator.js'

type SendFn = (msg: ServerMessage) => void
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000

export function resolveModel(config: SessionConfig): string {
  return config.model || (config.thinking === false ? 'deepseek-chat' : 'deepseek-reasoner')
}

function lastUserText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.getType() === 'human') return typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  }
  return ''
}

export function resolveModelChoice(
  config: Pick<SessionConfig, 'llmProvider' | 'model' | 'baseURL'>,
  fallback: { providerID: string; modelID: string; baseURL: string },
): { providerID: string; modelID: string; baseURL: string } {
  if (config.model) {
    return { providerID: config.llmProvider || fallback.providerID, modelID: config.model, baseURL: config.baseURL || fallback.baseURL }
  }
  return fallback
}

function buildModel(config: SessionConfig): ChatOpenAI {
  return buildChatModel(resolveModelChoice(config, getActiveModel()))
}

const NOOP_SUMMARIZER: Summarizer = { async summarize() { return '' } }

export class Session {
  private app!: ReturnType<typeof buildGraph>
  private orchestratorRunner?: AgentRunner
  private readonly hooks = new HookRegistry()
  private readonly injectedRunner?: ModelRunner
  _config: SessionConfig
  private readonly injectedModel?: BaseLanguageModel
  private readonly messages: BaseMessage[] = []
  private abortController: AbortController | null = null
  private running = false
  private awaitingResume = false
  private paused: { messages: BaseMessage[]; steps: number } | null = null
  private readonly injectedSummarizer?: Summarizer
  private modelDirty = false
  private turnSeq = 0
  readonly usesEnvModel: boolean
  private readonly titleGenerator?: TitleGenerator
  private readonly invokerFactory: (cwd: string) => AgentInvoker
  readonly backgroundTasks: Map<string, Promise<void>> = new Map()
  static readonly MAX_BACKGROUND_TASKS = 10

  readonly git: GitOperations
  readonly permissions: PermissionManager
  readonly agentProv: AgentProviderManager
  readonly configMgr: ConfigManager
  readonly approvalCache = new SessionApprovalCache()
  readonly toolPolicy = defaultToolPolicy({ selfGatedTools: SELF_GATED_TOOLS })

  listBackgroundTasks(): string[] { return [...this.backgroundTasks.keys()] }
  registerHook(hook: Hook): void { this.hooks.register(hook) }

  constructor(
    readonly id: string,
    config: SessionConfig,
    model?: BaseLanguageModel,
    private readonly store?: SessionStore,
    titleGenerator?: TitleGenerator,
    private readonly idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
    runner?: ModelRunner,
    summarizer?: Summarizer,
    invokerFactory?: (cwd: string) => AgentInvoker,
  ) {
    this._config = config
    this.injectedModel = model
    this.injectedRunner = runner
    this.injectedSummarizer = summarizer
    this.invokerFactory = invokerFactory ?? ((cwd) => createAgentInvoker(cwd))
    this.usesEnvModel = !model && !runner
    this.titleGenerator = titleGenerator ?? (this.usesEnvModel ? buildDefaultTitleGenerator(config) : undefined)

    this.git = new GitOperations(id, store)
    this.permissions = new PermissionManager(
      () => this._config.permissionMode ?? 'edit',
      (mode) => { if (this.running) return false; this._config = { ...this._config, permissionMode: mode }; return true },
      { enableStickyApproval: this._config.enableStickyApproval ?? true },
    )
    this.permissions.setApprovalCache(this.approvalCache)
    this.agentProv = new AgentProviderManager(id, store, () => this._config, this.invokerFactory)
    this.configMgr = new ConfigManager(
      () => this._config, (cfg) => { this._config = cfg }, () => this.running,
      this.usesEnvModel, () => this.buildAgent(),
      () => this.agentProv.isExternalAgent(), () => this.modelDirty, (v) => { this.modelDirty = v },
    )
    this.buildAgent()
    this.configMgr.loadPluginComponents()
  }

  get config(): SessionConfig { return this._config }
  private buildAgent(): void { this.app = buildGraph() }

  private modelRunner(): ModelRunner {
    if (this.injectedRunner) return this.injectedRunner
    return new RealModelRunner((this.injectedModel as ChatOpenAI | undefined) ?? buildModel(this._config))
  }

  private summarizer(): Summarizer {
    if (this.injectedSummarizer) return this.injectedSummarizer
    return this.usesEnvModel ? createSummarizer() : NOOP_SUMMARIZER
  }

  // ── Git delegation ──
  async captureSnapshot() { await this.git.captureSnapshot(this._config.cwd) }
  private reseedLastCheckpoint() { this.git.reseedLastCheckpoint() }
  async workspaceDiff(base: DiffBase = 'head'): Promise<{ state: DiffState; base: DiffBase; hasSessionStart: boolean; files?: DiffFile[]; summary?: DiffSummary; error?: string }> { return this.git.workspaceDiff(this._config.cwd, base) }
  async workspaceDiffSummary(base: DiffBase = 'head'): Promise<{ state: DiffState; base: DiffBase; hasSessionStart: boolean; summary?: DiffSummary; error?: string }> { return this.git.workspaceDiffSummary(this._config.cwd, base) }
  async workspaceDiffFile(filePath: string, base: DiffBase = 'head', context?: number | 'full'): Promise<{ state: DiffState; file?: DiffFile; error?: string }> { return this.git.workspaceDiffFile(this._config.cwd, filePath, base, context) }
  async workspaceGitInit(): Promise<{ ok: boolean; error?: string }> { return this.git.workspaceGitInit(this._config.cwd) }
  async captureCheckpoint(turnId: string, label: string | null, send: SendFn) { await this.git.captureCheckpoint(this._config.cwd, turnId, label, send) }
  async listCheckpoints(): Promise<{ checkpoints: Checkpoint[]; isGitRepo: boolean; currentBranch: string | null }> { return this.git.listCheckpoints(this._config.cwd) }
  async checkpointDiff(checkpointId: string, mode: CheckpointMode): Promise<{ state: DiffState; files?: DiffFile[]; summary?: DiffSummary; error?: string }> { return this.git.checkpointDiff(this._config.cwd, checkpointId, mode) }
  async commitLog(): Promise<{ state: DiffState; commits?: CommitLogEntry[]; error?: string }> { return this.git.commitLog(this._config.cwd) }
  async revertCheckpoint(checkpointId: string, send: SendFn): Promise<{ ok: boolean; safetyCheckpointId?: string; error?: string }> { return this.git.revertCheckpoint(this._config.cwd, checkpointId, send) }
  async listBranches(): Promise<{ branches: Branch[]; currentBranch: string | null }> { return this.git.listBranches(this._config.cwd) }
  async switchBranch(branch: string): Promise<{ ok: boolean; currentBranch: string | null; error?: string }> { return this.git.switchBranch(this._config.cwd, branch) }

  // ── Permission delegation ──
  setPermissionMode(permissionMode: PermissionMode): boolean { return this.configMgr.setPermissionMode(permissionMode) }
  respondPermission(requestId: string, choice: { optionId: string } | { cancelled: true }): void { this.permissions.respondPermission(requestId, choice) }

  // ── Agent provider delegation ──
  async setAgentConfigOption(configId: string, value: string): Promise<void> { await this.agentProv.setAgentConfigOption(configId, value) }

  // ── Config delegation ──
  setCwd(cwd: string): void { this.configMgr.setCwd(cwd) }
  setThinking(thinking: boolean): boolean { return this.configMgr.setThinking(thinking) }
  setModel(llmProvider: string): boolean { return this.configMgr.setModel(llmProvider) }
  setSystemPrompt(systemPrompt: string | null): boolean { return this.configMgr.setSystemPrompt(systemPrompt) }
  applyActiveModel(): boolean { return this.configMgr.applyActiveModel() }
  reloadPlugins(): void { this.configMgr.reloadPlugins() }

  // ── FS helpers ──
  async lsDir(absPath: string): Promise<{ entries?: FsEntry[]; error?: string }> {
    if (!this._config.cwd) return { error: 'no_workspace' }
    try { return { entries: await workspaceFs.lsDir(this._config.cwd, absPath) } }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }

  async readForPreview(absPath: string): Promise<workspaceFs.PreviewResult> {
    if (!this._config.cwd) return { error: 'no_workspace' }
    try { return await workspaceFs.readForPreview(this._config.cwd, absPath) }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }

  // ── Lifecycle ──
  hydrate(messages: Message[]): void {
    for (const m of messages) {
      this.messages.push(m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))
    }
    this.reseedLastCheckpoint()
  }

  private requireCompatibleModel(send: SendFn): boolean {
    if (this.agentProv.isExternalAgent()) return true
    if (this.usesEnvModel) {
      const { providerID } = getActiveModel()
      if (!isOpenAICompatible(providerID)) {
        send({ type: 'error', sessionId: this.id, code: 'INCOMPATIBLE_MODEL', message: `Provider "${providerID}" is not OpenAI-compatible and can't be used here. Pick an OpenAI-compatible model in Settings.` })
        return false
      }
    }
    return true
  }

  private requireApiKey(send: SendFn): boolean {
    if (this.agentProv.isExternalAgent()) return true
    if (this.usesEnvModel) {
      const { providerID } = getActiveModel()
      if (!resolveApiKey(providerID)) {
        send({ type: 'error', sessionId: this.id, code: 'NO_API_KEY', message: 'API key not configured. Set it in Settings.' })
        return false
      }
    }
    return true
  }

  async sendMessage(content: string, _send: SendFn, userMessageId?: string): Promise<void> {
    if (this.running || this.awaitingResume) return
    if (this.modelDirty) { this.buildAgent(); this.modelDirty = false }
    if (!this.requireCompatibleModel(_send)) return
    if (!this.requireApiKey(_send)) return

    const userTs = Date.now()
    let isFirstTurn = false
    if (this.store) {
      const seq = this.store.insertMessage({ id: userMessageId ?? `u-${userTs}`, sessionId: this.id, role: 'user', agentId: null, content, timestamp: userTs })
      this.store.touchSession(this.id, userTs)
      isFirstTurn = seq === 1
      if (isFirstTurn && this.store.updateTitleIfAuto(this.id, deriveTitle(content)) === 1) {
        _send({ type: 'session:title', sessionId: this.id, title: deriveTitle(content) })
      }
    }

    const promptResult = await this.hooks.fire('UserPromptSubmit', { sessionId: this.id }).catch(() => ({ kind: 'deny' as const, reason: 'Hook error' }))
    if (promptResult.kind !== 'allow') {
      _send({ type: 'error', sessionId: this.id, code: 'HOOK_DENIED', message: `User prompt rejected: ${promptResult.reason ?? 'blocked by hook'}` })
      return
    }
    if (isFirstTurn) void this.hooks.fire('SessionStart', { sessionId: this.id }).catch(() => {})

    this.messages.push(new HumanMessage(content))
    const supervisorText = await this.runTurn(_send)

    if (isFirstTurn && this.titleGenerator && supervisorText && this.store) {
      try {
        const refined = sanitizeTitle(await this.titleGenerator({ firstUserMessage: content, firstReply: supervisorText }))
        if (refined && this.store.updateTitleIfAuto(this.id, refined) === 1) {
          _send({ type: 'session:title', sessionId: this.id, title: refined })
        }
      } catch { /* non-critical */ }
    }
  }

  async resume(content: string, send: SendFn): Promise<void> {
    if (!this.awaitingResume || !this.paused || this.running) return
    const base = { messages: [...this.paused.messages, new HumanMessage(content)], steps: this.paused.steps }
    this.awaitingResume = false; this.paused = null
    const ts = Date.now()
    if (this.store) {
      this.store.insertMessage({ id: `u-${ts}`, sessionId: this.id, role: 'user', agentId: null, content, timestamp: ts })
      this.store.touchSession(this.id, ts)
    }
    this.messages.push(new HumanMessage(content))
    await this.runTurn(send, base)
  }

  private async runTurn(rawSend: SendFn, base?: { messages: BaseMessage[]; steps: number }): Promise<string> {
    this.abortController = new AbortController(); this.running = true
    let timedOut = false
    const watchdog = new IdleWatchdog(this.idleTimeoutMs, () => { timedOut = true; this.abortController?.abort() })
    const send: SendFn = (msg) => { watchdog.kick(); rawSend(msg) }

    const turnId = `asst-supervisor-${Date.now()}-${this.turnSeq++}`
    const trajectory = new Map<string, TraceRun>()
    let agentSeq = 0; let stepSeq = 0
    const nextSeq = () => stepSeq++
    const started = new Set<string>()
    const usageByAgent = new Map<string, TurnUsage>()
    const recorder: TraceRecorder = {
      start: (agentId, callId, name, input, seq, truncated) => {
        const r = trajectory.get(agentId); if (r) r.toolCalls.set(callId, { callId, agentId, name, input, status: 'running', seq, ...(truncated ? { truncated: true } : {}) })
      },
      finish: (agentId, callId, status, output, error, truncated) => {
        const tc = trajectory.get(agentId)?.toolCalls.get(callId)
        if (!tc) return; tc.status = status
        if (output !== undefined) tc.output = output
        if (error !== undefined) tc.error = error
        if (truncated || tc.truncated) tc.truncated = true
      },
    }
    const reasoning = new ReasoningTracker(nextSeq)
    const reasoningDelta = (agentId: string, role: AgentRole, delta: string) => {
      if (!delta) return
      send({ type: 'reasoning:delta', sessionId: this.id, turnId, agentId, role, stepSeq: reasoning.push(agentId, delta), delta })
    }
    const closeReasoning = (agentId: string) => {
      const burst = reasoning.close(agentId); if (burst) { const r = trajectory.get(agentId); if (r) r.reasoningBursts.push(burst) }
    }
    const ensureStarted = (agentId: string, role: AgentRole, parentAgentId?: string, taskInput?: string) => {
      if (started.has(agentId)) return; started.add(agentId)
      trajectory.set(agentId, { role, output: '', startedAt: Date.now(), finishedAt: null, seq: agentSeq++, toolCalls: new Map(), reasoningBursts: [], ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
      send({ type: 'agent:started', sessionId: this.id, turnId, agentId, role, ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
    }
    const ensureFinished = (agentId: string, output: string) => {
      if (!started.has(agentId)) return; closeReasoning(agentId)
      const r = trajectory.get(agentId); if (r) { r.output = output; r.finishedAt = Date.now() }
      started.delete(agentId); send({ type: 'agent:finished', sessionId: this.id, turnId, agentId })
    }
    const finishRemaining = () => {
      for (const id of started) { closeReasoning(id); const r = trajectory.get(id); if (r) r.finishedAt = Date.now(); send({ type: 'agent:finished', sessionId: this.id, turnId, agentId: id }) }
      started.clear()
    }

    let supervisorText = ''
    ensureStarted('supervisor', 'supervisor')

    const turnStartResult = await this.hooks.fire('TurnStart', { sessionId: this.id, turnId }).catch(() => ({ kind: 'deny' as const, reason: 'Hook error' }))
    if (turnStartResult.kind !== 'allow') { rawSend({ type: 'error', sessionId: this.id, code: 'HOOK_DENIED', message: `Turn start rejected: ${turnStartResult.reason ?? 'blocked by hook'}` }); return '' }

    const cwd = this._config.cwd ?? process.cwd()
    const runner = this.modelRunner(); const summarizer = this.summarizer()
    const skills = this.configMgr.skills; const pluginAgents = this.configMgr.pluginAgents
    if (!this.agentProv.isExternalAgent()) {
      try { await mcpManager.reconcile(this.configMgr.mcpConfigs) } catch { /* degrade */ }
      send({ type: 'mcp:status', servers: mcpManager.connectionStatuses(this.configMgr.mcpConfigs) })
    }
    const rawMode = this._config.permissionMode
    const mode: PermissionMode = rawMode === 'chat' || rawMode === 'full' ? rawMode : 'edit'
    const mcpTools = mcpManager.tools(this.usesEnvModel ? { lazyThreshold: DEFAULT_LAZY_THRESHOLD } : undefined)
    const system = buildSystemPrompt({ cwd, userInstructions: this._config.systemPrompt, skills, permissionMode: mode, mcpCatalog: mcpManager.toolCatalog() })
    const makeEmit = (agentId: string, role: AgentRole): GraphEmit => ({
      token: (delta) => { if (!delta) return; if (agentId === 'supervisor') supervisorText += delta; const r = trajectory.get(agentId); if (r) r.output += delta; send({ type: 'token:stream', sessionId: this.id, turnId, agentId, delta }) },
      reasoning: (delta) => reasoningDelta(agentId, role, delta),
      toolStarted: (name, callId, input) => { closeReasoning(agentId); const seq = nextSeq(); const inClip = clip(stringify(input)); recorder.start(agentId, callId, name, inClip.text, seq, inClip.truncated); send({ type: 'tool:started', sessionId: this.id, turnId, agentId, role, callId, name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) }) },
      toolFinished: (callId, status, output, error) => { const outClip = output !== undefined ? clip(stringify(output)) : undefined; recorder.finish(agentId, callId, status, outClip?.text, error, outClip?.truncated ?? false); send({ type: 'tool:finished', sessionId: this.id, turnId, agentId, callId, status, ...(outClip ? { output: outClip.text } : {}), ...(error ? { error } : {}), ...(outClip?.truncated ? { truncated: true } : {}) }) },
      usage: (u) => { usageByAgent.set(agentId, addUsage(usageByAgent.get(agentId), u)) },
    })
    const emit = makeEmit('supervisor', 'supervisor')
    let subagentSeq = 0
    const spawnSubagent = async (description: string, subagentMode: 'foreground' | 'background' = 'foreground'): Promise<string> => {
      const childId = `worker-${++subagentSeq}`
      if (subagentMode === 'background') {
        if (this.backgroundTasks.size >= Session.MAX_BACKGROUND_TASKS) return `Error: maximum ${Session.MAX_BACKGROUND_TASKS} concurrent background tasks reached`
        ensureStarted(childId, 'worker', 'supervisor', description)
        const promise = (async () => {
          try { ensureFinished(childId, await runSubagent({ runner, root: cwd, summarizer, emit: makeEmit(childId, 'worker'), signal: this.abortController!.signal, description, childMaxSteps: CHILD_MAX_STEPS, permissionMode: mode, requestApproval })) }
          catch (err) { const msg = err instanceof Error ? err.message : String(err); console.error(`Background task ${childId} failed:`, msg); ensureFinished(childId, `Error: ${msg}`) }
          finally { this.backgroundTasks.delete(childId) }
        })()
        this.backgroundTasks.set(childId, promise); return `Background task started: ${childId}`
      }
      ensureStarted(childId, 'worker', 'supervisor', description)
      const text = await runSubagent({ runner, root: cwd, summarizer, emit: makeEmit(childId, 'worker'), signal: this.abortController!.signal, description, childMaxSteps: CHILD_MAX_STEPS, permissionMode: mode, requestApproval })
      ensureFinished(childId, text); return text
    }

    const enabledAgents = [...readAgentsConfig().filter((a) => a.enabled && a.id !== 'builtin'), ...pluginAgents.filter((a) => a.enabled && a.id !== 'builtin')]
    const invoker = this.agentProv.invoker(cwd)
    const requestApproval = this.permissions.buildRequestApproval(send, this.id, turnId, nextSeq, mode)

    const dispatchAgent = async (agentId: string, task: string): Promise<string> => {
      const cfg = enabledAgents.find((a) => a.id === agentId)
      if (!cfg) return `Error: unknown or disabled agent ${agentId}`
      const childId = `subagent-${++subagentSeq}`
      ensureStarted(childId, 'subagent', 'supervisor', task)
      const hooks: ExternalAgentHooks = {
        requestPermission: (req) => new Promise((resolve) => { this.permissions.pendingPermissions.set(req.requestId, resolve); send({ type: 'permission:request', sessionId: this.id, turnId, requestId: req.requestId, tool: req.tool, options: req.options, agentFrame: { agentId: childId, parentAgentId: 'supervisor', name: cfg.name } }) }),
        configOptions: () => {},
      }
      try {
        const text = await invoker.invoke(agentId, task, makeEmit(childId, 'subagent'), this.abortController!.signal, hooks, { mcpTools, skills, requestApproval, permissionMode: mode })
        ensureFinished(childId, text); return text || '(sub-agent produced no output)'
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err
        const msg = err instanceof Error ? err.message : String(err); ensureFinished(childId, `Error: ${msg}`); return `Error: ${msg}`
      }
    }

    const tools = buildTools(cwd, spawnSubagent, this._config.cwd,
      enabledAgents.length ? { agents: enabledAgents.map((a) => ({ id: a.id, name: a.name, description: a.description })), run: dispatchAgent } : undefined,
      { mcpTools, skills, requestApproval, permissionMode: mode, webSearchEnabled: true, generateAgentEnabled: true, sessionId: this.id },
    )
    const toolRunner = new ToolRunner({
      tools: new Map(tools.map((t) => [t.name, t])),
      hooks: this.hooks,
      toolPolicy: this.toolPolicy,
      approvalCache: this.approvalCache,
      selfGatedTools: SELF_GATED_TOOLS,
      requestApproval,
      permissionMode: mode,
      sessionId: this.id,
      onToolStarted: (name, callId, input) => emit.toolStarted(name, callId, input),
      onToolFinished: (callId, status, output, error) => emit.toolFinished(callId, status, output, error),
      emitRisk: (toolName, risk, approval) => {
        send({ type: 'guardian:risk', sessionId: this.id, turnId, toolName, risk, category: approval, reason: '' })
      },
    })
    const ctx: GraphCtx = { runner, tools, emit, summarizer, hooks: this.hooks, sessionId: this.id, toolRunner, toolPolicy: this.toolPolicy, approvalCache: this.approvalCache, requestApproval, permissionMode: mode }

    try {
      if (this.agentProv.isExternalAgent()) {
        const userText = lastUserText(base?.messages ?? this.messages)
        const hooks: ExternalAgentHooks = {
          requestPermission: (req) => new Promise((resolve) => { this.permissions.pendingPermissions.set(req.requestId, resolve); send({ type: 'permission:request', sessionId: this.id, turnId, requestId: req.requestId, tool: req.tool, options: req.options }) }),
          configOptions: (options) => send({ type: 'agent:configOptions', sessionId: this.id, options }),
        }
        await this.agentProv.ensureExternalProvider().runTurn(userText, emit, this.abortController.signal, hooks)
        closeReasoning('supervisor'); finishRemaining()
        const acpId = this.agentProv.acpSessionId; if (acpId && this.store) this.store.setAcpSessionId(this.id, acpId)
      } else {
        const finalState = await this.app.invoke(
          { messages: [new SystemMessage(system), ...(base?.messages ?? this.messages)], steps: base?.steps ?? 0, recentSigs: [], nudgedSig: undefined, status: 'running' },
          { configurable: { ctx }, signal: this.abortController.signal, recursionLimit: recursionLimit() },
        )
        closeReasoning('supervisor'); finishRemaining()
        if (finalState.status === 'awaiting_user') {
          this.paused = { messages: finalState.messages.slice(1), steps: finalState.steps }; this.awaitingResume = true
          const stoppedText = this.finalizeAndPersist(send, turnId, supervisorText, trajectory, true, usageByAgent)
          void this.hooks.fire('TurnComplete', { sessionId: this.id, turnId }).catch(() => {})
          send({ type: 'agent:interrupt', sessionId: this.id, turnId, agentId: 'supervisor', question: finalState.pendingQuestion ?? PAUSE_QUESTION })
          return stoppedText
        }
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'; finishRemaining()
      if (isAbort && supervisorText) {
        const text = this.finalizeAndPersist(rawSend, turnId, supervisorText, trajectory, true, usageByAgent)
        void this.hooks.fire('TurnComplete', { sessionId: this.id, turnId }).catch(() => {})
        if (timedOut) rawSend({ type: 'error', sessionId: this.id, code: 'TIMEOUT', message: '' })
        return text
      }
      rawSend({ type: 'error', sessionId: this.id, code: timedOut ? 'TIMEOUT' : isAbort ? 'CANCELLED' : 'AGENT_ERROR', message: timedOut ? '' : isAbort ? 'User cancelled the request' : err instanceof Error ? err.message : String(err) })
      return ''
    } finally {
      watchdog.stop(); this.running = false; this.abortController = null; this.permissions.cancelAll()
    }

    const finalText = this.finalizeAndPersist(send, turnId, supervisorText, trajectory, false, usageByAgent)
    void this.hooks.fire('TurnComplete', { sessionId: this.id, turnId }).catch(() => {})
    const ckptLabel = (finalText || '').replace(/\s+/g, ' ').trim().slice(0, 72) || null
    void this.captureCheckpoint(turnId, ckptLabel, send).catch(() => {})
    return finalText
  }

  async runWorkflowTurn(def: WorkflowDef, send: SendFn): Promise<string> {
    return runWorkflowTurnFn(
      {
        id: this.id, config: this._config,
        modelRunner: () => this.modelRunner(), summarizer: () => this.summarizer(),
        invokerFactory: this.agentProv.invoker, store: this.store,
        idleTimeoutMs: this.idleTimeoutMs, pendingPermissions: this.permissions.pendingPermissions,
        orchestratorRunner: this.orchestratorRunner,
      },
      def, send,
      (s, turnId, text, traj, stopped) => this.finalizeAndPersist(s, turnId, text, traj, stopped),
    )
  }

  private finalizeAndPersist(send: SendFn, turnId: string, supervisorText: string, trajectory: Map<string, TraceRun>, stopped: boolean, usageByAgent?: Map<string, TurnUsage>): string {
    const { correction } = verifyWrites(trajectory, supervisorText, this._config.language ?? 'en')
    const finalText = correction ? `${supervisorText}\n\n${correction}` : supervisorText
    if (finalText) this.messages.push(new AIMessage(finalText))
    const ts = Date.now()
    const runs: AgentRun[] = trajectoryToRuns(trajectory).map((r) => { const u = usageByAgent?.get(r.agentId); return { ...r, messageId: turnId, ...(u ? { usage: u } : {}) } })
    const turnUsage = sumUsage(runs.map((r) => r.usage))
    const timeline = trajectoryToTimeline(trajectory)
    const toolCalls = runs.flatMap((r) => r.toolCalls ?? []).sort((a, b) => a.seq - b.seq)
    if (this.store) {
      this.store.insertTurn(finalText ? { id: turnId, sessionId: this.id, agentId: 'supervisor', content: finalText, timestamp: ts, stopped, timeline } : null, this.id, runs)
      this.store.touchSession(this.id, ts)
    }
    send({ type: 'message:complete', sessionId: this.id, message: { id: turnId, role: 'assistant', content: finalText, agentId: 'supervisor', timestamp: ts, timeline, toolCalls, agentRuns: runs, ...(turnUsage ? { usage: turnUsage } : {}), ...(stopped ? { stopped: true } : {}) } })
    return finalText
  }

  async regenerate(send: SendFn): Promise<void> {
    if (this.running || this.awaitingResume) return
    if (!this.requireCompatibleModel(send)) return
    if (!this.requireApiKey(send)) return
    const tail = this.messages[this.messages.length - 1]
    if (tail instanceof AIMessage) { this.messages.pop(); this.store?.deleteLastAssistantMessage(this.id) }
    if (!(this.messages[this.messages.length - 1] instanceof HumanMessage)) return
    await this.runTurn(send)
  }

  cancel(): void {
    if (this.awaitingResume) { this.awaitingResume = false; this.paused = null; return }
    this.abortController?.abort()
  }

  async destroy(): Promise<void> {
    this.cancel()
    if (this.backgroundTasks.size > 0) {
      const timeout = new Promise<'timed_out'>((resolve) => setTimeout(() => resolve('timed_out'), 5_000))
      await Promise.race([Promise.allSettled([...this.backgroundTasks.values()]).then(() => 'settled' as const), timeout])
      this.backgroundTasks.clear()
    }
    this.agentProv.dispose()
  }
}
