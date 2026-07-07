# Agent 编排升级 — Phase 2 详细实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 输出必须经过客观验证才能通过（VerificationGate），熔断器防止停滞和预算超支（CircuitBreaker），对抗性 Reviewer 强制阻断不通过审核的变更。

**Architecture:** 在 Phase 1 的 DurableExecutor 基础上增加可插拔的验证层和熔断层。不修改 Agent 核心逻辑，通过 Hook 和 Gate 节点注入验证。

**Tech Stack:** TypeScript, Vitest, 复用现有 ToolRunner 和 AgentInvoker

**前置依赖:** Phase 1 完成（DurableExecutor + orchMode dispatch + maxDepth）

## Global Constraints

- TypeScript strict mode
- 测试框架：Vitest
- **不引入新的 npm 依赖**
- 向后兼容：无 VerificationGate 配置时，行为与 Phase 1 一致
- Gate 失败必须产生可操作的错误信息（文件路径 + 行号 + 修复建议）

---

## File Map

```
packages/sidecar/src/
  orchestrator/
    verification-gate.ts            [CREATE] VerificationGate interface + GateResult types
    gates/
      typecheck-gate.ts             [CREATE] tsc --noEmit gate
      lint-gate.ts                  [CREATE] eslint gate
      test-gate.ts                  [CREATE] vitest run gate
      script-gate.ts                [CREATE] arbitrary shell command gate
      index.ts                      [CREATE] gate registry + factory
    circuit-breaker.ts              [CREATE] CircuitBreaker class
    circuit-breaker.test.ts         [CREATE] breaker tests
    gate-runner.ts                  [CREATE] executes GateNode within DurableExecutor

  session/
    graph.ts                        [MODIFY] inject max-steps-budget note from CircuitBreaker
    reviewer-gate.ts                [CREATE] adversarial reviewer agent
    reviewer-gate.test.ts           [CREATE] reviewer tests
    context/
      sliding-window.ts             [CREATE] sliding window context strategy
      sliding-window.test.ts        [CREATE]
      prompt-cache-hint.ts          [CREATE] Anthropic prompt caching hint injection
```

---

### Task 2.1: VerificationGate 接口 + 内置 Gates

**目标:** 定义可插拔验证门控，内置 4 个 gate 实现。

**Files:**
- Create: `packages/sidecar/src/orchestrator/verification-gate.ts`
- Create: `packages/sidecar/src/orchestrator/gates/typecheck-gate.ts`
- Create: `packages/sidecar/src/orchestrator/gates/lint-gate.ts`
- Create: `packages/sidecar/src/orchestrator/gates/test-gate.ts`
- Create: `packages/sidecar/src/orchestrator/gates/script-gate.ts`
- Create: `packages/sidecar/src/orchestrator/gates/index.ts`

**Interfaces:**
- Produces:
  - `VerificationGate.run(ctx: GateContext): Promise<GateResult>`
  - `GateResult = { passed: boolean; failures: GateFailure[]; suggestions: string[]; durationMs: number }`
  - `GateFailure = { message: string; file?: string; line?: number; severity: 'error' | 'warning' }`
  - `GateContext = { cwd: string; sessionId: string; runId: string; config?: Record<string, unknown> }`

- [ ] **Step 1: 定义 VerificationGate 接口**

```typescript
// packages/sidecar/src/orchestrator/verification-gate.ts

export interface GateContext {
  cwd: string
  sessionId: string
  runId: string
  config?: Record<string, unknown>
}

export interface GateFailure {
  message: string
  file?: string
  line?: number
  severity: 'error' | 'warning'
}

export interface GateResult {
  passed: boolean
  failures: GateFailure[]
  suggestions: string[]
  durationMs: number
}

export interface VerificationGate {
  readonly kind: string
  readonly description: string
  run(ctx: GateContext): Promise<GateResult>
}
```

- [ ] **Step 2: 实现 typecheck-gate**

