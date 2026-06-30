# Phase 1：核心 UI E2E + 关键单元测试 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不依赖外部 LLM/MCP 的前提下，补齐会话管理、Composer 控件、设置页 smoke 的 E2E 覆盖，并补齐 Composer、MessageBubble、CodeBlock、PermissionModal、PlanApprovalCard、FilePreview、FileTree 的单元测试。

**Architecture:** 复用现有 WebdriverIO + Tauri E2E 与 Vitest + @testing-library/react 单元测试栈；扩展 page objects 与 helpers，少量补充 `data-testid` 以提升选择器稳定性。

**Tech Stack:** WebdriverIO, Vitest, @testing-library/react, happy-dom, TypeScript, React.

## Global Constraints

- 不硬编码、不提交任何 API key 或本地 config 中的敏感字段。
- Phase 1 E2E 不调用真实 LLM/MCP；需要 provider catalog 的断言仅做 UI 存在性检查或 skip。
- 每个任务修改/创建的文件必须通过 `yarn type-check`、`yarn test`（相关文件）、`yarn test:e2e`（相关 spec）验证。
- 每次任务完成后提交；提交信息遵循现有约定（`test(e2e): ...`、`test: ...`）。

---

## Task 1: 扩展 ChatPage page object

**Files:**
- Modify: `e2e/page-objects/ChatPage.ts`

**Interfaces:**
- Consumes: 现有 `browser` 全局与页面 `data-testid`。
- Produces: `ChatPage` 新增 getter，供 E2E specs 使用。

- [ ] **Step 1: 在 `ChatPage` 中新增常用元素 getter**

```ts
export class ChatPage {
  get newConversation() { return browser.$('[data-testid="new-conversation"]') }
  get composerTextarea() { return browser.$('[data-testid="new-conversation"] textarea') }
  get composerSend() { return browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]') }
  get sessionItems() { return browser.$$('[data-testid="session-item"]') }

  // slash command palette
  get slashPalette() { return browser.$('[data-testid="slash-palette"]') }
  slashCmd(name: string) { return browser.$(`[data-testid="slash-cmd-${name}"]`) }

  /** Active textarea in the chat view — works for both new-conversation and existing sessions. */
  get activeTextarea() { return browser.$('textarea') }

  // ── new getters ──
  get messageBubbles() { return browser.$$('[data-message-id]') }
  messageBubble(index: number) { return browser.$(`[data-message-id]:nth-child(${index + 1})`) }
  get lastMessageText() { return browser.$('[data-message-id]:last-child') }
  get jumpToLatest() { return browser.$('[data-testid="jump-to-latest"]') }
  get chatError() { return browser.$('[data-testid="chat-error"]') }
  get chatErrorRetry() { return browser.$('[data-testid="chat-error-retry"]') }
  get chatInterrupt() { return browser.$('[data-testid="chat-interrupt"]') }
  get composerStop() { return browser.$('[data-testid="composer-stop"]') }
  get attachmentButton() { return browser.$('[data-testid="attachment-button"]') }
  get attachmentChips() { return browser.$$('[data-testid="attachment-chip"]') }
  get modelChip() { return browser.$('[data-testid="model-chip"]') }
  get permissionChip() { return browser.$('[data-testid="permission-chip"]') }
  get planApprovalCard() { return browser.$('[data-testid="plan-approval-card"]') }
  get planApprove() { return browser.$('[data-testid="plan-approve"]') }
  get planAmend() { return browser.$('[data-testid="plan-amend"]') }
  get planReject() { return browser.$('[data-testid="plan-reject"]') }
  get permissionModal() { return browser.$('[data-testid="permission-modal"]') }
  permissionOption(id: string) { return browser.$(`[data-testid="permission-option-${id}"]`) }
}
```

- [ ] **Step 2: 验证类型检查通过**

