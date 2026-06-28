# Testing Phase 1 Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all currently failing or flaky tests and repair test infrastructure so that `yarn test` and `yarn test:e2e` pass reliably on a clean checkout.

**Architecture:** Make minimal, surgical changes to Vitest coverage config, protocol type assertions, the ACP integration test harness, the WebdriverIO/Tauri service configuration, and the existing E2E specs. Add shared E2E helpers/page-objects and a minimal GitHub Actions workflow.

**Tech Stack:** Vitest v2, @vitest/coverage-v8, @testing-library/react, WebdriverIO v9, @wdio/tauri-service, Mocha, GitHub Actions.

## Global Constraints

- Do not introduce new test frameworks.
- Do not change business logic unless a test reveals a real bug.
- All changes must keep `yarn type-check` green.
- E2E must use the real Tauri app + sidecar + LLM when keys are available; key-gated suites skip cleanly when keys are absent.
- Each task ends with an independently verifiable green state.
- Commit after each task.

---

## File Structure

```
.
├── vitest.config.ts                         # coverage exclude fix
├── vitest.setup.ts                          # unchanged, loaded by all suites
├── packages/protocol/src/index.contract.test.ts     # type-cast fix
├── packages/sidecar/src/session/external-acp.integration.test.ts  # deflake
├── packages/sidecar/src/session/agents/__fixtures__/mock-acp-agent.mjs  # reset support
├── wdio.conf.ts                             # binary path, readiness, isolation
├── e2e/
│   ├── helpers/
│   │   ├── auth.ts                          # skip login
│   │   ├── app.ts                           # launch readiness
│   │   ├── surface.ts                       # Chat/Code/Domain switch
│   │   └── composer.ts                      # send message
│   ├── page-objects/
│   │   ├── LoginPage.ts
│   │   ├── ChatPage.ts
│   │   └── CodePage.ts
│   └── specs/
│       ├── app-launch.spec.ts               # fix
│       ├── project-workspace.spec.ts        # fix
│       └── diff-workspace.spec.ts           # fix
├── src/components/navigation/MenuRail.tsx   # add data-testid to rail buttons
├── src/components/navigation/RailButton.tsx # forward data-testid
└── .github/workflows/test.yml               # minimal CI
```

---

### Task 1: Fix Vitest coverage excludes

**Files:**
- Modify: `vitest.config.ts`
- Test: run `yarn test --coverage` and inspect `coverage/index.html`

**Interfaces:**
- No new interfaces.

- [ ] **Step 1: Update coverage.exclude**

Edit `vitest.config.ts`. Replace the `coverage.exclude` array so it excludes bundled/compiled artifacts and the coverage directory itself:

```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov'],
  include: ['src/**', 'packages/sidecar/src/**', 'packages/protocol/src/**'],
  exclude: [
    '**/*.d.ts',
    '**/*.test.ts',
    '**/*.integration.test.ts',
    '**/*.contract.test.ts',
    '**/node_modules/**',
    '**/dist/**',
    '**/src-tauri/**',
    '**/coverage/**',
  ],
},
```

- [ ] **Step 2: Delete stale coverage artifacts**

```bash
rm -rf coverage
```

- [ ] **Step 3: Regenerate coverage and verify**

```bash
yarn test --coverage
```