```typescript
// packages/sidecar/src/orchestrator/gates/typecheck-gate.ts

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VerificationGate, GateContext, GateResult } from '../verification-gate.js'

const execAsync = promisify(exec)

const DIAGNOSTIC_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/gm

export const typecheckGate: VerificationGate = {
  kind: 'typecheck',
  description: 'Run tsc --noEmit and fail on type errors',

  async run(ctx: GateContext): Promise<GateResult> {
    const startedAt = Date.now()
    try {
      await execAsync('npx tsc --noEmit', { cwd: ctx.cwd, timeout: 120_000 })
      return {
        passed: true,
        failures: [],
        suggestions: [],
        durationMs: Date.now() - startedAt,
      }
    } catch (err: any) {
      const stderr: string = err.stderr || err.stdout || ''
      const failures = parseTypeScriptErrors(stderr)
      return {
        passed: failures.length === 0,
        failures,
        suggestions: failures.length > 0
          ? ['Fix type errors above and re-run']
          : [],
        durationMs: Date.now() - startedAt,
      }
    }
  },
}

function parseTypeScriptErrors(output: string): import('../verification-gate.js').GateFailure[] {
  const failures: import('../verification-gate.js').GateFailure[] = []
  for (const m of output.matchAll(DIAGNOSTIC_RE)) {
    failures.push({
      file: m[1],
      line: parseInt(m[2], 10),
      message: `TS${m[5]}: ${m[6]}`,
      severity: m[4] === 'warning' ? 'warning' : 'error',
    })
  }
  return failures
}
```

- [ ] **Step 3: 实现 lint-gate**

```typescript
// packages/sidecar/src/orchestrator/gates/lint-gate.ts

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VerificationGate, GateContext, GateResult } from '../verification-gate.js'

const execAsync = promisify(exec)

export const lintGate: VerificationGate = {
  kind: 'lint',
  description: 'Run eslint and fail on lint errors',

  async run(ctx: GateContext): Promise<GateResult> {
    const startedAt = Date.now()
    const command = (ctx.config?.command as string) ?? 'npx eslint . --format json'
    try {
      await execAsync(command, { cwd: ctx.cwd, timeout: 120_000 })
      return { passed: true, failures: [], suggestions: [], durationMs: Date.now() - startedAt }
    } catch (err: any) {
      // eslint exits 1 on lint errors — parse JSON output
      try {
        const results = JSON.parse(err.stdout || '[]')
        const failures = results.flatMap((r: any) =>
          r.messages.map((m: any) => ({
            file: r.filePath,
            line: m.line,
            message: `${m.ruleId ?? 'syntax'}: ${m.message}`,
            severity: m.severity === 1 ? 'warning' as const : 'error' as const,
          }))
        )
        return {
          passed: failures.filter(f => f.severity === 'error').length === 0,
          failures,
          suggestions: failures.length > 0 ? ['Run eslint --fix to auto-correct some issues'] : [],
          durationMs: Date.now() - startedAt,
        }
      } catch {
        return {
          passed: false,
          failures: [{ message: err.stderr || err.message, severity: 'error' }],
          suggestions: ['Ensure eslint is installed and configured'],
          durationMs: Date.now() - startedAt,
        }
      }
    }
  },
}
```

- [ ] **Step 4: 实现 test-gate 和 script-gate**

```typescript
// packages/sidecar/src/orchestrator/gates/test-gate.ts

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VerificationGate, GateContext, GateResult } from '../verification-gate.js'

const execAsync = promisify(exec)

const FAIL_RE = /(FAIL|ERROR)\s+(.+?)(?::(.+))?\n/g

export const testGate: VerificationGate = {
  kind: 'test',
  description: 'Run vitest and fail on test failures',

  async run(ctx: GateContext): Promise<GateResult> {
    const startedAt = Date.now()
    const command = (ctx.config?.command as string) ?? 'npx vitest run'
    try {
      await execAsync(command, { cwd: ctx.cwd, timeout: 300_000 })
      return { passed: true, failures: [], suggestions: [], durationMs: Date.now() - startedAt }
    } catch (err: any) {
      const output = err.stdout || err.stderr || ''
      const failures: import('../verification-gate.js').GateFailure[] = []
      for (const m of output.matchAll(FAIL_RE)) {
        failures.push({ message: `${m[1]}: ${m[2]}${m[3] ? ' - ' + m[3] : ''}`, severity: 'error' })
      }
      if (failures.length === 0) {
        failures.push({ message: 'Tests failed (parse error). Run vitest manually for details.', severity: 'error' })
      }
      return {
        passed: false,
        failures,
        suggestions: ['Fix failing tests and re-run'],
        durationMs: Date.now() - startedAt,
      }
    }
  },
}
```