Run: `yarn type-check`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add e2e/page-objects/ChatPage.ts
git commit -m "test(e2e): extend ChatPage page object for chat state and widgets"
```

---

## Task 2: 创建 SettingsPage page object 并补充设置页 testid

**Files:**
- Create: `e2e/page-objects/SettingsPage.ts`
- Modify: `src/components/account/SettingsPanel.tsx`
- Modify: `src/components/sidebar/AccountFooter.tsx`

**Interfaces:**
- Consumes: SettingsPanel / AccountFooter 的 DOM。
- Produces: `SettingsPage` page object，供 `settings-smoke.spec.ts` 使用。

- [ ] **Step 1: 在 `SettingsPanel.tsx` 的导航触发器与返回按钮上增加 testid**

修改 `src/components/account/SettingsPanel.tsx`：

在 `TabsPrimitive.Trigger` 上添加：
```tsx
data-testid={`settings-nav-${page.id}`}
```

在返回按钮上添加：
```tsx
data-testid="settings-back"
```

- [ ] **Step 2: 在 `AccountFooter.tsx` 的触发按钮与设置菜单项上增加 testid**

在触发按钮（最外层 `DropdownMenuTrigger` 内的 `<button>`）上添加：
```tsx
data-testid="account-footer"
```

在设置 `DropdownMenuItem` 上添加：
```tsx
data-testid="settings-menu-item"
```

- [ ] **Step 3: 创建 `e2e/page-objects/SettingsPage.ts`**

```ts
export class SettingsPage {
  get accountFooter() { return browser.$('[data-testid="account-footer"]') }
  get settingsMenuItem() { return browser.$('[data-testid="settings-menu-item"]') }
  nav(page: 'general' | 'model' | 'agents' | 'mcp' | 'skill' | 'plugins') {
    return browser.$(`[data-testid="settings-nav-${page}"]`)
  }
  get backButton() { return browser.$('[data-testid="settings-back"]') }
  get activeTabPanel() { return browser.$('[role="tabpanel"]') }
}
```

- [ ] **Step 4: 验证类型检查**

Run: `yarn type-check`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/components/account/SettingsPanel.tsx src/components/sidebar/AccountFooter.tsx e2e/page-objects/SettingsPage.ts
git commit -m "test(e2e): add SettingsPage page object and settings testids"
```

---

## Task 3: 创建 E2E helpers

**Files:**
- Create: `e2e/helpers/settings.ts`
- Create: `e2e/helpers/session.ts`

**Interfaces:**
- Consumes: `ChatPage`, `SettingsPage`。
- Produces: `openSettings`, `closeSettings`, `sendChatMessage`, `activeSessionTitle`。

- [ ] **Step 1: 创建 `e2e/helpers/settings.ts`**

```ts
import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()

export async function openSettings(): Promise<void> {
  await settings.accountFooter.click()
  await settings.settingsMenuItem.waitForClickable({ timeout: 10000 })
  await settings.settingsMenuItem.click()
  await settings.nav('general').waitForExist({ timeout: 10000 })
}

export async function closeSettings(): Promise<void> {
  await settings.backButton.click()
  await browser.waitUntil(
    async () => !(await settings.backButton.isExisting()),
    { timeout: 10000, interval: 200 },
  )
}
```

- [ ] **Step 2: 创建 `e2e/helpers/session.ts`**

```ts
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

export async function sendChatMessage(text: string): Promise<void> {
  const ta = await chat.activeTextarea
  await ta.click()
  await browser.keys(text)
  const send = await chat.composerSend
  await send.waitForEnabled({ timeout: 10000 })
  await send.click()
}

export async function activeSessionTitle(): Promise<string> {
  const active = await browser.$('[data-testid="session-item"][data-active="true"]')
  await active.waitForExist({ timeout: 10000 })
  const title = await active.$('span.truncate')
  return title.getText()
}
```

- [ ] **Step 3: 验证类型检查**

Run: `yarn type-check`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add e2e/helpers/settings.ts e2e/helpers/session.ts
git commit -m "test(e2e): add settings and session helpers"
```

---

## Task 4: 为 SessionItem / SearchBox 补充 testid

**Files:**
- Modify: `src/components/sidebar/SessionItem.tsx`
- Modify: `src/components/sidebar/SearchBox.tsx`

**Interfaces:**
- Consumes: 无。
- Produces: 更稳定的 E2E 选择器。

- [ ] **Step 1: 在 `SessionItem.tsx` 增加 active 状态属性**

在 `data-testid="session-item"` 的 div 上添加：
```tsx
data-active={active}
```

- [ ] **Step 2: 在 `SearchBox.tsx` 输入框增加 testid**

```tsx
<input
  data-testid="session-search-input"
  value={search}
  onChange={(e) => setSearch(e.target.value)}
  placeholder={t('sidebar.search')}
  ...