Open `coverage/index.html` and confirm:
- No files under `packages/sidecar/dist/` or `src-tauri/` appear.
- Statement/line coverage is non-zero for source files that have tests.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts
git commit -m "test: exclude dist/src-tauri/coverage from coverage report"
```

---

### Task 2: Fix protocol contract test type-check

**Files:**
- Modify: `packages/protocol/src/index.contract.test.ts`
- Test: `yarn workspace @hip/protocol type-check`

**Interfaces:**
- No new interfaces; only narrows existing type assertions.

- [ ] **Step 1: Replace broad `as SessionEvent` casts with variant-specific casts**

In `packages/protocol/src/index.contract.test.ts`, change every `JSON.parse(JSON.stringify(e)) as SessionEvent` to the concrete variant:

For the `user_message` test:
```ts
const rt = JSON.parse(JSON.stringify(e)) as Extract<SessionEvent, { type: 'user_message' }>
```

For `step_started` / `step_ended`:
```ts
const rtStarted = JSON.parse(JSON.stringify(started)) as Extract<SessionEvent, { type: 'step_started' }>
const rtEnded = JSON.parse(JSON.stringify(ended)) as Extract<SessionEvent, { type: 'step_ended' }>
```

For `text_started` / `text_ended`:
```ts
const rtStarted = JSON.parse(JSON.stringify(started)) as Extract<SessionEvent, { type: 'text_started' }>
const rtEnded = JSON.parse(JSON.stringify(ended)) as Extract<SessionEvent, { type: 'text_ended' }>
```

For `tool_called` / `tool_success` / `tool_failed`:
```ts
const rtCalled = JSON.parse(JSON.stringify(called)) as Extract<SessionEvent, { type: 'tool_called' }>
const rtSuccess = JSON.parse(JSON.stringify(success)) as Extract<SessionEvent, { type: 'tool_success' }>
const rtFailed = JSON.parse(JSON.stringify(failed)) as Extract<SessionEvent, { type: 'tool_failed' }>
```

For `compaction_ended`:
```ts
const rt = JSON.parse(JSON.stringify(e)) as Extract<SessionEvent, { type: 'compaction_ended' }>
```

- [ ] **Step 2: Run protocol type-check**

```bash
yarn workspace @hip/protocol type-check
```

Expected: exit code 0.

- [ ] **Step 3: Run protocol tests**

```bash
yarn test packages/protocol/src/index.contract.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/index.contract.test.ts
git commit -m "test(protocol): narrow SessionEvent casts so package type-check passes"
```

---

### Task 3: Stabilize external-acp integration test

**Files:**
- Modify: `packages/sidecar/src/session/external-acp.integration.test.ts`
- Modify: `packages/sidecar/src/session/agents/__fixtures__/mock-acp-agent.mjs`
- Test: `yarn test packages/sidecar/src/session/external-acp.integration.test.ts --no-file-parallelism`

**Interfaces:**
- `mock-acp-agent.mjs` accepts a JSON-line message `{ "reset": true }` to clear module-level state (`cancelled`, `resumed`, `sessionSeq`).
- Tests use `afterEach` to call `acpConnections.disposeAll()` and reset the mock agent.

- [ ] **Step 1: Add per-test reset to mock-acp-agent.mjs**

Open `packages/sidecar/src/session/agents/__fixtures__/mock-acp-agent.mjs`. Locate the module-level mutable state and the stdin reader. Add reset handling so a control message clears state:

```js
// Near the top, where mutable state is declared:
let cancelled = new Set()
let resumed = new Set()
let sessionSeq = 0

function resetState() {
  cancelled.clear()
  resumed.clear()
  sessionSeq = 0
}

// In the stdin reader, before dispatching to handleMessage:
if (line.trim() === '{"reset":true}') {
  resetState()
  continue
}
```

- [ ] **Step 2: Refactor external-acp.integration.test.ts to cleanup after each test**

Edit `packages/sidecar/src/session/external-acp.integration.test.ts`:

1. Add an `afterEach` hook at the top of the describe block:

```ts
afterEach(async () => {
  // Close any open ACP connection.
  acpConnections.disposeAll()
  // Reset mutable mock-agent state so the next test starts clean.
  await resetMockAgent()
})
```

2. Add a helper to send reset to the mock agent. Because the mock is launched per `SessionManager`, the simplest reliable reset is to send reset through the active connection. Add:

```ts
async function resetMockAgent(): Promise<void> {
  // The mock agent reads stdin; sending {"reset":true} clears its module state.
  for (const conn of (acpConnections as any).connections?.values?.() ?? []) {
    try {
      conn.child?.stdin?.write('{"reset":true}\n')
    } catch {
      // ignore if already closed
    }
  }
}
```

If `acpConnections` does not expose `.connections`, inspect `acpConnections` at runtime to find the child process handles. If no clean API exists, refactor `acp-connection.ts` to expose a `getConnections(): AcpConnection[]` method as part of this task.

3. Replace the fixed `setTimeout` waits with waits for terminal events. Add a helper:

```ts
async function waitForTerminal(out: ServerMessage[], predicate: (m: ServerMessage) => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (out.some(predicate)) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`Timeout waiting for terminal message`)
}
```

4. Update each test to use `waitForTerminal` instead of sleep:

For the first test:
```ts
await waitForTerminal(out, (m) => m.type === 'message:complete')
```

For the permission proceed test:
```ts
await waitForTerminal(out, (m) => m.type === 'message:complete')
```

For the permission reject test:
```ts
await waitForTerminal(out, (m) => m.type === 'message:complete')
```

For the cancel test:
```ts
await turn
await waitForTerminal(out, (m) => m.type === 'message:complete' || (m.type === 'error' && m.code === 'CANCELLED'))
```

For loadSession tests:
```ts
await waitForTerminal(out, (m) => m.type === 'message:complete')
```

Remove the raw `await new Promise((r) => setTimeout(r, ...))` calls used for settling.

- [ ] **Step 3: Run the stabilized test repeatedly**

```bash
for i in {1..5}; do yarn test packages/sidecar/src/session/external-acp.integration.test.ts --no-file-parallelism; done
```

Expected: all 5 runs pass.

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/session/external-acp.integration.test.ts packages/sidecar/src/session/agents/__fixtures__/mock-acp-agent.mjs
# if acp-connection.ts was changed to expose connections, add it too
git commit -m "test(sidecar): deflake external-acp integration test with cleanup and event-based waits"
```