```typescript
// packages/sidecar/src/orchestrator/gates/script-gate.ts

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { VerificationGate, GateContext, GateResult } from '../verification-gate.js'

const execAsync = promisify(exec)

export const scriptGate: VerificationGate = {
  kind: 'script',
  description: 'Run an arbitrary shell command. Passes on exit 0.',

  async run(ctx: GateContext): Promise<GateResult> {
    const startedAt = Date.now()
    const command = ctx.config?.command as string
    if (!command) {
      return {
        passed: false,
        failures: [{ message: 'script gate requires config.command', severity: 'error' }],
        suggestions: ['Provide a command in gate config'],
        durationMs: 0,
      }
    }
    try {
      const { stdout } = await execAsync(command, {
        cwd: ctx.cwd,
        timeout: (ctx.config?.timeoutMs as number) ?? 120_000,
      })
      return {
        passed: true,
        failures: [],
        suggestions: stdout.trim() ? [stdout.trim()] : [],
        durationMs: Date.now() - startedAt,
      }
    } catch (err: any) {
      return {
        passed: false,
        failures: [{
          message: err.stderr || err.message || `Command "${command}" failed with exit code ${err.code}`,
          severity: 'error',
        }],
        suggestions: [],
        durationMs: Date.now() - startedAt,
      }
    }
  },
}
```

- [ ] **Step 5: 实现 Gate Registry + Factory**

```typescript
// packages/sidecar/src/orchestrator/gates/index.ts

import type { VerificationGate, VerificationGateKind } from '../verification-gate.js'
import { typecheckGate } from './typecheck-gate.js'
import { lintGate } from './lint-gate.js'
import { testGate } from './test-gate.js'
import { scriptGate } from './script-gate.js'

const builtins: Record<string, VerificationGate> = {
  typecheck: typecheckGate,
  lint: lintGate,
  test: testGate,
  script: scriptGate,
}

/** Resolve a gate by kind. Throws if unknown. */
export function resolveGate(kind: VerificationGateKind): VerificationGate {
  const gate = builtins[kind]
  if (!gate) throw new Error(`Unknown gate kind: ${kind}`)
  return gate
}

/** Register a custom gate (e.g. from a plugin). */
export function registerGate(gate: VerificationGate): void {
  builtins[gate.kind] = gate
}

/** List all registered gate kinds. */
export function listGates(): string[] {
  return Object.keys(builtins)
}
```

- [ ] **Step 6: 编写测试**

```typescript
// packages/sidecar/src/orchestrator/gates/index.test.ts

import { describe, it, expect } from 'vitest'
import { resolveGate, listGates, registerGate } from './index.js'
import type { VerificationGate } from '../verification-gate.js'

describe('Gate registry', () => {
  it('resolves all built-in gates', () => {
    for (const kind of ['typecheck', 'lint', 'test', 'script']) {
      expect(resolveGate(kind as any)).toBeDefined()
      expect(resolveGate(kind as any).kind).toBe(kind)
    }
  })

  it('throws on unknown gate', () => {
    expect(() => resolveGate('unknown' as any)).toThrow('Unknown gate kind')
  })

  it('supports custom gate registration', () => {
    const custom: VerificationGate = {
      kind: 'custom-check',
      description: 'A custom check',
      async run(ctx) {
        return { passed: true, failures: [], suggestions: [], durationMs: 0 }
      },
    }
    registerGate(custom)
    expect(resolveGate('custom-check')).toBe(custom)
  })

  it('listGates includes all registered gates', () => {
    const gates = listGates()
    expect(gates).toContain('typecheck')
    expect(gates).toContain('lint')
    expect(gates).toContain('test')
    expect(gates).toContain('script')
  })
})
```

- [ ] **Step 7: 运行测试并 commit**

