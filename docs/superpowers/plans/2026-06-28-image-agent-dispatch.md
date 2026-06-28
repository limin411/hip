# Image Attachment Direct Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user sends an image attachment while the session's main model is text-only, the sidecar automatically hands the whole turn to an enabled internal multimodal sub-agent, without changing the main session model.

**Architecture:** Add a sidecar agent selector that filters internal agents by multimodal bound model and prompt-keyword match. Extend the internal agent runner and invoker to accept image attachments. In `Session.processInput`, detect the dispatch trigger and run a new `runManagedAgentTurn` path that emits agent events, invokes the selected agent, and emits the assistant response. The frontend stops switching models on image attach.

**Tech Stack:** TypeScript, Vitest, LangChain `@langchain/core` messages, existing hip sidecar session/attachment modules.

## Global Constraints

- Dispatch only for image attachments (`mimeType.startsWith('image/')`).
- Only internal agents (`kind === 'internal'`) that are enabled, not `builtin`, and have a multimodal `boundModel` are eligible.
- The main session model is never mutated by the frontend for image attachments.
- External ACP/custom agents are out of scope for automatic dispatch.
- Follow existing code style and patterns in the repo.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/sidecar/src/session/agents/registry.ts` | New `selectImageAgent` helper and keyword extraction. |
| `packages/sidecar/src/session/agents/registry.test.ts` | Unit tests for `selectImageAgent`. |
| `packages/sidecar/src/session/internal-runner.ts` | Extend `runManagedAgent` to build multipart `HumanMessage` from `task + attachments`. |
| `packages/sidecar/src/session/internal-runner.test.ts` | Test that image attachments become content parts. |
| `packages/sidecar/src/session/agents/invoker.ts` | Extend `AgentInvoker.invoke` and `RunInternalArgs` with optional `attachments`. |
| `packages/sidecar/src/session/agents/invoker.test.ts` | Test that internal branch forwards attachments. |
| `packages/sidecar/src/session/session.ts` | Detect dispatch trigger in `processInput`; add `runManagedAgentTurn`. |
| `packages/sidecar/src/session/session-image-agent-dispatch.integration.test.ts` | Integration test for full dispatch flow. |
| `src/domain/sessionService.ts` | Remove send-time model-switch fallback. |
| `src/domain/sessionService.test.ts` | Assert no model switch on image send/regenerate. |
| `src/components/chat/InputBar.tsx` | Remove model-switch effect/callback; keep attachment-clear guard. |
| `src/components/chat/InputBar.test.tsx` | Assert no model switch when image attached. |

---

## Task 1: Sidecar Agent Selector

**Files:**
- Modify: `packages/sidecar/src/session/agents/registry.ts`
- Test: `packages/sidecar/src/session/agents/registry.test.ts`

**Interfaces:**
- Consumes: `AgentConfig` from `@hip/protocol`, `Catalog` / `readCatalog` from `../../config/catalog.js`.
- Produces: `selectImageAgent(cwd: string, userPrompt: string, catalog?: Catalog): AgentConfig | null`.

- [ ] **Step 1: Write the failing test**

Append to `packages/sidecar/src/session/agents/registry.test.ts`:

```ts
import { selectImageAgent } from './registry.js'
import type { Catalog } from '../../config/catalog.js'

const visionCatalog: Catalog = {
  openai: { id: 'openai', name: 'OpenAI', env: [], models: { 'gpt-4o': { id: 'gpt-4o', attachment: true } } },
  deepseek: { id: 'deepseek', name: 'DeepSeek', env: [], models: { 'deepseek-chat': { id: 'deepseek-chat', attachment: false } } },
}

