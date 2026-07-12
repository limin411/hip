# Hook Events

The hook system allows plugins and external code to intercept lifecycle events during an agent session. Each hook event fires at a specific point in the turn lifecycle.

Plugins load CJS handlers via `ConfigManager.loadPluginComponents` into the session `HookRegistry`. The same registry is shared across the main ReAct loop, `task` subagents, managed internal agents, and workflow agent nodes.

## Runtime path coverage

| Path | Plugin hooks | Tool Pre/Post | Turn lifecycle |
|------|--------------|---------------|----------------|
| Main session (builtin / env model) | ✅ | ✅ `ToolRunner` | ✅ |
| `task` / background subagent | ✅ (same registry) | ✅ | — |
| Managed / dispatch internal agent | ✅ via `pluginHooks` | ✅ | — |
| Workflow agent node (`worker` / invoker) | ✅ | ✅ | ✅ TurnStart / TurnComplete; UserPromptSubmit when applicable |
| Workflow gate node | ❌ | ❌ | — |
| External ACP session | ❌ (plugins not loaded) | N/A | partial |

Workflow HITL: no `requestApproval` on workers (policy A). PreToolUse `ask` without transport is denied. Workflow `Stop` `continue` does **not** start a second DAG.

`message:send` + `orchMode: dag` sets `skipUserPromptSubmit` so UserPromptSubmit is not double-fired.

## Hook Event Types

| # | Event | Fires When | Context Fields | Return Values |
|---|-------|-----------|----------------|---------------|
| 1 | `SessionStart` | First message of a session | `sessionId` | `allow` (proceed), `deny` (stop session) |
| 2 | `TurnStart` | Before each turn begins (before model invocation); also each workflow run | `sessionId`, `turnId`, `runId?` | `allow`, `deny` (abort turn) |
| 3 | `UserPromptSubmit` | After the user submits a message, before model runs | `sessionId`, `turnId`, `runId?` | `allow`, `deny` (abort turn with HOOK_DENIED) |
| 4 | `PreToolUse` | Before a tool is invoked | `sessionId`, `turnId?`, `runId?`, `nodeId?`, `agentId?`, `parentAgentId?`, `toolName`, `toolInput` | `allow`, `deny` (block tool), `ask`, `modify` (mutate input) |
| 5 | `PostToolUse` | After a tool completes successfully | same + `toolOutput` | `allow`, `modify`, `continue`, `additionalContexts` |
| 6 | `PostToolUseFailure` | After a tool invocation fails | same + `toolError` | `allow`, `modify`, `continue`, `additionalContexts` |
| 7 | `TurnComplete` | After a turn finishes (fire-and-forget) | `sessionId`, `turnId`, `runId?` | any (result is ignored) |
| 8 | `Stop` | After turn stop path / end of workflow run | `sessionId`, `turnId`, `runId?` | `allow` (proceed), `deny` (cancel stop); workflow ignores `continue` |
| 9 | `PermissionRequest` | Before presenting a HITL permission prompt to the user | `sessionId`, `turnId`, `toolName`, `toolInput` | `allow` (auto-allow, skip prompt), `deny` (auto-deny, skip prompt), `ask` (proceed with prompt) |
| 10 | `ActivityStart` | When a new activity is started for a user goal | `sessionId`, `activityId` | any (result is ignored) |
| 11 | `ActivityEnd` | When the current activity ends | `sessionId`, `activityId` | any (result is ignored) |
| 12 | `ActivityBudgetRequest` | When something requests an extension of the current activity's step budget | `sessionId`, `activityId`, `stepsRequested` | `allow` (extend), `deny` (keep current budget); `steps` can override the requested amount |

Optional frame fields on `HookContext`: `runId`, `nodeId`, `agentId`, `parentAgentId` (workflow / subagent identity).

## PermissionRequest Hook

The `PermissionRequest` hook fires before a HITL (human-in-the-loop) permission prompt is presented to the user. This allows hooks to automatically approve or deny tool execution without user interaction.

### Context

- `sessionId`: The session ID
- `turnId`: The current turn ID
- `toolName`: The tool requesting permission (e.g., `run_script`)
- `toolInput`: The tool's input parameters (`{ kind: string, content?: string }`)

### Return Values

| Return | Effect |
|--------|--------|
| `{ kind: 'allow' }` | Auto-approve: resolves as `allow_once` immediately, no `permission:request` is sent |
| `{ kind: 'deny', reason: '...' }` | Auto-deny: resolves as `reject_once` immediately, no `permission:request` is sent |
| `{ kind: 'ask' }` | Proceed with normal HITL: `permission:request` is sent, user must respond |

### Example

```typescript
session.registerHook({
  event: 'PermissionRequest',
  matcher: 'run_script',
  handler: async (ctx) => {
    // Auto-approve safe commands
    if (ctx.toolInput?.content === 'git status') {
      return { kind: 'allow' }
    }
    // Auto-deny dangerous commands
    if (ctx.toolInput?.content?.includes('rm -rf')) {
      return { kind: 'deny', reason: 'destructive command blocked' }
    }
    // Ask user for anything else
    return { kind: 'ask' }
  },
})
```

### Hook Chaining

Multiple `PermissionRequest` hooks are aggregated like other hooks:
- First terminal result (`deny` or `ask`) short-circuits remaining hooks
- Non-terminal results (`allow`) continue to the next hook
- If all hooks return `allow`, the final result is auto-approve
