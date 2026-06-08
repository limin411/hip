# New-Conversation UX — Draft Sessions, Centered Composer, Start-Time Directory Choice

- **Date:** 2026-06-08
- **Status:** Approved (brainstorming complete; ready for implementation plan)
- **Builds on:** `2026-06-07-project-workspace-design.md` (per-session `config.cwd`, `FilesystemBackend`, Files panel tree+preview)
- **Branch base:** `feat/project-workspace`

## 1. Problem & Goals

The current "new conversation" flow has three rough edges:

1. **Directory selection is buried.** A session binds a real project directory only via the right-panel Files tab's "Select folder" empty state (`src/components/artifact/FileTree.tsx`). This couples "I want files visible" with "bind a workspace," and offers no decision point at the *start* of a conversation.
2. **Empty sessions pollute the sidebar.** `sessionService.createSession()` → `useDomainStore.createSession()` eagerly prepends an empty `SessionVM` to `sessions[]` **and** sends `session:create` (persisted to SQLite). So a brand-new, message-less chat immediately appears in the left sidebar and survives restart as an orphan row.
3. **The composer is always bottom-pinned.** `ChatPane.tsx` (lines 22-28) renders only centered *placeholder text* for the empty state, while `InputBar.tsx` is a separate sibling in `AppLayout.tsx` (lines 77-78), permanently docked at the bottom.

### Goals (user-stated)

- **G1 — Start-time directory choice.** At the start of a new conversation the user either picks a real project directory (agent gets sandboxed real filesystem) **or** chooses pure-chat mode (which uses a sandbox). The Files tree "opens" as a consequence of that choice.
- **G2 — No empty sessions in the sidebar.** A new conversation that has produced no conversation record must not appear in the left sidebar.
- **G3 — Centered composer when empty.** When a new conversation has no messages, the input box is centered in the page (it relocates to the bottom once the conversation begins).

## 2. Competitive Research Summary

Researched Claude Desktop, OpenAI Codex, and Cursor (10 agents, web-sourced, adversarially verified). Key confirmed findings:

| Pattern | Claude Desktop | OpenAI Codex | Cursor |
|---|---|---|---|
| Directory selection | Per-session, at start, inline near composer. Pure-chat = separate "Chat" tab (no FS). | **Strongest model:** per-thread Projects vs first-class projectless "Chats" (auto scratch dir `~/Documents/Codex/<date>/<slug>`). | Binds to the open folder/workspace; no per-chat picker. No true pure-chat mode. |
| Empty session in sidebar | Row materializes at **first user message**; untitleable sessions get filtered out (GH #29620). | Record created **on the prompt**; nothing listed before submit. | Draft tab opens pre-message; row on send. ⚠️ **Confirmed bug: unsent draft is lost on tab-switch.** |
| Centered composer | Chat tab: **centered → relocates to bottom**. Code tab: bottom-pinned. | Cloud/web: **centered** ("What are we coding next?"). IDE/CLI: bottom-pinned. | Always bottom-pinned. |

**Implications for hip:**
- All three goals match the **confirmed industry norm for *wide* chat canvases** (ChatGPT / Claude Chat): lazy materialization + centered-then-relocate. hip's center column is wide, so centering is appropriate (narrow IDE side-panels bottom-pin *because* they're narrow).
- **Make pure-chat an explicit, labeled choice** (Codex's projectless thread is the cleanest precedent), not an inferred "cwd happens to be empty" state.
- **Biggest pitfall to beat: Cursor loses unsent drafts.** hip is local-first, so persisting drafts (text + folder choice) across restart strictly beats all three.
- hip already owns the right primitive (`session.config.cwd`), so this is **flow/UI work, not re-architecture**.

**Evidence caveats (do not over-rely):** whether anyone persists an *empty un-messaged* draft as a durable entry is unconfirmed across all three — this is a greenfield decision. The centered-composer-for-a-coding-agent pattern is confirmed only for Claude *Chat* and Codex *cloud*; our adoption rests on the wide-canvas principle and the ChatGPT/Claude precedent.

Selected sources: Claude Code desktop docs (`code.claude.com/docs/en/desktop`, `/desktop-quickstart`), GH anthropics/claude-code #36175, #29620; OpenAI Codex docs (`developers.openai.com/codex/app`, `/cloud`), GH openai/codex #21165, #18464; Cursor docs (`cursor.com/docs/agent/agents-window`, `/cloud-agent`) and forum thread 161643 (draft-loss bug); Linear drafts changelog; ChatGPT/VS Code/Zed lazy-materialization precedent.

## 3. Product Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| D1 | New-chat entry | **Centered composer + folder pill.** Pick folder → Files panel opens + real FS. Type & send without picking → pure-chat (sandbox). |
| D2 | Draft in sidebar | **No sidebar row until the first message** (lazy materialization). Titled from first message → folder name → timestamp. |
| D3 | Draft persistence | **Persist locally** (composer text + folder/mode choice) across app restart / window reload. |
| D4 | Pure-chat filesystem | **Auto scratch dir + show its tree.** Agent reads/writes a throwaway dir; Files panel shows it like a project. |
| D5 | Empty-state content | **Greeting only** above the composer (no suggestion chips for v1). |

## 4. Architecture

### 4.1 The Draft model

A single persistent **draft** lives *outside* `sessions[]`, in a new store persisted to `localStorage`:

```ts
// src/store/draftStore.ts  (zustand + persist middleware → localStorage)
interface Draft {
  tempId: string            // client-side id for fsStore keying before commit
  mode: 'project' | 'chat'
  cwd?: string              // absolute host path when mode === 'project'
  text: string             // unsent composer text
}
interface DraftStore {
  draft: Draft | null
  ensureDraft(): Draft               // create singleton if absent (mode defaults 'chat')
  setText(text: string): void
  pickProject(cwd: string): void     // mode='project', cwd=abs
  clearProject(): void               // back to mode='chat'
  reset(): void                      // after commit
}
```

- **localStorage** (via zustand `persist`) is the persistence mechanism: it survives WKWebView reload **and** app restart, needs no SQLite/sidecar schema change, and matches "single small draft." (A `drafts` SQLite table was considered and rejected as overkill for one local draft — see §9.)
- There is **at most one** draft at a time (reuse-one-empty-slot, ChatGPT behavior). "New Chat" focuses the existing draft rather than spawning duplicates.

### 4.2 Lazy materialization & the commit flow

```
New Chat click ─────────────► ensureDraft()         (client only; NO session:create)
   │
   ├─ user types ────────────► draft.text updated, persisted
   ├─ user picks folder ─────► draft.mode='project', draft.cwd=<abs>; Files tree renders (§4.3)
   │
   └─ first message send ────► COMMIT:
                                 1. session:create { id, config:{...DEFAULT, cwd?} }   // SQLite persist
                                 2. domain.createSession(id, config)                   // adds to sessions[] → sidebar row
                                 3. domain.appendUserMessage(id, msgId, text)
                                 4. message:send { sessionId:id, id:msgId, content }
                                 5. draftStore.reset()
```

- `cwd` carried at commit: for `mode:'project'` it's the picked folder; for `mode:'chat'` it is **omitted** and the sidecar derives the scratch dir on `session:create` (§4.4).
- Title on the new row: first user message; reducer/sidecar fall back to folder basename, then timestamp, so a row is never untitleable (guards the Claude #29620 trap).
- The sidebar (`SessionList`/`Sidebar`) is **unchanged** — drafts simply never enter `sessions[]`.

`sessionService.sendMessage()` is the commit site. Current code lazily creates a session when `activeSessionId` is null; the new logic instead reads `draftStore.draft`, performs the commit sequence above, and routes message:send to the freshly-created session id.

### 4.3 Architectural decision — live file tree for a *draft* (Approach A)

When a `mode:'project'` draft has a `cwd` but no committed server session, the Files panel must still show the real tree. **Chosen: Approach A — cwd-keyed FS reads.**

- Extend the existing `fs:ls` / `fs:read` client messages so they may carry a **`cwd`** (draft) instead of a `sessionId`. The sidecar serves these directly through the **existing** `workspace-fs.ts` functions `lsDir(cwd, path)` / `readForPreview(cwd, path)` — already cwd-keyed and symlink-hardened (`resolveRealWithin`, commit `e490de9`).
- No server session exists until commit; therefore **zero orphan rows are possible**, and there is no server-side draft lifecycle/GC to maintain (important given hip's known leaky-sidecar gap).
- The agent's sandboxed `FilesystemBackend` is still built at `session:create` (commit) — fine, because the agent does not run before the first message.
- **Security:** the `cwd` is an absolute path the user just authorized via the native dialog; reads are confined to it by `resolveRealWithin`. The result responses (`fs:ls:result` / `fs:read:result`) are keyed back to the draft via the same `cwd` (or the draft `tempId`) so `fsStore` can store them under a draft scope.

**Rejected: Approach B — ephemeral in-memory server session.** Create a Session on folder-pick, kept out of SQLite/`session:list` until commit. Reuses the session-keyed FS path verbatim but forces the sidecar to track and GC un-committed drafts (disconnect, restart, abandonment) — added lifecycle complexity layered on the existing leaky-sidecar problem. The only thing Approach A gives up is a populated tree for a *pure-chat* draft before its first message, which is moot (the scratch dir is empty/non-existent until the agent runs).

### 4.4 Pure-chat sandbox (scratch dir)

- On `session:create` for a chat-mode session (no `cwd` provided), the sidecar derives a deterministic scratch path: **`<appDataDir>/hip/scratch/<sessionId>`**, creates it (`mkdir -p`), and binds it as the session `cwd` with `FilesystemBackend({ rootDir, virtualMode: true, maxFileSizeMb: 10 })`.
- The `session:cwd` server message reports the resolved scratch path back to the client, so the Files panel shows the scratch tree exactly like a project.
- **Lifecycle:** the scratch dir persists with the session (reopening shows produced files) and is removed on `session:delete` (best-effort `rm -rf` of `<appDataDir>/hip/scratch/<sessionId>`).
- **Before commit**, a pure-chat draft's Files panel shows a small placeholder ("sandbox starts on first message") — there is nothing on disk yet.
- The app-data base dir is resolved on the sidecar via a stable per-user path (Node `os.homedir()`-derived, mirroring the Tauri app-data location) so it survives restarts; exact path helper is an implementation detail.

## 5. Component & Layout Changes

### 5.1 Center column layout (G3)

`AppLayout.tsx`'s center `Panel` becomes conditional on "is there a committed active session with content":

| State | Renders |
|---|---|
| `activeSessionId === null` (the draft / landing is the active view) | `<NewConversation/>` — greeting + **centered** `<Composer/>` + `<FolderPill/>` |
| `activeSessionId !== null` (a committed session is selected) | `<ChatHeader/>` + `<ChatPane/>` (messages) + bottom-docked `<InputBar/>` |

- **The landing is gated on `activeSessionId === null`, never on message count.** This matters: a selected summary-only session that is still loading has `messages: []` transiently (until `session:loaded` arrives) — gating on `messages.length === 0` would wrongly flash the landing over a real session. Such a session shows `ChatPane`'s normal loading/empty area instead.
- Extract the textarea/submit logic from `InputBar.tsx` into a shared **`<Composer/>`** used by both `NewConversation` (centered) and `InputBar` (bottom). **One composer component, two layouts — no second input box.**
- The transition occurs at commit, when `domain.createSession()` sets `activeSessionId` from `null` to the new id. A light crossfade is **optional polish**, deferred; the conditional swap ships first.
- `ChatPane.tsx`'s current `messages.length === 0` placeholder branch (lines 22-28) is removed — that state is now owned by `NewConversation`.

### 5.2 New / changed files

**New:**
- `src/store/draftStore.ts` — persisted draft store (§4.1).
- `src/components/chat/NewConversation.tsx` — centered landing (greeting + Composer + FolderPill).
- `src/components/chat/Composer.tsx` — extracted shared input (value/onChange/submit, Enter-to-send).
- `src/components/chat/FolderPill.tsx` — "选择项目文件夹 ▾" / bound-path pill; dropdown → pick folder (via `pickDirectory()`) or clear to pure-chat. On pick it also opens the right panel on the Files tab (`uiStore.setPanelOpen(true)` + `setTab('files')`) so "pick a folder → Files panel opens" (D1).

**Changed:**
- `src/components/sidebar/NewChatButton.tsx` — `onClick` → `draftStore.ensureDraft()` + select the draft view (clear `activeSessionId`), instead of `sessionService.createSession()`.
- `src/domain/sessionService.ts` — `sendMessage()` commit path (§4.2); new `lsDraft(cwd, path)` / `readDraftFile(cwd, path)` sending cwd-keyed `fs:ls`/`fs:read`; `setProjectDir` unaffected for committed sessions.
- `src/components/chat/InputBar.tsx` — wraps `<Composer/>`, bottom layout.
- `src/routes/AppLayout.tsx` — conditional center layout (§5.1).
- `src/store/fsStore.ts` — allow a **draft scope** (keyed by the draft `cwd`, since only project-mode drafts have a tree pre-commit) for entries + preview, parallel to the per-session cache; cleared on commit/reset.
- `src/domain/sessionStore.ts` — title fallback on commit (folder basename / timestamp) if first message is empty; otherwise reducers mostly unchanged.

**Unchanged:** `SessionList`, `Sidebar`, `previewKind.ts`, `FilePreview.tsx`, `ArtifactPanel` tree/preview internals.

### 5.3 Protocol changes (`packages/protocol/src/index.ts`)

- `fs:ls` and `fs:read` client messages: make `sessionId` optional and add optional `cwd?: string`. Exactly one of `{sessionId, cwd}` is set. (Draft reads pass `cwd`; committed-session reads pass `sessionId` as today.)
- `fs:ls:result` / `fs:read:result` server messages: echo back a discriminator so the client can route a draft result to the draft scope (e.g. include the `cwd` when the request was cwd-keyed, or a `scope: 'draft' | 'session'` tag). `session:cwd` already exists and is reused to report a chat-mode scratch path.

### 5.4 Sidecar changes (`packages/sidecar/src/session/`)

- `session-manager.ts` — `fs:ls` / `fs:read` handlers branch on `cwd` vs `sessionId`: cwd-keyed requests call `workspaceFs.lsDir(cwd, path)` / `readForPreview(cwd, path)` directly (no session lookup).
- `session.ts` — `buildAgent()` / `session:create` path: when `config.cwd` is absent, derive + create the scratch dir (§4.4), set it as `cwd`, and emit `session:cwd` with the resolved path.
- `session-manager.ts` `session:delete` — best-effort scratch-dir cleanup for chat-mode sessions.

## 6. Data Flow Summary

```
Pick folder (draft):   FolderPill → pickDirectory() → draftStore.pickProject(cwd)
                       → uiStore.setPanelOpen(true) + setTab('files')   // Files panel opens
                       → sessionService.lsDraft(cwd, cwd) → fs:ls{cwd} → sidecar workspaceFs.lsDir
                       → fs:ls:result{cwd,...} → fsStore draft scope → FileTree renders

Preview file (draft):  FileTree click → readDraftFile(cwd, path) → fs:read{cwd,path}
                       → readForPreview → fs:read:result → fsStore draft preview → FilePreview

Send first message:    Composer submit → sessionService.sendMessage(text)
                       → COMMIT (session:create{cwd?} → createSession → appendUserMessage
                          → message:send → draftStore.reset)
                       → sidebar row appears, layout swaps to ChatPane+InputBar

Pure-chat commit:      session:create{no cwd} → sidecar mkdir scratch → bind cwd
                       → session:cwd{scratchPath} → Files panel shows scratch tree
```

## 7. Edge Cases & Error Handling

- **Switch away from a draft with content** → draft is persisted; restored when the user returns to the new-conversation view.
- **Restored draft whose folder was deleted/moved** → `fs:ls` errors; tree shows an error state; the pill lets the user re-pick or drop to pure-chat.
- **Unpick folder** (`clearProject`) → reverts draft to `mode:'chat'`, clears the draft FS scope.
- **Empty submit** → no-op (existing `sendMessage` guard).
- **Title fallback** → first user message → folder basename → timestamp (never untitleable; guards Claude #29620).
- **Send queue interplay** → commit emits `session:create` then `message:send`; the existing pre-connect WS send-queue (`ws-client.ts`, commit `4c8d4cd`) guarantees ordered delivery if the socket is still connecting.
- **On launch** `activeSessionId` is `null` → the new-conversation landing shows by default (an implicit draft via `ensureDraft()`); selecting a history row sets `activeSessionId` and shows that conversation. The landing is gated on `activeSessionId === null`, never on message count (see §5.1).

## 8. Testing Strategy

Per project conventions (manual GUI acceptance for the live-LLM path; thorough real-machine E2E welcome for non-LLM FS/UI flows — this feature is FS/UI):

**Unit (Vitest, `environment: 'node'` — pure functions/stores):**
- `draftStore`: ensureDraft singleton; setText/pickProject/clearProject; persist+rehydrate round-trip; reset.
- Commit flow (via `FakeTransport` + `sessionService`): first send emits `session:create` then `message:send` in order, adds exactly one session to `sessions[]`, clears the draft.
- Sidebar exclusion: a draft never appears in `sessions[]`/`filterSessions`.
- Title fallback derivation.
- Scratch-path derivation (`<appDataDir>/hip/scratch/<id>`).
- cwd-keyed FS containment (sidecar): `fs:ls`/`fs:read` with `cwd` resolve through `resolveRealWithin`; traversal/symlink escape rejected (extends existing `workspace-fs.test.ts`).

**E2E (WebdriverIO + Tauri, real `hip.app`):**
- New Chat → centered composer visible, **no** sidebar row.
- Pick folder (via `window.__hipPickDir` seam) → tree renders, **still no** sidebar row.
- Send first message → sidebar row appears, composer docks to the bottom, messages render.
- Pure-chat: send without a folder → scratch tree appears in Files panel.
- Draft survives a window reload (text + folder choice restored).

## 9. Out of Scope / Deferred (YAGNI)

- Suggestion chips (D5 = greeting only) and dynamic repo-introspected starters.
- Recent-projects list in the folder picker (research-recommended; defer).
- Git-worktree isolation for parallel sessions on one repo.
- Trust-confirmation dialog when a restored `cwd` is reloaded (research-recommended; defer — the path is already user-authorized and sandbox-hardened).
- Header re-bind pill for committed sessions (the existing Files-panel "change folder" button stays the re-bind affordance).
- A SQLite `drafts` table (localStorage suffices for a single local draft; revisit only if multi-draft or cross-window sync is ever wanted).
- Composer relocation animation (ship the conditional swap; animate later).

## 10. Open Questions

None blocking. Two implementation-time details to settle in the plan:
1. The exact app-data base-path helper on the sidecar (Node-side equivalent of Tauri's app-data dir).
2. Whether `fs:ls:result`/`fs:read:result` route to the draft scope via an echoed `cwd` or an explicit `scope` tag — both work; pick the smaller diff during implementation.