```bash
yarn vitest run packages/sidecar/src/orchestrator/gates/index.test.ts
git add packages/sidecar/src/orchestrator/verification-gate.ts \
        packages/sidecar/src/orchestrator/gates/
git commit -m "feat(orchestrator): add VerificationGate interface + 4 built-in gates

- VerificationGate interface with GateResult/GateFailure/GateContext types
- typecheck-gate: tsc --noEmit with TS error parsing
- lint-gate: eslint with JSON output parsing
- test-gate: vitest run with failure detection
- script-gate: arbitrary shell command (pass on exit 0)
- Gate registry with resolve/register/list
- Custom gate registration for plugin extensibility

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2.2: CircuitBreaker（停滞检测 + Token 预算）

**目标:** 检测停滞循环和预算超支，自动终止并告警。

**Files:**
- Create: `packages/sidecar/src/orchestrator/circuit-breaker.ts`
- Create: `packages/sidecar/src/orchestrator/circuit-breaker.test.ts`
- Modify: `packages/sidecar/src/session/doom-loop.ts`（提取公共逻辑）
- Modify: `packages/sidecar/src/session/graph.ts`（注入 breaker 检查）

**Interfaces:**
- Produces:
  - `CircuitBreaker.check(state: BreakerSnapshot): BreakerDecision`
  - `BreakerDecision = { action: 'continue' | 'warn' | 'terminate'; reason?: string }`
  - `BreakerSnapshot = { consecutiveNoFileChange: number; totalTokens: number; steps: number; ... }`

- [ ] **Step 1: 定义 CircuitBreaker 类**

```typescript
// packages/sidecar/src/orchestrator/circuit-breaker.ts

export interface BreakerConfig {
  /** Max consecutive steps without any file change (write_file / edit_file). */
  maxNoFileChangeSteps: number
  /** Hard token budget for the entire workflow run. */
  maxTokens: number
  /** Max total steps across all agents in the run. */
  maxSteps: number
  /** When true, 'warn' decisions are auto-escalated to 'terminate' after N warns. */
  maxWarns: number
}

const DEFAULT_CONFIG: BreakerConfig = {
  maxNoFileChangeSteps: 10,
  maxTokens: 200_000,
  maxSteps: 100,
  maxWarns: 3,
}

export interface BreakerSnapshot {
  steps: number
  totalTokens: number
  consecutiveNoFileChange: number
  warnCount: number
  lastFileChangedAt: number | null
}

export interface BreakerDecision {
  action: 'continue' | 'warn' | 'terminate'
  reason?: string
}

export class CircuitBreaker {
  private snapshot: BreakerSnapshot
  private cfg: BreakerConfig

  constructor(cfg: Partial<BreakerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg }
    this.snapshot = {
      steps: 0,
      totalTokens: 0,
      consecutiveNoFileChange: 0,
      warnCount: 0,
      lastFileChangedAt: null,
    }
  }

  /** Call after each agent step. Returns whether to continue. */
  step(tokensUsed: number, fileChanged: boolean): BreakerDecision {
    this.snapshot.steps++
    this.snapshot.totalTokens += tokensUsed

    if (fileChanged) {
      this.snapshot.consecutiveNoFileChange = 0
      this.snapshot.lastFileChangedAt = Date.now()
    } else {
      this.snapshot.consecutiveNoFileChange++
    }

    return this.evaluate()
  }

  private evaluate(): BreakerDecision {
    // 1. Token budget
    if (this.snapshot.totalTokens >= this.cfg.maxTokens) {
      return {
        action: 'terminate',
        reason: `Token budget exhausted: ${this.snapshot.totalTokens} >= ${this.cfg.maxTokens}`,
      }
    }

    // 2. Step limit
    if (this.snapshot.steps >= this.cfg.maxSteps) {
      return {
        action: 'terminate',
        reason: `Step limit reached: ${this.snapshot.steps} >= ${this.cfg.maxSteps}`,
      }
    }

    // 3. No-progress detection
    if (this.snapshot.consecutiveNoFileChange >= this.cfg.maxNoFileChangeSteps) {
      // Escalate warn → terminate after maxWarns
      if (this.snapshot.warnCount >= this.cfg.maxWarns) {
        return {
          action: 'terminate',
          reason: `No file changes for ${this.snapshot.consecutiveNoFileChange} steps after ${this.cfg.maxWarns} warnings`,
        }
      }
      this.snapshot.warnCount++
      return {
        action: 'warn',
        reason: `No file changes in the last ${this.snapshot.consecutiveNoFileChange} steps. Progress may be stalled.`,
      }
    }

    return { action: 'continue' }
  }

  getSnapshot(): BreakerSnapshot {
    return { ...this.snapshot }
  }

  reset(): void {
    this.snapshot = {
      steps: 0,
      totalTokens: 0,
      consecutiveNoFileChange: 0,
      warnCount: 0,
      lastFileChangedAt: null,
    }
  }
}
```

- [ ] **Step 2: 编写测试**

```typescript
// packages/sidecar/src/orchestrator/circuit-breaker.test.ts