---

### Task 4: Create shared E2E helpers and page objects

**Files:**
- Create: `e2e/helpers/auth.ts`
- Create: `e2e/helpers/app.ts`
- Create: `e2e/helpers/surface.ts`
- Create: `e2e/helpers/composer.ts`
- Create: `e2e/page-objects/LoginPage.ts`
- Create: `e2e/page-objects/ChatPage.ts`
- Create: `e2e/page-objects/CodePage.ts`
- Test: `yarn tsc --noEmit` or `npx tsc --noEmit -p e2e/tsconfig.json` if it exists; otherwise rely on `yarn test:e2e` compile step

**Interfaces:**
- `skipLoginIfPresent(): Promise<void>`
- `waitForAppReady(timeoutMs?: number): Promise<void>`
- `switchToCodeSurface(): Promise<void>`
- `sendComposerMessage(text: string): Promise<void>`
- Page objects expose locators, not behaviors.

- [ ] **Step 1: Create e2e/helpers/auth.ts**

```ts
export async function skipLoginIfPresent(): Promise<void> {
  const skip = await browser.$('button=跳过登录')
  if (await skip.isExisting()) {
    await skip.click()
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('#/app'),
      { timeout: 10000, interval: 200 }
    )
  }
}
```

- [ ] **Step 2: Create e2e/helpers/app.ts**

```ts
export async function waitForAppReady(timeoutMs = 60000): Promise<void> {
  await browser.waitUntil(
    async () => (await browser.getUrl()).includes('#/login') || (await browser.getUrl()).includes('#/app'),
    { timeout: timeoutMs, interval: 500 }
  )
  // Wait for the Tauri bridge to be usable.
  await browser.waitUntil(
    async () => {
      try {
        return await browser.execute(() => typeof window.__TAURI_INTERNALS__ !== 'undefined')
      } catch {
        return false
      }
    },
    { timeout: 30000, interval: 500 }
  )
}

export async function waitForMainApp(timeoutMs = 60000): Promise<void> {
  await browser.waitUntil(
    async () => (await browser.getUrl()).includes('#/app'),
    { timeout: timeoutMs, interval: 500 }
  )
  // Wait for main chrome.
  await (await browser.$('[data-testid="sidebar-root"]')).waitForExist({ timeout: 30000 })
}
```

- [ ] **Step 3: Create e2e/helpers/surface.ts**

```ts
export async function switchToCodeSurface(): Promise<void> {
  const codeBtn = await browser.$('[data-testid="rail-code"]')
  await codeBtn.waitForClickable({ timeout: 20000 })
  await codeBtn.click()
  await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 60000 })
}

export async function switchToChatSurface(): Promise<void> {
  const chatBtn = await browser.$('[data-testid="rail-chat"]')
  await chatBtn.waitForClickable({ timeout: 20000 })
  await chatBtn.click()
}
```

- [ ] **Step 4: Create e2e/helpers/composer.ts**

