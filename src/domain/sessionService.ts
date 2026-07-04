// src/domain/sessionService.ts
import type { ServerMessage, SessionConfig, DiffBase, CheckpointMode, PermissionMode } from '@hip/protocol'
import { nanoid } from 'nanoid'
import type { Transport } from './transport'
import { WsTransport } from './wsTransport'
import { useDomainStore, DEFAULT_CONFIG } from './sessionStore'
import { useFsStore } from '@/store/fsStore'
import { useDraftStore } from '@/store/draftStore'
import type { Draft } from '@/store/draftStore'
import { useUiStore, type Surface } from '@/store/uiStore'
import { useDiffStore } from '@/store/diffStore'
import i18n from '@/i18n'
import { resolveModelConfig } from '@/lib/modelKey'
import { useProvidersStore } from '@/store/providersStore'
import { surfaceOf } from '@/lib/sessions'
import type { LocalAttachment } from '@/components/chat/attachmentTypes'

/** Map the current i18next language to one of the three SessionConfig-supported values. */
function currentLanguage(): 'en' | 'zh-CN' | 'zh-TW' {
  const l = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  return l === 'zh-CN' || l === 'zh-TW' ? l : 'en'
}

export class SessionService {
  private readonly transport: Transport
  private readonly unsubscribe: () => void
  private readonly unsubStatus: () => void

  constructor(transport: Transport) {
    this.transport = transport
    this.unsubscribe = this.transport.onMessage((msg: ServerMessage) => this.receive(msg))
    this.unsubStatus = this.transport.onStatus((s) => useDomainStore.getState().setConnection(s))
  }

  dispose(): void {
    this.unsubscribe()
    this.unsubStatus()
  }

  async connect(): Promise<void> {
    try {
      await this.transport.connect()
    } catch (e) {
      console.error('[SessionService] connect failed', e)
      useDomainStore.getState().setConnection('error')
    }
  }

  reconnect(): void {
    void this.connect()
  }

  /** Stop the transport's connect/reconnect loop (e.g. on AppLayout unmount). */
  disconnect(): void {
    this.transport.disconnect()
  }