import { describe, it, expect } from 'vitest'
import { CircuitBreaker } from './circuit-breaker.js'

describe('CircuitBreaker', () => {
  it('allows steps within budget', () => {
    const cb = new CircuitBreaker({ maxSteps: 10, maxTokens: 10000, maxNoFileChangeSteps: 5 })
    const result = cb.step(100, true)
    expect(result.action).toBe('continue')
  })

  it('terminates on token budget exhaustion', () => {
    const cb = new CircuitBreaker({ maxTokens: 500 })
    const result = cb.step(600, true)
    expect(result.action).toBe('terminate')
    expect(result.reason).toContain('Token budget exhausted')
  })

  it('terminates on step limit', () => {
    const cb = new CircuitBreaker({ maxSteps: 1 })
    cb.step(10, true)
    const result = cb.step(10, true)
    expect(result.action).toBe('terminate')
    expect(result.reason).toContain('Step limit reached')
  })

  it('warns on no-progress then terminates after maxWarns', () => {
    const cb = new CircuitBreaker({ maxNoFileChangeSteps: 3, maxWarns: 2 })

    // First 3 steps: no file change → warn
    cb.step(10, false)
    cb.step(10, false)
    const warn1 = cb.step(10, false)
    expect(warn1.action).toBe('warn')

    // Reset warn counter by making a file change
    cb.step(10, true) // resets consecutiveNoFileChange

    // Another 3 no-change → second warn
    cb.step(10, false)
    cb.step(10, false)
    const warn2 = cb.step(10, false)
    expect(warn2.action).toBe('warn')

    // Third time → terminate
    cb.step(10, true) // reset
    cb.step(10, false)
    cb.step(10, false)
    const term = cb.step(10, false)
    expect(term.action).toBe('terminate')
    expect(term.reason).toContain('2 warnings')
  })

  it('file change resets consecutive counter but not warn count until explicit reset', () => {
    const cb = new CircuitBreaker({ maxNoFileChangeSteps: 2, maxWarns: 2 })
    // accumulate warn — but warn count only increments ONCE per stall period
    cb.step(10, false)
    const w1 = cb.step(10, false)
    expect(w1.action).toBe('warn')

    cb.step(10, true) // reset consecutive counter
    cb.step(10, true) // file change again
    expect(cb.getSnapshot().consecutiveNoFileChange).toBe(0)
  })

  it('reset() clears all state', () => {
    const cb = new CircuitBreaker()
    cb.step(5000, false)
    cb.step(5000, false)
    cb.reset()
    expect(cb.getSnapshot().steps).toBe(0)
    expect(cb.getSnapshot().totalTokens).toBe(0)
  })
})
```

- [ ] **Step 3: 集成到 graph.ts agent 节点中**

```typescript
// packages/sidecar/src/session/graph.ts

// 在 GraphCtx 中追加 breaker:
export interface GraphCtx {
  // ... existing fields
  circuitBreaker?: CircuitBreaker
}

// 在 agent 节点函数中，LLM 调用之后:
const tokensUsed = (response.usage_metadata?.input_tokens ?? 0) +
                   (response.usage_metadata?.output_tokens ?? 0)
const hadFileWrite = lastMessage.tool_calls?.some(
  (tc: any) => tc.name === 'write_file' || tc.name === 'edit_file'
) ?? false