/>
```

- [ ] **Step 3: 验证单元测试仍通过**

Run: `yarn test src/components/sidebar`
Expected: 全绿。

- [ ] **Step 4: 提交**

```bash
git add src/components/sidebar/SessionItem.tsx src/components/sidebar/SearchBox.tsx
git commit -m "test: add testids to SessionItem and SearchBox"
```

---

## Task 5: E2E spec — 会话管理

**Files:**
- Create: `e2e/specs/session-management.spec.ts`

**Interfaces:**
- Consumes: `waitForAppReady`, `waitForMainApp`, `skipLoginIfPresent`, `sendChatMessage`, `ChatPage`。
- Produces: 会话创建、切换、搜索的 E2E 覆盖。

- [ ] **Step 1: 创建 spec 文件**

```ts
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { sendChatMessage } from '../helpers/session.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('session management', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
  })

  it('creates a new conversation draft from the sidebar', async () => {
    const newBtn = await browser.$('[data-testid="new-session-button"]')
    await newBtn.waitForClickable({ timeout: 10000 })
    await newBtn.click()
    await chat.newConversation.waitForExist({ timeout: 10000 })
  })

  it('commits a chat session by sending a message', async () => {
    const before = await (await chat.sessionItems).length
    await sendChatMessage('hello e2e')
    await browser.waitUntil(
      async () => (await chat.sessionItems).length === before + 1,
      { timeout: 30000, interval: 500 },
    )
    const bubble = await browser.$('[data-message-id]:last-child')
    await bubble.waitForExist({ timeout: 10000 })
    expect(await bubble.getText()).toContain('hello e2e')
  })

  it('switches between sessions by clicking session items', async () => {
    await sendChatMessage('second session')
    await browser.waitUntil(
      async () => (await chat.sessionItems).length >= 2,
      { timeout: 30000, interval: 500 },
    )
    const items = await chat.sessionItems
    const first = items[0]
    await first.click()
    const active = await browser.$('[data-testid="session-item"][data-active="true"]')
    await active.waitForExist({ timeout: 10000 })
    expect(await active.getText()).toContain('second session')
  })

  it('filters sessions via the search box', async () => {
    const search = await browser.$('[data-testid="session-search-input"]')
    await search.click()
    await browser.keys('e2e')
    await browser.pause(500)
    const items = await chat.sessionItems
    expect(items.length).toBeGreaterThanOrEqual(1)
    for (const item of items) {
      expect(await item.getText()).toMatch(/e2e/i)
    }
  })
})
```

- [ ] **Step 2: 单独运行该 spec**

Run: `E2E_GREP="session management" yarn test:e2e`
Expected: 全绿（发送消息会创建本地会话并渲染用户消息；不等待 assistant 回复）。

- [ ] **Step 3: 提交**

```bash
git add e2e/specs/session-management.spec.ts
git commit -m "test(e2e): add session management spec"
```

---

## Task 6: E2E spec — Composer 控件

**Files:**
- Create: `e2e/specs/composer-widgets.spec.ts`

**Interfaces:**
- Consumes: `waitForAppReady`, `waitForMainApp`, `skipLoginIfPresent`，`switchToCodeSurface`。
- Produces: ModelPicker / PermissionModePicker 的 E2E 覆盖。

- [ ] **Step 1: 创建 spec 文件**

```ts
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('composer widgets', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await switchToCodeSurface()
  })

  it('shows the model picker chip and opens its dropdown', async () => {
    const chip = await chat.modelChip
    await chip.waitForExist({ timeout: 10000 })
    await chip.click()
    const menu = await browser.$('[role="menu"]')
    await menu.waitForExist({ timeout: 10000 })
    expect(await menu.isDisplayed()).toBe(true)
    await browser.keys('Escape')
  })

  it('shows the permission mode picker and lists all three modes', async () => {
    const chip = await chat.permissionChip
    await chip.waitForExist({ timeout: 10000 })
    await chip.click()
    const menu = await browser.$('[role="menu"]')
    await menu.waitForExist({ timeout: 10000 })
    const text = await menu.getText()
    expect(text).toContain('仅对话')
    expect(text).toContain('编辑目录内文件')
    expect(text).toContain('完全放开')
    await browser.keys('Escape')
  })

  it('send button is disabled when textarea is empty and no attachments', async () => {
    const send = await chat.composerSend
    expect(await send.isEnabled()).toBe(false)
  })
})
```

- [ ] **Step 2: 单独运行该 spec**

Run: `E2E_GREP="composer widgets" yarn test:e2e`
Expected: 全绿。

- [ ] **Step 3: 提交**

```bash
git add e2e/specs/composer-widgets.spec.ts
git commit -m "test(e2e): add composer widgets spec"
```

---

## Task 7: E2E spec — 设置页 smoke

**Files:**
- Create: `e2e/specs/settings-smoke.spec.ts`

**Interfaces:**
- Consumes: `openSettings`, `closeSettings`, `SettingsPage`。
- Produces: 设置页导航 smoke 覆盖。

- [ ] **Step 1: 创建 spec 文件**

```ts
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { openSettings, closeSettings } from '../helpers/settings.js'
import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()

