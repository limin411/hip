# Project Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each session bind a real project directory so deepagents sub-agents read/write it via a sandboxed `FilesystemBackend`, and add a split file-tree + multi-format preview (Markdown/HTML/image/text) UI fed by the sidecar over WS.

**Architecture:** Sidecar serves the UI's tree/preview through new `fs:ls`/`fs:read` WS messages backed by a dedicated sandboxed Node-fs reader (`workspace-fs.ts`), while the agent gets `createDeepAgent({ backend: new FilesystemBackend({ rootDir: cwd, virtualMode: true }) })`. The protocol/UI use real absolute paths; the agent keeps `virtualMode` internally (two representations, same files on disk). A native directory picker comes from `tauri-plugin-dialog`.

**Tech Stack:** TypeScript, deepagents 1.10, `@langchain/langgraph`, Node `fs/promises`, Tauri 2 (`tauri-plugin-dialog`), React 18, Zustand 5, `react-resizable-panels`, `react-markdown`, Vitest, WebdriverIO (`@wdio/tauri-service`).

**Spec:** `docs/superpowers/specs/2026-06-07-project-workspace-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/protocol/src/index.ts` | `SessionConfig.cwd`, `FsEntry`, new WS messages (modify) |
| `packages/sidecar/src/session/workspace-fs.ts` | Sandboxed Node-fs reader: `resolveWithin`/`lsDir`/`readForPreview` (create) |
| `packages/sidecar/src/persistence/store.ts` | `updateConfig` (modify) |
| `packages/sidecar/src/session/session.ts` | `buildAgent`, `FilesystemBackend`, `setCwd`, `lsDir`, `readForPreview`, mutable config (modify) |
| `packages/sidecar/src/session/session-manager.ts` | `session:setCwd`/`fs:ls`/`fs:read` branches (modify) |
| `src-tauri/{Cargo.toml,src/lib.rs,capabilities/default.json}`, `package.json` | `tauri-plugin-dialog` wiring (modify) |
| `src/ipc/dialog.ts` | `pickDirectory()` with E2E test seam (create) |
| `src/store/fsStore.ts` | Per-session tree/preview cache (create) |
| `src/domain/sessionStore.ts` | `session:cwd` reducer case (modify) |
| `src/domain/sessionService.ts` | `setProjectDir`/`lsDir`/`readFile` + fs-result routing + refresh-on-complete (modify) |
| `src/components/artifact/previewKind.ts` | Pure renderer-kind selector (create) |
| `src/components/artifact/FilePreview.tsx` | Multi-format preview pane (create) |
| `src/components/artifact/FileTree.tsx` | Real lazy tree + folder picker (rewrite) |
| `src/components/artifact/ArtifactPanel.tsx` | Drop `doc` tab; split Files pane (modify) |
| `src/components/artifact/DocRenderer.tsx` | Delete (prose styles move to FilePreview) |
| `src/store/uiStore.ts` | `ArtifactTab` drops `'doc'` (modify) |
| `src/components/chat/ChatHeader.tsx` | `data-testid="toggle-panel"` (modify) |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | artifact keys (modify) |
| `e2e/fixtures/sample-project/*` | Deterministic E2E fixture (create) |
| `e2e/specs/project-workspace.spec.ts` | Real-machine E2E (create) |

---

## Phase 1 — Protocol

### Task 1: Protocol types and messages

**Files:**
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Add `cwd` to `SessionConfig`**

In `packages/protocol/src/index.ts`, change the `SessionConfig` interface to:

```ts
export interface SessionConfig {
  llmProvider: 'deepseek'
  model: string
  tools: string[]
  systemPrompt?: string
  cwd?: string                 // absolute project root; undefined → virtual FS (no real file tools)
}
```

- [ ] **Step 2: Add the `FsEntry` interface**

Add after `SearchHit` (anywhere among the exported interfaces):

```ts
/** One immediate child of a directory. `path` is a real absolute host path. */
export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
}
```

- [ ] **Step 3: Add client messages**

Append these variants to the `ClientMessage` union:

```ts
  | { type: 'session:setCwd'; sessionId: string; cwd: string }
  | { type: 'fs:ls'; sessionId: string; path: string }
  | { type: 'fs:read'; sessionId: string; path: string }
```

- [ ] **Step 4: Add server messages**

Append these variants to the `ServerMessage` union:

```ts
  | { type: 'session:cwd'; sessionId: string; cwd: string }
  | { type: 'fs:ls:result'; sessionId: string; path: string; entries: FsEntry[]; error?: string }
  | { type: 'fs:read:result'; sessionId: string; path: string; content?: string; encoding?: 'utf8' | 'base64'; mimeType?: string; truncated?: boolean; error?: string }
```

- [ ] **Step 5: Type-check both ends**

Run: `yarn workspace @hip/protocol exec tsc --noEmit && yarn type-check && yarn workspace @hip/sidecar type-check`
Expected: clean (new fields are additive; existing code still compiles).

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): cwd + FsEntry + fs:ls/fs:read/session:setCwd messages"
```

---

## Phase 2 — Sidecar

### Task 2: Sandboxed filesystem reader (`workspace-fs.ts`)

**Files:**
- Create: `packages/sidecar/src/session/workspace-fs.ts`
- Test: `packages/sidecar/src/session/workspace-fs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/workspace-fs.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveWithin, lsDir, readForPreview } from './workspace-fs.js'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-wsfs-'))
  await fs.writeFile(path.join(root, 'README.md'), '# Hello\n\nWorld')
  await fs.mkdir(path.join(root, 'src'))
  await fs.writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1')
  // 1x1 PNG
  await fs.writeFile(path.join(root, 'logo.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('resolveWithin', () => {
  it('allows paths inside root', () => {
    expect(resolveWithin(root, path.join(root, 'src/a.ts'))).toBe(path.join(root, 'src/a.ts'))
  })
  it('rejects traversal escaping root', () => {
    expect(() => resolveWithin(root, path.join(root, '../../etc/passwd'))).toThrow()
  })
  it('rejects an unrelated absolute path', () => {
    expect(() => resolveWithin(root, '/etc/passwd')).toThrow()
  })
})

describe('lsDir', () => {
  it('lists immediate children, dirs first, with absolute paths', async () => {
    const entries = await lsDir(root, root)
    expect(entries[0]).toMatchObject({ name: 'src', isDir: true })
    expect(entries.slice(1).map((e) => e.name).sort()).toEqual(['README.md', 'logo.png'])
    expect(entries.every((e) => path.isAbsolute(e.path))).toBe(true)
  })
})