if (ctx.circuitBreaker) {
  const decision = ctx.circuitBreaker.step(tokensUsed, hadFileWrite)
  if (decision.action === 'terminate') {
    return {
      messages: [new AIMessage(`CIRCUIT BREAKER TRIPPED: ${decision.reason}\n\nTerminating execution.`)],
      steps: state.steps + 1,
      status: 'awaiting_user' as const,
    }
  }
  if (decision.action === 'warn') {
    // Inject warning as system note, but continue
    state.messages.push(new SystemMessage(`⚠️ ${decision.reason}`))
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/orchestrator/circuit-breaker.ts \
        packages/sidecar/src/orchestrator/circuit-breaker.test.ts \
        packages/sidecar/src/session/graph.ts
git commit -m "feat(orchestrator): add CircuitBreaker with stall detection and budget control

- CircuitBreaker class: step token tracking + file-change detection
- Three termination conditions: token budget, step limit, no-progress
- Warn → escalate → terminate flow with configurable maxWarns
- Integrated into graph.ts agent node via GraphCtx.circuitBreaker
- Reset() for clean restart between workflow runs

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2.3: 对抗性 Reviewer Gate

**目标:** Coder 输出必须通过独立 Reviewer agent 的审核，不通过则自动回退。

**Files:**
- Create: `packages/sidecar/src/session/reviewer-gate.ts`
- Create: `packages/sidecar/src/session/reviewer-gate.test.ts`
- Modify: `packages/sidecar/src/orchestrator/gate-runner.ts`（如果 GateNode 需要调用 agent）

**Interfaces:**
- Produces:
  - `ReviewerGate.run(ctx: ReviewerContext): Promise<GateResult>`
  - `ReviewerContext extends GateContext { diff: string; originalPrompt: string }`

- [ ] **Step 1: 实现 ReviewerGate**

```typescript
// packages/sidecar/src/session/reviewer-gate.ts

import type { VerificationGate, GateContext, GateResult, GateFailure } from '../orchestrator/verification-gate.js'
import type { ModelRunner } from './model-runner.js'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

export interface ReviewerContext extends GateContext {
  /** The git diff of changes made by the coder. */
  diff: string
  /** The original task prompt. */
  originalPrompt: string
}

const REVIEWER_SYSTEM_PROMPT = `You are a strict code reviewer. Review the following diff against the original task requirements.

Check for:
1. **Correctness**: Does the code correctly implement the requirements?
2. **Security**: Are there any security vulnerabilities (injection, XSS, exposed secrets)?
3. **Idioms**: Does the code follow the project's conventions?
4. **Completeness**: Are edge cases handled? Are there TODOs left behind?
5. **Regression risk**: Could this change break existing functionality?

Respond in this exact JSON format:
{
  "approved": true/false,
  "issues": [
    { "severity": "error"|"warning", "file": "path/to/file", "line": 123, "message": "description" }
  ],
  "suggestions": ["suggestion 1", "suggestion 2"]
}

If there are any "error" severity issues, approved MUST be false.`

export function createReviewerGate(runner: ModelRunner): VerificationGate {
  return {
    kind: 'reviewer',
    description: 'Adversarial code review by an independent agent',

    async run(ctx: GateContext): Promise<GateResult> {
      const startedAt = Date.now()
      const rctx = ctx as ReviewerContext

      if (!rctx.diff) {
        return {
          passed: true,
          failures: [],
          suggestions: ['No diff to review'],
          durationMs: Date.now() - startedAt,
        }
      }

      const messages = [
        new SystemMessage(REVIEWER_SYSTEM_PROMPT),
        new HumanMessage(
          `Original task: ${rctx.originalPrompt}\n\nDiff to review:\n\`\`\`diff\n${rctx.diff}\n\`\`\``
        ),
      ]

      const response = await runner.invoke(messages)
      const text = typeof response.content === 'string'
        ? response.content
        : (response.content as any[]).map(c => c.text ?? '').join('')

      try {
        // Extract JSON from response (may be wrapped in markdown)
        const jsonMatch = text.match(/\{[\s\S]*"approved"[\s\S]*\}/)
        if (!jsonMatch) {
          return {
            passed: false,
            failures: [{ message: 'Reviewer response could not be parsed', severity: 'error' }],
            suggestions: [text.slice(0, 500)],
            durationMs: Date.now() - startedAt,
          }
        }

        const result = JSON.parse(jsonMatch[0])
        const failures: GateFailure[] = (result.issues ?? []).map((i: any) => ({
          message: i.message,
          file: i.file,
          line: i.line,
          severity: i.severity ?? 'warning',
        }))

        const errorFailures = failures.filter(f => f.severity === 'error')

        return {
          passed: result.approved !== false && errorFailures.length === 0,
          failures,
          suggestions: result.suggestions ?? [],
          durationMs: Date.now() - startedAt,
        }
      } catch {
        return {
          passed: false,
          failures: [{ message: 'Reviewer produced invalid JSON', severity: 'error' }],
          suggestions: ['Re-run review with a different model'],
          durationMs: Date.now() - startedAt,
        }
      }
    },
  }
}
```

- [ ] **Step 2: 编写测试**

```typescript
// packages/sidecar/src/session/reviewer-gate.test.ts