const PAGES = [
  { id: 'general', label: '通用设置' },
  { id: 'model', label: '模型配置' },
  { id: 'agents', label: '智能体管理' },
  { id: 'mcp', label: '外部工具服务' },
  { id: 'skill', label: '技能' },
  { id: 'plugins', label: '插件' },
] as const

describe('settings smoke', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await openSettings()
  })

  after(async () => {
    if (await settings.backButton.isExisting()) await closeSettings()
  })

  it('opens the settings page and shows the general tab by default', async () => {
    const panel = await settings.activeTabPanel
    await panel.waitForExist({ timeout: 10000 })
    expect(await panel.getText()).not.toBe('')
  })

  for (const { id, label } of PAGES) {
    it(`switches to the ${id} tab`, async () => {
      const nav = await settings.nav(id)
      await nav.waitForClickable({ timeout: 10000 })
      await nav.click()
      await browser.waitUntil(
        async () => (await nav.getAttribute('aria-selected')) === 'true',
        { timeout: 10000, interval: 200 },
      )
      const panel = await settings.activeTabPanel
      await panel.waitForExist({ timeout: 10000 })
      const text = await panel.getText()
      expect(text.toLowerCase()).toContain(label.toLowerCase())
    })
  }

  it('closes settings with the back button', async () => {
    await closeSettings()
    expect(await settings.backButton.isExisting()).toBe(false)
  })
})
```

- [ ] **Step 2: 单独运行该 spec**

Run: `E2E_GREP="settings smoke" yarn test:e2e`
Expected: 全绿。

- [ ] **Step 3: 提交**

```bash
git add e2e/specs/settings-smoke.spec.ts
git commit -m "test(e2e): add settings smoke spec"
```

---

## Task 8: 单元测试 — Composer

**Files:**
- Create: `src/components/chat/Composer.test.tsx`

**Interfaces:**
- Consumes: `Composer` props；`Textarea`/`Button` UI 组件。
- Produces: Composer 渲染、输入、提交、附件、停止的测试覆盖。

- [ ] **Step 1: 创建测试文件**

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Composer } from './Composer'

describe('Composer', () => {
  it('renders textarea and disabled send when empty', () => {
    render(<Composer value="" onChange={vi.fn()} onSubmit={vi.fn()} />)
    expect(screen.getByPlaceholderText(/Message hip/)).toBeInTheDocument()
    expect(screen.getByTestId('composer-send')).toBeDisabled()
  })

  it('calls onChange when typing', () => {
    const onChange = vi.fn()
    render(<Composer value="" onChange={onChange} onSubmit={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/Message hip/), { target: { value: 'hi' } })
    expect(onChange).toHaveBeenCalledWith('hi')
  })

  it('calls onSubmit when send is clicked', () => {
    const onSubmit = vi.fn()
    render(<Composer value="hello" onChange={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByTestId('composer-send'))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('submits on Enter without shift', () => {
    const onSubmit = vi.fn()
    render(<Composer value="hello" onChange={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.keyDown(screen.getByPlaceholderText(/Message hip/), { key: 'Enter', shiftKey: false })
    expect(onSubmit).toHaveBeenCalled()
  })

  it('does not submit on shift+Enter', () => {
    const onSubmit = vi.fn()
    render(<Composer value="hello" onChange={vi.fn()} onSubmit={onSubmit} />)
    fireEvent.keyDown(screen.getByPlaceholderText(/Message hip/), { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders attachment chips and removes them', () => {
    const onAttachmentsChange = vi.fn()
    const attachments = [{ id: 'a1', name: 'file.png', mimeType: 'image/png', path: '/tmp/file.png' }]
    render(
      <Composer
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        attachments={attachments}
        onAttachmentsChange={onAttachmentsChange}
      />,
    )
    expect(screen.getByTestId('attachment-chip')).toHaveTextContent('file.png')
    fireEvent.click(screen.getByTestId('attachment-remove'))
    expect(onAttachmentsChange).toHaveBeenCalledWith([])
  })

  it('shows stop button while running', () => {
    const onStop = vi.fn()
    render(<Composer value="" onChange={vi.fn()} onSubmit={vi.fn()} running onStop={onStop} />)
    fireEvent.click(screen.getByTestId('composer-stop'))
    expect(onStop).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行该组件测试**

Run: `yarn test src/components/chat/Composer.test.tsx`
Expected: 全绿。

- [ ] **Step 3: 提交**

```bash
git add src/components/chat/Composer.test.tsx
git commit -m "test: add Composer unit tests"
```

---

## Task 9: 单元测试 — MessageBubble

**Files:**
- Create: `src/components/chat/MessageBubble.test.tsx`

**Interfaces:**
- Consumes: `Message` 类型；`MessageBubble` 组件。
- Produces: 用户/助手消息、附件、时间戳、usage 的测试覆盖。

- [ ] **Step 1: 创建测试文件**

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageBubble } from './MessageBubble'

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }))
vi.mock('@/ipc/clipboard', () => ({ copyText: vi.fn() }))

describe('MessageBubble', () => {
  it('renders a user message with content', () => {
    render(
      <MessageBubble
        message={{
          id: 'm1',
          role: 'user',
          content: 'hello',
          timestamp: Date.now(),
        } as any}
      />,
    )
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('你')).toBeInTheDocument()
  })

  it('renders an assistant message', () => {
    render(
      <MessageBubble
        message={{
          id: 'm2',
          role: 'assistant',
          content: 'hi there',
          timestamp: Date.now(),
        } as any}
      />,
    )
    expect(screen.getByText('hi there')).toBeInTheDocument()
    expect(screen.getByText('hip')).toBeInTheDocument()
  })

  it('renders user attachments', () => {
    render(
      <MessageBubble
        message={{
          id: 'm3',
          role: 'user',
          content: '',
          timestamp: Date.now(),
          attachments: [{ id: 'a1', name: 'pic.png', mimeType: 'image/png', size: 1024 }],
        } as any}
      />,
    )
    const chip = screen.getByTestId('message-attachment')
    expect(chip).toHaveTextContent('pic.png')
    expect(chip).toHaveTextContent('1 KB')
  })

  it('shows message usage for assistant messages', () => {
    render(
      <MessageBubble
        message={{
          id: 'm4',
          role: 'assistant',
          content: 'ok',
          timestamp: Date.now(),
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        } as any}
        isLastAssistant
      />,
    )
    expect(screen.getByTestId('message-usage')).toHaveTextContent('15')
  })

  it('shows message timestamp when available', () => {
    const now = Date.now()
    render(
      <MessageBubble
        message={{
          id: 'm5',
          role: 'user',
          content: 'time',
          timestamp: now,
        } as any}
      />,
    )
    expect(screen.getByTestId('message-time')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行该组件测试**

Run: `yarn test src/components/chat/MessageBubble.test.tsx`
Expected: 全绿。

- [ ] **Step 3: 提交**

```bash
git add src/components/chat/MessageBubble.test.tsx
git commit -m "test: add MessageBubble unit tests"
```

---

## Task 10: 单元测试 — CodeBlock

**Files:**
- Create: `src/components/chat/CodeBlock.test.tsx`

**Interfaces:**
- Consumes: `CodeBlock` 组件；`copyText`。
- Produces: 代码块渲染、复制按钮状态切换的测试覆盖。

- [ ] **Step 1: 创建测试文件**

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CodeBlock } from './CodeBlock'
import { copyText } from '@/ipc/clipboard'

vi.mock('@/ipc/clipboard', () => ({ copyText: vi.fn() }))

describe('CodeBlock', () => {
  it('renders code and copy button', () => {
    render(
      <CodeBlock>
        <code>const x = 1</code>
      </CodeBlock>,
    )
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
    expect(screen.getByTestId('code-copy')).toBeInTheDocument()
  })

  it('copies code and shows check icon', async () => {
    vi.mocked(copyText).mockResolvedValue(true)
    render(
      <CodeBlock>
        <code>hello</code>
      </CodeBlock>,
    )
    fireEvent.click(screen.getByTestId('code-copy'))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('hello'))
  })

  it('does not change icon when copy fails', async () => {
    vi.mocked(copyText).mockResolvedValue(false)
    render(
      <CodeBlock>
        <code>fail</code>
      </CodeBlock>,
    )
    fireEvent.click(screen.getByTestId('code-copy'))
    await waitFor(() => expect(copyText).toHaveBeenCalled())
    expect(screen.getByTestId('code-copy')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行该组件测试**

Run: `yarn test src/components/chat/CodeBlock.test.tsx`
Expected: 全绿。

- [ ] **Step 3: 提交**

```bash
git add src/components/chat/CodeBlock.test.tsx
git commit -m "test: add CodeBlock unit tests"
```

---

## Task 11: 单元测试 — PermissionModal

**Files:**
- Create: `src/components/chat/PermissionModal.test.tsx`

**Interfaces:**
- Consumes: `useActiveSessionId`, `useActivePendingPermission`, `sessionService.respondPermission`。
- Produces: PermissionModal 渲染与响应的测试覆盖。

- [ ] **Step 1: 创建测试文件**

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PermissionModal } from './PermissionModal'
import * as domain from '@/domain'

const respondPermission = vi.fn()

vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    useActiveSessionId: vi.fn(),
    useActivePendingPermission: vi.fn(),
    sessionService: { respondPermission },
  }
})

describe('PermissionModal', () => {
  beforeEach(() => {
    cleanup()
    respondPermission.mockClear()
  })

  it('returns null when there is no pending permission', () => {
    vi.mocked(domain.useActiveSessionId).mockReturnValue('s1')
    vi.mocked(domain.useActivePendingPermission).mockReturnValue(null as any)
    const { container } = render(<PermissionModal />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the modal and responds with the chosen option', () => {
    vi.mocked(domain.useActiveSessionId).mockReturnValue('s1')
    vi.mocked(domain.useActivePendingPermission).mockReturnValue({
      requestId: 'r1',
      tool: { title: 'Run tests', kind: 'shell' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow' }],
      agentFrame: null,
    } as any)

    render(<PermissionModal />)
    expect(screen.getByTestId('permission-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('permission-option-allow'))
    expect(respondPermission).toHaveBeenCalledWith('s1', 'r1', { optionId: 'allow' })
  })

  it('shows subagent name when present', () => {
    vi.mocked(domain.useActiveSessionId).mockReturnValue('s1')
    vi.mocked(domain.useActivePendingPermission).mockReturnValue({
      requestId: 'r2',
      tool: { title: 'Edit', kind: 'edit_file' },
      options: [{ optionId: 'reject', name: 'Reject', kind: 'reject' }],
      agentFrame: { name: 'SubAgent' },
    } as any)

    render(<PermissionModal />)
    expect(screen.getByTestId('permission-subagent')).toHaveTextContent('SubAgent')
  })
})
```