describe('readForPreview', () => {
  it('reads text as utf8 with a mimeType', async () => {
    const r = await readForPreview(root, path.join(root, 'README.md'))
    expect(r).toMatchObject({ encoding: 'utf8', mimeType: 'text/markdown' })
    expect((r as { content: string }).content).toContain('# Hello')
  })
  it('reads images as base64 with an image mimeType', async () => {
    const r = await readForPreview(root, path.join(root, 'logo.png'))
    expect(r).toMatchObject({ encoding: 'base64', mimeType: 'image/png' })
  })
  it('throws when the path escapes root', async () => {
    await expect(readForPreview(root, '/etc/passwd')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `yarn vitest run packages/sidecar/src/session/workspace-fs.test.ts`
Expected: FAIL — cannot find module `./workspace-fs.js`.

- [ ] **Step 3: Implement `workspace-fs.ts`**

Create `packages/sidecar/src/session/workspace-fs.ts`:

```ts
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { FsEntry } from '@hip/protocol'

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
}
const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.json', '.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css',
  '.scss', '.less', '.yml', '.yaml', '.toml', '.xml', '.sh', '.py', '.rs', '.go', '.java', '.c',
  '.h', '.cpp', '.rb', '.php', '.sql', '.env', '.gitignore', '.lock', '.cfg', '.ini', '.csv',
])
const TEXT_CAP = 1024 * 1024 // 1 MB
const IMG_CAP = 5 * 1024 * 1024 // 5 MB

export type PreviewResult =
  | { content: string; encoding: 'utf8' | 'base64'; mimeType?: string; truncated?: boolean }
  | { error: string }

/** Resolve `abs` and assert it stays within `cwd`. Throws on escape (sandbox 2nd line of defense). */
export function resolveWithin(cwd: string, abs: string): string {
  const root = path.resolve(cwd)
  const target = path.resolve(abs)
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`path escapes project root: ${abs}`)
  }
  return target
}

/** List immediate children of `dirAbs` (non-recursive): dirs first, then alphabetical. */
export async function lsDir(cwd: string, dirAbs: string): Promise<FsEntry[]> {
  const dir = resolveWithin(cwd, dirAbs)
  const dirents = await fs.readdir(dir, { withFileTypes: true })
  const entries: FsEntry[] = []
  for (const d of dirents) {
    const isDir = d.isDirectory()
    const full = path.join(dir, d.name)
    let size: number | undefined
    if (!isDir) {
      try { size = (await fs.stat(full)).size } catch { size = undefined }
    }
    entries.push({ name: d.name, path: full, isDir, size })
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  return entries
}

async function readHead(file: string, n: number): Promise<Buffer> {
  const fh = await fs.open(file, 'r')
  try {
    const buf = Buffer.alloc(n)
    const { bytesRead } = await fh.read(buf, 0, n, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/** Read a file for UI preview. Text → utf8 (capped+truncated); images → base64; else error. */
export async function readForPreview(cwd: string, abs: string): Promise<PreviewResult> {
  const file = resolveWithin(cwd, abs)
  const ext = path.extname(file).toLowerCase()
  const stat = await fs.stat(file)
  if (stat.isDirectory()) return { error: 'is_directory' }

  if (ext in IMAGE_MIME) {
    if (stat.size > IMG_CAP) return { error: 'too_large' }
    const buf = await fs.readFile(file)
    return { content: buf.toString('base64'), encoding: 'base64', mimeType: IMAGE_MIME[ext] }
  }

  if (TEXT_EXT.has(ext) || ext === '') {
    const truncated = stat.size > TEXT_CAP
    const buf = truncated ? await readHead(file, TEXT_CAP) : await fs.readFile(file)
    if (buf.subarray(0, 8000).includes(0)) return { error: 'binary' } // NUL byte → treat as binary
    const mimeType =
      ext === '.html' || ext === '.htm' ? 'text/html'
      : ext === '.md' || ext === '.markdown' ? 'text/markdown'
      : 'text/plain'
    return { content: buf.toString('utf8'), encoding: 'utf8', mimeType, truncated }
  }

  return { error: 'binary' }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `yarn vitest run packages/sidecar/src/session/workspace-fs.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/workspace-fs.ts packages/sidecar/src/session/workspace-fs.test.ts
git commit -m "feat(sidecar): sandboxed workspace-fs reader (ls + preview)"
```

### Task 3: Persist cwd via `store.updateConfig`

**Files:**
- Modify: `packages/sidecar/src/persistence/store.ts`
- Test: `packages/sidecar/src/persistence/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `it` inside the existing `describe('SessionStore', () => { ... })` block in `packages/sidecar/src/persistence/store.test.ts` (it reuses that block's `store` from `beforeEach` and the file's top-level `cfg` constant):

```ts
  it('updateConfig overwrites the stored config blob', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.updateConfig('s1', JSON.stringify({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd: '/proj' }))
    expect(JSON.parse(store.getSession('s1')!.config).cwd).toBe('/proj')
  })
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `yarn vitest run packages/sidecar/src/persistence/store.test.ts`
Expected: FAIL — `store.updateConfig is not a function`.

- [ ] **Step 3: Implement `updateConfig`**

In `packages/sidecar/src/persistence/store.ts`, add this method right after `getSession`:

```ts
  /** Replace the persisted config blob (e.g. when cwd changes). */
  updateConfig(id: string, config: string): void {
    this.db.prepare(`UPDATE sessions SET config=? WHERE id=?`).run(config, id)
  }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `yarn vitest run packages/sidecar/src/persistence/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
git commit -m "feat(persistence): updateConfig to persist cwd in the config blob"
```

### Task 4: Wire `FilesystemBackend` + workspace methods into `Session`

**Files:**
- Modify: `packages/sidecar/src/session/session.ts`
- Test: `packages/sidecar/src/session/session-cwd.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/session-cwd.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Session } from './session.js'

let root: string
const fake = () => new FakeListChatModel({ responses: ['ok'] })
const cfg = { llmProvider: 'deepseek' as const, model: 'm', tools: [] }

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-sess-'))
  await fs.writeFile(path.join(root, 'README.md'), '# Hi')
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe('Session workspace', () => {
  it('lsDir returns no_workspace before a cwd is bound', async () => {
    const s = new Session('s1', cfg, fake())
    expect(await s.lsDir(root)).toMatchObject({ error: 'no_workspace' })
  })

  it('setCwd binds the workspace and exposes it via config', async () => {
    const s = new Session('s2', cfg, fake())
    s.setCwd(root)
    expect(s.config.cwd).toBe(root)
    const r = await s.lsDir(root)
    expect(r.entries?.some((e) => e.name === 'README.md')).toBe(true)
  })

  it('rebuilding the agent on setCwd keeps the session runnable', async () => {
    const s = new Session('s3', cfg, fake())
    s.hydrate([{ id: 'u1', role: 'user', content: 'earlier', timestamp: 1 }])
    s.setCwd(root)
    const events: { type: string }[] = []
    await s.sendMessage('hello', (m) => events.push(m as { type: string }))
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `yarn vitest run packages/sidecar/src/session/session-cwd.test.ts`
Expected: FAIL — `s.setCwd is not a function` / `s.lsDir is not a function`.

- [ ] **Step 3: Update imports in `session.ts`**

At the top of `packages/sidecar/src/session/session.ts`, change the deepagents import and add the workspace-fs + protocol imports:

```ts
import { createDeepAgent, FilesystemBackend } from 'deepagents'
import * as workspaceFs from './workspace-fs.js'
import type { FsEntry } from '@hip/protocol'
```

(Keep all existing imports; `FsEntry` joins the existing `@hip/protocol` type import line or stays a separate `import type`.)

- [ ] **Step 4: Make config/agent/model fields support rebuilding**

Replace the class field declarations and constructor (the block from `private readonly agent = ...` through the end of the constructor) with:

```ts
  private agent!: ReturnType<typeof createDeepAgent>
  private _config: SessionConfig
  private readonly injectedModel?: BaseLanguageModel
  private readonly messages: BaseMessage[] = []
  private abortController: AbortController | null = null
  private readonly usesEnvModel: boolean
  private readonly titleGenerator?: TitleGenerator

  constructor(
    readonly id: string,
    config: SessionConfig,
    model?: BaseLanguageModel,
    private readonly store?: SessionStore,
    titleGenerator?: TitleGenerator,
  ) {
    this._config = config
    this.injectedModel = model
    this.usesEnvModel = !model
    // Inject a generator (tests), else build the real one only for the env-keyed
    // production model. Injected-model sessions get no generator → no LLM title.
    this.titleGenerator = titleGenerator ?? (this.usesEnvModel ? buildDefaultTitleGenerator(config) : undefined)
    this.buildAgent()
  }

  /** Current config (cwd may change via setCwd). */
  get config(): SessionConfig {
    return this._config
  }

  /** (Re)build the deep agent — with a sandboxed FilesystemBackend when a cwd is bound. */
  private buildAgent(): void {
    const model = this.injectedModel ?? buildModel(this._config)
    const backend = this._config.cwd
      ? new FilesystemBackend({ rootDir: this._config.cwd, virtualMode: true, maxFileSizeMb: 10 })
      : undefined
    this.agent = createDeepAgent({
      model,
      systemPrompt: this._config.systemPrompt ?? SUPERVISOR_PROMPT,
      subagents: SUBAGENTS as unknown as NonNullable<Parameters<typeof createDeepAgent>[0]>['subagents'],
      ...(backend ? { backend } : {}),
    })
  }
```

> Note: the constructor signature is unchanged, so existing `new Session(...)` call sites and tests still compile. `this.config` is now a getter returning `_config`.

- [ ] **Step 5: Add `setCwd` / `lsDir` / `readForPreview` methods**

Add these methods to the `Session` class (e.g. right after `hydrate`):

```ts
  /** Bind/replace the project directory and rebuild the agent. Conversation history is preserved. */
  setCwd(cwd: string): void {
    this._config = { ...this._config, cwd }
    this.buildAgent()
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
```

- [ ] **Step 6: Tell the Coder sub-agent it has real file tools**

In `packages/sidecar/src/session/agents.ts`, update the `coder` entry's `systemPrompt` so it knows the file tools write the real workspace (paths are relative to the project root, since the agent runs in `virtualMode`):

```ts
  {
    name: 'coder',
    description: 'Writes or edits code to satisfy the plan.',
    systemPrompt:
      'You are the Coder. Implement the plan. You have real file tools — read_file, write_file, edit_file, ls, glob, grep — operating on the project directory; use them to read and write actual files. All paths are relative to the project root (e.g. "/src/index.ts"). Output the code and a one-line summary.',
  },
```

(Leave `planner`, `reviewer`, and `SUPERVISOR_PROMPT` unchanged — only the Coder writes files.)

- [ ] **Step 7: Run the test to confirm it passes**

Run: `yarn vitest run packages/sidecar/src/session/session-cwd.test.ts && yarn workspace @hip/sidecar type-check`
Expected: PASS + clean type-check.

- [ ] **Step 8: Run the existing session tests (no regressions)**

Run: `yarn vitest run packages/sidecar/src/session/session-unit.test.ts`
Expected: PASS (constructor signature preserved).

- [ ] **Step 9: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-cwd.test.ts packages/sidecar/src/session/agents.ts
git commit -m "feat(sidecar): bind FilesystemBackend per cwd; setCwd/lsDir/readForPreview"
```

### Task 5: `session-manager` message branches

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts`
- Test: `packages/sidecar/src/session/session-manager-fs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/session-manager-fs.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-mgr-'))
  await fs.writeFile(path.join(root, 'README.md'), '# Hi')
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

function setup() {
  const sent: ServerMessage[] = []
  const send = (m: ServerMessage) => sent.push(m)
  const mgr = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }))
  mgr.handle({ type: 'session:create', id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [] } }, send)
  return { mgr, sent, send }
}

describe('session-manager fs', () => {
  it('session:setCwd echoes session:cwd', () => {
    const { mgr, sent, send } = setup()
    mgr.handle({ type: 'session:setCwd', sessionId: 's1', cwd: root }, send)
    expect(sent).toContainEqual({ type: 'session:cwd', sessionId: 's1', cwd: root })
  })

  it('fs:ls returns directory entries', async () => {
    const { mgr, sent, send } = setup()
    mgr.handle({ type: 'session:setCwd', sessionId: 's1', cwd: root }, send)
    await mgr.handleAsync({ type: 'fs:ls', sessionId: 's1', path: root }, send)
    const ls = sent.find((m) => m.type === 'fs:ls:result') as Extract<ServerMessage, { type: 'fs:ls:result' }>
    expect(ls.entries.some((e) => e.name === 'README.md')).toBe(true)
  })

  it('fs:read returns file content', async () => {
    const { mgr, sent, send } = setup()
    mgr.handle({ type: 'session:setCwd', sessionId: 's1', cwd: root }, send)
    await mgr.handleAsync({ type: 'fs:read', sessionId: 's1', path: path.join(root, 'README.md') }, send)
    const read = sent.find((m) => m.type === 'fs:read:result') as Extract<ServerMessage, { type: 'fs:read:result' }>
    expect(read.content).toContain('# Hi')
    expect(read.encoding).toBe('utf8')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `yarn vitest run packages/sidecar/src/session/session-manager-fs.test.ts`
Expected: FAIL — no `session:cwd`/`fs:ls:result`/`fs:read:result` emitted (default switch falls through).

- [ ] **Step 3: Add the branches**

In `packages/sidecar/src/session/session-manager.ts`, add these cases inside the `handleAsync` `switch (msg.type)` (after the existing `session:rename` case):

```ts
      case 'session:setCwd': {
        const s = this.ensureSession(msg.sessionId)
        s.setCwd(msg.cwd)
        this.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
        send({ type: 'session:cwd', sessionId: msg.sessionId, cwd: msg.cwd })
        break
      }
      case 'fs:ls': {
        const r = await this.ensureSession(msg.sessionId).lsDir(msg.path)
        send({ type: 'fs:ls:result', sessionId: msg.sessionId, path: msg.path, entries: r.entries ?? [], error: r.error })
        break
      }
      case 'fs:read': {
        const r = await this.ensureSession(msg.sessionId).readForPreview(msg.path)
        send(
          'error' in r
            ? { type: 'fs:read:result', sessionId: msg.sessionId, path: msg.path, error: r.error }
            : { type: 'fs:read:result', sessionId: msg.sessionId, path: msg.path, content: r.content, encoding: r.encoding, mimeType: r.mimeType, truncated: r.truncated },
        )
        break
      }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `yarn vitest run packages/sidecar/src/session/session-manager-fs.test.ts && yarn workspace @hip/sidecar type-check`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-fs.test.ts
git commit -m "feat(session-manager): handle session:setCwd, fs:ls, fs:read"
```

---

## Phase 3 — Tauri

### Task 6: Native directory picker plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `package.json`

- [ ] **Step 1: Add the Rust dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Register the plugin**

In `src-tauri/src/lib.rs`, find the builder chain (where `.plugin(tauri_plugin_shell::init())` or similar is registered) and add the dialog plugin alongside the others:

```rust
        .plugin(tauri_plugin_dialog::init())
```

(Place it next to the existing `.plugin(...)` calls, before `.invoke_handler(...)`.)

- [ ] **Step 3: Grant the capability**

In `src-tauri/capabilities/default.json`, add `"dialog:allow-open"` to the `permissions` array:

```json
    "core:window:allow-start-dragging",
    "dialog:allow-open"
```

(Append after the last existing permission; ensure valid JSON commas.)

- [ ] **Step 4: Add the JS binding dependency**

In root `package.json` `dependencies`, add:

```json
    "@tauri-apps/plugin-dialog": "^2",
```

- [ ] **Step 5: Install and build**

Run: `yarn install && (cd src-tauri && cargo build)`
Expected: install resolves `@tauri-apps/plugin-dialog`; `cargo build` compiles with the new plugin.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json yarn.lock src-tauri/Cargo.lock
git commit -m "feat(tauri): add tauri-plugin-dialog for native directory picking"
```

---

## Phase 4 — Frontend domain

### Task 7: `session:cwd` reducer case

**Files:**
- Modify: `src/domain/sessionStore.ts`
- Test: `src/domain/sessionStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/domain/sessionStore.test.ts` (match the file's import of `applyServerMessage` and its `SessionVM` construction style):

```ts
describe('applyServerMessage session:cwd', () => {
  it('sets cwd on the matching session config', () => {
    const base = emptySession('s1') // import emptySession from './sessionStore' if not already
    const next = applyServerMessage({ sessions: [base] }, { type: 'session:cwd', sessionId: 's1', cwd: '/proj' }, 0)
    expect(next.sessions[0].config.cwd).toBe('/proj')
  })
})
```

> If `emptySession` isn't already imported in this test file, add it to the existing `import { ... } from './sessionStore'` line.

- [ ] **Step 2: Run it to confirm it fails**

Run: `yarn vitest run src/domain/sessionStore.test.ts`
Expected: FAIL — `config.cwd` is `undefined` (no case handles `session:cwd`).

- [ ] **Step 3: Add the reducer case**

In `src/domain/sessionStore.ts`, inside `applyServerMessage`'s `switch (msg.type)`, add before `default:`:

```ts
    case 'session:cwd':
      return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, cwd: msg.cwd } }))
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `yarn vitest run src/domain/sessionStore.test.ts && yarn type-check`
Expected: PASS + clean.

> `FileTree` (Task 11) reads the active session's `config.cwd` via the existing `useActiveSession()` — no extra selector hook is needed.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "feat(domain): session:cwd reducer sets config.cwd"
```

### Task 8: `fsStore` per-session cache

**Files:**
- Create: `src/store/fsStore.ts`
- Test: `src/store/fsStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/store/fsStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useFsStore } from './fsStore'

beforeEach(() => useFsStore.setState({ bySession: {} }))

describe('fsStore', () => {
  it('setEntries stores entries per dir/session', () => {
    useFsStore.getState().setEntries('s1', '/root', [{ name: 'a', path: '/root/a', isDir: false }])
    expect(useFsStore.getState().bySession.s1.entriesByDir['/root']).toHaveLength(1)
  })
  it('toggleExpanded flips a directory', () => {
    useFsStore.getState().toggleExpanded('s1', '/root/src')
    expect(useFsStore.getState().bySession.s1.expanded['/root/src']).toBe(true)
    useFsStore.getState().toggleExpanded('s1', '/root/src')
    expect(useFsStore.getState().bySession.s1.expanded['/root/src']).toBe(false)
  })
  it('setPreview replaces the preview state', () => {
    useFsStore.getState().setPreview('s1', { status: 'loading', path: '/root/a.md' })
    expect(useFsStore.getState().bySession.s1.preview).toMatchObject({ status: 'loading' })
  })
  it('clearSession resets a session', () => {
    useFsStore.getState().setActive('s1', '/root/a')
    useFsStore.getState().clearSession('s1')
    expect(useFsStore.getState().bySession.s1.activePath).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `yarn vitest run src/store/fsStore.test.ts`
Expected: FAIL — cannot find module `./fsStore`.

- [ ] **Step 3: Implement `fsStore.ts`**

Create `src/store/fsStore.ts`:

```ts
import { create } from 'zustand'
import type { FsEntry } from '@hip/protocol'

export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | { status: 'ready'; path: string; content?: string; encoding?: 'utf8' | 'base64'; mimeType?: string; truncated?: boolean; error?: string }

export interface SessionFs {
  entriesByDir: Record<string, FsEntry[]>
  expanded: Record<string, boolean>
  activePath: string | null
  preview: PreviewState
}

export const EMPTY_FS: SessionFs = { entriesByDir: {}, expanded: {}, activePath: null, preview: { status: 'idle' } }

interface FsStore {
  bySession: Record<string, SessionFs>
  setEntries: (sessionId: string, dir: string, entries: FsEntry[]) => void
  toggleExpanded: (sessionId: string, dir: string) => void
  setActive: (sessionId: string, path: string) => void
  setPreview: (sessionId: string, preview: PreviewState) => void
  clearSession: (sessionId: string) => void
}

function patch(bySession: Record<string, SessionFs>, id: string, fn: (s: SessionFs) => SessionFs): Record<string, SessionFs> {
  return { ...bySession, [id]: fn(bySession[id] ?? EMPTY_FS) }
}

export const useFsStore = create<FsStore>((set) => ({
  bySession: {},
  setEntries: (id, dir, entries) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, entriesByDir: { ...s.entriesByDir, [dir]: entries } })) })),
  toggleExpanded: (id, dir) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, expanded: { ...s.expanded, [dir]: !s.expanded[dir] } })) })),
  setActive: (id, path) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, activePath: path })) })),
  setPreview: (id, preview) =>
    set((st) => ({ bySession: patch(st.bySession, id, (s) => ({ ...s, preview })) })),
  clearSession: (id) =>
    set((st) => ({ bySession: { ...st.bySession, [id]: EMPTY_FS } })),
}))
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `yarn vitest run src/store/fsStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/fsStore.ts src/store/fsStore.test.ts
git commit -m "feat(store): fsStore per-session tree/preview cache"
```

### Task 9: Directory picker IPC + sessionService fs actions

**Files:**
- Create: `src/ipc/dialog.ts`
- Modify: `src/domain/sessionService.ts`
- Test: `src/domain/sessionService.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/domain/sessionService.test.ts`. First add the import and reset at the top of the file:

```ts
import { useFsStore } from '@/store/fsStore'
```

Add to the existing `beforeEach` body:

```ts
  useFsStore.setState({ bySession: {} })
```

Then add these tests inside the `describe('SessionService', ...)` block:

```ts
  it('setProjectDir optimistically sets cwd and sends session:setCwd', () => {
    const t = new FakeTransport()
    new SessionService(t).setProjectDir('s1', '/proj')
    expect(useDomainStore.getState().sessions[0].config.cwd).toBe('/proj')
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:setCwd', sessionId: 's1', cwd: '/proj' })
  })

  it('readFile marks the preview loading and sends fs:read', () => {
    const t = new FakeTransport()
    new SessionService(t).readFile('s1', '/proj/a.md')
    expect(useFsStore.getState().bySession.s1.preview).toMatchObject({ status: 'loading', path: '/proj/a.md' })
    expect(t.sent.at(-1)).toMatchObject({ type: 'fs:read', sessionId: 's1', path: '/proj/a.md' })
  })

  it('fs:ls:result populates entries', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:ls:result', sessionId: 's1', path: '/proj', entries: [{ name: 'a.md', path: '/proj/a.md', isDir: false }] })
    expect(useFsStore.getState().bySession.s1.entriesByDir['/proj']).toHaveLength(1)
  })

  it('fs:read:result populates the preview', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:read:result', sessionId: 's1', path: '/proj/a.md', content: '# Hi', encoding: 'utf8', mimeType: 'text/markdown' })
    expect(useFsStore.getState().bySession.s1.preview).toMatchObject({ status: 'ready', content: '# Hi' })
  })
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `yarn vitest run src/domain/sessionService.test.ts`
Expected: FAIL — `setProjectDir`/`readFile` not functions; fs results not routed.

- [ ] **Step 3: Create the dialog IPC**

Create `src/ipc/dialog.ts`:

```ts
// Native folder picker. In E2E (and any harness), `window.__hipPickDir` is a seam
// that returns a fixture path, since WebdriverIO can't drive the native OS dialog.
declare global {
  interface Window {
    __hipPickDir?: () => Promise<string | null>
  }
}

export async function pickDirectory(): Promise<string | null> {
  if (typeof window !== 'undefined' && window.__hipPickDir) return window.__hipPickDir()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({ directory: true, multiple: false, title: '选择项目文件夹' })
  return typeof result === 'string' ? result : null
}

export {}
```

- [ ] **Step 4: Add the sessionService actions + routing**

In `src/domain/sessionService.ts`, add the fsStore import:

```ts
import { useFsStore } from '@/store/fsStore'
```

Replace the `receive` method with one that routes fs results and refreshes after a turn:

```ts
  private receive(msg: ServerMessage): void {
    useDomainStore.getState().apply(msg)
    if (msg.type === 'ready') {
      this.transport.send({ type: 'session:list' })
    } else if (msg.type === 'fs:ls:result') {
      useFsStore.getState().setEntries(msg.sessionId, msg.path, msg.entries)
    } else if (msg.type === 'fs:read:result') {
      useFsStore.getState().setPreview(msg.sessionId, {
        status: 'ready', path: msg.path, content: msg.content, encoding: msg.encoding, mimeType: msg.mimeType, truncated: msg.truncated, error: msg.error,
      })
    } else if (msg.type === 'message:complete') {
      // The agent may have written files this turn — re-pull every loaded dir + the open file.
      const fsState = useFsStore.getState().bySession[msg.sessionId]
      if (fsState) {
        for (const dir of Object.keys(fsState.entriesByDir)) this.transport.send({ type: 'fs:ls', sessionId: msg.sessionId, path: dir })
        if (fsState.activePath) this.transport.send({ type: 'fs:read', sessionId: msg.sessionId, path: fsState.activePath })
      }
    }
  }
```

Add these public methods to the `SessionService` class (e.g. after `renameSession`):

```ts
  setProjectDir(id: string, cwd: string): void {
    useDomainStore.getState().apply({ type: 'session:cwd', sessionId: id, cwd }) // optimistic
    useFsStore.getState().clearSession(id)
    this.transport.send({ type: 'session:setCwd', sessionId: id, cwd })
  }

  lsDir(sessionId: string, path: string): void {
    this.transport.send({ type: 'fs:ls', sessionId, path })
  }

  readFile(sessionId: string, path: string): void {
    useFsStore.getState().setPreview(sessionId, { status: 'loading', path })
    this.transport.send({ type: 'fs:read', sessionId, path })
  }
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `yarn vitest run src/domain/sessionService.test.ts && yarn type-check`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add src/ipc/dialog.ts src/domain/sessionService.ts src/domain/sessionService.test.ts
git commit -m "feat(domain): pickDirectory IPC + setProjectDir/lsDir/readFile + fs routing"
```

---

## Phase 5 — Frontend UI

### Task 10: `previewKind` + `FilePreview`

**Files:**
- Create: `src/components/artifact/previewKind.ts`
- Create: `src/components/artifact/FilePreview.tsx`
- Test: `src/components/artifact/previewKind.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/artifact/previewKind.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { previewKind } from './previewKind'

describe('previewKind', () => {
  it('detects markdown', () => expect(previewKind('/a/README.md', 'text/markdown')).toBe('markdown'))
  it('detects html', () => expect(previewKind('/a/index.html', 'text/html')).toBe('html'))
  it('detects image by mime', () => expect(previewKind('/a/logo.png', 'image/png')).toBe('image'))
  it('detects image by ext', () => expect(previewKind('/a/pic.svg', 'image/svg+xml')).toBe('image'))
  it('falls back to text for code', () => expect(previewKind('/a/main.ts', 'text/plain')).toBe('text'))
  it('returns none for unknown extension-less binary', () => expect(previewKind('/a/blob')).toBe('none'))
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `yarn vitest run src/components/artifact/previewKind.test.ts`
Expected: FAIL — cannot find module `./previewKind`.

- [ ] **Step 3: Implement `previewKind.ts`**

Create `src/components/artifact/previewKind.ts`:

```ts
export type PreviewKind = 'markdown' | 'html' | 'image' | 'text' | 'none'

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])

export function previewKind(path: string, mimeType?: string): PreviewKind {
  const dot = path.lastIndexOf('.')
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  if (mimeType?.startsWith('image/') || IMG_EXT.has(ext)) return 'image'
  if (mimeType === 'text/markdown' || ext === '.md' || ext === '.markdown') return 'markdown'
  if (mimeType === 'text/html' || ext === '.html' || ext === '.htm') return 'html'
  if (mimeType?.startsWith('text/') || ext) return 'text'
  return 'none'
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `yarn vitest run src/components/artifact/previewKind.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `FilePreview.tsx`** (rendering verified by E2E, not a unit test)

Create `src/components/artifact/FilePreview.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { useActiveSession } from '@/domain'
import { useFsStore } from '@/store/fsStore'
import { cn } from '@/lib/utils'
import { previewKind } from './previewKind'

const PROSE = `
  max-w-none text-[14px] leading-relaxed text-ink
  [&_h1]:mb-3 [&_h1]:mt-1 [&_h1]:text-[22px] [&_h1]:font-bold [&_h1]:tracking-tight
  [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:tracking-tight
  [&_p]:my-2.5
  [&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5
  [&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-surface-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12.5px]
  [&_code]:font-mono
  [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-ink-secondary
  [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse
  [&_th]:border [&_th]:border-border [&_th]:bg-surface-muted [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left
  [&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5
`

function Centered({ text, testid }: { text: string; testid: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-ink-tertiary" data-testid={testid}>
      {text}
    </div>
  )
}

function TruncBanner({ text }: { text: string }) {
  return <div className="mb-2 rounded bg-surface-muted px-2 py-1 text-[12px] text-ink-tertiary">{text}</div>
}

export function FilePreview() {
  const { t } = useTranslation()
  const sessionId = useActiveSession()?.id ?? null
  const preview = useFsStore((s) => (sessionId ? s.bySession[sessionId]?.preview : undefined))

  if (!preview || preview.status === 'idle') return <Centered text={t('artifact.selectFileToPreview')} testid="preview-empty" />
  if (preview.status === 'loading') return <Centered text={t('artifact.loading')} testid="preview-loading" />

  if (preview.error || preview.content == null) {
    const text = preview.error === 'too_large' ? t('artifact.fileTooLarge') : t('artifact.cannotPreview')
    return <Centered text={text} testid="preview-error" />
  }

  const kind = previewKind(preview.path, preview.mimeType)

  if (kind === 'image' && preview.encoding === 'base64') {
    return (
      <div className="h-full overflow-auto p-4" data-testid="preview-image">
        <img alt={preview.path} src={`data:${preview.mimeType};base64,${preview.content}`} className="max-w-full" />
      </div>
    )
  }

  if (kind === 'html') {
    return <iframe data-testid="preview-html" title="preview" sandbox="" className="h-full w-full border-0 bg-white" srcDoc={preview.content} />
  }

  if (kind === 'markdown') {
    return (
      <article className={cn('h-full overflow-auto p-4', PROSE)} data-testid="preview-markdown">
        {preview.truncated && <TruncBanner text={t('artifact.previewTruncated')} />}
        <ReactMarkdown>{preview.content}</ReactMarkdown>
      </article>
    )
  }

  return (
    <div className="h-full overflow-auto p-4" data-testid="preview-text">
      {preview.truncated && <TruncBanner text={t('artifact.previewTruncated')} />}
      <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] text-ink">{preview.content}</pre>
    </div>
  )
}
```

- [ ] **Step 6: Type-check**

Run: `yarn type-check`
Expected: clean (new i18n keys are added in Task 12; if type-check flags missing keys here, proceed — they resolve once Task 12 lands. To keep this task green standalone, do Task 12 before re-running, or temporarily verify with `yarn vitest run src/components/artifact/previewKind.test.ts` only.)

> Ordering note: `t('artifact.selectFileToPreview')` etc. are typed against `en`. If you run tasks strictly in order, do **Step 6 type-check after Task 12**. The unit test in this task does not depend on i18n.

- [ ] **Step 7: Commit**

```bash
git add src/components/artifact/previewKind.ts src/components/artifact/previewKind.test.ts src/components/artifact/FilePreview.tsx
git commit -m "feat(artifact): previewKind selector + multi-format FilePreview"
```

### Task 11: Split Files pane, real FileTree, drop Doc tab

**Files:**
- Modify: `src/store/uiStore.ts`
- Rewrite: `src/components/artifact/FileTree.tsx`
- Modify: `src/components/artifact/ArtifactPanel.tsx`
- Delete: `src/components/artifact/DocRenderer.tsx`
- Modify: `src/components/chat/ChatHeader.tsx`

- [ ] **Step 1: Drop `'doc'` from `ArtifactTab`**

In `src/store/uiStore.ts`, change:

```ts
export type ArtifactTab = 'files' | 'agents' | 'diff'
```

The default `activeTab: 'agents'` stays valid.

- [ ] **Step 2: Check the uiStore test for `'doc'`**

Run: `grep -n "doc" src/store/uiStore.test.ts`
If any test references `'doc'` as a tab, change it to `'files'`. Then run `yarn vitest run src/store/uiStore.test.ts` — expected PASS.

- [ ] **Step 3: Rewrite `FileTree.tsx`**

Replace the entire contents of `src/components/artifact/FileTree.tsx`:

```tsx
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FolderGit2, RefreshCw } from 'lucide-react'
import type { FsEntry } from '@hip/protocol'
import { useActiveSession, sessionService } from '@/domain'
import { useFsStore } from '@/store/fsStore'
import { pickDirectory } from '@/ipc/dialog'
import { cn } from '@/lib/utils'