```ts
export async function sendComposerMessage(text: string): Promise<void> {
  const ta = await browser.$('[data-testid="new-conversation"] textarea')
  await ta.click()
  await browser.keys(text)
  const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
  await send.waitForEnabled({ timeout: 10000 })
  await send.click()
}
```

- [ ] **Step 5: Create page objects**

`e2e/page-objects/LoginPage.ts`:
```ts
export class LoginPage {
  get heading() { return browser.$('h1') }
  get skipButton() { return browser.$('button=跳过登录') }

  async skipIfPresent(): Promise<void> {
    const skip = await this.skipButton
    if (await skip.isExisting()) await skip.click()
  }
}
```

`e2e/page-objects/ChatPage.ts`:
```ts
export class ChatPage {
  get newConversation() { return browser.$('[data-testid="new-conversation"]') }
  get composerTextarea() { return browser.$('[data-testid="new-conversation"] textarea') }
  get composerSend() { return browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]') }
  get sessionItems() { return browser.$$('[data-testid="session-item"]') }
}
```

`e2e/page-objects/CodePage.ts`:
```ts
import * as path from 'node:path'

export class CodePage {
  get pickFolder() { return browser.$('[data-testid="pick-folder"]') }
  get newConversation() { return browser.$('[data-testid="new-conversation"]') }

  async pickDirectory(dir: string): Promise<void> {
    await browser.execute((d: string) => {
      (window as unknown as { __hipPickDir?: () => Promise<string> }).__hipPickDir = () => Promise.resolve(d)
    }, dir)
    await (await this.pickFolder).click()
  }

  entry(suffix: string) {
    return browser.$(`[data-testid="tree-entry"][data-path$="${suffix}"]`)
  }
}
```

- [ ] **Step 6: Verify helpers compile**

Run a TypeScript check. If `e2e/tsconfig.json` exists:
```bash
npx tsc --noEmit -p e2e/tsconfig.json
```

If not, run the full E2E compile:
```bash
yarn test:e2e --dry-run
```

(If `--dry-run` is unsupported, proceed to Task 5 and use `yarn test:e2e` as the compile check.)

- [ ] **Step 7: Commit**

```bash
git add e2e/helpers e2e/page-objects
git commit -m "test(e2e): add shared helpers and page objects"
```

---

### Task 5: Add stable data-testid to rail buttons

**Files:**
- Modify: `src/components/navigation/MenuRail.tsx`
- Modify: `src/components/navigation/RailButton.tsx`
- Test: `yarn type-check` and inspect the rendered app

**Interfaces:**
- `RailButton` accepts an optional `data-testid` prop and forwards it to the rendered button.

- [ ] **Step 1: Update RailButton.tsx**

Open `src/components/navigation/RailButton.tsx`. Find the button JSX and forward `data-testid`:

```tsx
interface RailButtonProps {
  // ... existing props
  'data-testid'?: string
}

// In the component:
<button
  // ... existing props
  data-testid={props['data-testid']}
>
```

If `RailButton` is rendered through a generic component, pass the prop through.

- [ ] **Step 2: Update MenuRail.tsx**

Open `src/components/navigation/MenuRail.tsx`. Locate the three rail buttons (Chat, Code, Domain) and add stable test ids:

```tsx
<RailButton
  // ... existing props for chat
  data-testid="rail-chat"
/>
<RailButton
  // ... existing props for code
  data-testid="rail-code"
/>
<RailButton
  // ... existing props for domain
  data-testid="rail-domain"
/>
```

- [ ] **Step 3: Type-check and run app-launch E2E**

```bash
yarn type-check
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/navigation/MenuRail.tsx src/components/navigation/RailButton.tsx
git commit -m "chore(ui): add data-testid to rail buttons for E2E stability"
```

---

### Task 6: Fix wdio.conf.ts for binary path, readiness, and isolation

**Files:**
- Modify: `wdio.conf.ts`
- Test: `yarn test:e2e`

**Interfaces:**
- `E2E_BINARY` env var overrides the Tauri binary path.
- `E2E_DATA_DIR` env var overrides the isolated data directory.
- `waitForViteAndSidecar()` ensures the frontend and sidecar are ready before spawning the app.

- [ ] **Step 1: Determine the correct default binary path**

