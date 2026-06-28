# Image Attachment Direct Dispatch to Internal Multimodal Agent

## Goal

When a user sends a turn that contains image attachments while the session's main model is a **text-only reasoning model**, the sidecar must automatically hand the whole turn off to an enabled internal sub-agent whose bound model is multimodal. The main session model is **not** changed; after the sub-agent finishes, its response is inserted into the session history as the assistant reply.

This fixes the current failure path where a text-only main model receives an `image_url` content block and the provider returns:

```
400 ... unknown variant `image_url`, expected `text`
```

## Background

- The previous attachment-upload design (`2026-06-28-chat-attachment-upload-design.md`) added the ability to send images/PDFs/text documents through the chat input.
- The previous design noted that if the upload button is shown because a sub-agent is multimodal but the current session model is not, "the supervisor may dispatch to the multimodal sub-agent, or the current model provider may reject the attachment."
- This spec makes that dispatch explicit and automatic for image attachments.

## Scope

- Applies only to **image attachments** (`mimeType.startsWith('image/')`).
- Dispatches only to **internal agents** (`kind === 'internal'`) that are `enabled`, not `builtin`, and have a `boundModel` that the cached model catalog marks as supporting attachments (`attachment === true`).
- The dispatch decision is made **in the sidecar at send-time** so the frontend does not need to mutate the session model.
- PDF/text attachments keep the existing behavior (sent to the main model as text parts).
- External ACP/custom agents are out of scope for automatic dispatch.

## Agent Selection Algorithm

Location: `packages/sidecar/src/session/agents/registry.ts` (new helper `selectImageAgent`).

Inputs:

- `cwd`: session working directory.
- `userPrompt`: the text content of the current user turn (may be empty).
- `catalog`: optional `Catalog` object; if omitted, reads `~/.hip/cache/models.json`.

Steps:

1. Load agents via `readAgentsConfig(cwd)`.
2. Filter to internal agents that are `enabled`, `kind === 'internal'`, `id !== 'builtin'`, and have a `boundModel` whose `(providerID, modelID)` is multimodal according to `catalog`.
3. If `userPrompt` is non-empty, further filter to agents whose `prompt` or `description` contains at least one keyword from the user prompt.
   - Keyword extraction: split on non-word characters, drop tokens shorter than 2 characters, drop a small set of stop words (`the`, `a`, `is`, `what`, `how`, `请`, `一下`, etc.). Case-insensitive matching.
4. If the prompt filter yields at least one agent, return the first one.
5. Otherwise, return the first agent from step 2 (fallback).
6. Return `null` if step 2 yields no agent.

## Sidecar Architecture

### New / changed modules

| File | Change |
|------|--------|
| `packages/sidecar/src/config/catalog.ts` | Already created. Adds `isMultimodalModel(providerID, modelID)` helper used by selector and session. |
| `packages/sidecar/src/session/agents/registry.ts` | Add `selectImageAgent(cwd, userPrompt, catalog?)`. |
| `packages/sidecar/src/session/agents/invoker.ts` | Extend `AgentInvoker.invoke` with optional `attachments?: AttachmentPayload[]`; forward to internal runner. |
| `packages/sidecar/src/session/internal-runner.ts` | Extend `RunManagedAgentArgs` with `attachments`; build multipart `HumanMessage` with text + image content parts. |
| `packages/sidecar/src/session/session.ts` | In `processInput`, detect image-dispatch path and call a new `runManagedAgentTurn` method. |
| `src/domain/sessionService.ts` | Remove the send-time model-switch fallback (`switchToMultimodalModelIfNeeded`, `ensureMultimodalModelForImages`). |
| `src/components/chat/InputBar.tsx` | Remove the effect that switches the model on image attach. |

### Data flow for a dispatched image turn

1. Frontend sends `message:send` with `attachments` as today.
2. `SessionManager` forwards to `Session.sendMessage(content, send, messageId, attachments)`.
3. `Session.processInput` is invoked.
4. Sidecar validates attachments and copies images to the managed scratch directory (`stageAttachments`).
5. Sidecar emits `user_message` with attachment metadata.
6. Sidecar checks the dispatch trigger:
   - `input.attachments` contains at least one image.
   - The session's resolved main model does **not** support attachments (via `catalog`).
   - `selectImageAgent(cwd, input.content)` returns an agent.
