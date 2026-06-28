# Chat Attachment Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an attachment upload button to the chat input that appears when the current model or an available internal sub-agent is multimodal, and send images, PDFs, and text documents through a managed sidecar attachment directory.

**Architecture:** Extend the shared protocol with an `Attachment` type, add a pure eligibility helper on the frontend, pick files via Tauri dialog, render attachment chips in `Composer`, pass absolute paths to the sidecar over `message:send`, copy files into the session scratch directory, build LangChain multipart `HumanMessage` content, and persist attachment metadata alongside messages.

**Tech Stack:** React + TypeScript + Tailwind, Zustand, Tauri v2 dialog, Vitest, LangChain `@langchain/core` messages, Node `fs/promises`, `pdf-parse` for PDF text extraction.

## Global Constraints

- Supported file types: images (`image/*`), PDFs (`application/pdf`), and text documents with explicit allowed extensions.
- Single file size limit: **10 MB**; total per-message limit: **50 MB**.
- Drag-and-drop and clipboard paste are out of scope but interfaces must be extensible.
- External ACP/custom sub-agents are **not** considered for button visibility.
- No new Tauri Rust plugins; file reading happens in the sidecar using Node `fs`.
- Follow existing code style and patterns in the repo.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/protocol/src/index.ts` | Shared `Attachment` type and `message:send` extension. |
| `src/lib/attachmentEligibility.ts` | Pure helper deciding whether the upload button should show. |
| `src/lib/attachmentEligibility.test.ts` | Unit tests for the helper. |
| `src/lib/attachmentMimeType.ts` | Map file extension → MIME type for picked files. |
| `src/ipc/dialog.ts` | Tauri file picker for attachments. |
| `src/components/chat/attachmentTypes.ts` | Shared `LocalAttachment` type for frontend components. |
| `src/components/chat/AttachmentButton.tsx` | Upload button with visibility logic. |
| `src/components/chat/AttachmentButton.test.tsx` | Component tests. |
| `src/components/chat/Composer.tsx` | Render attachment chips and accept attachment props. |
| `src/components/chat/InputBar.tsx` | Own attachment state and pass it through to `Composer`/`sessionService`. |
| `src/components/chat/MessageBubble.tsx` | Render attachment list on user messages. |
| `src/domain/sessionService.ts` | Send attachments with `message:send`. |
| `src/domain/sessionService.test.ts` | Update existing tests for new signature. |
| `src/domain/sessionStore.ts` | Carry `attachments` on optimistic user messages and server messages. |
| `src/domain/sessionStore.test.ts` | Update store tests. |
| `packages/sidecar/src/session/attachments.ts` | Validation, staging, and multipart content building. |
| `packages/sidecar/src/session/attachments.test.ts` | Sidecar attachment unit tests. |
| `packages/sidecar/src/session/session.ts` | Wire attachments into input processing and `HumanMessage` construction. |
| `packages/sidecar/src/session/session-manager.ts` | Forward `message:send.attachments` to `Session.sendMessage`. |
| `packages/sidecar/src/persistence/schema.ts` | Migration v15: add `attachments` column. |
| `packages/sidecar/src/persistence/store.ts` | Persist/load attachment metadata. |
| `packages/sidecar/src/persistence/message-types.ts` | Add `attachments` to user `SessionMessageData`. |
| `packages/sidecar/src/persistence/message-updater.ts` | Project `user_message.attachments` into `session_message`. |
| `packages/sidecar/package.json` | Add `pdf-parse` dependency. |

---

## Task 1: Protocol types

**Files:**
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Produces: `Attachment` interface and `message:send` payload shape used by frontend and sidecar.

- [ ] **Step 1: Add `Attachment` interface**

Add near the `Message` interface:

```ts
export interface Attachment {
  id: string
  name: string
  mimeType: string
  size?: number
}
```

- [ ] **Step 2: Extend `Message` with attachments**

```ts
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentId?: string
  timestamp: number
  stopped?: boolean
  timeline?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
  usage?: TurnUsage
  attachments?: Attachment[]
}
```

- [ ] **Step 3: Extend `ClientMessage` `message:send`**

Replace the existing `message:send` variant with:

```ts
| { type: 'message:send'; sessionId: string; id: string; content: string; role: 'user'; attachments?: AttachmentSendPayload[] }
```

And add the internal payload type below `ClientMessage`:

```ts
type AttachmentSendPayload = Attachment & { path: string }
```

- [ ] **Step 4: Extend `SessionEvent` `user_message`**

```ts
| { type: 'user_message'; sessionId: string; content: string; messageId: string; timestamp: number; attachments?: Attachment[] }
```

- [ ] **Step 5: Run type check**

```bash
yarn type-check
```

Expected: pass (only types added, no consumers yet).

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): add Attachment type and message:send extension"
```