  private receive(msg: ServerMessage): void {
    useDomainStore.getState().apply(msg)
    if (msg.type === 'ready') {
      useDiffStore.getState().resetTransient()
      this.transport.send({ type: 'session:list' })
      this.resyncActiveIfRunning()
    } else if (msg.type === 'fs:ls:result') {
      useFsStore.getState().setEntries(msg.sessionId, msg.path, msg.entries)
    } else if (msg.type === 'fs:read:result') {
      useFsStore.getState().setPreview(msg.sessionId, {
        status: 'ready', path: msg.path, content: msg.content, encoding: msg.encoding, mimeType: msg.mimeType, truncated: msg.truncated, error: msg.error,
      })
    } else if (msg.type === 'fs:lsCwd:result') {
      useFsStore.getState().setEntries(msg.cwd, msg.path, msg.entries)
    } else if (msg.type === 'fs:readCwd:result') {
      useFsStore.getState().setPreview(msg.cwd, {
        status: 'ready', path: msg.path, content: msg.content, encoding: msg.encoding, mimeType: msg.mimeType, truncated: msg.truncated, error: msg.error,
      })
    } else if (msg.type === 'fs:diff:result') {
      useDiffStore.getState().setResult(msg.sessionId, { state: msg.state, files: msg.files, summary: msg.summary, base: msg.base, hasSessionStart: msg.hasSessionStart, error: msg.error })
    } else if (msg.type === 'fs:diffSummary:result') {
      if (msg.summary) useDiffStore.getState().setSummary(msg.sessionId, msg.summary, msg.base, msg.hasSessionStart)
    } else if (msg.type === 'fs:diffFile:result') {
      if (msg.file) useDiffStore.getState().setFileExpanded(msg.sessionId, msg.path, msg.file)
    } else if (msg.type === 'fs:gitInit:result') {
      useDiffStore.getState().setInitPending(msg.sessionId, false)
      if (msg.ok) {
        // Init flipped the cwd into a repo; refresh the repo gate so the git-gated tabs appear.
        this.requestDiff(msg.sessionId)
        this.requestCheckpoints(msg.sessionId)
      } else {
        useDiffStore.getState().setResult(msg.sessionId, { state: 'not_a_repo', base: 'head', hasSessionStart: false, error: msg.error })
      }
    } else if (msg.type === 'git:checkpoint:list:result') {
      useDiffStore.getState().setCheckpoints(msg.sessionId, msg.checkpoints, msg.isGitRepo, msg.currentBranch)
    } else if (msg.type === 'checkpoint:created') {
      useDiffStore.getState().addCheckpoint(msg.sessionId, msg.checkpoint)
    } else if (msg.type === 'git:checkpoint:diff:result') {
      useDiffStore.getState().setCheckpointDiffResult(msg.sessionId, `${msg.checkpointId}|${msg.mode}`, { state: msg.state, files: msg.files, summary: msg.summary, error: msg.error })
    } else if (msg.type === 'git:commitLog:result') {
      useDiffStore.getState().setCommitLogResult(msg.sessionId, { state: msg.state, commits: msg.commits, error: msg.error })
    } else if (msg.type === 'git:branch:list:result') {
      useDiffStore.getState().setBranches(msg.sessionId, msg.branches, msg.currentBranch)
    } else if (msg.type === 'git:branch:switch:result') {
      if (msg.ok) {
        useDiffStore.getState().setBranches(msg.sessionId, useDiffStore.getState().bySession[msg.sessionId]?.branches ?? [], msg.currentBranch)
        // Working tree changed → the live-tree-relative checkpoint diffs are now stale.
        useDiffStore.getState().clearCheckpointDiffCache(msg.sessionId)
        // Branch changed → re-pull branches (current flag) + checkpoints (branch labels) + diff summary.
        this.transport.send({ type: 'git:branch:list', sessionId: msg.sessionId })
        this.transport.send({ type: 'git:checkpoint:list', sessionId: msg.sessionId })
        const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
        this.transport.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
      } else {
        // Failure (e.g. a dirty tree) → record the error so the confirm modal can clear its spinner
        // and surface it, instead of bricking the modal on a stuck 'switching' state.
        useDiffStore.getState().setSwitchError(msg.sessionId, msg.error ?? 'switch_failed')
      }
    } else if (msg.type === 'git:revert:result') {
      if (msg.ok) {
        // Worktree changed → the live-tree-relative checkpoint diffs are now stale.
        useDiffStore.getState().clearCheckpointDiffCache(msg.sessionId)
        // Worktree changed → refresh the checkpoint list (safety checkpoint was added) + diff badge.
        this.transport.send({ type: 'git:checkpoint:list', sessionId: msg.sessionId })
        const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
        this.transport.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
      } else {
        // Failure → record the error so the confirm modal can clear its 'reverting' spinner + surface it.
        useDiffStore.getState().setRevertError(msg.sessionId, msg.error ?? 'revert_failed')
      }
    } else if (msg.type === 'session:created') {
      const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
      this.transport.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
      this.transport.send({ type: 'git:checkpoint:list', sessionId: msg.sessionId })
    } else if (msg.type === 'session:cwd') {
      const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
      this.transport.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
      this.transport.send({ type: 'git:checkpoint:list', sessionId: msg.sessionId })
    } else if (msg.type === 'message:complete') {
      // The agent may have written files this turn — re-pull every loaded dir + the open file.
      const fsState = useFsStore.getState().bySession[msg.sessionId]
      if (fsState) {
        for (const dir of Object.keys(fsState.entriesByDir)) this.transport.send({ type: 'fs:ls', sessionId: msg.sessionId, path: dir })
        if (fsState.activePath) this.transport.send({ type: 'fs:read', sessionId: msg.sessionId, path: fsState.activePath })
      }
      // 改完文件 → 工作区变了,相对实时工作树的检查点 diff 缓存失效。
      useDiffStore.getState().clearCheckpointDiffCache(msg.sessionId)
      // 改完文件 → 总是刷新角标(便宜) + 检查点列表(新一轮可能新建了 checkpoint)。
      const base = useDiffStore.getState().bySession[msg.sessionId]?.base ?? 'session-start'
      this.transport.send({ type: 'fs:diffSummary', sessionId: msg.sessionId, base })
      this.transport.send({ type: 'git:checkpoint:list', sessionId: msg.sessionId })
      const tab = useUiStore.getState().activeTab
      if (tab === 'changes') { this.requestDiff(msg.sessionId); this.requestCommitLog(msg.sessionId) }
    } else if (msg.type === 'compact:result') {
      if (msg.ok) {
        useDomainStore.getState().appendMessage(msg.sessionId, {
          id: nanoid(),
          role: 'assistant',
          content: `Conversation compacted: ${msg.messagesBefore} messages → ${msg.messagesAfter} messages`,
          timestamp: Date.now(),
        })
      }
    }
  }