- [ ] **Step 2: 运行该组件测试**

Run: `yarn test src/components/chat/PermissionModal.test.tsx`
Expected: 全绿。

- [ ] **Step 3: 提交**

```bash
git add src/components/chat/PermissionModal.test.tsx
git commit -m "test: add PermissionModal unit tests"
```

---

## Task 12: 单元测试 — PlanApprovalCard

**Files:**
- Create: `src/components/chat/PlanApprovalCard.test.tsx`

**Interfaces:**
- Consumes: `PlanApprovalCard` props。
- Produces: plan 渲染、approve/amend/reject 交互的测试覆盖。

- [ ] **Step 1: 创建测试文件**

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlanApprovalCard } from './PlanApprovalCard'

describe('PlanApprovalCard', () => {
  const plan = [
    { content: 'Step one', status: 'completed' },
    { content: 'Step two', status: 'pending' },
  ] as any

  it('renders plan items', () => {
    render(<PlanApprovalCard plan={plan} onApprove={vi.fn()} onReject={vi.fn()} onAmend={vi.fn()} />)
    expect(screen.getByText('Step one')).toBeInTheDocument()
    expect(screen.getByText('Step two')).toBeInTheDocument()
  })

  it('calls onApprove when approve is clicked', () => {
    const onApprove = vi.fn()
    render(<PlanApprovalCard plan={plan} onApprove={onApprove} onReject={vi.fn()} onAmend={vi.fn()} />)
    fireEvent.click(screen.getByTestId('plan-approve'))
    expect(onApprove).toHaveBeenCalled()
  })

  it('calls onReject when reject is clicked', () => {
    const onReject = vi.fn()
    render(<PlanApprovalCard plan={plan} onApprove={vi.fn()} onReject={onReject} onAmend={vi.fn()} />)
    fireEvent.click(screen.getByTestId('plan-reject'))
    expect(onReject).toHaveBeenCalled()
  })

  it('switches to amend mode and submits amendment', () => {
    const onAmend = vi.fn()
    render(<PlanApprovalCard plan={plan} onApprove={vi.fn()} onReject={vi.fn()} onAmend={onAmend} />)
    fireEvent.click(screen.getByTestId('plan-amend'))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'change step two' } })
    fireEvent.click(screen.getByTestId('plan-amend-submit'))
    expect(onAmend).toHaveBeenCalledWith('change step two')
  })
})
```

- [ ] **Step 2: 运行该组件测试**

Run: `yarn test src/components/chat/PlanApprovalCard.test.tsx`
Expected: 全绿。

- [ ] **Step 3: 提交**

```bash
git add src/components/chat/PlanApprovalCard.test.tsx
git commit -m "test: add PlanApprovalCard unit tests"
```

---

## Task 13: 单元测试 — FilePreview

**Files:**
- Create: `src/components/artifact/FilePreview.test.tsx`

**Interfaces:**
- Consumes: `useFsScope`, `useFsStore`。
- Produces: FilePreview 各种状态（empty/loading/error/image/pdf/html/markdown/text）的测试覆盖。

- [ ] **Step 1: 创建测试文件**

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { FilePreview } from './FilePreview'
import { useFsStore } from '@/store/fsStore'

vi.mock('@/store/useFsScope', () => ({
  useFsScope: () => ({ scopeId: 's1', cwd: '/tmp', isDraft: false, chatDraft: false }),
}))

describe('FilePreview', () => {
  beforeEach(() => {
    cleanup()
    useFsStore.setState({ bySession: {} } as any)
  })

  function setPreview(state: any) {
    useFsStore.setState({ bySession: { s1: { preview: state } } } as any)
  }

  it('shows empty state when no file is selected', () => {
    render(<FilePreview />)
    expect(screen.getByTestId('preview-empty')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    setPreview({ status: 'loading' })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-loading')).toBeInTheDocument()
  })

  it('shows error state', () => {
    setPreview({ status: 'error', error: 'too_large' })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-error')).toBeInTheDocument()
  })

  it('renders markdown preview', () => {
    setPreview({ status: 'ready', path: 'README.md', content: '# Hello', mimeType: 'text/markdown', encoding: 'utf8' })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-markdown')).toHaveTextContent('Hello')
  })

  it('renders text preview', () => {
    setPreview({ status: 'ready', path: 'a.ts', content: 'export const a = 1', mimeType: 'text/plain', encoding: 'utf8' })
    render(<FilePreview />)
    expect(screen.getByTestId('preview-text')).toHaveTextContent('export const a = 1')
  })

  it('renders html preview in sandboxed iframe', () => {
    setPreview({ status: 'ready', path: 'index.html', content: '<p>hi</p>', mimeType: 'text/html', encoding: 'utf8' })
    render(<FilePreview />)
    const frame = screen.getByTestId('preview-html')
    expect(frame).toHaveAttribute('sandbox', '')
  })
})
```