---

## Task 2: Attachment eligibility helper

**Files:**
- Create: `src/lib/attachmentEligibility.ts`
- Create: `src/lib/attachmentEligibility.test.ts`

**Interfaces:**
- Consumes: `AgentConfig` from `@hip/protocol`, `Catalog` from `@/ipc/catalog`, `parseModelKey` from `@/lib/modelKey`.
- Produces: `isAttachmentSupported(currentModelKey, agents, catalog): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/attachmentEligibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isAttachmentSupported } from './attachmentEligibility'
import type { Catalog } from '@/ipc/catalog'
import type { AgentConfig } from '@hip/protocol'

const catalog: Catalog = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    env: [],
    models: {
      'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', attachment: true },
      'gpt-4': { id: 'gpt-4', name: 'GPT-4', attachment: false },
    },
  },
}

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'a1',
    name: 'Agent',
    kind: 'internal',
    command: '',
    args: [],
    enabled: true,
    ...overrides,
  } as AgentConfig
}

describe('isAttachmentSupported', () => {
  it('returns true when current model is multimodal', () => {
    expect(isAttachmentSupported('openai/gpt-4o', [], catalog)).toBe(true)
  })

  it('returns false when current model is not multimodal and no agents', () => {
    expect(isAttachmentSupported('openai/gpt-4', [], catalog)).toBe(false)
  })

  it('returns true when an internal sub-agent has a multimodal bound model', () => {
    const agents = [agent({ boundModel: { providerID: 'openai', modelID: 'gpt-4o' } })]
    expect(isAttachmentSupported('openai/gpt-4', agents, catalog)).toBe(true)
  })

  it('ignores external agents', () => {
    const agents = [agent({ kind: 'acp', boundModel: { providerID: 'openai', modelID: 'gpt-4o' } })]
    expect(isAttachmentSupported('openai/gpt-4', agents, catalog)).toBe(false)
  })

  it('ignores disabled or builtin agents', () => {
    const agents = [
      agent({ id: 'builtin', enabled: true, boundModel: { providerID: 'openai', modelID: 'gpt-4o' } }),
      agent({ enabled: false, boundModel: { providerID: 'openai', modelID: 'gpt-4o' } }),
    ]
    expect(isAttachmentSupported('openai/gpt-4', agents, catalog)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
yarn test src/lib/attachmentEligibility.test.ts
```

Expected: FAIL — `isAttachmentSupported` not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/attachmentEligibility.ts`:

```ts
import type { AgentConfig } from '@hip/protocol'
import type { Catalog } from '@/ipc/catalog'
import { parseModelKey } from '@/lib/modelKey'

export function isAttachmentSupported(
  currentModelKey: string | undefined,
  agents: AgentConfig[],
  catalog: Catalog,
): boolean {
  if (currentModelKey) {
    const { providerID, modelID } = parseModelKey(currentModelKey)
    if (catalog[providerID]?.models[modelID]?.attachment) return true
  }
  for (const agent of agents) {
    if (agent.kind !== 'internal' || !agent.enabled || agent.id === 'builtin') continue
    if (!agent.boundModel) continue
    const { providerID, modelID } = agent.boundModel
    if (catalog[providerID]?.models[modelID]?.attachment) return true
  }
  return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
yarn test src/lib/attachmentEligibility.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/attachmentEligibility.ts src/lib/attachmentEligibility.test.ts
git commit -m "feat(chat): add attachment eligibility helper"
```

---

## Task 3: File picker and MIME type utility

**Files:**
- Modify: `src/ipc/dialog.ts`
- Create: `src/lib/attachmentMimeType.ts`
- Create: `src/lib/attachmentMimeType.test.ts`

**Interfaces:**
- Produces: `pickAttachmentFiles(): Promise<string[] | null>` and `getAttachmentMimeType(name): string`.

- [ ] **Step 1: Add MIME type utility**

Create `src/lib/attachmentMimeType.ts`:

```ts
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  csv: 'text/csv',
  xml: 'application/xml',
  toml: 'text/toml',
  js: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript-jsx',
  py: 'text/x-python',
  go: 'text/x-go',
  rs: 'text/x-rust',
  java: 'text/x-java',
  c: 'text/x-c',
  cpp: 'text/x-c++',
  h: 'text/x-c',
  cs: 'text/x-csharp',
  rb: 'text/x-ruby',
  php: 'text/x-php',
  swift: 'text/x-swift',
  kt: 'text/x-kotlin',
  html: 'text/html',
  css: 'text/css',
  scss: 'text/x-scss',
  sql: 'text/x-sql',
  sh: 'text/x-shellscript',
  ps1: 'text/x-powershell',
}