import { describe, it, expect } from 'vitest'
import { createReviewerGate } from './reviewer-gate.js'
import type { ReviewerContext } from './reviewer-gate.js'
import { FakeModelRunner } from './model-runner.test-utils.js'

describe('ReviewerGate', () => {
  const baseCtx: ReviewerContext = {
    cwd: '/tmp/test',
    sessionId: 's1',
    runId: 'r1',
    diff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-const x = 1\n+const x = 2',
    originalPrompt: 'Change x from 1 to 2',
  }

  it('passes when reviewer approves with no errors', async () => {
    const runner = new FakeModelRunner([
      JSON.stringify({ approved: true, issues: [], suggestions: ['LGTM'] }),
    ])
    const gate = createReviewerGate(runner)
    const result = await gate.run(baseCtx)
    expect(result.passed).toBe(true)
  })

  it('fails when reviewer reports errors', async () => {
    const runner = new FakeModelRunner([
      JSON.stringify({
        approved: false,
        issues: [{ severity: 'error', file: 'src/foo.ts', line: 1, message: 'Missing null check' }],
        suggestions: ['Add null check before accessing x'],
      }),
    ])
    const gate = createReviewerGate(runner)
    const result = await gate.run(baseCtx)
    expect(result.passed).toBe(false)
    expect(result.failures.length).toBe(1)
    expect(result.failures[0].severity).toBe('error')
  })

  it('passes when diff is empty', async () => {
    const runner = new FakeModelRunner([])
    const gate = createReviewerGate(runner)
    const result = await gate.run({ ...baseCtx, diff: '' })
    expect(result.passed).toBe(true)
  })

  it('handles malformed reviewer response', async () => {
    const runner = new FakeModelRunner(['not valid JSON at all'])
    const gate = createReviewerGate(runner)
    const result = await gate.run(baseCtx)
    expect(result.passed).toBe(false)
    expect(result.failures[0].message).toContain('could not be parsed')
  })
})
```

- [ ] **Step 3: 在 DurableExecutor 中支持 GateNode 执行**

```typescript
// packages/sidecar/src/orchestrator/gate-runner.ts

import type { GateNode } from '@hip/protocol'
import type { GateContext, GateResult } from './verification-gate.js'
import { resolveGate } from './gates/index.js'