Check which binary exists:
```bash
ls -la src-tauri/target/debug/hip src-tauri/target/release/bundle/macos/hip.app/Contents/MacOS/hip 2>/dev/null || true
```

Use the debug binary as the default for E2E because it is faster to build and the release bundle may be stale:

```ts
const DEFAULT_BINARY = './src-tauri/target/debug/hip'
const appBinaryPath = process.env.E2E_BINARY || DEFAULT_BINARY
```

- [ ] **Step 2: Refactor wdio.conf.ts**

Replace the hard-coded paths with env-aware defaults and add a readiness wait:

```ts
import type { Options } from '@wdio/types'
import { createServer, type ViteDevServer } from 'vite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const VITE_PORT = 1420
const DEFAULT_BINARY = './src-tauri/target/debug/hip'
const appBinaryPath = process.env.E2E_BINARY || DEFAULT_BINARY

// Isolated data dir so repeated E2E runs do not accumulate sessions.
const e2eDataDir = process.env.E2E_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-data-'))
process.env.HIP_DATA_DIR = e2eDataDir

let viteServer: ViteDevServer | undefined

async function pingVite(): Promise<boolean> {
  try {
    await fetch(`http://localhost:${VITE_PORT}`)
    return true
  } catch {
    return false
  }
}

async function waitForVite(timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await pingVite()) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Vite did not become ready on port ${VITE_PORT}`)
}

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./e2e/**/*.spec.ts'],
  maxInstances: 1,

  services: [
    ['@wdio/tauri-service', {
      appBinaryPath,
      driverProvider: 'embedded',
    }],
  ],

  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      application: appBinaryPath,
    },
  }],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 20000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 180000,
    ...(process.env.E2E_GREP ? { grep: process.env.E2E_GREP, invert: process.env.E2E_INVERT === '1' } : {}),
  },

  reporters: ['spec'],

  onPrepare: async () => {
    if (await pingVite()) {
      console.log(`[e2e] reusing Vite already running on :${VITE_PORT}`)
    } else {
      viteServer = await createServer()
      await viteServer.listen()
      await waitForVite()
      console.log(`[e2e] started Vite on :${VITE_PORT}`)
    }
    // Give the sidecar a moment to cold-start after the app spawns.
    // The actual readiness is verified by the first spec's before hook.
  },

  onComplete: async () => {
    if (viteServer) {
      await viteServer.close()
      viteServer = undefined
      console.log('[e2e] stopped Vite')
    }
    // Cleanup isolated data dir unless the user provided one.
    if (!process.env.E2E_DATA_DIR && fs.existsSync(e2eDataDir)) {
      fs.rmSync(e2eDataDir, { recursive: true, force: true })
    }
  },
}
```

- [ ] **Step 3: Run a single E2E spec to verify the harness**

```bash
E2E_GREP="should launch and show the login screen" yarn test:e2e
```

Expected: spec compiles and runs (it may still fail on app-launch assertions, which are fixed in the next task).

- [ ] **Step 4: Commit**

```bash
git add wdio.conf.ts
git commit -m "test(e2e): use debug binary, isolated data dir, and readiness wait"
```

---

### Task 7: Fix app-launch.spec.ts

**Files:**
- Modify: `e2e/specs/app-launch.spec.ts`
- Test: `E2E_GREP="hip desktop app" yarn test:e2e`

**Interfaces:**
- Uses `waitForAppReady()` and `waitForMainApp()` from `e2e/helpers/app.ts`.
- Uses `skipLoginIfPresent()` from `e2e/helpers/auth.ts`.

- [ ] **Step 1: Rewrite app-launch.spec.ts**