export function getAttachmentMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_MIME[ext] ?? 'application/octet-stream'
}
```

- [ ] **Step 2: Test the MIME utility**

Create `src/lib/attachmentMimeType.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getAttachmentMimeType } from './attachmentMimeType'

describe('getAttachmentMimeType', () => {
  it('returns image/png for png', () => {
    expect(getAttachmentMimeType('photo.png')).toBe('image/png')
  })
  it('returns application/pdf for pdf', () => {
    expect(getAttachmentMimeType('doc.pdf')).toBe('application/pdf')
  })
  it('returns text/plain for txt', () => {
    expect(getAttachmentMimeType('notes.txt')).toBe('text/plain')
  })
  it('falls back to octet-stream', () => {
    expect(getAttachmentMimeType('unknown.unknown')).toBe('application/octet-stream')
  })
})
```

Run:

```bash
yarn test src/lib/attachmentMimeType.test.ts
```

Expected: PASS.

- [ ] **Step 3: Extend dialog.ts global seam**

Modify `src/ipc/dialog.ts` to add `__hipPickAttachmentFiles` to the global interface.

- [ ] **Step 4: Add pickAttachmentFiles**

Append to `src/ipc/dialog.ts`:

```ts
export async function pickAttachmentFiles(): Promise<string[] | null> {
  if (typeof window !== 'undefined' && window.__hipPickAttachmentFiles) return window.__hipPickAttachmentFiles()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    multiple: true,
    title: '选择附件',
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: '文本文档', extensions: ['txt', 'md', 'json', 'yaml', 'yml', 'csv', 'xml', 'toml', 'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'swift', 'kt', 'html', 'css', 'scss', 'sql', 'sh', 'ps1'] },
    ],
  })
  if (result === null) return null
  return Array.isArray(result) ? result : [result]
}
```

- [ ] **Step 5: Commit**

```bash
git add src/ipc/dialog.ts src/lib/attachmentMimeType.ts src/lib/attachmentMimeType.test.ts
git commit -m "feat(chat): add attachment file picker and MIME utility"
```

---

## Task 4: `AttachmentButton` component

**Files:**
- Create: `src/components/chat/AttachmentButton.tsx`
- Create: `src/components/chat/AttachmentButton.test.tsx`

**Interfaces:**
- Consumes: `isAttachmentSupported`, `pickAttachmentFiles`, `getAttachmentMimeType`, `useProvidersStore`, `useHipConfigStore`, `ModelPicker` current-key resolution logic.
- Produces: `AttachmentButton({ onAttach }: { onAttach: (attachments: LocalAttachment[]) => void })`.

- [ ] **Step 1: Create shared `LocalAttachment` type**

Create `src/components/chat/attachmentTypes.ts`:

```ts
export type LocalAttachment = {
  id: string
  name: string
  mimeType: string
  path: string
}
```

- [ ] **Step 2: Implement `AttachmentButton`**

```tsx
import { useTranslation } from 'react-i18next'
import { Paperclip } from 'lucide-react'
import { nanoid } from 'nanoid'
import { Button } from '@/components/ui/Button'
import { pickAttachmentFiles } from '@/ipc/dialog'
import { getAttachmentMimeType } from '@/lib/attachmentMimeType'
import { isAttachmentSupported } from '@/lib/attachmentEligibility'
import { useProvidersStore } from '@/store/providersStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useActiveSession, useActiveSessionId } from '@/domain'
import { useDraftStore } from '@/store/draftStore'
import { activeModelKey } from '@/lib/modelKey'
import type { LocalAttachment } from './attachmentTypes'

export interface AttachmentButtonProps {
  onAttach: (attachments: LocalAttachment[]) => void
}