  createSession(config: SessionConfig = DEFAULT_CONFIG): string {
    const id = nanoid()
    const enriched: SessionConfig = { ...config, language: currentLanguage() }
    useDomainStore.getState().createSession(id, enriched)
    this.rememberActiveForSurface(id)
    useUiStore.getState().addOpenSession(id)
    this.transport.send({ type: 'session:create', id, config: enriched })
    return id
  }

  selectSession(id: string, messageId?: string): void {
    useDomainStore.getState().selectSession(id)
    useUiStore.getState().addOpenSession(id)
    useUiStore.getState().setSelectedArtifactPath(null)
    const s = useDomainStore.getState().sessions.find((x) => x.id === id)
    if (s) {
      useUiStore.getState().setActiveView(surfaceOf(s.config))
      this.rememberActiveForSurface(id)
    }
    // Lazily fetch history the first time a summary-only session is opened.
    if (s && !s.loaded) this.transport.send({ type: 'session:load', sessionId: id })
    // Refresh the Diff-tab change badge on open (cheap numstat) so pending changes are
    // advertised without the user first opening the Diff tab. No-cwd/non-repo → no summary → no badge.
    const base = useDiffStore.getState().bySession[id]?.base ?? 'session-start'
    this.transport.send({ type: 'fs:diffSummary', sessionId: id, base })
    // Pull the checkpoint list (cheap; also tells the panel whether the cwd is a git repo → tab gating).
    this.transport.send({ type: 'git:checkpoint:list', sessionId: id })
    // Carry a clicked search hit's message into the scroll target; a plain select clears any stale one.
    useUiStore.getState().setScrollTarget(messageId ?? null)
  }

  /** Remember the currently-open conversation for the active surface (so returning restores it,
   *  and so Code's persisted last-conversation pointer stays fresh across launches). */
  private rememberActiveForSurface(id: string | null): void {
    const view = useUiStore.getState().activeView
    if (view === 'chat') useUiStore.getState().setChatSessionId(id)
    else if (view === 'code') useUiStore.getState().setCodeSessionId(id)
  }

  /** Switch the active top-level surface. Snapshots the leaving surface's open conversation, then
   *  restores the entering surface's (validated against the loaded list + its surface). Code restores
   *  its last conversation; Chat starts at new-conversation on cold launch (chatSessionId starts null). */
  setSurface(view: Surface): void {
    const cur = useUiStore.getState().activeView
    const activeId = useDomainStore.getState().activeSessionId
    if (cur === 'chat') useUiStore.getState().setChatSessionId(activeId)
    else if (cur === 'code') useUiStore.getState().setCodeSessionId(activeId)
    useUiStore.getState().setActiveView(view)
    if (view === 'chat' && useDraftStore.getState().draft?.mode === 'project') {
      useDraftStore.getState().clearProject()
    }
    const want = view === 'chat' ? useUiStore.getState().chatSessionId : useUiStore.getState().codeSessionId
    const sessions = useDomainStore.getState().sessions
    if (want != null && sessions.some((s) => s.id === want && surfaceOf(s.config) === view)) {
      this.selectSession(want)
    } else {
      useDomainStore.getState().deselect()
    }
  }

  /** Update the active surface without restoring a remembered session. Used on the New Conversation
   *  page, where the user is choosing the surface for a *new* draft rather than returning to history. */
  previewSurface(view: Surface): void {
    useUiStore.getState().setActiveView(view)
    if (view === 'chat' && useDraftStore.getState().draft?.mode === 'project') {
      useDraftStore.getState().clearProject()
    }
  }

  closeSession(id: string): void {
    const wasActive = useDomainStore.getState().activeSessionId === id
    const ids = useUiStore.getState().openSessionIds
    const index = ids.indexOf(id)
    useUiStore.getState().removeOpenSession(id)
    this.deleteSession(id)
    const remaining = useUiStore.getState().openSessionIds
    if (wasActive && remaining.length > 0) {
      const nextIndex = Math.min(index, remaining.length - 1)
      this.selectSession(remaining[nextIndex])
    } else if (remaining.length === 0) {
      useDomainStore.getState().deselect()
      useUiStore.getState().setChatSessionId(null)
      useUiStore.getState().setCodeSessionId(null)
    }
  }