```ts
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'

const CHAT_GREETINGS = [
  '我们来做点什么？',
  '你好呀！',
  '游啊游',
  '一跃而起！',
  '鼓足干劲！',
  '跳起来！',
  '好开心！',
  '让我想想…',
  '伸个懒腰',
  '哗啦啦',
  '看那边！',
  '哇！！',
  '好困…',
  '生气！',
  '太棒了！',
  '躲猫猫',
  '转圈圈！',
  '翻滚吧！',
]

describe('hip desktop app', () => {
  it('should launch and show the login screen', async () => {
    await waitForAppReady()

    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('#/login'),
      { timeout: 30000, interval: 500 }
    )

    const heading = await browser.$('h1')
    await heading.waitForDisplayed({ timeout: 10000 })

    const text = await heading.getText()
    expect(text).toContain('登录到 hip')
  })

  it('should navigate to the main app and render the chat landing', async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()

    const landing = await browser.$('[data-testid="new-conversation"]')
    await landing.waitForDisplayed({ timeout: 30000 })

    const greeting = await landing.$('h1')
    await greeting.waitForDisplayed({ timeout: 10000 })
    const greetingText = await greeting.getText()
    expect(CHAT_GREETINGS.some((g) => greetingText.includes(g))).toBe(true)

    const newChat = await browser.$('button=新对话')
    await newChat.waitForDisplayed({ timeout: 10000 })
    expect(await newChat.getText()).toContain('新对话')
  })
})
```

- [ ] **Step 2: Run the spec**

```bash
E2E_GREP="hip desktop app" yarn test:e2e
```

Expected: both tests pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/app-launch.spec.ts
git commit -m "test(e2e): stabilize app-launch spec with readiness helpers"
```

---

### Task 8: Fix project-workspace.spec.ts

**Files:**
- Modify: `e2e/specs/project-workspace.spec.ts`
- Test: `E2E_GREP="new conversation" yarn test:e2e`

**Interfaces:**
- Uses `skipLoginIfPresent()`, `switchToCodeSurface()`, `CodePage` page object.

- [ ] **Step 1: Rewrite project-workspace.spec.ts**

```ts
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const codePage = new CodePage()
const sessionItems = () => browser.$$('[data-testid="session-item"]')
const entry = (suffix: string) => browser.$(`[data-testid="tree-entry"][data-path$="${suffix}"]`)

describe('new conversation', () => {
  before(async () => {
    await skipLoginIfPresent()
    await switchToCodeSurface()
  })

  it('a new code conversation shows the centered composer landing with a folder picker', async () => {
    await codePage.newConversation.waitForExist({ timeout: 120000 })
    expect(await codePage.pickFolder.isExisting()).toBe(true)
  })

  it('picking a folder opens the tree without creating a sidebar row', async () => {
    const before = await (await sessionItems()).length
    await codePage.pickDirectory(FIXTURE)
    await (await entry('/README.md')).waitForExist({ timeout: 60000 })
    expect(await (await sessionItems()).length).toBe(before)
  })

  it('the composer chip ✕ returns to pure-chat (then re-pick restores the tree)', async () => {
    await (await browser.$('[data-testid="clear-folder"]')).click()
    await codePage.pickFolder.waitForExist({ timeout: 10000 })
    await codePage.pickDirectory(FIXTURE)
    await (await entry('/README.md')).waitForExist({ timeout: 60000 })
  })

  it('the Files-panel exit returns the tree to sandbox-pending (then re-pick restores it)', async () => {
    await (await browser.$('[data-testid="tree-back-to-chat"]')).click()
    await browser.waitUntil(
      async () => !(await (await entry('/README.md')).isExisting()),
      { timeout: 10000, interval: 200 }
    )
    await codePage.pickDirectory(FIXTURE)
    await (await entry('/README.md')).waitForExist({ timeout: 60000 })
  })

  it('renders a Markdown preview (rendered, not source)', async () => {
    await (await entry('/README.md')).click()
    const md = await browser.$('[data-testid="preview-markdown"]')
    await md.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => (await md.getText()).includes('Sample Project'),
      { timeout: 10000, interval: 500 }
    )
  })

  it('renders HTML in a sandboxed iframe', async () => {
    await (await entry('/index.html')).click()
    const frame = await browser.$('[data-testid="preview-html"]')
    await frame.waitForExist({ timeout: 30000 })
    expect(await frame.getAttribute('sandbox')).toBe('')
  })

  it('renders an image as a data URL', async () => {
    await (await entry('/logo.png')).click()
    const img = await browser.$('[data-testid="preview-image"] img')
    await img.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => ((await img.getAttribute('src')) ?? '').includes('data:image/png;base64,'),
      { timeout: 10000, interval: 500 }
    )
  })

  it('lazily expands a directory and previews a text file', async () => {
    await (await entry('/src')).click()
    await (await entry('/a.ts')).waitForExist({ timeout: 30000 })
    await (await entry('/a.ts')).click()
    const txt = await browser.$('[data-testid="preview-text"]')
    await txt.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => (await txt.getText()).includes('export const a'),
      { timeout: 10000, interval: 500 }
    )
  })

  it('sending the first message commits the session and replaces the landing', async () => {
    const before = await (await sessionItems()).length
    const ta = await browser.$('[data-testid="new-conversation"] textarea')
    await ta.click()
    await browser.keys('hello world')
    const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
    await send.waitForEnabled({ timeout: 10000 })
    await send.click()
    await codePage.newConversation.waitForExist({ reverse: true, timeout: 30000 })
    await browser.waitUntil(
      async () => await (await sessionItems()).length === before + 1,
      { timeout: 30000, interval: 500 }
    )
  })
})
```

- [ ] **Step 2: Run the spec**

```bash
E2E_GREP="new conversation" yarn test:e2e
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/project-workspace.spec.ts
git commit -m "test(e2e): stabilize project-workspace spec with helpers"
```

---

### Task 9: Fix diff-workspace.spec.ts

**Files:**
- Modify: `e2e/specs/diff-workspace.spec.ts`
- Test: `E2E_GREP="workspace git diff" yarn test:e2e`

**Interfaces:**
- Uses `skipLoginIfPresent()`, `switchToCodeSurface()`, `CodePage` page object.

- [ ] **Step 1: Rewrite diff-workspace.spec.ts**

```ts
import { expect } from 'expect-webdriverio'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'