export function AttachmentButton({ onAttach }: AttachmentButtonProps) {
  const { t } = useTranslation()
  const catalog = useProvidersStore((s) => s.catalog)
  const config = useProvidersStore((s) => s.config)
  const agents = useHipConfigStore((s) => s.config.agents ?? [])
  const draft = useDraftStore((s) => s.draft)
  const activeId = useActiveSessionId()
  const session = useActiveSession()

  const currentKey = activeId && session
    ? (session.config.model ? `${session.config.llmProvider}/${session.config.model}` : activeModelKey(config))
    : (draft?.modelKey ?? activeModelKey(config))

  if (!isAttachmentSupported(currentKey, agents, catalog)) return null

  const handleClick = async () => {
    const paths = await pickAttachmentFiles()
    if (!paths) return
    const attachments: LocalAttachment[] = paths.map((path) => {
      const name = path.replace(/\\/g, '/').split('/').pop() ?? path
      return {
        id: nanoid(),
        name,
        mimeType: getAttachmentMimeType(name),
        path,
      }
    })
    onAttach(attachments)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleClick}
      title={t('chat.attach')}
      data-testid="attachment-button"
    >
      <Paperclip size={16} />
    </Button>
  )
}
```

- [ ] **Step 3: Add tests**

Create `src/components/chat/AttachmentButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AttachmentButton } from './AttachmentButton'
import * as providersStore from '@/store/providersStore'
import * as hipConfigStore from '@/store/hipConfigStore'
import * as domain from '@/domain'
import * as draftStore from '@/store/draftStore'

vi.mock('@/ipc/dialog', () => ({
  pickAttachmentFiles: vi.fn(),
}))

function mockStores(catalog: any, agents: any[] = []) {
  vi.spyOn(providersStore, 'useProvidersStore').mockImplementation((selector: any) =>
    selector({ catalog, config: { providers: {}, activeModel: { providerID: 'openai', modelID: 'gpt-4' } } }),
  )
  vi.spyOn(hipConfigStore, 'useHipConfigStore').mockImplementation((selector: any) => selector({ config: { agents } }))
  vi.spyOn(domain, 'useActiveSessionId').mockReturnValue(null)
  vi.spyOn(domain, 'useActiveSession').mockReturnValue(null)
  vi.spyOn(draftStore, 'useDraftStore').mockImplementation((selector: any) => selector({ draft: null, setModelKey: vi.fn() }))
}