7. If the trigger is met:
   - Push the user message as a multipart `HumanMessage` to `this.messages`.
   - Emit `agent:started`.
   - Build the same extras as a normal turn (`mcpTools`, `skills`, `requestApproval`, `permissionMode`, `networkPolicy`, `toolOutputStore`, `guardianReviewer`).
   - Call `this.agentProv.invoker(cwd).invoke(agent.id, input.content, emit, signal, undefined, extras, input.attachments)`.
   - The internal runner builds `[SystemMessage(agent prompt), HumanMessage(text + image parts)]` and runs the agent's ReAct loop.
   - Emit `agent:finished`.
   - Push the returned assistant text as an `AIMessage` to `this.messages`.
   - Emit `message:complete` with the assistant response.
8. If the trigger is not met, fall through to the existing normal supervisor turn.

### Why not dispatch PDF/text attachments?

PDFs and text documents are converted to text parts before reaching the model. A text-only model can consume them, so no dispatch is required. Images require a vision-capable model.

## Frontend Changes

The frontend must stop trying to switch the session/draft model when an image is attached. The model picker stays on the user's chosen text reasoning model; the sidecar decides whether to dispatch.

Changes:

- `src/domain/sessionService.ts`: remove `switchToMultimodalModelIfNeeded` and `ensureMultimodalModelForImages`.
- `src/components/chat/InputBar.tsx`: remove the `useEffect` that calls `ensureMultimodalModelForImages`.
- Tests in `src/domain/sessionService.test.ts` and `src/components/chat/InputBar.test.tsx` should be updated to assert that the model is **not** switched when an image is attached.

The global loading gate added earlier (`src/App.tsx`) remains unchanged; it is required so that the model catalog and agent config are loaded before the user can reach the main UI.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No internal multimodal agent available | Fall through to normal turn; the text-only model will reject the image and the existing error path emits an `error` server message. |
| Agent selection succeeds but agent invocation throws | `processInput` throws; `drainInputQueue` catch emits an `error` server message and stops the turn. |
| Agent returns `awaiting_user` status | `runManagedAgent` already appends the pending question to the returned text. The parent session treats it as a completed assistant response; it does not leave the parent session paused. |
| Attachment validation fails | Same behavior as today: error message and turn abort. |

## Persistence

- The user message with attachment metadata is persisted by the existing event-sourced projection (`user_message` → `session_message`).
- The assistant response from the sub-agent is persisted as a normal assistant message.
- The fact that the turn was handled by a sub-agent is **not** persisted separately; it is reconstructed at runtime from the message history and the same dispatch rules. This is acceptable because dispatch is a runtime routing decision, not a user-visible property.

## Testing Plan

1. **Unit tests for `selectImageAgent`** (`packages/sidecar/src/session/agents/registry.test.ts`):
   - Current model not multimodal, one internal multimodal agent → selected.
   - Multiple internal multimodal agents, prompt keywords match one agent's prompt → that agent selected.
   - No keyword match → fallback to first internal multimodal agent.
   - Disabled/builtin/external agents ignored.

2. **Unit tests for `runManagedAgent` with attachments** (`packages/sidecar/src/session/internal-runner.test.ts` or extend existing tests):
   - Creates a temp image file.
   - Asserts the `HumanMessage` passed to the graph contains text + `image_url` parts.

3. **Integration test for `Session` dispatch path** (`packages/sidecar/src/session/session-image-agent-dispatch.integration.test.ts`):
   - Create a session with a text-only main model.
   - Configure an internal agent with a multimodal bound model.
   - Send a user message with a temporary image attachment.
   - Assert that the mocked `AgentInvoker.invoke` is called with the attachment.
   - Assert that `agent:started` and `agent:finished` are emitted.
   - Assert that `message:complete` carries the agent's returned text.
   - Assert that the session history contains the user message and the assistant response.

4. **Frontend tests**:
   - `sessionService.test.ts`: attaching an image does **not** call `setModel` on the session config.
   - `InputBar.test.tsx`: attaching an image does **not** change the selected model.

5. **Regression**:
   - `yarn test -- --run` passes.
   - `yarn type-check` passes.

## References

- `docs/superpowers/specs/2026-06-28-chat-attachment-upload-design.md`
- `packages/sidecar/src/session/session.ts`
- `packages/sidecar/src/session/agents/invoker.ts`
- `packages/sidecar/src/session/internal-runner.ts`
- `packages/sidecar/src/session/agents/registry.ts`
- `packages/sidecar/src/config/catalog.ts`
- `src/domain/sessionService.ts`
- `src/components/chat/InputBar.tsx`