function basename(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

function Node({ entry, sessionId, depth }: { entry: FsEntry; sessionId: string; depth: number }) {
  const open = useFsStore((s) => !!s.bySession[sessionId]?.expanded[entry.path])
  const active = useFsStore((s) => s.bySession[sessionId]?.activePath === entry.path)
  const children = useFsStore((s) => s.bySession[sessionId]?.entriesByDir[entry.path])

  const onClick = () => {
    if (entry.isDir) {
      useFsStore.getState().toggleExpanded(sessionId, entry.path)
      if (!children) sessionService.lsDir(sessionId, entry.path)
    } else {
      useFsStore.getState().setActive(sessionId, entry.path)
      sessionService.readFile(sessionId, entry.path)
    }
  }

  return (
    <div>
      <div
        data-testid="tree-entry"
        data-path={entry.path}
        onClick={onClick}
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-[13px] transition-colors',
          active ? 'bg-accent-subtle text-accent' : 'text-ink hover:bg-surface-muted',
        )}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        {entry.isDir
          ? open ? <ChevronDown size={14} className="text-ink-tertiary" /> : <ChevronRight size={14} className="text-ink-tertiary" />
          : <span className="w-3.5" />}
        {entry.isDir
          ? open ? <FolderOpen size={15} className="text-accent" /> : <Folder size={15} className="text-accent" />
          : <File size={15} className="text-ink-tertiary" />}
        <span className="truncate">{entry.name}</span>
      </div>
      {entry.isDir && open && children?.map((c) => <Node key={c.path} entry={c} sessionId={sessionId} depth={depth + 1} />)}
    </div>
  )
}