- [ ] **Step 2: 运行该组件测试**

Run: `yarn test src/components/artifact/FilePreview.test.tsx`
Expected: 全绿。

- [ ] **Step 3: 提交**

```bash
git add src/components/artifact/FilePreview.test.tsx
git commit -m "test: add FilePreview unit tests"
```

---

## Task 14: 单元测试 — FileTree

**Files:**
- Create: `src/components/artifact/FileTree.test.tsx`

**Interfaces:**
- Consumes: `useFsScope`, `useFsStore`，`sessionService`。
- Produces: FileTree 空状态、目录选择、文件点击的测试覆盖。

- [ ] **Step 1: 创建测试文件**

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FileTree } from './FileTree'
import { useFsStore } from '@/store/fsStore'

const lsDir = vi.fn()
const readFile = vi.fn()
vi.mock('@/domain', async () => {
  const actual = await vi.importActual<typeof import('@/domain')>('@/domain')
  return {
    ...actual,
    sessionService: { lsDir, readFile, lsDraft: vi.fn(), readDraftFile: vi.fn(), setProjectDir: vi.fn() },
  }
})

vi.mock('@/store/useFsScope', () => ({
  useFsScope: () => ({ scopeId: 's1', cwd: '/project', isDraft: false, chatDraft: false }),
}))

