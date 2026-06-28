# Chat Attachment Upload Design

## Goal

Add an attachment upload button to the user chat input box. The button is visible when the current configured model is multimodal, or when an available internal sub-agent has a multimodal bound model. The implementation supports end-to-end upload of images, PDFs, and text documents using a managed attachment directory.

## Scope

- Supported file types:
  - Images: `image/*`
  - PDFs: `application/pdf`
  - Text documents: explicit allowlist of extensions — `.txt`, `.md`, `.json`, `.yaml`, `.yml`, `.csv`, and source-code extensions `.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.go`, `.rs`, `.java`, `.c`, `.cpp`, `.h`, `.cs`, `.rb`, `.php`, `.swift`, `.kt`, `.html`, `.css`, `.scss`, `.sql`, `.sh`, `.ps1`, `.xml`, `.toml`
- Single file size limit: **10 MB**
- Total per-message size limit: **50 MB**
- Drag-and-drop and clipboard paste are **out of scope** for this phase, but interfaces should be extensible.
- External ACP/custom sub-agents are **not** considered for button visibility because their model capabilities are not visible to hip.

## Context

### Current input stack

- `src/components/chat/InputBar.tsx` — owns text state, session status, and submit action.
- `src/components/chat/Composer.tsx` — renders the textarea and the action footer (`leftSlot` + send/stop buttons).
- `src/components/ui/Textarea.tsx` — styled textarea primitive.

### Model resolution

`ModelPicker.tsx` resolves the effective model key as:

```ts
const currentKey = activeId && session
  ? (session.config.model ? `${session.config.llmProvider}/${session.config.model}` : activeModelKey(config))
  : (draft?.modelKey ?? activeModelKey(config))
```

### Multimodal detection

Models in `src/ipc/catalog.ts` have an `attachment?: boolean` flag. A model is multimodal iff `catalog[providerID].models[modelID].attachment === true`.

### Sub-agents

Sub-agents are `AgentConfig` entries from `packages/protocol/src/index.ts`. Only `kind === 'internal'` agents expose a `boundModel`; other kinds manage their own model and are ignored for visibility.

### Existing upload functionality

There is no generic file picker or user upload flow. `src/ipc/dialog.ts` only provides folder and ZIP pickers. User messages are sent as plain strings via `message:send`.

## Design

### 1. Button visibility logic

Add a pure helper function (e.g., `src/lib/attachmentEligibility.ts`):

```ts
export function isAttachmentSupported(
  currentModelKey: string | undefined,
  agents: AgentConfig[],
  catalog: Catalog,
): boolean
```

Rules:

1. **Current model multimodal**: parse `providerID/modelID` from the effective model key and check `catalog[providerID]?.models[modelID]?.attachment === true`.
2. **Internal sub-agent multimodal**: for every `internal` agent that is `enabled` and not `builtin`, if it has a `boundModel`, check whether that model is multimodal using the same catalog lookup.
3. Return `true` if either rule is satisfied.

The `AttachmentButton` uses this helper to decide whether to render.

> Note: if the button is shown because a sub-agent is multimodal but the current session model is not, the attachment will still be sent to the current model. The supervisor may dispatch to the multimodal sub-agent, or the current model provider may reject the attachment. This matches the requirement that the button is visible whenever *any* eligible multimodal path exists.

### 2. File picker

Extend `src/ipc/dialog.ts` with `pickAttachmentFiles()`:

```ts
export async function pickAttachmentFiles(): Promise<string[] | null>
```

- Uses Tauri `open({ multiple: true, filters: [...] })`.
- Filters cover images, PDFs, and text documents.
- Returns absolute paths.
- Respects the existing `window.__hipPickAttachmentFiles` E2E seam.

### 3. Composer state

`InputBar` owns the attachment list and passes it to `Composer`:

```ts
type LocalAttachment = {
  id: string      // nanoid
  name: string
  mimeType: string
  path: string    // absolute path from Tauri dialog
  size: number
}
```

`Composer` props extended with:

```ts
attachments?: LocalAttachment[]
onAttachmentsChange?: (attachments: LocalAttachment[]) => void
```

`Composer` renders attachment chips above the textarea with remove buttons.

### 4. Protocol extensions

In `packages/protocol/src/index.ts`:

```ts
export interface Attachment {
  id: string
  name: string
  mimeType: string
  size?: number
}
```

Extend `Message`:

```ts
export interface Message {
  ...
  attachments?: Attachment[]
}
```

Extend `ClientMessage` `message:send` (paths are internal to the send flow):

```ts
| { type: 'message:send'; sessionId: string; id: string; content: string; role: 'user'; attachments?: AttachmentSendPayload[] }

type AttachmentSendPayload = Attachment & { path: string }
```

Extend `SessionEvent` `user_message`:

```ts
| { type: 'user_message'; sessionId: string; content: string; messageId: string; timestamp: number; attachments?: Attachment[] }
```

### 5. Sidecar processing

`SessionManager.handleAsync` for `message:send`:

1. Validate each attachment:
   - MIME type in allowed set.
   - File size ≤ 10 MB.
   - Total size ≤ 50 MB.
2. Copy each file into the managed directory:
   - Target: `<scratchDir>/attachments/<attachmentId>/<name>`
   - `ensureScratchDir(sessionId)` is already available.
3. Build a LangChain `HumanMessage` with multipart content:
   - Text part: user-typed content.
   - Image parts: read image as base64, emit `{ type: 'image_url', image_url: { url: 'data:<mime>;base64,<data>' } }`.
   - Text document parts: read UTF-8 content, emit `{ type: 'text', text: '[Attached: <name>]\n<content>' }`.
   - PDF parts: extract text with `pdf-parse`; on failure, emit metadata text `[Attached PDF: <name>]`.
4. Persist the message with `attachments` metadata.
5. Continue with the normal turn.

If any file fails validation or copy, emit an `error` server message and abort the send.

### 6. UI components

- `AttachmentButton` (`src/components/chat/AttachmentButton.tsx`):
  - `Paperclip` icon from `lucide-react`.
  - Renders only when `isAttachmentSupported(...)` returns `true`.
  - Opens the file picker and calls `onAttachmentsChange`.
- `Composer`:
  - Renders attachment chips above textarea.
  - Each chip shows filename and remove button.
- User message rendering:
  - Show attachment names/icons alongside the message.

### 7. Persistence

- `packages/sidecar/src/persistence/store.ts`: add an `attachments` JSON column to the `messages` table.
- `packages/sidecar/src/persistence/message-types.ts`: add `attachments?: Attachment[]` to the user `SessionMessageData` variant.
- `src/domain/sessionStore.ts`: update `appendUserMessage` and message reducers to carry `attachments`.

### 8. Storage and cleanup

- Managed directory: `<scratchRoot>/<sessionId>/attachments/<attachmentId>/`.
- Reuses existing scratch utilities in `packages/sidecar/src/session/scratch.ts`.
- Cleanup happens automatically when `session:destroy` removes the session scratch directory.
- Orphan detection/cleanup is out of scope for this phase.

### 9. Error handling

| Scenario | Behavior |
|----------|----------|
| File type not allowed | Frontend rejects before staging |
| Single file > 10 MB | Frontend rejects with clear message |
| Total > 50 MB | Frontend rejects |
| File unreadable or moved after pick | Sidecar emits `error` and aborts send |
| PDF text extraction fails | Fallback to metadata text; send continues |

### 10. Testing plan

- Unit tests for `isAttachmentSupported`:
  - current model multimodal
  - internal sub-agent with multimodal boundModel
  - non-multimodal model with no eligible agents
  - external agents ignored
- Sidecar tests:
  - attachment copy to scratch
  - HumanMessage multipart construction for images/text/PDF
  - oversized/invalid file rejection
- Component tests:
  - `AttachmentButton` renders only when eligible
  - `Composer` renders chips and calls remove handler

## References

- `src/components/chat/InputBar.tsx`
- `src/components/chat/Composer.tsx`
- `src/components/chat/ModelPicker.tsx`
- `src/ipc/dialog.ts`
- `src/ipc/catalog.ts`
- `packages/protocol/src/index.ts`
- `packages/sidecar/src/session/session.ts`
- `packages/sidecar/src/session/session-manager.ts`
- `packages/sidecar/src/session/scratch.ts`
- `packages/sidecar/src/persistence/store.ts`
- `packages/sidecar/src/persistence/message-types.ts`