export function FileTree() {
  const { t } = useTranslation()
  const active = useActiveSession()
  const sessionId = active?.id ?? null
  const cwd = active?.config.cwd
  const rootEntries = useFsStore((s) => (sessionId && cwd ? s.bySession[sessionId]?.entriesByDir[cwd] : undefined))

  // Load the root listing once a workspace is bound and not yet cached.
  useEffect(() => {
    if (sessionId && cwd && !rootEntries) sessionService.lsDir(sessionId, cwd)
  }, [sessionId, cwd, rootEntries])

  const choose = async () => {
    const sid = sessionId ?? sessionService.createSession()
    const dir = await pickDirectory()
    if (dir) sessionService.setProjectDir(sid, dir)
  }

  if (!cwd) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-ink-tertiary" data-testid="file-tree">
        <Folder size={32} className="opacity-40" />
        <div className="max-w-[200px] text-[13px]">{t('artifact.selectFolderDesc')}</div>
        <button
          data-testid="select-folder"
          onClick={choose}
          className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {t('artifact.selectFolder')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-testid="file-tree">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="flex items-center gap-1.5 truncate text-[12px] font-medium text-ink-secondary" title={cwd}>
          <FolderGit2 size={13} className="shrink-0 text-ink-tertiary" />
          {basename(cwd)}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            title={t('artifact.refresh')}
            data-testid="refresh-tree"
            onClick={() => sessionId && sessionService.lsDir(sessionId, cwd)}
            className="rounded p-1 text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <RefreshCw size={13} />
          </button>
          <button
            title={t('artifact.changeFolder')}
            onClick={choose}
            className="rounded p-1 text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <Folder size={13} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {sessionId && rootEntries?.map((e) => <Node key={e.path} entry={e} sessionId={sessionId} depth={0} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update `ArtifactPanel.tsx`**

Replace the entire contents of `src/components/artifact/ArtifactPanel.tsx`:

```tsx
import { X } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useTranslation } from 'react-i18next'
import type { ArtifactTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { FileTree } from './FileTree'
import { FilePreview } from './FilePreview'
import { AgentDashboard } from './AgentDashboard'
import { DiffViewer } from './DiffViewer'

export function ArtifactPanel() {
  const { t } = useTranslation()
  const TABS: { value: ArtifactTab; label: string }[] = [
    { value: 'files', label: t('artifact.files') },
    { value: 'agents', label: t('artifact.agents') },
    { value: 'diff', label: t('artifact.diff') },
  ]
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const togglePanel = useUiStore((s) => s.togglePanel)

  return (
    <div className="h-full bg-surface">
      <Tabs value={activeTab} onValueChange={(v) => setTab(v as ArtifactTab)} className="flex h-full flex-col">
        <div
          data-tauri-drag-region
          className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2"
        >
          <TabsList className="h-full gap-4" data-tauri-drag-region="false">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-${tab.value}`}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button variant="ghost" size="icon" onClick={togglePanel} title={t('artifact.closePanel')} data-tauri-drag-region="false">
            <X size={16} />
          </Button>
        </div>

        <TabsContent value="files" className="overflow-hidden p-0">
          <PanelGroup direction="horizontal" className="h-full">
            <Panel defaultSize={42} minSize={24}>
              <FileTree />
            </Panel>
            <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
              <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
            </PanelResizeHandle>
            <Panel minSize={30}>
              <FilePreview />
            </Panel>
          </PanelGroup>
        </TabsContent>
        <TabsContent value="agents" className="p-3">
          <AgentDashboard />
        </TabsContent>
        <TabsContent value="diff" className="p-0">
          <DiffViewer />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 5: Delete `DocRenderer.tsx`**

Run: `git rm src/components/artifact/DocRenderer.tsx`
(Its prose styles now live in `FilePreview.tsx`. Confirm nothing else imports it: `grep -rn "DocRenderer" src` → only the now-updated ArtifactPanel, which no longer references it.)

- [ ] **Step 6: Add the panel-toggle testid in `ChatHeader.tsx`**

In `src/components/chat/ChatHeader.tsx`, add `data-testid="toggle-panel"` to the panel-toggle `Button` (the one with `onClick={togglePanel}` and `<PanelRight />`):

```tsx
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePanel}
        title={t('chat.togglePanel')}
        data-tauri-drag-region="false"
        data-testid="toggle-panel"
      >
        <PanelRight size={17} />
      </Button>
```

- [ ] **Step 7: Type-check** (expect i18n key errors until Task 12; proceed to Task 12 then re-check)

Run: `yarn type-check`
Expected: errors only for not-yet-added `artifact.*` keys (resolved in Task 12). No other errors.

- [ ] **Step 8: Commit**

```bash
git add src/store/uiStore.ts src/components/artifact/FileTree.tsx src/components/artifact/ArtifactPanel.tsx src/components/chat/ChatHeader.tsx
git rm src/components/artifact/DocRenderer.tsx
git commit -m "feat(artifact): split Files into tree+preview; drop Doc tab"
```

### Task 12: i18n keys (three locales)

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`

- [ ] **Step 1: Replace the `artifact` block in `en.ts`**

In `src/i18n/en.ts`, replace the entire `artifact: { ... },` block with:

```ts
    artifact: {
      files: 'Files',
      agents: 'Agents',
      diff: 'Diff',
      closePanel: 'Close Panel',
      noDiff: 'No diff yet',
      noDiffDesc: 'Changes made by agents will appear here',
      waiting: 'Waiting…',
      parallelAgents: 'Sub-agents',
      selectFolder: 'Select Project Folder',
      selectFolderDesc: 'Pick a folder for the agent to read and write, and browse it here',
      changeFolder: 'Change Folder',
      refresh: 'Refresh',
      selectFileToPreview: 'Select a file to preview',
      cannotPreview: 'Cannot preview this file',
      fileTooLarge: 'File is too large to preview',
      previewTruncated: 'Showing the first 1 MB',
      loading: 'Loading…',
    },
```

- [ ] **Step 2: Replace the `artifact` block in `zh-CN.ts`**

```ts
    artifact: {
      files: '文件',
      agents: '智能体',
      diff: '差异',
      closePanel: '关闭面板',
      noDiff: '暂无差异',
      noDiffDesc: '智能体的改动会显示在这里',
      waiting: '等待中…',
      parallelAgents: '子智能体',
      selectFolder: '选择项目文件夹',
      selectFolderDesc: '选择一个文件夹，供智能体读写，并在此浏览',
      changeFolder: '更换文件夹',
      refresh: '刷新',
      selectFileToPreview: '选择文件以预览',
      cannotPreview: '无法预览此文件',
      fileTooLarge: '文件过大，无法预览',
      previewTruncated: '仅显示前 1 MB',
      loading: '加载中…',
    },
```

- [ ] **Step 3: Replace the `artifact` block in `zh-TW.ts`**

```ts
    artifact: {
      files: '檔案',
      agents: '智能體',
      diff: '差異',
      closePanel: '關閉面板',
      noDiff: '尚無差異',
      noDiffDesc: '智能體的變更會顯示在這裡',
      waiting: '等待中…',
      parallelAgents: '子智能體',
      selectFolder: '選擇專案資料夾',
      selectFolderDesc: '選擇一個資料夾，供智能體讀寫，並在此瀏覽',
      changeFolder: '更換資料夾',
      refresh: '重新整理',
      selectFileToPreview: '選擇檔案以預覽',
      cannotPreview: '無法預覽此檔案',
      fileTooLarge: '檔案過大，無法預覽',
      previewTruncated: '僅顯示前 1 MB',
      loading: '載入中…',
    },
```

- [ ] **Step 4: Verify no orphaned old keys remain referenced**

Run: `grep -rn "artifact.doc\|artifact.noDoc\|artifact.noFiles" src`
Expected: no matches (all removed keys are unreferenced). If any remain, update the call site to the new keys.

- [ ] **Step 5: Full type-check (now green)**

Run: `yarn type-check`
Expected: clean. The `i18next.d.ts` resource type derives from `en`, and all three locales now share the same shape.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(i18n): workspace/preview keys; drop doc keys (en/zh-CN/zh-TW)"
```

---

## Phase 6 — Real-machine E2E

### Task 13: Fixture + WebdriverIO spec

**Files:**
- Create: `e2e/fixtures/sample-project/README.md`, `index.html`, `logo.png`, `src/a.ts`
- Create: `e2e/specs/project-workspace.spec.ts`

- [ ] **Step 1: Create the fixture files**

```bash
mkdir -p e2e/fixtures/sample-project/src
printf '# Sample Project\n\nThis is a fixture for the workspace E2E.\n' > e2e/fixtures/sample-project/README.md
printf '<!doctype html><html><body><h1>Fixture Page</h1></body></html>\n' > e2e/fixtures/sample-project/index.html
printf 'export const a = 1\n' > e2e/fixtures/sample-project/src/a.ts
node -e "require('fs').writeFileSync('e2e/fixtures/sample-project/logo.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'))"
```

Verify: `ls -R e2e/fixtures/sample-project` shows `README.md index.html logo.png src/a.ts`.

- [ ] **Step 2: Write the E2E spec**

Create `e2e/specs/project-workspace.spec.ts`:

```ts
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')

describe('project workspace', () => {
  before(async () => {
    await browser.pause(2500)
    const skip = await browser.$('button=跳过登录')
    if (await skip.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), (await skip) as unknown as HTMLElement)
      await browser.waitUntil(async () => (await browser.getUrl()).includes('#/app'), { timeout: 10000, interval: 200 })
    }
    // Seam: native folder dialog can't be driven by wdio — return the fixture path.
    await browser.execute((dir: string) => {
      ;(window as unknown as { __hipPickDir?: () => Promise<string> }).__hipPickDir = () => Promise.resolve(dir)
    }, FIXTURE)
  })

  it('selects a folder and renders the file tree', async () => {
    await (await browser.$('[data-testid="toggle-panel"]')).click()
    await (await browser.$('[data-testid="tab-files"]')).click()
    await (await browser.$('[data-testid="select-folder"]')).click()
    const readme = await browser.$('[data-testid="tree-entry"][data-path$="README.md"]')
    await readme.waitForExist({ timeout: 8000 })
    expect(await (await browser.$('[data-testid="tree-entry"][data-path$="src"]')).isExisting()).toBe(true)
  })

  it('lazily expands a directory', async () => {
    await (await browser.$('[data-testid="tree-entry"][data-path$="src"]')).click()
    const child = await browser.$('[data-testid="tree-entry"][data-path$="a.ts"]')
    await child.waitForExist({ timeout: 6000 })
    expect(await child.isExisting()).toBe(true)
  })

  it('renders a Markdown preview (rendered, not source)', async () => {
    await (await browser.$('[data-testid="tree-entry"][data-path$="README.md"]')).click()
    const md = await browser.$('[data-testid="preview-markdown"]')
    await md.waitForExist({ timeout: 6000 })
    expect(await md.getText()).toContain('Sample Project')
  })

  it('renders HTML in a sandboxed iframe', async () => {
    await (await browser.$('[data-testid="tree-entry"][data-path$="index.html"]')).click()
    const frame = await browser.$('[data-testid="preview-html"]')
    await frame.waitForExist({ timeout: 6000 })
    expect(await frame.getAttribute('sandbox')).toBe('')
  })

  it('renders an image as a data URL', async () => {
    await (await browser.$('[data-testid="tree-entry"][data-path$="logo.png"]')).click()
    const img = await browser.$('[data-testid="preview-image"] img')
    await img.waitForExist({ timeout: 6000 })
    expect(await img.getAttribute('src')).toContain('data:image/png;base64,')
  })

  it('renders a code/text file as monospace text', async () => {
    // src/ was expanded in the earlier test, so a.ts is in the tree.
    await (await browser.$('[data-testid="tree-entry"][data-path$="a.ts"]')).click()
    const txt = await browser.$('[data-testid="preview-text"]')
    await txt.waitForExist({ timeout: 6000 })
    expect(await txt.getText()).toContain('export const a')
  })
})
```

> Sandbox traversal (rejecting paths outside the project root) is covered deterministically by the `workspace-fs` and `session-manager` unit tests rather than E2E — wiring a window-level transport seam solely for that case would be over-engineering. Per-session empty-state on tab switch is likewise left to manual acceptance.

- [ ] **Step 3: Build the app bundle the E2E driver runs**

Run: `yarn tauri build --debug`
Expected: produces `src-tauri/target/debug/bundle/macos/hip.app` (the binary `wdio.conf.ts` launches). (If a debug bundle already exists and only frontend/sidecar changed, rebuild to embed the latest sidecar + frontend.)

- [ ] **Step 4: Run the E2E suite**

Run: `yarn test:e2e`
Expected: both `app-launch.spec.ts` and `project-workspace.spec.ts` pass. The workspace spec drives a real window: open panel → Files tab → select fixture folder → tree renders → expand `src` → preview Markdown/HTML/image. No API key needed (fs ops don't call the LLM).

> If the tree doesn't populate, confirm the sidecar is reachable (the app spawns it) and that `FIXTURE` resolves to an absolute path on the test machine (it uses the wdio runner's `process.cwd()` = repo root).

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures/sample-project e2e/specs/project-workspace.spec.ts
git commit -m "test(e2e): real-machine workspace flow (tree + md/html/image preview)"
```

---

## Final Verification

- [ ] **Offline unit + type checks (no LLM/API spend)**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check && yarn vitest run packages/sidecar/src/session/workspace-fs.test.ts packages/sidecar/src/session/session-cwd.test.ts packages/sidecar/src/session/session-manager-fs.test.ts packages/sidecar/src/persistence/store.test.ts src/store/fsStore.test.ts src/domain/sessionStore.test.ts src/domain/sessionService.test.ts src/components/artifact/previewKind.test.ts`
Expected: all clean/green.

> Do NOT run a bare `yarn test` with a `src` positional filter — per project convention it substring-matches the real-LLM sidecar suites (`session.test.ts`, `multiagent.integration.test.ts`) and spends DeepSeek quota. Run the explicit file list above, or `yarn vitest run` (which respects the config's includes but still runs the two `skipIf(!DEEPSEEK_API_KEY)` files as skips when no key is set).

- [ ] **Real-machine E2E**

Run: `yarn test:e2e`
Expected: green (Task 13).

- [ ] **Manual GUI acceptance (real DeepSeek — one pass, user-driven)**

1. `yarn tauri dev`, configure the API key in Settings.
2. New chat → open panel → Files → **Select Project Folder** → pick a small real project.
3. Ask the agent to "create `hello.ts` with a single console.log line".
4. After the turn completes, confirm `hello.ts` appears in the tree (auto-refresh), opens in the preview with the right content, and exists on the real disk.
5. Confirm the agent cannot escape the folder (paths stay under the chosen root).

---

## Notes for the implementer

- **DRY:** `FilePreview` reuses the exact prose classes formerly in `DocRenderer`; the agent backend (`FilesystemBackend`) and the UI reader (`workspace-fs`) deliberately stay separate (binary/mime control) but both anchor to `cwd`.
- **YAGNI:** no file editing, no syntax highlighting, no `fs.watch` (refresh-on-turn + manual refresh), no Diff-tab integration, no ignore rules (lazy load controls volume).
- **Sandbox invariants:** agent backend is always `virtualMode: true`; `workspace-fs.resolveWithin` re-checks every UI read. Protocol/UI carry absolute paths; the agent's tools use virtual paths internally — two representations, same files.
- **No-LLM tests:** every Vitest suite here is deterministic and offline. The only real-DeepSeek check is the manual GUI pass.