let dir: string
const codePage = new CodePage()

describe('workspace git diff', () => {
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-diff-'))
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello\n')
    await skipLoginIfPresent()
    await switchToCodeSurface()
  })

  after(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('commits a session bound to the temp folder', async () => {
    await codePage.newConversation.waitForExist({ timeout: 120000 })
    await codePage.pickDirectory(dir)
    await browser.$(`[data-testid="tree-entry"][data-path$="/hello.txt"]`).waitForExist({ timeout: 60000 })
    const ta = await browser.$('[data-testid="new-conversation"] textarea')
    await ta.click()
    await browser.keys('diff e2e')
    const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
    await send.waitForEnabled({ timeout: 10000 })
    await send.click()
    await codePage.newConversation.waitForExist({ reverse: true, timeout: 30000 })
  })

  it('shows the not-a-repo state with an init button on the Files tab', async () => {
    expect(await (await browser.$('[data-testid="tab-changes"]')).isExisting()).toBe(false)
    await (await browser.$('button*=初始化 git 仓库')).waitForExist({ timeout: 30000 })
  })

  it('one-click init produces a clean baseline and reveals the Changes tab', async () => {
    await (await browser.$('button*=初始化 git 仓库')).click()
    const changesTab = await browser.$('[data-testid="tab-changes"]')
    await changesTab.waitForExist({ timeout: 30000 })
    await changesTab.click()
    await (await browser.$('[data-testid="changes-view"]')).waitForExist({ timeout: 30000 })
    expect(await (await browser.$('[data-testid="diff-file"]')).isExisting()).toBe(false)
  })

  it('an out-of-band file change appears in the changes view', async () => {
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'changed\n')
    await (await browser.$('[data-testid="tab-files"]')).click()
    await (await browser.$('[data-testid="tab-changes"]')).click()
    const file = await browser.$('[data-testid="diff-file"]')
    await file.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => (await file.getText()).includes('hello.txt'),
      { timeout: 10000, interval: 500 }
    )
  })

  it('split view toggle is present and switches to two-column layout', async () => {
    const viewToggle = await browser.$('[data-testid="diff-view-toggle"]')
    await viewToggle.waitForExist({ timeout: 10000 })
    const splitBtn = await viewToggle.$('button:nth-child(2)')
    await splitBtn.click()
    const changesView = await browser.$('[data-testid="changes-view"]')
    await changesView.waitForExist({ timeout: 5000 })
    expect(await changesView.isExisting()).toBe(true)
    const unifiedBtn = await viewToggle.$('button:nth-child(1)')
    await unifiedBtn.click()
  })

  it('show-full button is present on a modified file', async () => {
    const showFullBtn = await browser.$('[data-testid="diff-show-full"]')
    await showFullBtn.waitForExist({ timeout: 10000 })
    expect(await showFullBtn.isExisting()).toBe(true)
  })

  it('clicking show-full toggles the file to expanded state', async () => {
    const showFullBtn = await browser.$('[data-testid="diff-show-full"]')
    await showFullBtn.waitForExist({ timeout: 10000 })
    await showFullBtn.click()
    const collapseBtn = await browser.$('[data-testid="diff-collapse-full"]')
    await collapseBtn.waitForExist({ timeout: 15000 })
    expect(await collapseBtn.isExisting()).toBe(true)
    await collapseBtn.click()
    await (await browser.$('[data-testid="diff-show-full"]')).waitForExist({ timeout: 10000 })
  })

  it('changed-files jump list is absent for a single-file diff', async () => {
    const jumpList = await browser.$('[data-testid="diff-file-list"]')
    expect(await jumpList.isExisting()).toBe(false)
  })
})
```

- [ ] **Step 2: Run the spec**

```bash
E2E_GREP="workspace git diff" yarn test:e2e
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/diff-workspace.spec.ts
git commit -m "test(e2e): stabilize diff-workspace spec with helpers"
```

---

### Task 10: Add minimal GitHub Actions CI

**Files:**
- Create: `.github/workflows/test.yml`
- Test: Validate YAML syntax; CI will run on push after merge.

**Interfaces:**
- Workflow runs on `push` and `pull_request`.
- Jobs: `type-check`, `unit-contract`.
- E2E job is optional (`continue-on-error: true`) due to Tauri build time.

- [ ] **Step 1: Create .github/workflows/test.yml**

```yaml
name: Test

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: yarn
      - run: yarn install --frozen-lockfile
      - run: yarn type-check
      - run: yarn workspace @hip/protocol type-check
      - run: yarn workspace @hip/sidecar type-check

  unit-contract:
    runs-on: ubuntu-latest
    needs: [type-check]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: yarn
      - run: yarn install --frozen-lockfile
      - run: yarn test
      - run: yarn test --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: coverage/

  e2e-smoke:
    runs-on: macos-latest
    needs: [type-check]
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: yarn
      - uses: dtolnay/rust-toolchain@stable
      - run: yarn install --frozen-lockfile
      - run: yarn tauri build --debug
      - run: yarn test:e2e