  deleteSession(id: string): void {
    useUiStore.getState().removeOpenSession(id)
    useDomainStore.getState().deleteSession(id)
    if (useUiStore.getState().chatSessionId === id) useUiStore.getState().setChatSessionId(null)
    if (useUiStore.getState().codeSessionId === id) useUiStore.getState().setCodeSessionId(null)
    // The domain delete-fallback may auto-select sessions[0] from the GLOBAL list, which can belong
    // to the other surface. Reconcile: if the now-active session doesn't match the current surface,
    // pick the newest same-surface session, else show new-conversation.
    const view = useUiStore.getState().activeView
    if (view === 'chat' || view === 'code') {
      const st = useDomainStore.getState()
      const cur = st.sessions.find((s) => s.id === st.activeSessionId)
      if (!cur || surfaceOf(cur.config) !== view) {
        const next = st.sessions.find((s) => surfaceOf(s.config) === view)
        if (next) this.selectSession(next.id)
        else { useDomainStore.getState().deselect(); this.rememberActiveForSurface(null) }
      }
    }
    this.transport.send({ type: 'session:delete', sessionId: id })
  }

  renameSession(id: string, title: string): void {
    useDomainStore.getState().renameSession(id, title)
    this.transport.send({ type: 'session:rename', sessionId: id, title })
  }

  setProjectDir(id: string, cwd: string): void {
    useDomainStore.getState().apply({ type: 'session:cwd', sessionId: id, cwd }) // optimistic
    useFsStore.getState().clearSession(id)
    useDiffStore.getState().clearSession(id)
    this.transport.send({ type: 'session:setCwd', sessionId: id, cwd })
  }

  setThinking(id: string, thinking: boolean): void {
    useDomainStore.getState().apply({ type: 'session:thinking', sessionId: id, thinking }) // optimistic
    this.transport.send({ type: 'session:setThinking', sessionId: id, thinking })
  }

  setPermissionMode(id: string, mode: PermissionMode): void {
    useDomainStore.getState().apply({ type: 'session:permissionMode', sessionId: id, permissionMode: mode }) // optimistic
    this.transport.send({ type: 'session:setPermissionMode', sessionId: id, permissionMode: mode })
  }

  setSystemPrompt(id: string, systemPrompt: string | null): void {
    useDomainStore.getState().apply({ type: 'session:systemPrompt', sessionId: id, systemPrompt }) // optimistic
    this.transport.send({ type: 'session:setSystemPrompt', sessionId: id, systemPrompt })
  }

  /** Switch the global current model live (no sidecar restart). */
  setActiveModel(providerID: string, modelID: string, baseURL: string): void {
    this.transport.send({ type: 'config:setActiveModel', providerID, modelID, baseURL })
  }

  /** Switch the active session's model mid-conversation. Resolves the modelKey to llmProvider /
   *  model / baseURL, sends session:setModel to the sidecar (which also updates the global active
   *  model), and optimistically updates the session's config. */
  setSessionModel(modelKey: string): void {
    const { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) return
    const { catalog, config } = useProvidersStore.getState()
    const { llmProvider, model, baseURL } = resolveModelConfig(catalog, config, modelKey)
    // Optimistic — the sidecar echoes session:model to confirm.
    useDomainStore.getState().apply({ type: 'session:model', sessionId: activeSessionId, llmProvider, model })
    this.transport.send({ type: 'session:setModel', sessionId: activeSessionId, llmProvider, model, baseURL })
  }

  /** Switch a live ACP-agent config selector (model/mode); the agent re-advertises via agent:configOptions. */
  setAgentConfigOption(sessionId: string, configId: string, value: string): void {
    this.transport.send({ type: 'agent:setConfigOption', sessionId, configId, value })
  }

  /** Answer a pending HITL tool-permission request: forward the user's choice (a chosen optionId, or
   *  a cancellation) so the blocked tool proceeds or is denied. The caller clears the local queue. */
  respondPermission(sessionId: string, requestId: string, choice: { optionId: string } | { cancelled: true }): void {
    this.transport.send({ type: 'permission:respond', sessionId, requestId, ...('optionId' in choice ? { optionId: choice.optionId } : { cancelled: true }) })
  }

  /** Compact the in-memory conversation history (summarize the middle), freeing token budget
   *  for longer sessions. Fires a message:compact WS message; the backend responds with a
   *  compact:result that injects an informational message into the session. */
  compactSession(sessionId: string): void {
    this.transport.send({ type: 'message:compact', sessionId })
  }