export async function runGateNode(
  node: GateNode,
  ctx: GateContext
): Promise<GateResult> {
  const gate = resolveGate(node.gateKind)
  return gate.run({ ...ctx, config: node.config })
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/session/reviewer-gate.ts \
        packages/sidecar/src/session/reviewer-gate.test.ts \
        packages/sidecar/src/orchestrator/gate-runner.ts
git commit -m "feat(orchestrator): add adversarial ReviewerGate

- ReviewerGate: independent agent reviews coder diff
- Structured JSON output with approved/issues/suggestions
- Error-severity issues force rejection
- GateNode execution integrated via gate-runner.ts
- Handles malformed responses gracefully

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2.4: 上下文管理优化

**目标:** 滑动窗口 + prompt caching hint 注入，降低长对话的 token 消耗。

**Files:**
- Create: `packages/sidecar/src/session/context/sliding-window.ts`
- Create: `packages/sidecar/src/session/context/sliding-window.test.ts`
- Modify: `packages/sidecar/src/session/graph.ts`（compact 节点集成）

- [ ] **Step 1: 实现 SlidingWindow**

```typescript
// packages/sidecar/src/session/context/sliding-window.ts

import type { BaseMessage } from '@langchain/core/messages'

export interface SlidingWindowConfig {
  /** Max number of recent turns to keep fully intact. */
  recentTurns: number
  /** Max total messages before summarization kicks in. */
  maxMessages: number
  /** When true, the first user message (task definition) is always preserved. */
  preserveFirstMessage: boolean
}

const DEFAULT: SlidingWindowConfig = {
  recentTurns: 5,
  maxMessages: 50,
  preserveFirstMessage: true,
}

/**
 * Apply a sliding window to a message array.
 * Keeps: first user message (task) + last N turns intact + summaries in between.
 */
export function applySlidingWindow(
  messages: BaseMessage[],
  config: Partial<SlidingWindowConfig> = {}
): { kept: BaseMessage[]; removed: BaseMessage[] } {
  const cfg = { ...DEFAULT, ...config }

  if (messages.length <= cfg.maxMessages) {
    return { kept: messages, removed: [] }
  }

  const kept: BaseMessage[] = []
  const removed: BaseMessage[] = []

  // 1. Keep first user message (task definition)
  let idx = 0
  if (cfg.preserveFirstMessage && messages.length > 0 && messages[0].getType() === 'human') {
    kept.push(messages[0])
    idx = 1
  }

  // 2. Count turns from the end
  const turns: BaseMessage[][] = []
  let currentTurn: BaseMessage[] = []

  // Work backwards to count turns
  for (let i = messages.length - 1; i >= idx; i--) {
    const msg = messages[i]
    currentTurn.unshift(msg)
    if (msg.getType() === 'human' && i > idx) {
      turns.unshift(currentTurn)
      currentTurn = []
    }
  }
  if (currentTurn.length > 0) turns.unshift(currentTurn)

  // 3. Keep last N turns
  const turnsToKeep = Math.min(cfg.recentTurns, turns.length)
  const keepFrom = turns.length - turnsToKeep

  for (let i = 0; i < turns.length; i++) {
    if (i >= keepFrom) {
      kept.push(...turns[i])
    } else {
      removed.push(...turns[i])
    }
  }

  return { kept, removed }
}
```

- [ ] **Step 2: 在 compact 节点中集成**

```typescript
// 在 graph.ts 的 compact 节点中，token-budget compaction 之前:

import { applySlidingWindow } from './context/sliding-window.js'

// ...

const windowResult = applySlidingWindow(state.messages, {
  recentTurns: ctx.contextConfig?.recentTurns ?? 5,
  maxMessages: ctx.contextConfig?.maxMessages ?? 50,
})

if (windowResult.removed.length > 0) {
  // 对被移除的消息做摘要
  const summary = await ctx.summarizer.summarize(windowResult.removed)
  const summaryMsg = new SystemMessage(`[Earlier conversation summary]\n${summary}`)
  // 摘要消息插入到保留消息之前
  const compacted = [summaryMsg, ...windowResult.kept]
  return { messages: compacted, compacted: true }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/sidecar/src/session/context/
git commit -m "feat(context): add sliding window strategy for message compaction

- applySlidingWindow: keep first task + last N turns, summarize middle
- Configurable recentTurns, maxMessages, preserveFirstMessage
- Integrated into graph.ts compact node before summary compaction
- Reduces token waste on long conversations

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Phase 2 Completion Checklist

- [ ] `yarn tsc` passes with no new errors
- [ ] `yarn vitest run packages/sidecar/src/orchestrator/gates/` passes
- [ ] `yarn vitest run packages/sidecar/src/orchestrator/circuit-breaker.test.ts` passes
- [ ] `yarn vitest run packages/sidecar/src/session/reviewer-gate.test.ts` passes
- [ ] `yarn vitest run packages/sidecar/src/session/context/` passes
- [ ] Manual test: workflow with gate node → gate executes → blocks downstream on failure
- [ ] Manual test: circuit breaker trips after N no-progress steps
- [ ] Manual test: reviewer rejects bad code → coder gets feedback for rework

---

*Phase 2 完成后，进入 Phase 3：多 Agent 团队协调与自主循环。详见主计划文档 `docs/agent-orchestration-plan.md` §6.*
