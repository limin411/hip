# Remediation Phase 4 — Test Strategy & Dead-Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `yarn test` pass without an API key (fast unit layer always green; real-LLM tests skipped, not erroring), remove dead code, and sync the docs to the now-true architecture.

**Architecture:** The fast unit layer (`attribution.test.ts`, `session-unit.test.ts`, plus the existing `src/**` tests) runs with no network. The real-DeepSeek suites are gated with `describe.skipIf(!process.env.DEEPSEEK_API_KEY)` and never throw at import. Dead modules and stale comments left over from the mock era are removed.

**Tech Stack:** Vitest, TypeScript.

**Spec:** [docs/superpowers/specs/2026-06-07-hip-remediation-design.md](../specs/2026-06-07-hip-remediation-design.md) (§W8)

**Depends on:** Phases 1-3 (the unit tests and the `useConnectionStatus` consumer they reference already exist).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/sidecar/src/session/session.test.ts` | Gate real-LLM suite with `skipIf`, drop throwing import | Modify |
| `src/lib/stream.ts` | Dead `tokenize` helper | Delete |
| `src/lib/stream.test.ts` | Test for the dead helper | Delete |
| `src/domain/sessionService.ts` | Remove stale MockTransport comment | Modify |
| `src/domain/wsTransport.ts` | Remove stale MockTransport comments | Modify |
| `src/domain/index.ts` | Remove stale "no UI consumer" comment | Modify |
| `README.md` / `AGENTS.md` | Sync wording to real multi-agent + key setup | Modify |

---

## Task 1: Gate the real-LLM session suite with `skipIf` (W8)

**Files:**
- Modify: `packages/sidecar/src/session/session.test.ts`

- [ ] **Step 1: Verify current behavior fails without a key**

Run: `env -u DEEPSEEK_API_KEY yarn vitest run packages/sidecar/src/session/session.test.ts`
Expected: FAIL — the top-level `throw new Error('DEEPSEEK_API_KEY is required for real-LLM tests')` aborts the file.

- [ ] **Step 2: Replace the throwing guard with `skipIf`**

In `packages/sidecar/src/session/session.test.ts`, delete the lines:

```ts
const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) {
  throw new Error('DEEPSEEK_API_KEY is required for real-LLM tests')
}
```

Replace with:

```ts
const apiKey = process.env.DEEPSEEK_API_KEY
const hasKey = !!apiKey
```

Change the suite declaration from `describe('Session with real DeepSeek API', () => {` to:

```ts
describe.skipIf(!hasKey)('Session with real DeepSeek API', () => {
```

Inside `createModel()`, the `apiKey` is now possibly `undefined` at the type level but the suite only runs when `hasKey` — assert it: change `apiKey,` in the `ChatOpenAI` options to `apiKey: apiKey!,`.

- [ ] **Step 3: Verify it is skipped (not failed) without a key**

Run: `env -u DEEPSEEK_API_KEY yarn vitest run packages/sidecar/src/session/session.test.ts`
Expected: the suite is SKIPPED; 0 failures.

- [ ] **Step 4: Verify it still runs with a key**

Run: `DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY yarn vitest run packages/sidecar/src/session/session.test.ts`
Expected: PASS (the existing real-LLM assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session.test.ts
git commit -m "test(sidecar): skipIf-gate real-LLM suite instead of throwing"
```

---

## Task 2: Delete the dead `tokenize` helper (W8)

**Files:**
- Delete: `src/lib/stream.ts`
- Delete: `src/lib/stream.test.ts`

- [ ] **Step 1: Confirm it has no non-test consumers**

Run: `grep -rn "lib/stream\|tokenize" src --include="*.ts" --include="*.tsx"`
Expected: matches only inside `src/lib/stream.ts` and `src/lib/stream.test.ts`. (If anything else imports it, stop and reassess.)

- [ ] **Step 2: Delete the files**

```bash
git rm src/lib/stream.ts src/lib/stream.test.ts
```

- [ ] **Step 3: Verify the suite + types are still green**

Run: `yarn type-check && yarn test`
Expected: PASS, with no reference errors to the removed module.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove dead tokenize stream helper"
```

---

## Task 3: Remove stale mock-era comments (W8)

**Files:**
- Modify: `src/domain/sessionService.ts`
- Modify: `src/domain/wsTransport.ts`
- Modify: `src/domain/index.ts`

- [ ] **Step 1: `sessionService.ts` — fix the singleton comment**

In `src/domain/sessionService.ts`, replace the block above the `sessionService` export:

```ts
/**
 * App 单例：接 live 后端（WsTransport）。
 * 若要在无 Tauri 环境下使用 mock，临时改为 MockTransport 即可。
 */
export const sessionService = new SessionService(new WsTransport())
```

with (MockTransport no longer exists):

```ts
/** App 单例：通过 WsTransport 连接 live sidecar。 */
export const sessionService = new SessionService(new WsTransport())
```

- [ ] **Step 2: `wsTransport.ts` — drop the MockTransport references**

In `src/domain/wsTransport.ts`, remove the line comment `// 注意：wsClient 是模块级单例...` only if it references MockTransport, and change the class doc comment:

```ts
/** 真后端缝。日后把 sessionService 单例从 MockTransport 换成它即可。 */
```

to:

```ts
/** WsTransport：domain 层与 live sidecar 之间的 WebSocket 实现。 */
```

(Keep the accurate note that `wsClient` is a module-level singleton.)

- [ ] **Step 3: `index.ts` — drop the stale "no consumer" note**

In `src/domain/index.ts`, remove the line:

```ts
// 注：useConnectionStatus 目前无 UI 消费方，为接入 WsTransport 后显示连接状态预留。
```

(It is now consumed by `ChatHeader` from Phase 3.)

- [ ] **Step 4: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionService.ts src/domain/wsTransport.ts src/domain/index.ts
git commit -m "chore(domain): remove stale mock-era comments"
```

---

## Task 4: Sync the docs to reality (W8)

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: README — confirm/adjust the architecture wording**

Read `README.md`. The "Architecture" section now accurately describes the implemented system (Supervisor + sub-agents). Add a one-line note to the "Development setup" section that a DeepSeek API key is configured in-app via Settings (keychain) and that `DEEPSEEK_API_KEY` env is a dev fallback:

```md
> The DeepSeek API key is entered in the app's **Settings** panel and stored in
> the OS keychain. For development, a `DEEPSEEK_API_KEY` environment variable (or
> `.env`) is used as a fallback.
```

Remove any sentence that implies multiple LLM providers are selectable (the app is DeepSeek-only after the remediation), if present.

- [ ] **Step 2: AGENTS.md — update the project structure snapshot**

Read `AGENTS.md`. In the "项目结构速查" section, ensure it reflects: `src/domain/` (sessionService/sessionStore/transport/wsTransport/hooks), `src/store/uiStore.ts` is UI-chrome-only, and the sidecar runs Supervisor + planner/coder/reviewer sub-agents. Update only the now-inaccurate lines; do not rewrite the whole file.

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: sync README/AGENTS to implemented multi-agent + keychain setup"
```

---

## Task 5: Final CI gate + E2E sanity

**Files:** none (verification only)

- [ ] **Step 1: Full no-key test run (the CI contract)**

Run: `env -u DEEPSEEK_API_KEY yarn type-check && env -u DEEPSEEK_API_KEY yarn workspace @hip/sidecar type-check && env -u DEEPSEEK_API_KEY yarn test`
Expected: ALL PASS — frontend tests + sidecar unit tests (`attribution`, `session-unit`) green; real-LLM suites (`session`, `multiagent.integration`) reported as skipped; 0 failures.

- [ ] **Step 2: With-key integration run**

Run: `DEEPSEEK_API_KEY=$DEEPSEEK_API_KEY yarn test`
Expected: PASS including the real-LLM suites.

- [ ] **Step 3: Rust gate**

Run: `cd src-tauri && cargo build && cargo test`
Expected: PASS.

- [ ] **Step 4: E2E sanity (auth guard didn't break launch)**

The app now redirects `/` → `/login` and guards `/app`. Confirm the existing E2E still drives login → app. Read `e2e/specs/app-launch.spec.ts`; if it asserts a direct landing on the app shell, add a step that clicks a login button (or `skip` route) first. Then build + run:

```bash
cargo tauri build --debug && yarn test:e2e
```

Expected: PASS (or an updated spec that accounts for the login gate).

- [ ] **Step 5: Final commit (if the E2E spec was updated)**

```bash
git add e2e/
git commit -m "test(e2e): account for the login route guard"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (§W8):** real-LLM `skipIf` → Task 1; fast unit layer already added in Phases 1-2 (`session-unit`, `attribution`) and verified green in Task 5; dead code (`tokenize`, MockTransport comments, stale `useConnectionStatus` note) → Tasks 2-3; doc sync → Task 4. ✅
- **CI contract:** Task 5 Step 1 is the exact "`yarn test` passes with no key" success criterion from the spec. ✅
- **Type safety after edits:** `apiKey!` non-null assertion in Task 1 keeps `session.test.ts` type-clean now that the throwing guard (which previously narrowed the type) is gone. ✅
- **No placeholders:** deletions use `git rm`; comment edits show exact before/after; doc tasks instruct reading the file first then making targeted edits. ✅
- **Dependency note:** this phase assumes Phases 1-3 landed (the consumer of `useConnectionStatus` and the unit-test files must exist); if run standalone, Task 3 Step 3 and Task 5 Step 1 will reveal the gap. ✅