vi.mock('@/ipc/dialog', () => ({ pickDirectory: vi.fn() }))

describe('FileTree', () => {
  beforeEach(() => {
    cleanup()
    useFsStore.setState({ bySession: {} } as any)
    lsDir.mockClear()
    readFile.mockClear()
  })

  it('renders root entries and expands a directory', () => {
    useFsStore.setState({
      bySession: {
        s1: {
          cwd: '/project',
          entriesByDir: {
            '/project': [
              { path: '/project/src', name: 'src', isDir: true },
              { path: '/project/README.md', name: 'README.md', isDir: false },
            ],
            '/project/src': [{ path: '/project/src/a.ts', name: 'a.ts', isDir: false }],
          },
          expanded: { '/project/src': true },
          activePath: null,
        },
      },
    } as any)

    render(<FileTree />)
    expect(screen.getByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('a.ts')).toBeInTheDocument()
  })

  it('calls readFile when a file entry is clicked', () => {
    useFsStore.setState({
      bySession: {
        s1: {
          cwd: '/project',
          entriesByDir: {
            '/project': [{ path: '/project/README.md', name: 'README.md', isDir: false }],
          },
          expanded: {},
          activePath: null,
        },
      },
    } as any)

    render(<FileTree />)
    fireEvent.click(screen.getByText('README.md'))
    expect(readFile).toHaveBeenCalledWith('s1', '/project/README.md')
  })
})
```

- [ ] **Step 2: 运行该组件测试**

Run: `yarn test src/components/artifact/FileTree.test.tsx`
Expected: 全绿。如 store 结构不一致则调整。

- [ ] **Step 3: 提交**

```bash
git add src/components/artifact/FileTree.test.tsx
git commit -m "test: add FileTree unit tests"
```

---

## Task 15: Phase 1 集成验证

**Files:**
- 全部 Phase 1 新增/修改文件。

- [ ] **Step 1: 运行类型检查**

Run: `yarn type-check`
Expected: 无错误。

- [ ] **Step 2: 运行单元测试**

Run: `yarn test`
Expected: 全绿（或至少无新增失败）。

- [ ] **Step 3: 运行 E2E 套件**

Run: `yarn test:e2e`
Expected: 全部 spec 通过。若 LLM/配置无关的 spec 失败，先修复。

- [ ] **Step 4: 提交验证结果（可选聚合提交）**

如果前面已逐任务提交，本步骤可跳过；否则：

```bash
git add .
git commit -m "test: complete Phase 1 UI E2E and key unit tests"
```

---

## Spec 覆盖率自查

| 设计文档要求 | 对应任务 |
|---------------|----------|
| 会话列表、搜索、新建会话 | Task 5 |
| Composer 附件、ModelPicker、PermissionModePicker、停止生成 | Task 6, Task 8 |
| 设置页 smoke | Task 7 |
| MessageBubble、Composer、CodeBlock | Task 9, Task 8, Task 10 |
| PermissionModal、PlanApprovalCard | Task 11, Task 12 |
| FilePreview、FileTree | Task 13, Task 14 |

---

## 执行交接

Plan saved to `docs/superpowers/plans/2026-06-30-complete-tests-phase1.md`.

**Execution options:**

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach do you want?