```

- [ ] **Step 2: Validate YAML locally**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add type-check, unit, and optional e2e smoke workflow"
```

---

### Task 11: Final verification

**Files:**
- All files touched in Phase 1.
- Test: full test matrix.

- [ ] **Step 1: Run type checks**

```bash
yarn type-check
yarn workspace @hip/protocol type-check
yarn workspace @hip/sidecar type-check
```

Expected: all pass.

- [ ] **Step 2: Run unit and integration tests**

```bash
yarn test
```

Expected: all pass, no flaky failures.

- [ ] **Step 3: Run E2E suite**

```bash
yarn test:e2e
```

Expected: 3 spec files, all tests pass.

- [ ] **Step 4: Inspect coverage report**

```bash
yarn test --coverage
```

Open `coverage/index.html` and confirm no `dist/` or `src-tauri/` files and coverage numbers are reasonable.

- [ ] **Step 5: Commit any final fixes**

If any fixes were needed during verification, commit them with descriptive messages.

---

## Self-Review

1. **Spec coverage:** Every requirement in the design doc's Phase 1 section maps to a task:
   - Coverage fix → Task 1
   - Protocol type-check → Task 2
   - external-acp deflake → Task 3
   - E2E helpers/page objects → Task 4
   - Rail button test ids → Task 5
   - wdio config → Task 6
   - Existing E2E spec fixes → Tasks 7–9
   - Minimal CI → Task 10
   - Verification → Task 11
2. **Placeholder scan:** No TBD/TODO/fill-in-details placeholders.
3. **Type consistency:** All helpers and page objects use consistent locators and types.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-28-testing-phase1-stabilization-plan.md`.**

This is Phase 1 of the comprehensive testing modernization. Subsequent phases (E2E expansion, frontend unit tests, sidecar integration/contract hardening, full CI/coverage) will get their own plans once Phase 1 is verified green.

**Two execution options:**

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach would you like?
