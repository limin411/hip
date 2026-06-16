import type { ServerMessage, SessionConfig, AgentRole, Message, AgentRun, FsEntry, TurnUsage, DiffBase, DiffFile, DiffState, Checkpoint, CommitLogEntry, CheckpointMode, Branch } from '@hip/protocol'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import type { SessionStore } from '../persistence/store.js'
import * as workspaceFs from './workspace-fs.js'
import * as workspaceGit from './workspace-git.js'
import { clip, stringify, trajectoryToRuns, trajectoryToTimeline, ReasoningTracker, type TraceRun, type TraceRecorder } from './tool-trace.js'
import { verifyWrites } from './verify.js'
import { IdleWatchdog } from './idle-watchdog.js'
import { getActiveModel, isOpenAICompatible } from '../config/providers.js'
import { resolveApiKey } from '../config/auth-file.js'
import { buildGraph, type GraphEmit, type GraphCtx } from './graph.js'
import { buildTools } from './tools.js'
import { mcpManager } from './mcp/manager.js'
import { readMcpServersConfig } from '../config/mcp-servers.js'
import { readEnabledSkills } from './skills/registry.js'
import type { ApprovalFn } from './tools.js'
import { buildSystemPrompt } from './system-prompt.js'
import { RealModelRunner, type ModelRunner } from './model-runner.js'
import { buildChatModel, activeKey, createSummarizer } from './model-factory.js'
import { runSubagent } from './subagent.js'
import { recursionLimit, CHILD_MAX_STEPS } from './loop-control.js'
import { addUsage, sumUsage } from './usage.js'
import type { Summarizer } from './compaction.js'
import { PAUSE_QUESTION } from './doom-loop.js'
import { createAgentProvider, readAgentsConfig, resolveAgentModel, type AgentProvider } from './agents/index.js'
import { createAgentInvoker, type AgentInvoker } from './agents/invoker.js'
import type { ExternalAgentHooks } from './agents/types.js'

type SendFn = (msg: ServerMessage) => void

const TITLE_LEN = 40

/** A turn with no outbound activity for this long is treated as a stalled provider stream and aborted. */
export const DEFAULT_IDLE_TIMEOUT_MS = 60_000

/** DEPRECATED — superseded by the global active model (config/providers.ts). buildModel no longer
 *  calls this; it remains only for the legacy DeepSeek thinking-toggle unit tests pending full removal.
 *  thinking === false → fast non-reasoning model; otherwise the reasoner. A caller-pinned config.model wins. */
export function resolveModel(config: SessionConfig): string {
  return config.model || (config.thinking === false ? 'deepseek-chat' : 'deepseek-reasoner')
}

/** Text of the latest human message in a turn's message list (what an external agent should answer). */
function lastUserText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.getType() === 'human') return typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  }
  return ''
}

function deriveTitle(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > TITLE_LEN ? oneLine.slice(0, TITLE_LEN) + '…' : oneLine || '新对话'
}