  /** Pull the workspace diff. In-flight dedupe: a second request while loading is dropped. */
  requestDiff(sessionId: string, base?: DiffBase): void {
    const cur = useDiffStore.getState().bySession[sessionId]
    if (cur?.status === 'loading') return
    const b = base ?? cur?.base ?? 'session-start'
    useDiffStore.getState().setLoading(sessionId)
    this.transport.send({ type: 'fs:diff', sessionId, base: b })
  }

  /** Request a single file's full diff (for on-demand show-full). */
  requestDiffFile(sessionId: string, p: string, context: number | 'full' = 'full'): void {
    const base = useDiffStore.getState().bySession[sessionId]?.base ?? 'session-start'
    this.transport.send({ type: 'fs:diffFile', sessionId, path: p, base, context })
  }

  /** One-click `git init` for a non-repo cwd; a successful result chains a fresh diff. */
  gitInitWorkspace(sessionId: string): void {
    useDiffStore.getState().setInitPending(sessionId, true)
    this.transport.send({ type: 'fs:gitInit', sessionId })
  }

  /** Pull the checkpoint list (+ isGitRepo / current branch) for the timeline tab + tab gating. */
  requestCheckpoints(sessionId: string): void {
    this.transport.send({ type: 'git:checkpoint:list', sessionId })
  }

  /** Pull a checkpoint's diff in a given mode. Caches by `${id}|${mode}`; re-request always allowed. */
  requestCheckpointDiff(sessionId: string, checkpointId: string, mode: CheckpointMode): void {
    useDiffStore.getState().setCheckpointDiffLoading(sessionId, `${checkpointId}|${mode}`)
    this.transport.send({ type: 'git:checkpoint:diff', sessionId, checkpointId, mode })
  }

  /** Pull the session-start..HEAD commit log for the 更改 tab. */
  requestCommitLog(sessionId: string): void {
    useDiffStore.getState().setCommitLogLoading(sessionId)
    this.transport.send({ type: 'git:commitLog', sessionId })
  }

  /** Pull the branch list (+ current) for the BranchSwitcher. */
  requestBranches(sessionId: string): void {
    this.transport.send({ type: 'git:branch:list', sessionId })
  }

  /** Switch the checkout to a branch. The :result re-pulls branches + checkpoints + diff. */
  switchBranch(sessionId: string, branch: string): void {
    this.transport.send({ type: 'git:branch:switch', sessionId, branch })
  }

  /** Revert the worktree to a checkpoint (worktree-only; a safety checkpoint is written first). */
  revertCheckpoint(sessionId: string, checkpointId: string): void {
    this.transport.send({ type: 'git:revert', sessionId, checkpointId })
  }

  lsDir(sessionId: string, path: string): void {
    this.transport.send({ type: 'fs:ls', sessionId, path })
  }

  readFile(sessionId: string, path: string): void {
    useFsStore.getState().setPreview(sessionId, { status: 'loading', path })
    this.transport.send({ type: 'fs:read', sessionId, path })
  }

  /** Start a fresh new-conversation draft (no committed session yet). */
  newConversation(surface?: Surface): void {
    useDraftStore.getState().ensureDraft(surface)
    useDraftStore.getState().setText('')
    useDomainStore.getState().deselect()
    this.rememberActiveForSurface(null)
  }

  // Draft FS: fsStore is keyed by an arbitrary scope string — a committed session's
  // nanoid id, or (for an un-committed draft) its absolute cwd. The two never collide.
  /** List a directory for an un-committed draft (cwd-keyed, no session). */
  lsDraft(cwd: string, path: string): void {
    this.transport.send({ type: 'fs:lsCwd', cwd, path })
  }

  /** Read a file for an un-committed draft (cwd-keyed). Preview is keyed by cwd. */
  readDraftFile(cwd: string, path: string): void {
    useFsStore.getState().setPreview(cwd, { status: 'loading', path })
    this.transport.send({ type: 'fs:readCwd', cwd, path })
  }

  search(query: string): void {
    useDomainStore.getState().setSearching(query.trim().length > 0)
    this.transport.send({ type: 'session:search', query })
  }

