# Backend MVP: deepagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace custom LangGraph StateGraph stubs with `deepagents` `createDeepAgent`, connecting to DeepSeek API via OpenAI-compatible interface for basic conversation.

**Architecture:** `createDeepAgent` returns a compiled LangGraph graph. `Session` calls `agent.streamEvents({ version: "v3" })` on each user message, iterating `run.messages` → `msg.text` to extract streaming tokens and mapping them to `token:stream` WebSocket messages via `@hip/protocol`. Frontend and protocol remain unchanged except adding `'deepseek'` to `llmProvider` and `systemPrompt` to `SessionConfig`.

**Tech Stack:** `deepagents` v1.10.2 (npm), `@langchain/openai` (already a dep — repurposed for DeepSeek's OpenAI-compatible API), `ws`, `@hip/protocol`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `packages/protocol/src/index.ts` | Add `'deepseek'` to `llmProvider` union |
| Delete | `packages/sidecar/src/graph/builder.ts` | — |
| Delete | `packages/sidecar/src/agents/supervisor.ts` | — |
| Delete | `packages/sidecar/src/agents/sub-agents/planner.ts` | — |
| Delete | `packages/sidecar/src/agents/sub-agents/coder.ts` | — |
| Delete | `packages/sidecar/src/agents/sub-agents/reviewer.ts` | — |
| Modify | `packages/sidecar/package.json` | Add `deepagents` dep; remove `@langchain/anthropic` |
| Rewrite | `packages/sidecar/src/session/session.ts` | `createDeepAgent` + `streamEvents` event loop |
| No change | `packages/sidecar/src/session/session-manager.ts` | Zero changes needed |
| No change | `packages/sidecar/src/server/ws-server.ts` | Zero changes needed |
| No change | `packages/sidecar/src/main.ts` | Zero changes needed |
| No change | All frontend files | Zero changes needed |

---

### Task 1: Update protocol — add deepseek provider + systemPrompt

**Files:**
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Add 'deepseek' to llmProvider and systemPrompt to SessionConfig**

Open `packages/protocol/src/index.ts`. Make these two changes:

Change 1 — line 4, add `'deepseek'`:
```ts
// Before:
  llmProvider: 'anthropic' | 'openai' | 'ollama'
// After:
  llmProvider: 'anthropic' | 'openai' | 'ollama' | 'deepseek'
```

Change 2 — add `systemPrompt` field to `SessionConfig` interface (after `tools` line):
```ts
// Insert after line 6 (tools: string[]):
  systemPrompt?: string
```

Full `SessionConfig` after changes:
```ts
export interface SessionConfig {
  llmProvider: 'anthropic' | 'openai' | 'ollama' | 'deepseek'
  model: string
  tools: string[]
  systemPrompt?: string
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): add deepseek provider and optional systemPrompt to SessionConfig"
```

---

### Task 2: Remove old agent/graph files

**Files:**
- Delete: `packages/sidecar/src/graph/builder.ts`
- Delete: `packages/sidecar/src/agents/supervisor.ts`
- Delete: `packages/sidecar/src/agents/sub-agents/planner.ts`
- Delete: `packages/sidecar/src/agents/sub-agents/coder.ts`
- Delete: `packages/sidecar/src/agents/sub-agents/reviewer.ts`

- [ ] **Step 1: Delete the five files**

```bash
rm packages/sidecar/src/graph/builder.ts
rm packages/sidecar/src/agents/supervisor.ts
rm packages/sidecar/src/agents/sub-agents/planner.ts
rm packages/sidecar/src/agents/sub-agents/coder.ts
rm packages/sidecar/src/agents/sub-agents/reviewer.ts
```

- [ ] **Step 2: Clean up empty directories**

```bash
rmdir packages/sidecar/src/agents/sub-agents 2>/dev/null; rmdir packages/sidecar/src/agents 2>/dev/null; rmdir packages/sidecar/src/graph 2>/dev/null; true
```

- [ ] **Step 3: Commit**

```bash
git add packages/sidecar/src/graph/ packages/sidecar/src/agents/
git commit -m "refactor(sidecar): remove custom StateGraph and agent stubs"
```

---

### Task 3: Add deepagents dependency

**Files:**
- Modify: `packages/sidecar/package.json`

- [ ] **Step 1: Update package.json dependencies**

```jsonc
// packages/sidecar/package.json
// Replace the "dependencies" block:
"dependencies": {
  "@hip/protocol": "*",
  "@langchain/core": "^1.1",
  "@langchain/langgraph": "^1.3",
  "@langchain/openai": "^1.4",
  "deepagents": "^0.6.8",
  "ws": "^8"
}
```

Changes: added `"deepagents": "^0.6.8"`, removed `"@langchain/anthropic": "^1.4"` (no longer needed).

- [ ] **Step 2: Install dependencies**

```bash
yarn install
```

Expected: installs `deepagents` and its transitive deps. No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/sidecar/package.json yarn.lock
git commit -m "chore(sidecar): add deepagents, remove unused @langchain/anthropic"
```

---

### Task 4: Rewrite session.ts with createDeepAgent

**Files:**
- Rewrite: `packages/sidecar/src/session/session.ts`

- [ ] **Step 1: Write the new session.ts**

```ts
// packages/sidecar/src/session/session.ts
import type { ServerMessage, SessionConfig, AgentRole } from '@hip/protocol'
import { createDeepAgent } from 'deepagents'
import { ChatOpenAI } from '@langchain/openai'

type SendFn = (msg: ServerMessage) => void

const DEFAULT_MODEL = 'deepseek-chat'
const AGENT_ID = 'deepagent'
const AGENT_ROLE: AgentRole = 'supervisor'

function buildModel(config: SessionConfig): ChatOpenAI {
  return new ChatOpenAI({
    model: config.model || DEFAULT_MODEL,
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: {
      baseURL: 'https://api.deepseek.com/v1',
    },
  })
}

export class Session {
  private readonly agent: ReturnType<typeof createDeepAgent>
  private abortController: AbortController | null = null

  constructor(
    readonly id: string,
    readonly config: SessionConfig,
  ) {
    this.agent = createDeepAgent({
      model: buildModel(config),
      systemPrompt: config.systemPrompt ?? 'You are a helpful coding assistant.',
    })
  }

  async sendMessage(content: string, _send: SendFn): Promise<void> {
    this.abortController = new AbortController()
    let fullContent = ''

    _send({
      type: 'agent:started',
      sessionId: this.id,
      agentId: AGENT_ID,
      role: AGENT_ROLE,
    })

    try {
      const stream = this.agent.streamEvents(
        { messages: [{ role: 'user' as const, content }] },
        {
          version: 'v2',
          signal: this.abortController.signal,
        },
      )

      for await (const event of stream) {
        if (event.event === 'on_chat_model_stream') {
          const chunk = event.data?.chunk
          const delta = typeof chunk?.content === 'string' ? chunk.content : ''
          if (delta) {
            fullContent += delta
            _send({
              type: 'token:stream',
              sessionId: this.id,
              agentId: AGENT_ID,
              delta,
            })
          }
        }
      }

      _send({
        type: 'agent:finished',
        sessionId: this.id,
        agentId: AGENT_ID,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return

      _send({
        type: 'error',
        sessionId: this.id,
        code: 'AGENT_ERROR',
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }

    _send({
      type: 'message:complete',
      sessionId: this.id,
      message: {
        id: `asst-${AGENT_ID}-${Date.now()}`,
        role: 'assistant',
        content: fullContent,
        agentId: AGENT_ID,
        timestamp: Date.now(),
      },
    })
  }

  cancel(): void {
    this.abortController?.abort()
  }

  destroy(): void {
    this.cancel()
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/sidecar/src/session/session.ts
git commit -m "feat(sidecar): replace stub with createDeepAgent + streamEvents loop"
```

---

### Task 5: Verify type-check

**Files:** (none — verification only)

- [ ] **Step 1: Run type check on protocol package**

```bash
yarn workspace @hip/protocol exec tsc --noEmit 2>&1 || true
```

Expected: no type errors.

- [ ] **Step 2: Run type check on sidecar package**

```bash
yarn workspace @hip/sidecar type-check
```

Expected: no type errors.

- [ ] **Step 3: Verify the sidecar starts without errors**

```bash
cd packages/sidecar && timeout 5 yarn dev 2>&1 || true
```

Expected: outputs `{"port":<number>}` on stdout. No crash.

- [ ] **Step 4: Commit if any type fixes were needed**

(Only if type errors were found and fixed in previous steps.)

---

## Verification Summary

After all tasks complete, verify end-to-end:

1. `yarn workspace @hip/protocol exec tsc --noEmit` — clean
2. `yarn workspace @hip/sidecar type-check` — clean
3. `DEEPSEEK_API_KEY=sk-xxx yarn workspace @hip/sidecar dev` — prints `{"port":<number>}`, no crash
4. Frontend `yarn dev` + Tauri shell — sends message, receives streaming tokens, completes