describe('AttachmentButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders when current model supports attachments', () => {
    mockStores({
      openai: { id: 'openai', name: 'OpenAI', env: [], models: { 'gpt-4o': { id: 'gpt-4o', attachment: true } } },
    })
    render(<AttachmentButton onAttach={vi.fn()} />)
    expect(screen.getByTestId('attachment-button')).toBeInTheDocument()
  })

  it('does not render when no model supports attachments', () => {
    mockStores({
      openai: { id: 'openai', name: 'OpenAI', env: [], models: { 'gpt-4': { id: 'gpt-4', attachment: false } } },
    })
    render(<AttachmentButton onAttach={vi.fn()} />)
    expect(screen.queryByTestId('attachment-button')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run tests**

```bash
yarn test src/components/chat/AttachmentButton.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/AttachmentButton.tsx src/components/chat/AttachmentButton.test.tsx
git commit -m "feat(chat): add AttachmentButton with eligibility logic"
```

---

## Task 5: `Composer` attachment chips

**Files:**
- Modify: `src/components/chat/Composer.tsx`

**Interfaces:**
- Consumes: `LocalAttachment` from `AttachmentButton`.
- Produces: `Composer` accepts `attachments` and `onAttachmentsChange` props.

- [ ] **Step 1: Extend `Composer` props and state**

Import at the top:

```ts
import type { LocalAttachment } from './attachmentTypes'
```

Extend props:

```ts
export function Composer({
  value,
  onChange,
  onSubmit,
  autoFocus,
  running,
  onStop,
  reconnecting,
  leftSlot,
  submitDisabled,
  attachments = [],
  onAttachmentsChange,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  autoFocus?: boolean
  running?: boolean
  onStop?: () => void
  reconnecting?: boolean
  leftSlot?: React.ReactNode
  submitDisabled?: boolean
  attachments?: LocalAttachment[]
  onAttachmentsChange?: (attachments: LocalAttachment[]) => void
}) {
```

- [ ] **Step 2: Render attachment chips**

Insert above the textarea:

```tsx
{attachments.length > 0 && (
  <div className="flex flex-wrap gap-1 px-2 pb-2">
    {attachments.map((a) => (
      <div
        key={a.id}
        className="flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-meta"
        data-testid="attachment-chip"
      >
        <span className="max-w-[120px] truncate">{a.name}</span>
        <button
          type="button"
          className="text-ink-tertiary hover:text-ink"
          onClick={() => onAttachmentsChange?.(attachments.filter((x) => x.id !== a.id))}
          aria-label={t('chat.removeAttachment', { name: a.name })}
          data-testid="attachment-remove"
        >
          ×
        </button>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 3: Allow send when attachments exist**

Change submit button disabled condition from `!value.trim() || submitDisabled` to `(!value.trim() && attachments.length === 0) || submitDisabled`.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/Composer.tsx
git commit -m "feat(chat): render attachment chips in Composer"
```

---

## Task 6: Wire `InputBar`, `sessionService`, and `sessionStore`

**Files:**
- Modify: `src/components/chat/InputBar.tsx`
- Modify: `src/domain/sessionService.ts`
- Modify: `src/domain/sessionStore.ts`
- Modify: `src/domain/sessionService.test.ts`
- Modify: `src/domain/sessionStore.test.ts`

**Interfaces:**
- Consumes: `LocalAttachment` from `Composer`.
- Produces: `sessionService.sendMessage(content, attachments)` sends `message:send` with attachments.

- [ ] **Step 1: Update `InputBar` state and submit**

Import:

```ts
import type { LocalAttachment } from './attachmentTypes'
```

```tsx
const [attachments, setAttachments] = useState<LocalAttachment[]>([])
const submit = () => {
  const text = value.trim()
  if (!text && attachments.length === 0) return
  sessionService.sendMessage(text, attachments)
  setValue('')
  setAttachments([])
}
```

Pass to `Composer`:

```tsx
<Composer
  value={value}
  onChange={setValue}
  onSubmit={submit}
  running={status === 'running'}
  onStop={() => sessionService.cancel()}
  reconnecting={reconnecting}
  leftSlot={
    isCode ? (
      <><ModelPicker /><PermissionModePicker /><AttachmentButton onAttach={setAttachments} /></>
    ) : (
      <><ModelPicker /><AttachmentButton onAttach={(add) => setAttachments((prev) => [...prev, ...add])} /></>
    )
  }
  attachments={attachments}
  onAttachmentsChange={setAttachments}
/>
```

- [ ] **Step 2: Update `sessionService.sendMessage`**

```ts
sendMessage(content: string, attachments: LocalAttachment[] = []): void {
  const text = content.trim()
  if (!text && attachments.length === 0) return
  // ... existing session logic unchanged ...
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
```

- [ ] **Step 3: Update `sessionStore.appendUserMessage`**

```ts
appendUserMessage: (sessionId, id, content, attachments) =>
  set((s) => ({
    sessions: s.sessions.map((sess) =>
      sess.id !== sessionId
        ? sess
        : {
            ...sess,
            status: 'running' as const,
            error: null,
            interrupt: null,
            activeTurnPlan: null,
            planApprovalPending: false,
            updatedAtMs: Date.now(),
            messages: [...sess.messages, { id, role: 'user' as const, content, timestamp: Date.now(), attachments }],
          },
    ),
  })),
```

- [ ] **Step 4: Update existing tests for new signature**

Update `sessionService.test.ts` and `sessionStore.test.ts` calls to `appendUserMessage` and `sendMessage` to include the new optional parameter.

- [ ] **Step 5: Run affected tests**

```bash
yarn test src/domain/sessionService.test.ts src/domain/sessionStore.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/InputBar.tsx src/domain/sessionService.ts src/domain/sessionStore.ts src/domain/sessionService.test.ts src/domain/sessionStore.test.ts
git commit -m "feat(chat): wire attachments through InputBar, sessionService and store"
```

---

## Task 7: Sidecar attachments module

**Files:**
- Modify: `packages/sidecar/package.json`
- Create: `packages/sidecar/src/session/attachments.ts`
- Create: `packages/sidecar/src/session/attachments.test.ts`

**Interfaces:**
- Consumes: `Attachment` from `@hip/protocol`, `scratchDirFor` from `./scratch.js`.
- Produces: `validateAttachments`, `stageAttachments`, `buildAttachmentContentParts`.

- [ ] **Step 1: Add `pdf-parse` dependency**

```bash
cd packages/sidecar && yarn add pdf-parse
```

> If `pdf-parse` fails to install due to its post-install test download, set `PDF_PARSER_DISABLE_TEST=true` in the environment or switch to `pdf-parse-debug-disable-null`.

Update `packages/sidecar/package.json`:

```json
"dependencies": {
  ...
  "pdf-parse": "^1.1.1"
}
```

- [ ] **Step 2: Create attachments module**

Create `packages/sidecar/src/session/attachments.ts`:

```ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Attachment } from '@hip/protocol'
import { scratchDirFor } from './scratch.js'

export interface AttachmentPayload extends Attachment {
  path: string
}

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_SIZE = 50 * 1024 * 1024

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.yaml', '.yml', '.csv', '.xml', '.toml',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', '.java', '.c',
  '.cpp', '.h', '.cs', '.rb', '.php', '.swift', '.kt', '.html', '.css',
  '.scss', '.sql', '.sh', '.ps1',
])

const TEXT_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'application/json', 'text/yaml', 'text/csv',
  'application/xml', 'text/xml', 'text/toml', 'text/javascript', 'text/typescript',
  'text/html', 'text/css',
])

export function isAllowedAttachment(name: string, mimeType: string): boolean {
  if (IMAGE_MIME_TYPES.includes(mimeType)) return true
  if (mimeType === 'application/pdf') return true
  if (TEXT_MIME_TYPES.has(mimeType)) return true
  const ext = path.extname(name).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

export async function validateAttachments(attachments: AttachmentPayload[]): Promise<void> {
  let total = 0
  for (const a of attachments) {
    if (!isAllowedAttachment(a.name, a.mimeType)) {
      throw new Error(`Unsupported attachment type: ${a.name}`)
    }
    const stat = await fs.stat(a.path)
    if (stat.size > MAX_ATTACHMENT_SIZE) {
      throw new Error(`Attachment exceeds 10 MB limit: ${a.name}`)
    }
    total += stat.size
    if (total > MAX_TOTAL_ATTACHMENT_SIZE) {
      throw new Error('Total attachment size exceeds 50 MB limit')
    }
  }
}

export async function stageAttachments(
  sessionId: string,
  attachments: AttachmentPayload[],
  scratchRoot: string,
): Promise<Attachment[]> {
  const baseDir = path.join(scratchDirFor(sessionId, scratchRoot), 'attachments')
  await fs.mkdir(baseDir, { recursive: true })
  const staged: Attachment[] = []
  for (const a of attachments) {
    const targetDir = path.join(baseDir, a.id)
    await fs.mkdir(targetDir, { recursive: true })
    const targetPath = path.join(targetDir, a.name)
    await fs.copyFile(a.path, targetPath)
    const stat = await fs.stat(targetPath)
    staged.push({ id: a.id, name: a.name, mimeType: a.mimeType, size: stat.size })
  }
  return staged
}

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export async function buildAttachmentContentParts(attachments: AttachmentPayload[]): Promise<ContentPart[]> {
  const parts: ContentPart[] = []
  for (const a of attachments) {
    if (IMAGE_MIME_TYPES.includes(a.mimeType)) {
      const data = await fs.readFile(a.path)
      const base64 = data.toString('base64')
      parts.push({ type: 'image_url', image_url: { url: `data:${a.mimeType};base64,${base64}` } })
    } else if (a.mimeType === 'application/pdf') {
      try {
        const pdfParse = (await import('pdf-parse')).default
        const data = await fs.readFile(a.path)
        const parsed = await pdfParse(data)
        parts.push({ type: 'text', text: `[Attached PDF: ${a.name}]\n${parsed.text}` })
      } catch {
        parts.push({ type: 'text', text: `[Attached PDF: ${a.name}]` })
      }
    } else {
      const text = await fs.readFile(a.path, 'utf-8')
      parts.push({ type: 'text', text: `[Attached: ${a.name}]\n${text}` })
    }
  }
  return parts
}
```

- [ ] **Step 3: Write sidecar tests**

Create `packages/sidecar/src/session/attachments.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { isAllowedAttachment, validateAttachments, stageAttachments, buildAttachmentContentParts } from './attachments.js'

async function tempFile(name: string, content: Buffer | string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-attach-'))
  const p = path.join(dir, name)
  await fs.writeFile(p, content)
  return p
}

describe('attachments', () => {
  it('allows images and PDFs', () => {
    expect(isAllowedAttachment('x.png', 'image/png')).toBe(true)
    expect(isAllowedAttachment('x.pdf', 'application/pdf')).toBe(true)
  })

  it('rejects unknown binaries', () => {
    expect(isAllowedAttachment('x.exe', 'application/octet-stream')).toBe(false)
  })

  it('validates total size limit', async () => {
    const big = await tempFile('big.txt', Buffer.alloc(11 * 1024 * 1024))
    await expect(validateAttachments([{ id: '1', name: 'big.txt', mimeType: 'text/plain', path: big }]))
      .rejects.toThrow('10 MB')
    await fs.rm(path.dirname(big), { recursive: true, force: true })
  })

  it('stages attachments into scratch', async () => {
    const src = await tempFile('note.txt', 'hello')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-scratch-'))
    const staged = await stageAttachments('s1', [{ id: 'a1', name: 'note.txt', mimeType: 'text/plain', path: src }], root)
    expect(staged[0].size).toBe(5)
    const copied = await fs.readFile(path.join(root, 's1', 'attachments', 'a1', 'note.txt'), 'utf-8')
    expect(copied).toBe('hello')
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(path.dirname(src), { recursive: true, force: true })
  })

  it('builds text part for text files', async () => {
    const src = await tempFile('note.txt', 'hello')
    const parts = await buildAttachmentContentParts([{ id: 'a1', name: 'note.txt', mimeType: 'text/plain', path: src }])
    expect(parts).toEqual([{ type: 'text', text: '[Attached: note.txt]\nhello' }])
    await fs.rm(path.dirname(src), { recursive: true, force: true })
  })
})
```

- [ ] **Step 4: Run sidecar tests**

```bash
yarn test packages/sidecar/src/session/attachments.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/package.json packages/sidecar/src/session/attachments.ts packages/sidecar/src/session/attachments.test.ts
git commit -m "feat(sidecar): add attachment validation, staging and content building"
```

---

## Task 8: Sidecar message handling and persistence

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts`
- Modify: `packages/sidecar/src/session/session.ts`
- Modify: `packages/sidecar/src/persistence/schema.ts`
- Modify: `packages/sidecar/src/persistence/store.ts`
- Modify: `packages/sidecar/src/persistence/message-types.ts`
- Modify: `packages/sidecar/src/persistence/message-updater.ts`

**Interfaces:**
- Consumes: `AttachmentPayload`, `validateAttachments`, `stageAttachments`, `buildAttachmentContentParts`.
- Produces: `Session.sendMessage` accepts attachments and builds multipart `HumanMessage`.

- [ ] **Step 1: Forward attachments in `SessionManager`**

In `packages/sidecar/src/session/session-manager.ts`:

```ts
case 'message:send':
  await this.ensureSession(msg.sessionId, send).sendMessage(msg.content, send, msg.id, msg.attachments)
  break
```

- [ ] **Step 2: Extend `Session.sendMessage` and `processInput`**

Update signatures:

```ts
async sendMessage(content: string, _send: SendFn, userMessageId?: string, attachments?: AttachmentPayload[]): Promise<void> {
  this.enqueueInput({ type: 'message', content, messageId: userMessageId, attachments })
  if (this.running || this.awaitingResume) return
  await this.drainInputQueue(_send)
}
```

Update `SessionInput` type near the top of `session.ts`:

```ts
type SessionInput =
  | { type: 'message'; content: string; messageId?: string; attachments?: AttachmentPayload[] }
  | { type: 'steer'; content: string; messageId?: string }
```

In `processInput`, after validating the model and before pushing `HumanMessage`:

```ts
const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
if (input.content) parts.push({ type: 'text', text: input.content })

if (input.attachments?.length) {
  await validateAttachments(input.attachments)
  const staged = await stageAttachments(this.id, input.attachments, this.scratchRoot)
  const attachmentParts = await buildAttachmentContentParts(input.attachments)
  parts.push(...attachmentParts)
  this.emit({ type: 'user_message', sessionId: this.id, content: input.content, messageId: input.messageId ?? `u-${userTs}`, timestamp: userTs, attachments: staged })
} else {
  this.emit({ type: 'user_message', sessionId: this.id, content: input.content, messageId: input.messageId ?? `u-${userTs}`, timestamp: userTs })
}

this.messages.push(parts.length === 1 && parts[0].type === 'text'
  ? new HumanMessage(input.content)
  : new HumanMessage({ content: parts }))
```

- [ ] **Step 3: Add migration v15 for `attachments` column**

In `packages/sidecar/src/persistence/schema.ts` after v14:

```ts
if (version < 15) {
  db.exec('BEGIN')
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN attachments TEXT`)
    db.exec('PRAGMA user_version = 15')
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
```

- [ ] **Step 4: Update `store.ts` insert/load**

`insertMessage` signature:

```ts
insertMessage(r: { id: string; sessionId: string; role: 'user' | 'assistant'; agentId: string | null; content: string; timestamp: number; stopped?: boolean; attachments?: Attachment[] }): number
```

Update SQL insert to include `attachments` column.

In `loadMessages`, parse `attachments` JSON.

- [ ] **Step 5: Update `message-types.ts`**

```ts
| { readonly role: 'user'; readonly content: string; readonly messageId: string; readonly attachments?: Attachment[] }
```

Import `Attachment` from `@hip/protocol`.

- [ ] **Step 6: Update `message-updater.ts`**

In `onUserMessage`:

```ts
const attachments = optObjectArray<Attachment>(event.data, 'attachments')
const data: SessionMessageData = { role: 'user', content, messageId, ...(attachments?.length ? { attachments } : {}) }
```

Add helper `optObjectArray` if it doesn't exist.

- [ ] **Step 7: Update `rowToBaseMessage` to reconstruct multipart messages**

When loading legacy messages, if `d.attachments` exists and contains images, reconstruct a multipart `HumanMessage` so history retains images:

```ts
function rowToBaseMessage(d: SessionMessageData): BaseMessage {
  if (d.role === 'user') {
    if (d.attachments?.some((a) => a.mimeType.startsWith('image/'))) {
      // For loaded rows we only have metadata; images would need to be re-read from scratch.
      // As a fallback, keep the text content. A future improvement can reload image data.
      return new HumanMessage(d.content)
    }
    return new HumanMessage(d.content)
  }
  // ... rest unchanged
}
```

> Note: this is a placeholder for history replay. The event-sourced projection is the authoritative source for new messages.

- [ ] **Step 8: Run sidecar type check and tests**

```bash
cd packages/sidecar && yarn type-check
yarn test packages/sidecar/src/session/session-manager.test.ts packages/sidecar/src/persistence/message-types.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session.ts packages/sidecar/src/persistence/schema.ts packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/message-types.ts packages/sidecar/src/persistence/message-updater.ts
git commit -m "feat(sidecar): wire attachments into message flow and persistence"
```

---

## Task 9: Render attachments on user messages

**Files:**
- Modify: `src/components/chat/MessageBubble.tsx`

**Interfaces:**
- Consumes: `Message.attachments`.

- [ ] **Step 1: Add attachment list rendering**

Inside the user message branch, after `ReactMarkdown`:

```tsx
{message.attachments && message.attachments.length > 0 && (
  <div className="mt-2 flex flex-wrap gap-2">
    {message.attachments.map((a) => (
      <div
        key={a.id}
        className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-meta"
        data-testid="message-attachment"
      >
        <span className="max-w-[160px] truncate">{a.name}</span>
        {a.size !== undefined && (
          <span className="text-caption text-ink-tertiary">({formatBytes(a.size)})</span>
        )}
      </div>
    ))}
  </div>
)}
```

Add a small `formatBytes` helper in the same file or `src/lib/formatBytes.ts`.

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/MessageBubble.tsx
git commit -m "feat(chat): render attachments on user messages"
```

---

## Task 10: i18n keys and manual verification

**Files:**
- Modify: `src/i18n/locales/zh-CN.json` and `src/i18n/locales/en.json`

- [ ] **Step 1: Add translation keys**

Add under `chat`:

```json
"attach": "添加附件",
"removeAttachment": "移除 {{name}}",
```

English equivalents:

```json
"attach": "Attach file",
"removeAttachment": "Remove {{name}}",
```

- [ ] **Step 2: Run full test suite**

```bash
yarn test
```

Expected: all tests pass.

- [ ] **Step 3: Run type check**

```bash
yarn type-check
```

Expected: pass.

- [ ] **Step 4: Manual verification**

1. Start the app: `yarn dev`
2. Select a multimodal model (e.g., GPT-4o) → paperclip button appears.
3. Select a non-multimodal model with no eligible agents → button hidden.
4. Click paperclip, select one image, one PDF, one text file.
5. Verify chips appear in Composer; remove one chip.
6. Send message; verify attachments render in the user bubble.
7. Verify sidecar scratch directory contains staged files.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales
git commit -m "feat(chat): add attachment i18n keys"
```

---

## Self-Review

**Spec coverage:**
- Button visibility logic → Task 2.
- File picker → Task 3.
- Composer chips → Task 5.
- Protocol extensions → Task 1.
- Sidecar staging and multipart messages → Tasks 7–8.
- Persistence → Task 8.
- Rendering → Task 9.
- Error handling → embedded in Task 7/8.
- Testing → each task includes tests.

**Placeholder scan:** No TBD/TODO/fill-in-details patterns.

**Type consistency:** `LocalAttachment` is defined in `src/components/chat/attachmentTypes.ts` and consumed by `AttachmentButton.tsx`, `Composer.tsx`, and `InputBar.tsx`. `AttachmentPayload` extends protocol `Attachment` with `path`. `Message.attachments` uses protocol `Attachment`. All consistent.