/** Normalize a generated/echoed title: one line, no wrapping quotes, no trailing punctuation, bounded length. */
export function sanitizeTitle(raw: string): string {
  const oneLine = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'""''「」『』]+/, '')
    .replace(/["'""''「」『』]+$/, '')
    .replace(/[。.！!？?，,、；;：:]+$/, '')
    .trim()
  return oneLine.length > TITLE_LEN ? oneLine.slice(0, TITLE_LEN) : oneLine
}

export type TitleGenerator = (input: { firstUserMessage: string; firstReply: string }) => Promise<string>


const TITLE_SYSTEM_PROMPT =
  'You generate a very short title (at most 6 words, or about 16 Chinese characters) for a chat conversation. ' +
  'Use the same language as the user. Reply with ONLY the title — no quotes, no trailing punctuation.'

/** Production title generator: one cheap completion. Not used when a model is injected (tests). */
function buildDefaultTitleGenerator(_config: SessionConfig): TitleGenerator {
  return async ({ firstUserMessage, firstReply }) => {
    const { providerID, modelID, baseURL } = getActiveModel()
    const model = new ChatOpenAI({
      model: modelID,
      apiKey: activeKey(providerID),
      configuration: { baseURL },
      maxTokens: 24,
      temperature: 0.3,
    })
    const res = await model.invoke([
      new SystemMessage(TITLE_SYSTEM_PROMPT),
      new HumanMessage(`${firstUserMessage}\n\n[assistant reply]: ${firstReply.slice(0, 200)}`),
    ])
    return typeof res.content === 'string' ? res.content : ''
  }
}

/** Pure helper: prefer the session config's model (when non-empty) over the global active model.
 *  Falls back field-by-field: providerID from config.llmProvider, modelID from config.model,
 *  baseURL from config.baseURL (falls back to fallback.baseURL when absent). */
export function resolveModelChoice(
  config: Pick<SessionConfig, 'llmProvider' | 'model' | 'baseURL'>,
  fallback: { providerID: string; modelID: string; baseURL: string },
): { providerID: string; modelID: string; baseURL: string } {
  if (config.model) {
    return {
      providerID: config.llmProvider || fallback.providerID,
      modelID: config.model,
      baseURL: config.baseURL || fallback.baseURL,
    }
  }
  return fallback
}

function buildModel(config: SessionConfig): ChatOpenAI {
  return buildChatModel(resolveModelChoice(config, getActiveModel()))
}

const NOOP_SUMMARIZER: Summarizer = { async summarize() { return '' } }

export class Session {
  private app!: ReturnType<typeof buildGraph>
  private readonly injectedRunner?: ModelRunner
  private _config: SessionConfig
  private readonly injectedModel?: BaseLanguageModel
  private readonly messages: BaseMessage[] = []
  private abortController: AbortController | null = null
  private _diffBaseSha: string | null = null
  // Latest checkpoint commit (the parent for the next per-turn checkpoint). Seeded by captureSnapshot
  // (checkpoint #0 / session-start commit), advanced by each successful per-turn captureCheckpoint.
  private _lastCheckpointCommit: string | null = null
  // Re-entrancy guard: a second send/regenerate while a turn is in flight is dropped (the WS layer dispatches fire-and-forget, so it does not serialize).
  private running = false
  private awaitingResume = false
  private paused: { messages: BaseMessage[]; steps: number } | null = null
  private readonly injectedSummarizer?: Summarizer
  private modelDirty = false
  // Monotonic per-session turn counter — appended to turnId so two turns in the same millisecond cannot collide.
  private turnSeq = 0
  private readonly usesEnvModel: boolean
  private readonly titleGenerator?: TitleGenerator
  private externalProvider: AgentProvider | null = null
  // Pending HITL permission requests from the external agent, keyed by requestId. The hooks in the
  // external branch register a resolver here; the UI's permission:respond completes it (Slice 5).
  private readonly pendingPermissions = new Map<string, (c: { optionId: string } | { cancelled: true }) => void>()
  // Factory for the per-turn AgentInvoker that runs a dispatched configured agent as a nested sub-agent
  // turn. Injectable so tests stub the sub-agent (no real provider process); defaults to the real one.
  private readonly invokerFactory: (cwd: string) => AgentInvoker

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
    // Inject a generator (tests), else build the real one only for the env-keyed
    // production model. Injected-model sessions get no generator → no LLM title.
    this.titleGenerator = titleGenerator ?? (this.usesEnvModel ? buildDefaultTitleGenerator(config) : undefined)
    this.buildAgent()
  }

  /** Current config (cwd may change via setCwd). */
  get config(): SessionConfig {
    return this._config
  }

  /** (Re)build the compiled agent-loop graph (reused across turns; per-turn state is passed via configurable.ctx). */
  private buildAgent(): void {
    this.app = buildGraph()
  }

  /** The ModelRunner for this turn: injected (tests) or a RealModelRunner over the built ChatOpenAI. */
  private modelRunner(): ModelRunner {
    if (this.injectedRunner) return this.injectedRunner
    const model = (this.injectedModel as ChatOpenAI | undefined) ?? buildModel(this._config)
    return new RealModelRunner(model)
  }

  /** True when this session routes turns to an external agent rather than the built-in graph. */
  private isExternalAgent(): boolean {
    const a = this._config.agentId
    return !!a && a !== 'builtin'
  }

  /** Lazily build (and cache) the provider for this session's external agent. Throws on an unknown id. */
  private ensureExternalProvider(): AgentProvider {
    if (!this.externalProvider) {
      const agent = readAgentsConfig().find((x) => x.id === this._config.agentId)
      if (!agent) throw new Error(`Unknown agent: ${this._config.agentId}`)
      // Model rollback: CLI ('custom') agents self-manage their model — hip never resolves/pushes one
      // (LoopAgentProvider discards the model ctor param), so resolving it here would be dead work that
      // contradicts the UI promise. The ACP path still resolves a model until its own rollback lands.
      const model = agent.kind === 'custom' ? null : agent.acceptsModelConfig ? resolveAgentModel(agent) : null
      const resume = this.store?.getAcpSessionId(this.id) ?? null
      this.externalProvider = createAgentProvider(agent, this._config.cwd ?? process.cwd(), model)
      // createAgentProvider doesn't take resume; pass it via an optional setter to avoid widening the factory.
      ;(this.externalProvider as { setResumeSessionId?: (id: string | null) => void }).setResumeSessionId?.(resume)
    }
    return this.externalProvider
  }

  /** Complete a pending external-agent permission request with the user's choice (HITL round-trip). */
  respondPermission(requestId: string, choice: { optionId: string } | { cancelled: true }): void {
    const resolve = this.pendingPermissions.get(requestId)
    if (resolve) { this.pendingPermissions.delete(requestId); resolve(choice) }
  }

  /** Drive the external agent's live model/mode selector (ACP control-plane). No-op for inline/custom agents. */
  async setAgentConfigOption(configId: string, value: string): Promise<void> {
    await this.externalProvider?.setConfigOption?.(configId, value)
  }

  /** The Summarizer for compaction: injected (tests), else a cheap-model summarizer for the env model,
   *  else a no-op (injected-model/runner sessions never hit the paid path). */
  private summarizer(): Summarizer {
    if (this.injectedSummarizer) return this.injectedSummarizer
    return this.usesEnvModel ? createSummarizer() : NOOP_SUMMARIZER
  }

  /** Seed prior conversation so the agent resumes with full context. */
  hydrate(messages: Message[]): void {
    for (const m of messages) {
      this.messages.push(m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))
    }
    this.reseedLastCheckpoint()
  }

  /** Re-seed _lastCheckpointCommit from the store on lazy resume (captureSnapshot only runs on CREATE,
   *  so without this the first post-resume captureCheckpoint would pass prevCommit=null — defeating the
   *  empty-turn skip and orphaning the new checkpoint with no parent). Mirrors resolvedDiffBaseSha's
   *  fallback: latest checkpoint commit, else the session-start commit, else null. */
  private reseedLastCheckpoint(): void {
    if (this._lastCheckpointCommit) return
    this._lastCheckpointCommit =
      this.store?.listCheckpoints(this.id)[0]?.commitSha ??
      this.store?.getSessionGitMeta(this.id).sessionStartCommit ??
      null
  }

  /** Bind/replace the project directory and rebuild the agent. Conversation history is preserved. */
  setCwd(cwd: string): void {
    this._config = { ...this._config, cwd }
    this.buildAgent()
  }

  /** Toggle the thinking (reasoner) model and rebuild the agent. NO-OP (returns false) while a turn is running. */
  setThinking(thinking: boolean): boolean {
    if (this.running) return false
    this._config = { ...this._config, thinking }
    this.buildAgent()
    return true
  }

  /** Rebuild against the current global active model. NO-OP (returns false) while a turn is running;
   *  the next sendMessage rebuilds (see modelDirty). Injected-model sessions (tests) are unaffected. */
  applyActiveModel(): boolean {
    if (!this.usesEnvModel) return true
    if (this.running) { this.modelDirty = true; return false }
    this.buildAgent()
    return true
  }

  /** Set/clear per-conversation instructions and rebuild the agent. NO-OP (returns false) while a turn is running. */
  setSystemPrompt(systemPrompt: string | null): boolean {
    if (this.running) return false
    const next = systemPrompt?.trim() || undefined
    this._config = { ...this._config, systemPrompt: next }
    this.buildAgent()
    return true
  }

  /** List a directory for the UI tree. Absolute path. */
  async lsDir(absPath: string): Promise<{ entries?: FsEntry[]; error?: string }> {
    if (!this._config.cwd) return { error: 'no_workspace' }
    try {
      return { entries: await workspaceFs.lsDir(this._config.cwd, absPath) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Read a file for the UI preview. Absolute path. */
  async readForPreview(absPath: string): Promise<workspaceFs.PreviewResult> {
    if (!this._config.cwd) return { error: 'no_workspace' }
    try {
      return await workspaceFs.readForPreview(this._config.cwd, absPath)
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 解析会话起点快照 SHA：优先内存缓存，回退 DB。 */
  private resolvedDiffBaseSha(): string | null {
    return this._diffBaseSha ?? this.store?.getSession(this.id)?.diff_base_sha ?? null
  }

  /** 会话创建时抓一次工作区快照并持久化（fire-and-forget 调用）。同时记录会话起点 commit 与
   *  checkpoint #0（起点至今 diff 的 base / 第一轮 checkpoint 的 parent）。 */
  async captureSnapshot(): Promise<void> {
    if (!this._config.cwd) return
    const cwd = this._config.cwd
    const sha = await workspaceGit.captureSessionSnapshot(cwd)
    this._diffBaseSha = sha
    this.store?.setDiffBaseSha(this.id, sha)

    // Session-start commit (commit-log lower bound; null on unborn HEAD / non-repo) + branch.
    const branch = await workspaceGit.getCurrentBranch(cwd)
    this.store?.setSessionBranch(this.id, branch)
    let startCommit: string | null = null
    try { startCommit = (await workspaceGit.collectCommitLog(cwd, null)).commits?.[0]?.sha ?? null } catch { startCommit = null }
    this.store?.setSessionStartCommit(this.id, startCommit)

    // Checkpoint #0 (session start). prevCommit = session-start branch HEAD (or null on unborn HEAD).
    const r = await workspaceGit.captureCheckpoint(cwd, { sessionId: this.id, turnId: 'start', label: null, prevCommit: startCommit })
    if (r.ok && !r.skipped && r.commitSha) {
      this._lastCheckpointCommit = r.commitSha
      this.store?.insertCheckpoint({ id: `${this.id}:start`, sessionId: this.id, turnId: null, kind: 'start', label: null, treeSha: r.treeSha!, commitSha: r.commitSha, branch: r.branch ?? branch, createdAt: Date.now() })
    } else {
      // Empty/clean start (no change vs HEAD) → no checkpoint commit; the next turn parents to startCommit.
      this._lastCheckpointCommit = startCommit
    }
  }

  private resolveBase(base: DiffBase): { base: DiffBase; baseSha: string | null; hasSessionStart: boolean } {
    const snap = this.resolvedDiffBaseSha()
    const hasSessionStart = snap != null
    const effective: DiffBase = base === 'session-start' && hasSessionStart ? 'session-start' : 'head'
    return { base: effective, baseSha: effective === 'session-start' ? snap : null, hasSessionStart }
  }

  /** Worktree-vs-HEAD diff of the bound cwd subtree. Never throws. */
  async workspaceDiff(base: DiffBase = 'head'): Promise<workspaceGit.WorkspaceDiff & { base: DiffBase; hasSessionStart: boolean }> {
    if (!this._config.cwd) return { state: 'no_cwd', base: 'head', hasSessionStart: false }
    const b = this.resolveBase(base)
    const r = await workspaceGit.collectWorkspaceDiff(this._config.cwd, { base: b.base, baseSha: b.baseSha })
    return { ...r, base: b.base, hasSessionStart: b.hasSessionStart }
  }

  /** Summary-only diff (feeds the badge). Never throws. */
  async workspaceDiffSummary(base: DiffBase = 'head'): Promise<workspaceGit.WorkspaceDiff & { base: DiffBase; hasSessionStart: boolean }> {
    if (!this._config.cwd) return { state: 'no_cwd', base: 'head', hasSessionStart: false }
    const b = this.resolveBase(base)
    const r = await workspaceGit.collectWorkspaceDiffSummary(this._config.cwd, { base: b.base, baseSha: b.baseSha })
    return { ...r, base: b.base, hasSessionStart: b.hasSessionStart }
  }

  /** Single-file diff with custom context (for on-demand show-full). */
  async workspaceDiffFile(filePath: string, base: DiffBase = 'head', context?: number | 'full'): Promise<{ state: DiffState; file?: DiffFile; error?: string }> {
    if (!this._config.cwd) return { state: 'no_cwd' }
    const b = this.resolveBase(base)
    return workspaceGit.collectWorkspaceDiffFile(this._config.cwd, filePath, { base: b.base, baseSha: b.baseSha, context })
  }

  /** One-click `git init` + baseline commit in the bound cwd. */
  async workspaceGitInit(): Promise<{ ok: boolean; error?: string }> {
    if (!this._config.cwd) return { ok: false, error: 'no_workspace' }
    return workspaceGit.gitInit(this._config.cwd)
  }

  /** Capture a per-turn checkpoint (fire-and-forget after finalize). Persists the row and emits
   *  checkpoint:created on a non-skipped capture. Advances _lastCheckpointCommit. Never throws. */
  async captureCheckpoint(turnId: string, label: string | null, send: SendFn): Promise<void> {
    if (!this._config.cwd) return
    const prev = this._lastCheckpointCommit
    const r = await workspaceGit.captureCheckpoint(this._config.cwd, { sessionId: this.id, turnId, label, prevCommit: prev })
    if (!r.ok || r.skipped || !r.commitSha) return
    this._lastCheckpointCommit = r.commitSha
    const checkpoint = { id: `${this.id}:${turnId}`, sessionId: this.id, turnId, kind: 'turn' as const, label, treeSha: r.treeSha!, commitSha: r.commitSha, branch: r.branch ?? null, createdAt: Date.now() }
    this.store?.insertCheckpoint(checkpoint)
    if (r.branch) this.store?.setSessionBranch(this.id, r.branch)
    send({ type: 'checkpoint:created', sessionId: this.id, checkpoint })
  }

  /** List checkpoints (newest-first) + live repo state for the timeline tab. */
  async listCheckpoints(): Promise<{ checkpoints: Checkpoint[]; isGitRepo: boolean; currentBranch: string | null }> {
    const checkpoints = this.store?.listCheckpoints(this.id) ?? []
    const isGitRepo = this._config.cwd ? (await workspaceGit.getCurrentBranch(this._config.cwd)) !== null || (await workspaceGit.collectCommitLog(this._config.cwd, null)).state === 'ok' : false
    const currentBranch = this._config.cwd ? await workspaceGit.getCurrentBranch(this._config.cwd) : null
    return { checkpoints, isGitRepo, currentBranch }
  }

  /** Diff for a timeline checkpoint in one of the three modes. Tree pairs:
   *  this-turn = prev.tree → this.tree | since-then = this.tree → working | since-start = #0.tree → working. */
  async checkpointDiff(checkpointId: string, mode: CheckpointMode): Promise<workspaceGit.WorkspaceDiff> {
    if (!this._config.cwd) return { state: 'no_cwd' }
    const all = this.store?.listCheckpoints(this.id) ?? []
    const cp = all.find((c) => c.id === checkpointId)
    if (!cp) return { state: 'error', error: 'checkpoint not found' }
    // 'start' checkpoint = the session-start tree; everything is computed off tree shas.
    const startCp = all.find((c) => c.kind === 'start')
    if (mode === 'since-then') {
      // this.tree → live working tree
      return workspaceGit.collectWorkspaceDiff(this._config.cwd, { base: 'session-start', baseSha: cp.treeSha })
    }
    if (mode === 'since-start') {
      const baseSha = startCp?.treeSha ?? this._diffBaseSha
      return workspaceGit.collectWorkspaceDiff(this._config.cwd, { base: 'session-start', baseSha })
    }
    // 'this-turn': prev.tree → this.tree. prev = the checkpoint right before cp by created_at.
    const idx = all.findIndex((c) => c.id === cp.id)
    const prev = all[idx + 1] // all is newest-first → next index is the older neighbor
    const baseSha = prev?.treeSha ?? startCp?.treeSha ?? this._diffBaseSha
    return workspaceGit.collectWorkspaceDiff(this._config.cwd, { base: 'session-start', baseSha, headSha: cp.treeSha })
  }

  /** Commit log session-start..HEAD for the 更改 tab. */
  async commitLog(): Promise<{ state: DiffState; commits?: CommitLogEntry[]; error?: string }> {
    if (!this._config.cwd) return { state: 'no_cwd' }
    const start = this.store?.getSessionGitMeta(this.id).sessionStartCommit ?? null
    return workspaceGit.collectCommitLog(this._config.cwd, start)
  }

  /** Revert the worktree to a checkpoint's tree (worktree-only; HEAD untouched). Writes a mandatory
   *  pre-revert safety checkpoint first, persists it, then captures + persists a post-revert checkpoint
   *  of the restored worktree, emitting checkpoint:created for each so the timeline reflects both.
   *  Never throws. */
  async revertCheckpoint(checkpointId: string, send: SendFn): Promise<{ ok: boolean; safetyCheckpointId?: string; error?: string }> {
    if (!this._config.cwd) return { ok: false, error: 'no_workspace' }
    const all = this.store?.listCheckpoints(this.id) ?? []
    const cp = all.find((c) => c.id === checkpointId)
    if (!cp) return { ok: false, error: 'checkpoint not found' }
    const r = await workspaceGit.revertToCheckpoint(this._config.cwd, {
      sessionId: this.id, targetTree: cp.treeSha, prevCommit: this._lastCheckpointCommit ?? cp.commitSha,
    })
    if (!r.ok) return r
    // Persist the pre-revert safety checkpoint that revertToCheckpoint just wrote on the ref chain.
    if (r.safetyCheckpointId) {
      const turnId = r.safetyCheckpointId.split(':').slice(1).join(':')
      // Resolve the safety ref's commit + tree directly so we store accurate shas.
      const meta = await workspaceGit.checkpointRefMeta(this._config.cwd, this.id, turnId)
      if (meta) {
        const safety = { id: r.safetyCheckpointId, sessionId: this.id, turnId, kind: 'pre-revert' as const, label: 'pre-revert safety', treeSha: meta.treeSha, commitSha: meta.commitSha, branch: meta.branch, createdAt: Date.now() }
        this.store?.insertCheckpoint(safety)
        this._lastCheckpointCommit = meta.commitSha
        send({ type: 'checkpoint:created', sessionId: this.id, checkpoint: safety })
      }
    }
    // Capture a post-revert checkpoint of the now-restored worktree so the timeline shows the
    // post-revert state (chained onto the safety commit via _lastCheckpointCommit). A clean restore
    // may skip (nothing changed vs the safety commit) — that's fine; captureCheckpoint no-ops then.
    const postTurnId = `post-revert-${Date.now()}`
    await this.captureCheckpoint(postTurnId, 'post-revert', send)
    return r
  }

  /** List branches (+ current). For the panel's BranchSwitcher. Never throws. */
  async listBranches(): Promise<{ branches: Branch[]; currentBranch: string | null }> {
    if (!this._config.cwd) return { branches: [], currentBranch: null }
    const r = await workspaceGit.listBranches(this._config.cwd)
    const currentBranch = await workspaceGit.getCurrentBranch(this._config.cwd)
    return { branches: r.branches ?? [], currentBranch }
  }

  /** Switch the checkout to a branch (panel path). Records the new branch on the session. Never throws. */
  async switchBranch(branch: string): Promise<{ ok: boolean; currentBranch: string | null; error?: string }> {
    if (!this._config.cwd) return { ok: false, currentBranch: null, error: 'no_workspace' }
    const r = await workspaceGit.switchBranch(this._config.cwd, branch)
    const currentBranch = await workspaceGit.getCurrentBranch(this._config.cwd)
    if (r.ok) this.store?.setSessionBranch(this.id, currentBranch)
    return { ok: r.ok, currentBranch, error: r.error }
  }

  /** Emit INCOMPATIBLE_MODEL and return false when the active provider is not OpenAI-compatible.
   *  The renderer's catalog gate normally prevents selecting one, but a stale/hand-edited
   *  hip-providers.json can name e.g. `anthropic`; without this we'd build a ChatOpenAI against an
   *  incompatible endpoint and fail every turn with an opaque AGENT_ERROR. Runs before requireApiKey
   *  so the root cause (incompatibility) is surfaced even when the provider happens to have a key.
   *  Injected-model sessions (tests) are exempt — they drive arbitrary providers deliberately. */
  private requireCompatibleModel(send: SendFn): boolean {
    if (this.isExternalAgent()) return true
    if (this.usesEnvModel) {
      const { providerID } = getActiveModel()
      if (!isOpenAICompatible(providerID)) {
        send({ type: 'error', sessionId: this.id, code: 'INCOMPATIBLE_MODEL', message: `Provider "${providerID}" is not OpenAI-compatible and can't be used here. Pick an OpenAI-compatible model in Settings.` })
        return false
      }
    }
    return true
  }

  /** Emit NO_API_KEY and return false when the env-keyed active provider has no key. */
  private requireApiKey(send: SendFn): boolean {
    if (this.isExternalAgent()) return true
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

    // Persist the user message + bump/derive session metadata before running.
    const userTs = Date.now()
    let isFirstTurn = false
    if (this.store) {
      const seq = this.store.insertMessage({ id: userMessageId ?? `u-${userTs}`, sessionId: this.id, role: 'user', agentId: null, content, timestamp: userTs })
      this.store.touchSession(this.id, userTs)
      isFirstTurn = seq === 1
      if (isFirstTurn) {
        const title = deriveTitle(content)
        if (this.store.updateTitleIfAuto(this.id, title) === 1) {
          _send({ type: 'session:title', sessionId: this.id, title })
        }
      }
    }

    this.messages.push(new HumanMessage(content))
    const supervisorText = await this.runTurn(_send)

    // Auto-title refine: once, on the first turn, only while still auto-titled.
    if (isFirstTurn && this.titleGenerator && supervisorText && this.store) {
      try {
        const refined = sanitizeTitle(await this.titleGenerator({ firstUserMessage: content, firstReply: supervisorText }))
        if (refined && this.store.updateTitleIfAuto(this.id, refined) === 1) {
          _send({ type: 'session:title', sessionId: this.id, title: refined })
        }
      } catch {
        // swallow: the title is non-critical
      }
    }
  }

  /** Continue a turn that paused for user input (Option Z): append the answer to the stashed rich
   *  message list and re-invoke as a fresh turn carrying the prior step count. No-op unless awaiting. */
  async resume(content: string, send: SendFn): Promise<void> {
    if (!this.awaitingResume || !this.paused || this.running) return
    const base = { messages: [...this.paused.messages, new HumanMessage(content)], steps: this.paused.steps }
    this.awaitingResume = false
    this.paused = null
    const ts = Date.now()
    if (this.store) {
      this.store.insertMessage({ id: `u-${ts}`, sessionId: this.id, role: 'user', agentId: null, content, timestamp: ts })
      this.store.touchSession(this.id, ts)
    }
    this.messages.push(new HumanMessage(content))
    await this.runTurn(send, base)
  }

  /** Stream one turn for the HumanMessage already at the tail of this.messages.
   *  Returns the supervisor text on clean completion, or '' on abort/error. */
  private async runTurn(rawSend: SendFn, base?: { messages: BaseMessage[]; steps: number }): Promise<string> {
    this.abortController = new AbortController()
    this.running = true
    let timedOut = false
    const watchdog = new IdleWatchdog(this.idleTimeoutMs, () => { timedOut = true; this.abortController?.abort() })
    const send: SendFn = (msg) => { watchdog.kick(); rawSend(msg) }

    const turnId = `asst-supervisor-${Date.now()}-${this.turnSeq++}`
    const trajectory = new Map<string, TraceRun>()
    let agentSeq = 0
    let stepSeq = 0
    const nextSeq = () => stepSeq++
    const started = new Set<string>()
    const usageByAgent = new Map<string, TurnUsage>()
    const recorder: TraceRecorder = {
      start: (agentId, callId, name, input, seq, truncated) => {
        const r = trajectory.get(agentId)
        if (r) r.toolCalls.set(callId, { callId, agentId, name, input, status: 'running', seq, ...(truncated ? { truncated: true } : {}) })
      },
      finish: (agentId, callId, status, output, error, truncated) => {
        const tc = trajectory.get(agentId)?.toolCalls.get(callId)
        if (!tc) return
        tc.status = status
        if (output !== undefined) tc.output = output
        if (error !== undefined) tc.error = error
        if (truncated || tc.truncated) tc.truncated = true
      },
    }
    const reasoning = new ReasoningTracker(nextSeq)
    const reasoningDelta = (agentId: string, role: AgentRole, delta: string) => {
      if (!delta) return
      const burstSeq = reasoning.push(agentId, delta)
      send({ type: 'reasoning:delta', sessionId: this.id, turnId, agentId, role, stepSeq: burstSeq, delta })
    }
    const closeReasoning = (agentId: string) => {
      const burst = reasoning.close(agentId)
      if (burst) { const r = trajectory.get(agentId); if (r) r.reasoningBursts.push(burst) }
    }
    const ensureStarted = (agentId: string, role: AgentRole, parentAgentId?: string, taskInput?: string) => {
      if (started.has(agentId)) return
      started.add(agentId)
      trajectory.set(agentId, { role, output: '', startedAt: Date.now(), finishedAt: null, seq: agentSeq++, toolCalls: new Map(), reasoningBursts: [], ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
      send({ type: 'agent:started', sessionId: this.id, turnId, agentId, role, ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
    }
    const ensureFinished = (agentId: string, output: string) => {
      if (!started.has(agentId)) return
      closeReasoning(agentId)
      const r = trajectory.get(agentId)
      if (r) { r.output = output; r.finishedAt = Date.now() }
      started.delete(agentId)
      send({ type: 'agent:finished', sessionId: this.id, turnId, agentId })
    }
    const finishRemaining = () => {
      for (const id of started) {
        closeReasoning(id)
        const r = trajectory.get(id); if (r) r.finishedAt = Date.now()
        send({ type: 'agent:finished', sessionId: this.id, turnId, agentId: id })
      }
      started.clear()
    }

    let supervisorText = ''
    ensureStarted('supervisor', 'supervisor')

    const cwd = this._config.cwd ?? process.cwd()
    const runner = this.modelRunner()
    const summarizer = this.summarizer()
    // Pre-turn MCP reconcile + enabled-skills scan (mirrors the per-turn agents re-read). Both are
    // best-effort and never throw into the turn. ACP/CLI external turns skip this — they don't use
    // hip's own toolset (the isExternalAgent branch below ignores `tools`).
    let skills: ReturnType<typeof readEnabledSkills> = []
    if (!this.isExternalAgent()) {
      try { await mcpManager.reconcile(readMcpServersConfig()) } catch { /* degrade: skip MCP tools */ }
      try { skills = readEnabledSkills() } catch { skills = [] }
    }
    const system = buildSystemPrompt({ cwd, userInstructions: this._config.systemPrompt, skills })
    const makeEmit = (agentId: string, role: AgentRole): GraphEmit => ({
      token: (delta) => {
        if (!delta) return
        if (agentId === 'supervisor') supervisorText += delta
        const r = trajectory.get(agentId); if (r) r.output += delta
        send({ type: 'token:stream', sessionId: this.id, turnId, agentId, delta })
      },
      reasoning: (delta) => reasoningDelta(agentId, role, delta),
      toolStarted: (name, callId, input) => {
        closeReasoning(agentId)
        const seq = nextSeq()
        const inClip = clip(stringify(input))
        recorder.start(agentId, callId, name, inClip.text, seq, inClip.truncated)
        send({ type: 'tool:started', sessionId: this.id, turnId, agentId, role, callId, name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) })
      },
      toolFinished: (callId, status, output, error) => {
        const outClip = output !== undefined ? clip(stringify(output)) : undefined
        recorder.finish(agentId, callId, status, outClip?.text, error, outClip?.truncated ?? false)
        send({ type: 'tool:finished', sessionId: this.id, turnId, agentId, callId, status, ...(outClip ? { output: outClip.text } : {}), ...(error ? { error } : {}), ...(outClip?.truncated ? { truncated: true } : {}) })
      },
      usage: (u) => { usageByAgent.set(agentId, addUsage(usageByAgent.get(agentId), u)) },
    })
    const emit = makeEmit('supervisor', 'supervisor')
    let subagentSeq = 0
    const spawnSubagent = async (description: string): Promise<string> => {
      const childId = `worker-${++subagentSeq}`
      ensureStarted(childId, 'worker', 'supervisor', description)
      const text = await runSubagent({
        runner,
        root: cwd,
        summarizer,
        emit: makeEmit(childId, 'worker'),
        signal: this.abortController!.signal,
        description,
        childMaxSteps: CHILD_MAX_STEPS,
      })
      ensureFinished(childId, text)
      return text
    }

    // dispatch_agent: run a configured external agent as a nested sub-agent (role 'subagent',
    // parent 'supervisor'), streaming its events through makeEmit and surfacing its HITL requests.
    const enabledAgents = readAgentsConfig().filter((a) => a.enabled && a.id !== 'builtin')
    const invoker = this.invokerFactory(cwd)
    // HITL closure for the run_script tool (and dispatched internal agents): registers a pending
    // permission (same map + channel the external-agent and dispatch HITL paths use) and resolves on
    // the user's permission:respond. The turn-end / abort drain in `finally` settles any still-pending
    // request with {cancelled}. `turnId` and `nextSeq` are already in scope from the turn preamble.
    // The advertised options below use optionId === kind, so map the user's returned optionId straight
    // to a PermissionOption.kind-shaped ApprovalDecision (tools.ts keys allow-vs-reject off `kind`).
    const options = [
      { optionId: 'allow_once', name: '允许', kind: 'allow_once' },
      { optionId: 'reject_once', name: '拒绝', kind: 'reject_once' },
    ]
    const requestApproval: ApprovalFn = (req) =>
      new Promise((resolve) => {
        const requestId = `run-script-${turnId}-${nextSeq()}`
        this.pendingPermissions.set(requestId, (choice) => {
          if ('cancelled' in choice) { resolve({ cancelled: true }); return }
          const kind = options.find((o) => o.optionId === choice.optionId)?.kind ?? choice.optionId
          resolve({ kind })
        })
        send({
          type: 'permission:request',
          sessionId: this.id,
          turnId,
          requestId,
          tool: { title: req.title, kind: req.kind, content: req.content },
          options,
        })
      })
    const dispatchAgent = async (agentId: string, task: string): Promise<string> => {
      const cfg = enabledAgents.find((a) => a.id === agentId)
      if (!cfg) return `Error: unknown or disabled agent ${agentId}`
      const childId = `subagent-${++subagentSeq}`
      ensureStarted(childId, 'subagent', 'supervisor', task)
      const hooks: ExternalAgentHooks = {
        requestPermission: (req) =>
          new Promise((resolve) => {
            this.pendingPermissions.set(req.requestId, resolve)
            send({
              type: 'permission:request', sessionId: this.id, turnId,
              requestId: req.requestId, tool: req.tool, options: req.options,
              agentFrame: { agentId: childId, parentAgentId: 'supervisor', name: cfg.name },
            })
          }),
        // The supervisor owns the model picker; a transient delegate's config selectors are dropped.
        configOptions: () => {},
      }
      try {
        const text = await invoker.invoke(agentId, task, makeEmit(childId, 'subagent'), this.abortController!.signal, hooks, { mcpTools: mcpManager.tools(), skills, requestApproval })
        ensureFinished(childId, text)
        return text || '(sub-agent produced no output)'
      } catch (err) {
        // Let cancellation/timeout abort the whole turn (matches the non-catching worker path) —
        // do NOT launder an AbortError into a tool result, or the supervisor would resume instead of stopping.
        if (err instanceof Error && err.name === 'AbortError') throw err
        const msg = err instanceof Error ? err.message : String(err)
        ensureFinished(childId, `Error: ${msg}`)
        return `Error: ${msg}`
      }
    }

    const tools = buildTools(
      cwd,
      spawnSubagent,
      this._config.cwd,
      enabledAgents.length
        ? { agents: enabledAgents.map((a) => ({ id: a.id, name: a.name, description: a.description })), run: dispatchAgent }
        : undefined,
      { mcpTools: mcpManager.tools(), skills, requestApproval },
    )
    const ctx: GraphCtx = { runner, tools, emit, summarizer }

    try {
      if (this.isExternalAgent()) {
        // External-agent turn: dispatch to the provider, which streams tokens/reasoning/tool events
        // back through the SAME `emit` (so supervisorText accumulates) and resolves on end-of-turn.
        // No awaiting_user path — external agents drive HITL via the hooks below.
        const userText = lastUserText(base?.messages ?? this.messages)
        const hooks: ExternalAgentHooks = {
          requestPermission: (req) => new Promise((resolve) => {
            this.pendingPermissions.set(req.requestId, resolve)
            send({ type: 'permission:request', sessionId: this.id, turnId, requestId: req.requestId, tool: req.tool, options: req.options })
          }),
          configOptions: (options) => send({ type: 'agent:configOptions', sessionId: this.id, options }),
        }
        await this.ensureExternalProvider().runTurn(userText, emit, this.abortController.signal, hooks)
        closeReasoning('supervisor')
        finishRemaining()
        // Persist the ACP session handle (assigned on the first turn) so a reopened session resumes it.
        const acpId = (this.externalProvider as { sessionId?: string | null }).sessionId
        if (acpId && this.store) this.store.setAcpSessionId(this.id, acpId)
      } else {
        const finalState = await this.app.invoke(
          { messages: [new SystemMessage(system), ...(base?.messages ?? this.messages)], steps: base?.steps ?? 0, recentSigs: [], nudgedSig: undefined, status: 'running' },
          { configurable: { ctx }, signal: this.abortController.signal, recursionLimit: recursionLimit() },
        )
        closeReasoning('supervisor')
        finishRemaining()
        if (finalState.status === 'awaiting_user') {
          // Stash the rich graph history (minus the leading system msg) so resume re-plans with full
          // context, finalize this turn as stopped, and ask the user. The finally below stops the
          // watchdog and clears `running`; `awaitingResume` makes the next user message a resume.
          this.paused = { messages: finalState.messages.slice(1), steps: finalState.steps }
          this.awaitingResume = true
          const stoppedText = this.finalizeAndPersist(send, turnId, supervisorText, trajectory, true, usageByAgent)
          send({ type: 'agent:interrupt', sessionId: this.id, turnId, agentId: 'supervisor', question: finalState.pendingQuestion ?? PAUSE_QUESTION })
          return stoppedText
        }
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      finishRemaining()
      if (isAbort && supervisorText) {
        const text = this.finalizeAndPersist(rawSend, turnId, supervisorText, trajectory, true, usageByAgent)
        if (timedOut) rawSend({ type: 'error', sessionId: this.id, code: 'TIMEOUT', message: '' })
        return text
      }
      rawSend({
        type: 'error',
        sessionId: this.id,
        code: timedOut ? 'TIMEOUT' : isAbort ? 'CANCELLED' : 'AGENT_ERROR',
        message: timedOut ? '' : isAbort ? 'User cancelled the request' : err instanceof Error ? err.message : String(err),
      })
      return ''
    } finally {
      watchdog.stop()
      this.running = false
      this.abortController = null
      // Settle any HITL permission requests still outstanding at turn end / abort: resolve each with
      // {cancelled} so the external agent's blocked tool unblocks and the pending map never leaks.
      if (this.pendingPermissions.size) {
        for (const resolve of this.pendingPermissions.values()) resolve({ cancelled: true })
        this.pendingPermissions.clear()
      }
    }

    const finalText = this.finalizeAndPersist(send, turnId, supervisorText, trajectory, false, usageByAgent)
    // Per-turn checkpoint AFTER persistence (writes are done). Fire-and-forget — never block the
    // send path or let a git failure surface as a turn error. Label = a short slice of the reply.
    const ckptLabel = (finalText || '').replace(/\s+/g, ' ').trim().slice(0, 72) || null
    void this.captureCheckpoint(turnId, ckptLabel, send).catch(() => {})
    return finalText
  }

  /** Run the phantom-write safety net, push the assistant message into context, persist the turn
   *  (with its timeline), and emit message:complete. Returns the final (possibly corrected) text. */
  private finalizeAndPersist(send: SendFn, turnId: string, supervisorText: string, trajectory: Map<string, TraceRun>, stopped: boolean, usageByAgent?: Map<string, TurnUsage>): string {
    const { correction } = verifyWrites(trajectory, supervisorText, this._config.language ?? 'en')
    const finalText = correction ? `${supervisorText}\n\n${correction}` : supervisorText
    if (finalText) this.messages.push(new AIMessage(finalText))
    const ts = Date.now()
    const runs: AgentRun[] = trajectoryToRuns(trajectory).map((r) => {
      const u = usageByAgent?.get(r.agentId)
      return { ...r, messageId: turnId, ...(u ? { usage: u } : {}) }
    })
    const turnUsage = sumUsage(runs.map((r) => r.usage))
    const timeline = trajectoryToTimeline(trajectory)
    const toolCalls = runs.flatMap((r) => r.toolCalls ?? []).sort((a, b) => a.seq - b.seq)
    if (this.store) {
      this.store.insertTurn(
        finalText ? { id: turnId, sessionId: this.id, agentId: 'supervisor', content: finalText, timestamp: ts, stopped, timeline } : null,
        this.id,
        runs,
      )
      this.store.touchSession(this.id, ts)
    }
    send({
      type: 'message:complete',
      sessionId: this.id,
      message: { id: turnId, role: 'assistant', content: finalText, agentId: 'supervisor', timestamp: ts, timeline, toolCalls, agentRuns: runs, ...(turnUsage ? { usage: turnUsage } : {}), ...(stopped ? { stopped: true } : {}) },
    })
    return finalText
  }

  /** Re-run the last turn: drop the trailing assistant reply (if any) and stream a fresh one. */
  async regenerate(send: SendFn): Promise<void> {
    if (this.running || this.awaitingResume) return
    if (!this.requireCompatibleModel(send)) return
    if (!this.requireApiKey(send)) return
    const tail = this.messages[this.messages.length - 1]
    if (tail instanceof AIMessage) {
      this.messages.pop()
      this.store?.deleteLastAssistantMessage(this.id)
    }
    // After dropping an assistant reply, the tail must be the user turn to redo.
    if (!(this.messages[this.messages.length - 1] instanceof HumanMessage)) return
    await this.runTurn(send)
  }

  cancel(): void {
    if (this.awaitingResume) { this.awaitingResume = false; this.paused = null; return }
    this.abortController?.abort()
  }

  destroy(): void {
    this.cancel()
    this.externalProvider?.dispose()
    this.externalProvider = null
  }
}