  sendMessage(content: string, attachments: LocalAttachment[] = []): void {
    const text = content.trim()
    if (!text && attachments.length === 0) return
    const st = useDomainStore.getState()
    const active = st.sessions.find((s) => s.id === st.activeSessionId)
    if (active?.interrupt) { this.resume(text, attachments); return }
    let { activeSessionId } = st
    if (!activeSessionId) {
      // Commit the draft: create a real (persisted) session, then send.
      const draft = useDraftStore.getState().draft
      const config: SessionConfig = configFromDraft(draft)
      activeSessionId = this.createSession(config)
      if (draft?.cwd) useFsStore.getState().clearSession(draft.cwd)
      useDraftStore.getState().reset()
    }
    const id = nanoid()
    useDomainStore.getState().appendUserMessage(activeSessionId, id, text, attachments)
    this.transport.send({
      type: 'message:send',
      sessionId: activeSessionId,
      id,
      content: text,
      role: 'user',
      attachments: attachments.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, path: a.path })),
    })
  }

  /** Answer a paused turn's question: append the reply to the transcript (clears the interrupt) and
   *  send it as message:resume so the sidecar continues the loop. */
  resume(content: string, attachments: LocalAttachment[] = []): void {
    const text = content.trim()
    if (!text && attachments.length === 0) return
    const { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) return
    const id = nanoid()
    useDomainStore.getState().appendUserMessage(activeSessionId, id, text, attachments)
    this.transport.send({
      type: 'message:resume',
      sessionId: activeSessionId,
      content: text,
      ...(attachments.length ? { attachments: attachments.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, path: a.path })) } : {}),
    })
  }

  /** Respond to a plan approval interrupt (approve / reject / amend). */
  respondPlan(action: 'approve' | 'reject' | 'amend', amendContent?: string): void {
    const { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) return
    this.transport.send({ type: 'plan:respond', sessionId: activeSessionId, action, amendContent })
  }

  cancel(): void {
    const { activeSessionId } = useDomainStore.getState()
    if (activeSessionId) this.transport.send({ type: 'message:cancel', sessionId: activeSessionId })
  }

  regenerate(): void {
    const { activeSessionId, sessions } = useDomainStore.getState()
    if (!activeSessionId) return
    const sess = sessions.find((x) => x.id === activeSessionId)
    if (!sess) return
    if (sess.status === 'running' && !sess.interrupt) return
    // The sidecar decides whether to dispatch image turns to an internal multimodal agent.
    // The frontend no longer switches the session model.
    useDomainStore.getState().regenerateLastTurn(activeSessionId)
    this.transport.send({ type: 'message:regenerate', sessionId: activeSessionId })
  }

  /** On (re)connect, if the active session had an in-flight turn, force a history resync so a
   *  turn that finished/was interrupted during the outage is reconciled (see the session:loaded
   *  reducer). The resync REPLACES optimistic in-memory messages with the persisted truth: the
   *  user message is persisted before the turn runs (so it is never lost), and an unfinished
   *  assistant reply reconciles to "interrupted + retry" rather than a stuck spinner. */
  private resyncActiveIfRunning(): void {
    const { activeSessionId, sessions } = useDomainStore.getState()
    if (!activeSessionId) return
    const s = sessions.find((x) => x.id === activeSessionId)
    if (s?.status === 'running') this.transport.send({ type: 'session:load', sessionId: activeSessionId })
  }
}

/** Build the committed SessionConfig from the current draft. Surface is derived from the draft
 *  mode — a project draft (folder picked) is a Code conversation; a chat draft is a sandboxed
 *  Chat conversation. The Chat new-conversation view keeps chat drafts in chat mode, so the chat
 *  branch never carries a cwd/permissionMode (Chat is picker-less). */
export function configFromDraft(draft: Draft | null): SessionConfig {
  const surface: 'chat' | 'code' = draft?.mode === 'project' ? 'code' : 'chat'
  const base: SessionConfig =
    surface === 'code' && draft?.cwd
      ? { ...DEFAULT_CONFIG, surface, cwd: draft.cwd }
      : { ...DEFAULT_CONFIG, surface }
  const withMode: SessionConfig =
    surface === 'code' && draft?.permissionMode ? { ...base, permissionMode: draft.permissionMode } : base
  if (!draft?.modelKey) return withMode
  const { catalog, config } = useProvidersStore.getState()
  const { llmProvider, model, baseURL } = resolveModelConfig(catalog, config, draft.modelKey)
  return { ...withMode, llmProvider, model, ...(baseURL ? { baseURL } : {}) }
}

/** App singleton: connects to the live sidecar over WsTransport. */
export const sessionService = new SessionService(new WsTransport())
