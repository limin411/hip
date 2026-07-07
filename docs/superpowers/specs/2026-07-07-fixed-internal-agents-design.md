# Fixed Internal Agents (coder / explore / plan)

**Date**: 2026-07-07
**Status**: approved
**Branch**: dev.1.1

## Summary

Add three fixed, non-deletable internal agents to the agent management UI:

- **coder** — default sub-agent, general software engineering assistant. Read/write files, execute commands, search code, implement changes.
- **explore** — codebase exploration only. Read-only operations: search, read, summarize repos. No file modifications.
- **plan** — implementation planning & architecture design. No shell commands. Focused on "thinking about how to do it", not "doing it".

These agents are completely fixed: non-editable, non-deletable. Users can only toggle enable/disable.

## Architecture

### Backend mapping

The sidecar already has built-in `AgentProfile` definitions (`packages/sidecar/src/session/agent-profile.ts`):

| Frontend agent | Backend profile | Tool gating |
|---|---|---|
| coder | `worker` (extended) | read_file, write_file, edit_file, ls, glob, grep, run_script, use_skill, web_search, web_fetch |
| explore | `explore` | read_file, ls, glob, grep, use_skill, web_search, web_fetch |
| plan | `plan` | read_file, ls, glob, grep, write_todos, EnterPlanMode, ExitPlanMode, use_skill, web_search, web_fetch |

Backend change needed: add `run_script` to the `worker` profile (or create a new `coder` profile).

### Enable/disable persistence

Fixed agents are NOT stored in `hip.toml`'s `agents` array. Their enable/disable state is persisted in a new `[fixedAgents]` section:

```toml
[fixedAgents]
coder = true
explore = true
plan = true
```

### Protocol changes

`HipConfig` gains an optional field:

```typescript
fixedAgents?: Record<string, boolean>
```

Backend: add `coder` profile to `BUILTIN_PROFILES` (extends `worker` with `run_script`).

## UI Design

### Layout

Fixed agent cards appear in a row above user-created agents, separated by a visual divider:

```
┌─────────────────────────────────────────────────┐
│  [coder card]  [explore card]  [plan card]       │
│  ─────────── 用户智能体 ───────────               │
│  [user agent 1]  [user agent 2]  ...             │
└─────────────────────────────────────────────────┘
```

### FixedAgentCard

Each card shows:
- Icon + name + description
- "内置" (Built-in) badge + lock icon
- Enable/disable switch
- Model badge showing "全局模型" (Global model)
- NO edit button, NO delete button, NO kebab menu

Distinct from `AgentCard`: no edit/delete actions, enforced via component design (not just hidden).

### Component tree changes

```
AgentManagement
├── FixedAgentCard × 3        (NEW — always rendered)
├── Stats (total/enabled)     (modified — includes fixed agents in counts)
├── AgentToolbar              (unchanged)
└── AgentGrid                 (unchanged — user agents only)
```

## Files to create/modify

### New files

| File | Purpose |
|---|---|
| `src/lib/fixedAgents.ts` | Constant definitions for the 3 fixed agents |
| `src/components/account/FixedAgentCard.tsx` | Fixed agent card component |
| `src/lib/fixedAgents.test.ts` | Unit tests for fixed agent constants |
| `src/components/account/FixedAgentCard.test.tsx` | Component tests |

### Modified files

| File | Change |
|---|---|
| `src/components/account/AgentManagement.tsx` | Render fixed agents section above user agents; include in stats |
| `src/components/account/AgentCard.tsx` | Remove unused `BuiltinCard` (replaced by `FixedAgentCard`) |
| `src/i18n/en.ts` | Add i18n keys for the 3 agents |
| `src/i18n/zh-CN.ts` | Add i18n keys for the 3 agents |
| `src/i18n/zh-TW.ts` | Add i18n keys for the 3 agents |
| `packages/protocol/src/index.ts` | Add `fixedAgentSettings` to `HipConfig` |
| `packages/sidecar/src/session/agent-profile.ts` | Add `coder` profile (worker + run_script) |

### Deleted files

| File | Reason |
|---|---|
| None | `BuiltinCard` is removed from `AgentCard.tsx` but the file stays |

## i18n keys

New keys under `settings.agents.fixed.*`:

```typescript
fixed: {
  coderName: 'Coder' / 'Coder' / 'Coder',
  coderDesc: '默认子 Agent，通用软件工程助手，可读写文件、执行命令、搜索代码并落地具体改动。',
  exploreName: 'Explore' / 'Explore' / 'Explore',
  exploreDesc: '代码库探索专用，只读操作，不修改文件。适合快速搜索、阅读和总结仓库。',
  planName: 'Plan' / 'Plan' / 'Plan',
  planDesc: '实现规划与架构设计专用，不提供 Shell 命令，专注于"想清楚怎么做"。',
}
```

## Default system prompts

### coder

```
You are a software engineering assistant. You can read and write files, execute shell commands, search code, and implement concrete changes. When given a task, break it down into steps and execute them methodically. Always verify your changes work correctly.
```

### explore

```
You are a codebase exploration agent. You can read files, search code, and summarize findings — but you CANNOT modify any files, execute shell commands, or make any changes to the codebase. Your purpose is to understand, search, and report. When asked about the codebase, be thorough in your exploration before answering.
```

### plan

```
You are a software architecture and planning agent. You focus on analyzing requirements, designing implementation approaches, and creating detailed plans. You do NOT have access to shell commands — your job is to think through the problem and produce a clear, actionable plan that others can execute. Consider trade-offs, edge cases, and existing codebase patterns in your analysis.
```

## Error handling

- Enable/disable toggle failure: revert switch state, show error toast
- Missing `fixedAgentSettings` in config: default all three to enabled
- Disabled fixed agents: not shown in agent selector dropdowns

## Testing

| Layer | Coverage |
|---|---|
| `fixedAgents.test.ts` | 3 entries, required fields present, ids are unique |
| `FixedAgentCard.test.tsx` | Renders correctly, switch toggles, no edit/delete buttons present |
| `AgentManagement.test.tsx` | Fixed agents appear before user agents, stats include fixed agents |
| `agent-profile.test.ts` (sidecar) | coder profile has correct allowedTools including run_script |

## Backward compatibility

- Existing user agents in `hip.toml` `agents` array are unaffected
- `fixedAgentSettings` section is optional; omission → all enabled by default
- `agentId === 'builtin'` behavior unchanged
- `BuiltinCard` component removed (was dead code — never imported)