describe('selectImageAgent', () => {
  it('returns null when no internal multimodal agent exists', () => {
    const dir = tmpDir()
    writeToml(dir, 'hip.toml', `version = 1\n[[agents]]\nid = "a1"\nname = "A"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\n`)
    expect(selectImageAgent(dir, 'describe image', visionCatalog)).toBeNull()
  })

  it('returns the internal multimodal agent when only one exists', () => {
    const dir = tmpDir()
    writeToml(dir, 'hip.toml', `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "vision expert"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`)
    const agent = selectImageAgent(dir, 'describe image', visionCatalog)
    expect(agent).not.toBeNull()
    expect(agent!.id).toBe('vis')
  })

  it('picks the agent whose prompt matches a user keyword', () => {
    const dir = tmpDir()
    writeToml(dir, 'hip.toml', `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "analyze screenshots"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n\n[[agents]]\nid = "doc"\nname = "Doc"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "read documents"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`)
    const agent = selectImageAgent(dir, 'check this screenshot', visionCatalog)
    expect(agent!.id).toBe('vis')
  })

  it('falls back to the first internal multimodal agent when no keyword matches', () => {
    const dir = tmpDir()
    writeToml(dir, 'hip.toml', `version = 1\n[[agents]]\nid = "doc"\nname = "Doc"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "read documents"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "analyze screenshots"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`)
    const agent = selectImageAgent(dir, 'hello world', visionCatalog)
    expect(agent!.id).toBe('doc')
  })

  it('ignores disabled, builtin, or non-internal agents', () => {
    const dir = tmpDir()
    writeToml(dir, 'hip.toml', `version = 1\n[[agents]]\nid = "builtin"\nname = "Builtin"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "vision"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n\n[[agents]]\nid = "disabled"\nname = "Disabled"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = false\nprompt = "vision"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n\n[[agents]]\nid = "acp"\nname = "ACP"\nkind = "acp"\ncommand = "x"\nargs = []\nenabled = true\n`)
    expect(selectImageAgent(dir, 'describe image', visionCatalog)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test packages/sidecar/src/session/agents/registry.test.ts
```

Expected: FAIL — `selectImageAgent` not defined.

- [ ] **Step 3: Implement the selector**

Modify `packages/sidecar/src/session/agents/registry.ts`:

```ts
import type { Catalog } from '../../config/catalog.js'
import { readCatalog } from '../../config/catalog.js'

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','must','shall','can','need','dare','ought','used','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','under','again','further','then','once','here','there','when','where','why','how','all','any','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','and','but','if','or','because','until','while','what','which','who','whom','this','that','these','those','am','it','its','their','them','they','we','our','you','your','i','me','my','he','she','his','her','him',
  '请','一下','的','了','在','是','我','你','他','她','它','我们','你们','他们','这个','那个','这些','那些','什么','怎么','为什么','哪里','谁','哪','和','或','但是','如果','因为','所以','虽然','然后','就','都','也','很','非常','不','没','有','没有','要','会','能','可以','应该','可能','必须','需要','把','被','给','对','向','从','到','让','看','说','做','用','拿','想','知道','觉得','认为','吗','呢','吧','啊','哦','嗯',
])

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
  return [...new Set(words)]
}

/** Pick the best internal multimodal agent for an image turn.
 *  - Filter to enabled, non-builtin internal agents with a multimodal boundModel.
 *  - If the user prompt contains keywords matching an agent's prompt/description, pick the first match.
 *  - Otherwise fall back to the first eligible agent.
 *  - Returns null if no eligible agent exists.
 */
export function selectImageAgent(cwd: string, userPrompt: string, catalog?: Catalog): AgentConfig | null {
  const cat = catalog ?? readCatalog()
  const agents = readAgentsConfig(cwd).filter((a) => {
    if (a.kind !== 'internal' || !a.enabled || a.id === 'builtin') return false
    if (!a.boundModel) return false
    return !!cat[a.boundModel.providerID]?.models[a.boundModel.modelID]?.attachment
  })
  if (agents.length === 0) return null
  const keywords = extractKeywords(userPrompt)
  if (keywords.length > 0) {
    const matched = agents.filter((a) =>
      keywords.some((kw) =>
        (a.prompt ?? '').toLowerCase().includes(kw) ||
        (a.description ?? '').toLowerCase().includes(kw),
      ),
    )
    if (matched.length > 0) return matched[0]
  }
  return agents[0]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test packages/sidecar/src/session/agents/registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/agents/registry.ts packages/sidecar/src/session/agents/registry.test.ts
git commit -m "feat(sidecar): add selectImageAgent for image dispatch"
```

---

## Task 2: Internal Runner Attachment Support

**Files:**
- Modify: `packages/sidecar/src/session/internal-runner.ts`
- Test: `packages/sidecar/src/session/internal-runner.test.ts`

**Interfaces:**
- Consumes: `AttachmentPayload`, `buildAttachmentContentParts`, `ContentPart` from `../attachments.js`.
- Produces: `RunManagedAgentArgs.attachments?: AttachmentPayload[]`.

- [ ] **Step 1: Write the failing test**

Append to `packages/sidecar/src/session/internal-runner.test.ts`:

```ts
import { HumanMessage } from '@langchain/core/messages'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

it('includes image attachments as content parts in the human message', async () => {
  const cwd = tmp()
  const imgPath = join(cwd, 'test.png')
  writeFileSync(imgPath, Buffer.from('fake-image-bytes'))
  const captured: BaseMessage[] = []
  const runner: ModelRunner = {
    async run(messages, opts) {
      captured.push(...messages)
      opts.onText('ok')
      return new AIMessage('ok')
    },
  }
  await runManagedAgent({
    resolved: null,
    cwd,
    prompt: 'p',
    task: 'describe',
    attachments: [{ id: 'a1', name: 'test.png', mimeType: 'image/png', path: imgPath }],
    emit: collectingEmit().emit,
    signal: new AbortController().signal,
    childMaxSteps: 5,
    runner,
    summarizer: { async summarize() { return '' } },
  })
  const human = captured.find((m) => m instanceof HumanMessage)
  expect(human).toBeDefined()
  expect(Array.isArray(human!.content)).toBe(true)
  const parts = human!.content as Array<{ type: string }>
  expect(parts).toHaveLength(2)
  expect(parts[0]).toEqual({ type: 'text', text: 'describe' })
  expect(parts[1].type).toBe('image_url')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test packages/sidecar/src/session/internal-runner.test.ts
```

Expected: FAIL — `attachments` property not accepted.

- [ ] **Step 3: Extend the runner**

Modify `packages/sidecar/src/session/internal-runner.ts`:

```ts
import { validateAttachments, buildAttachmentContentParts, type AttachmentPayload, type ContentPart } from '../attachments.js'
```

Add to `RunManagedAgentArgs`:

```ts
attachments?: AttachmentPayload[]
```

Replace the `HumanMessage` construction in `runManagedAgent`:

```ts
const humanParts: ContentPart[] = []
if (task) humanParts.push({ type: 'text', text: task })
if (attachments?.length) {
  await validateAttachments(attachments)
  const attachmentParts = await buildAttachmentContentParts(attachments)
  humanParts.push(...attachmentParts)
}
const humanMessage = humanParts.length === 0
  ? new HumanMessage('')
  : humanParts.length === 1 && humanParts[0].type === 'text'
    ? new HumanMessage(humanParts[0].text)
    : new HumanMessage({ content: humanParts })
```

Then replace `new HumanMessage(task)` in the `app.invoke` argument with `humanMessage`.

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test packages/sidecar/src/session/internal-runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/internal-runner.ts packages/sidecar/src/session/internal-runner.test.ts
git commit -m "feat(sidecar): pass attachments into managed agent human message"
```

---

## Task 3: Agent Invoker Attachment Forwarding

**Files:**
- Modify: `packages/sidecar/src/session/agents/invoker.ts`
- Test: `packages/sidecar/src/session/agents/invoker.test.ts`

**Interfaces:**
- Consumes: `AttachmentPayload` from `../attachments.js`.
- Produces: `AgentInvoker.invoke(..., extras?, attachments?)` and `RunInternalArgs.attachments?`.

- [ ] **Step 1: Write the failing test**

Append to `packages/sidecar/src/session/agents/invoker.test.ts`:

```ts
import type { AttachmentPayload } from '../attachments.js'

it('forwards attachments to runInternal for internal agents', async () => {
  const seen: AttachmentPayload[] = []
  const internalAgent: AgentConfig = {
    id: 'vis', name: 'Vision', kind: 'internal', command: '', args: [],
    enabled: true, prompt: 'vision',
  }
  const invoker = createAgentInvoker('/work', {
    readAgents: () => [internalAgent],
    resolveModel: () => null,
    runInternal: async (a) => { seen.push(...(a.attachments ?? [])); return 'ok' },
  })
  const attachments: AttachmentPayload[] = [{ id: 'a1', name: 'x.png', mimeType: 'image/png', path: '/tmp/x.png' }]
  await invoker.invoke('vis', 'look', collectingEmit().emit, new AbortController().signal, undefined, undefined, attachments)
  expect(seen).toEqual(attachments)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test packages/sidecar/src/session/agents/invoker.test.ts
```

Expected: FAIL — too many arguments / `attachments` not on `RunInternalArgs`.

- [ ] **Step 3: Extend the invoker**

Modify `packages/sidecar/src/session/agents/invoker.ts`:

```ts
import type { AttachmentPayload } from '../attachments.js'
```

Update `AgentInvoker` interface:

```ts
invoke(agentId: string, task: string, emit: GraphEmit, signal: AbortSignal, hooks?: ExternalAgentHooks, extras?: InvokerExtras, attachments?: AttachmentPayload[]): Promise<string>
```

Add to `RunInternalArgs`:

```ts
attachments?: AttachmentPayload[]
```

In `createAgentInvoker`, update the internal branch to forward attachments:

```ts
return runInternal({
  agentId, resolved: resolveModel(agent, cwd), cwd, prompt: agent.prompt ?? '',
  task, emit, signal,
  mcpTools: narrowedMcp, skills: narrowedSkills,
  requestApproval: extras?.requestApproval, permissionMode: extras?.permissionMode,
  sessionId: extras?.sessionId, networkPolicy: extras?.networkPolicy,
  toolOutputStore: extras?.toolOutputStore, guardianReviewer: extras?.guardianReviewer,
  attachments,
})
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test packages/sidecar/src/session/agents/invoker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/agents/invoker.ts packages/sidecar/src/session/agents/invoker.test.ts
git commit -m "feat(sidecar): forward attachments through AgentInvoker to internal agents"
```

---

## Task 4: Session Dispatch Path

**Files:**
- Modify: `packages/sidecar/src/session/session.ts`
- Test: `packages/sidecar/src/session/session-image-agent-dispatch.integration.test.ts`

**Interfaces:**
- Consumes: `selectImageAgent` from `./agents/registry.js`, `isMultimodalModel` from `../config/catalog.js`.
- Produces: `Session.runManagedAgentTurn(input, agent, parts, send, isFirstTurn)`.

- [ ] **Step 1: Write the failing integration test**

Create `packages/sidecar/src/session/session-image-agent-dispatch.integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { AttachmentPayload } from './attachments.js'
import type { AgentInvoker } from './agents/invoker.js'
import type { ServerMessage } from '@hip/protocol'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import * as catalogModule from '../config/catalog.js'

function makeStore() {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
}

const textCatalog = {
  openai: { id: 'openai', name: 'OpenAI', env: [], models: { 'gpt-4o': { id: 'gpt-4o', attachment: true } } },
  deepseek: { id: 'deepseek', name: 'DeepSeek', env: [], models: { 'deepseek-chat': { id: 'deepseek-chat', attachment: false } } },
}

describe('Session image agent dispatch', () => {
  let scratch: string
  let cwd: string
  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-dispatch-'))
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-dispatch-cwd-'))
    await fs.mkdir(path.join(cwd, '.hip'), { recursive: true })
  })
  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true })
    await fs.rm(cwd, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('dispatches an image turn to an internal multimodal agent when the main model is text-only', async () => {
    const imgPath = path.join(scratch, 'test.png')
    await fs.writeFile(imgPath, Buffer.from('fake-image-bytes'))
    await fs.writeFile(
      path.join(cwd, '.hip', 'hip.toml'),
      `version = 1\n[[agents]]\nid = "vis"\nname = "Vision"\nkind = "internal"\ncommand = ""\nargs = []\nenabled = true\nprompt = "you are a vision expert"\n[agents.boundModel]\nproviderID = "openai"\nmodelID = "gpt-4o"\n`,
    )
    vi.spyOn(catalogModule, 'readCatalog').mockReturnValue(textCatalog)

    const st = makeStore()
    st.insertSession({ id: 's-dispatch', title: 't', config: '{}', createdAt: 1, updatedAt: 1 })

    const seen: { task?: string; attachments?: AttachmentPayload[] } = {}
    const invoker: AgentInvoker = {
      async invoke(_agentId, task, emit, _signal, _hooks, _extras, attachments) {
        seen.task = task
        seen.attachments = attachments
        emit.token('V')
        return 'vision result'
      },
    }

    const runner: ModelRunner = {
      async run(_m, o) {
        o.onText('ok')
        return new AIMessage('ok')
      },
    }

    const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [], cwd, disablePlan: true }
    const session = new Session('s-dispatch', cfg, undefined, st, undefined, 10_000, runner, undefined, () => invoker, scratch)

    const messages: ServerMessage[] = []
    const send = (msg: ServerMessage) => { messages.push(msg) }
    await session.sendMessage('describe this', send, undefined, [{ id: 'a1', name: 'test.png', mimeType: 'image/png', path: imgPath }])

    expect(seen.task).toBe('describe this')
    expect(seen.attachments).toHaveLength(1)
    expect(messages.some((m) => m.type === 'agent:started' && m.agentId === 'vis')).toBe(true)
    expect(messages.some((m) => m.type === 'agent:finished' && m.agentId === 'vis')).toBe(true)
    const complete = messages.find((m) => m.type === 'message:complete')
    expect(complete).toBeDefined()
    expect(complete!.message.content).toBe('vision result')
    expect(complete!.message.agentId).toBe('vis')
    const history = (session as unknown as { messages: BaseMessage[] }).messages
    expect(history[history.length - 1]).toBeInstanceOf(AIMessage)
    expect((history[history.length - 1] as AIMessage).content).toBe('vision result')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test packages/sidecar/src/session/session-image-agent-dispatch.integration.test.ts
```

Expected: FAIL — dispatch path not implemented; the runner or graph is invoked instead of the fake invoker.

- [ ] **Step 3: Implement the dispatch path**

Modify `packages/sidecar/src/session/session.ts`:

```ts
import { isMultimodalModel } from '../config/catalog.js'
import { selectImageAgent } from './agents/registry.js'
```

Add the helper:

```ts
private currentModelSupportsImages(): boolean {
  const choice = resolveModelChoice(this._config, getActiveModel(), this.getActiveProfile().modelBinding)
  return isMultimodalModel(choice.providerID, choice.modelID)
}
```

In `processInput`, after the existing attachment staging / `user_message` emission block and before `this.messages.push(...)` / `runTurn`, insert:

```ts
const imageAgent = hasImageAttachment && !this.currentModelSupportsImages()
  ? selectImageAgent(this._config.cwd ?? process.cwd(), input.content)
  : null
if (imageAgent) {
  return this.runManagedAgentTurn(input, imageAgent, parts, _send, isFirstTurn)
}
```

Add the new method near `runTurn`:

```ts
private async runManagedAgentTurn(input: SessionInput, agent: AgentConfig, parts: ContentPart[], _send: SendFn, isFirstTurn: boolean): Promise<string> {
  const turnId = `asst-managed-${agent.id}-${Date.now()}-${this.turnSeq++}`
  logInfo('session', 'turn:start', { sessionId: this.id, turnId, agentId: agent.id })
  this.abortController = new AbortController()
  this.running = true

  const cwd = this._config.cwd ?? process.cwd()
  const rawMode = this._config.permissionMode
  const mode: PermissionMode = rawMode === 'chat' || rawMode === 'full' ? rawMode : 'edit'
  const requestApproval = this.permissions.buildRequestApproval(_send, this.id, turnId, () => 0, mode, this.hooks)

  const emit: GraphEmit = {
    token: (delta) => { _send({ type: 'token:stream', sessionId: this.id, turnId, agentId: agent.id, delta }) },
    reasoning: () => {},
    toolStarted: (name, callId, input) => { _send({ type: 'tool:started', sessionId: this.id, turnId, agentId: agent.id, role: 'subagent', callId, name, input: typeof input === 'string' ? input : JSON.stringify(input) }) },
    toolFinished: (callId, status, output, error) => { _send({ type: 'tool:finished', sessionId: this.id, turnId, agentId: agent.id, callId, status, ...(output ? { output } : {}), ...(error ? { error } : {}) }) },
    usage: () => {},
    planDelta: () => {},
    compaction: () => {},
  }

  _send({ type: 'agent:started', sessionId: this.id, turnId, agentId: agent.id, role: 'subagent' })
  this.messages.push(parts.length === 1 && parts[0].type === 'text'
    ? new HumanMessage(input.content)
    : new HumanMessage({ content: parts }))

  let agentText = ''
  try {
    const invoker = this.agentProv.invoker(cwd)
    agentText = await invoker.invoke(agent.id, input.content, emit, this.abortController.signal, undefined, {
      mcpTools: mcpManager.tools(),
      skills: this.configMgr.skills,
      requestApproval,
      permissionMode: mode,
      sessionId: this.id,
      networkPolicy: this.networkPolicy,
      toolOutputStore: this.toolOutputStore,
      guardianReviewer: this.usesEnvModel ? new GuardianReviewer({ modelRunner: this.modelRunner() }) : undefined,
    }, input.attachments)
  } catch (err) {
    logInfo('session', 'turn:error', { sessionId: this.id, turnId, agentId: agent.id, error: err instanceof Error ? err.message : String(err) })
    const isAbort = err instanceof Error && err.name === 'AbortError'
    _send({ type: 'error', sessionId: this.id, code: isAbort ? 'CANCELLED' : 'AGENT_ERROR', message: isAbort ? 'User cancelled the request' : safeErrorMessage(err) })
    _send({ type: 'agent:finished', sessionId: this.id, turnId, agentId: agent.id })
    this.running = false
    this.abortController = null
    return ''
  }

  this.running = false
  this.abortController = null
  _send({ type: 'agent:finished', sessionId: this.id, turnId, agentId: agent.id })
  this.messages.push(new AIMessage(agentText))
  _send({ type: 'message:complete', sessionId: this.id, message: { id: turnId, role: 'assistant', content: agentText, agentId: agent.id, timestamp: Date.now() } })

  if (isFirstTurn && this.titleGenerator && agentText && this.store) {
    try {
      const refined = sanitizeTitle(await this.titleGenerator({ firstUserMessage: input.content, firstReply: agentText }))
      if (refined && this.store.updateTitleIfAuto(this.id, refined) === 1) {
        _send({ type: 'session:title', sessionId: this.id, title: refined })
      }
    } catch (err) {
      console.warn(`Title generation failed for session ${this.id}:`, err instanceof Error ? err.message : String(err))
    }
  }

  return agentText
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
yarn test packages/sidecar/src/session/session-image-agent-dispatch.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-image-agent-dispatch.integration.test.ts
git commit -m "feat(sidecar): dispatch image turns to internal multimodal agents"
```

---

## Task 5: Remove Frontend Model-Switch Fallback

**Files:**
- Modify: `src/domain/sessionService.ts`
- Modify: `src/components/chat/InputBar.tsx`

**Interfaces:**
- Removes `switchToMultimodalModelIfNeeded` and `ensureMultimodalModelForImages`.
- Keeps `isAttachmentSupported` for button visibility.

- [ ] **Step 1: Clean up sessionService.ts**

Modify `src/domain/sessionService.ts`:

```ts
// Remove this import:
// import { findMultimodalAgentModelKey, isAttachmentSupported } from '@/lib/attachmentEligibility'
import { isAttachmentSupported } from '@/lib/attachmentEligibility'
```

Delete the two private methods:

```ts
private switchToMultimodalModelIfNeeded(session: SessionVM | null): string | undefined { ... }
private ensureMultimodalModelForImages(attachments: LocalAttachment[], session: SessionVM | null): string | undefined { ... }
```

In `sendMessage`, remove:

```ts
this.ensureMultimodalModelForImages(attachments, active ?? null)
```

In `resume`, remove:

```ts
this.ensureMultimodalModelForImages(attachments, session)
```

In `regenerate`, replace:

```ts
const hasImageInHistory = sess.messages.some(...)
if (hasImageInHistory) {
  this.switchToMultimodalModelIfNeeded(sess)
}
```

with:

```ts
// The sidecar decides whether to dispatch image turns to an internal multimodal agent.
// The frontend no longer switches the session model.
```

- [ ] **Step 2: Clean up InputBar.tsx**

Modify `src/components/chat/InputBar.tsx`:

```ts
// Remove this import:
// import { isAttachmentSupported, findMultimodalAgentModelKey } from '@/lib/attachmentEligibility'
import { isAttachmentSupported } from '@/lib/attachmentEligibility'
```

Delete the `ensureMultimodalModelForImages` `useCallback` entirely.

Replace the `useEffect` with:

```ts
useEffect(() => {
  if (!attachmentsSupported && attachments.length > 0) {
    setAttachments([])
  }
}, [attachmentsSupported, attachments.length])
```

In `submit`, remove the call to `ensureMultimodalModelForImages()`.

- [ ] **Step 3: Run frontend tests (they will fail until updated)**

```bash
yarn test src/domain/sessionService.test.ts src/components/chat/InputBar.test.tsx
```

Expected: FAIL — existing tests still expect model switching.

- [ ] **Step 4: Commit**

```bash
git add src/domain/sessionService.ts src/components/chat/InputBar.tsx
git commit -m "refactor(chat): stop switching model on image attachment"
```

---

## Task 6: Update Frontend Tests

**Files:**
- Modify: `src/domain/sessionService.test.ts`
- Modify: `src/components/chat/InputBar.test.tsx`

- [ ] **Step 1: Update sessionService tests**

In `src/domain/sessionService.test.ts`, replace the three model-switch tests ("sendMessage with an image switches the draft model...", "sendMessage with an image switches the active session model...", "regenerate switches to a multimodal model when the session history contains an image") with:

```ts
it('sendMessage with an image does not switch the draft model', () => {
  useDomainStore.setState({ activeSessionId: null })
  useDraftStore.setState({ draft: { tempId: 'd1', mode: 'chat', text: '', modelKey: 'deepseek/deepseek-v4-flash' } })
  const t = new FakeTransport()
  const svc = new SessionService(t)
  const attachments = [{ id: 'a1', name: 'image.png', mimeType: 'image/png', path: '/tmp/image.png' }]
  svc.sendMessage('describe', attachments)
  expect(t.sent.some((m) => m.type === 'session:setModel')).toBe(false)
  expect(t.sent.some((m) => m.type === 'session:create' && m.config.model === 'deepseek-v4-flash')).toBe(true)
  expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', content: 'describe', attachments })
})

it('sendMessage with an image does not switch the active session model', () => {
  useDomainStore.setState({
    sessions: [{ id: 's1', config: { llmProvider: 'deepseek', model: 'deepseek-v4-flash', tools: [] }, title: 'T', preview: 'P', updatedAtMs: 0, loaded: true, messages: [], status: 'idle', error: null }],
    activeSessionId: 's1',
  })
  const t = new FakeTransport()
  const svc = new SessionService(t)
  const attachments = [{ id: 'a1', name: 'image.png', mimeType: 'image/png', path: '/tmp/image.png' }]
  svc.sendMessage('describe', attachments)
  expect(t.sent.some((m) => m.type === 'session:setModel')).toBe(false)
  expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', content: 'describe', attachments })
})

it('regenerate does not switch model when the session history contains an image', () => {
  useDomainStore.setState({
    sessions: [{
      id: 's1',
      config: { llmProvider: 'deepseek', model: 'deepseek-v4-flash', tools: [] },
      title: 'T',
      preview: 'P',
      updatedAtMs: 0,
      loaded: true,
      messages: [
        { id: 'u1', role: 'user', content: 'what is this', timestamp: 0, attachments: [{ id: 'a1', name: 'image.png', mimeType: 'image/png' }] },
        { id: 'a1', role: 'assistant', content: 'ans', timestamp: 1 },
      ],
      status: 'idle',
      error: null,
    }],
    activeSessionId: 's1',
  })
  const t = new FakeTransport()
  const svc = new SessionService(t)
  svc.regenerate()
  expect(t.sent.some((m) => m.type === 'session:setModel')).toBe(false)
  expect(t.sent.some((m) => m.type === 'message:regenerate')).toBe(true)
})
```

- [ ] **Step 2: Update InputBar tests**

In `src/components/chat/InputBar.test.tsx`:

1. Rename "switches to the first multimodal internal agent model before sending an image attachment" to "does not switch model before sending an image attachment when a vision agent exists" and change the assertions to:

```ts
expect(setSessionModel).not.toHaveBeenCalled()
expect(sendMessage).toHaveBeenCalledWith('describe this', expect.any(Array))
```

2. Rename "switches the draft model before sending an image attachment when no session is active" to "does not switch the draft model before sending an image attachment" and change assertions to:

```ts
expect(setModelKey).not.toHaveBeenCalled()
expect(sendMessage).toHaveBeenCalledWith('describe this', expect.any(Array))
```

3. Rename "switches to the multimodal agent model before resuming an interrupt with an image attachment" to "does not switch model before resuming an interrupt with an image attachment" and change assertions to:

```ts
expect(setSessionModel).not.toHaveBeenCalled()
expect(resume).toHaveBeenCalledWith('here is the image', expect.any(Array))
```

Keep the existing tests "does not switch model when the active session model is already multimodal" and "does not switch model for non-image attachments when the current model is not multimodal".

- [ ] **Step 3: Run frontend tests**

```bash
yarn test src/domain/sessionService.test.ts src/components/chat/InputBar.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/domain/sessionService.test.ts src/components/chat/InputBar.test.tsx
git commit -m "test(chat): assert no model switch on image attachment"
```

---

## Task 7: Final Verification

**Files:**
- All modified files.

- [ ] **Step 1: Run sidecar type check**

```bash
cd packages/sidecar && yarn type-check
```

Expected: pass (no TypeScript errors).

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/lijiamin/data/my-github/hip
yarn test -- --run
```

Expected: all tests pass.

- [ ] **Step 3: Run project type check**

```bash
yarn type-check
```

Expected: pass.

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: verify image-agent-dispatch implementation"
```

---

## Self-Review

**Spec coverage:**
- Agent selector with prompt-keyword matching and fallback → Task 1.
- Internal runner builds multipart `HumanMessage` with attachments → Task 2.
- `AgentInvoker` forwards attachments → Task 3.
- `Session.processInput` dispatch trigger and `runManagedAgentTurn` → Task 4.
- Frontend stops switching models → Task 5.
- Tests for selector, runner, invoker, session integration, frontend → Tasks 1–6.
- Type check and full test run → Task 7.

**Placeholder scan:** No TBD/TODO/fill-in-details patterns.

**Type consistency:** `AttachmentPayload` is imported from `../attachments.js` everywhere. `selectImageAgent` accepts an optional `Catalog` for test injection. `AgentInvoker.invoke` adds an optional seventh argument.
