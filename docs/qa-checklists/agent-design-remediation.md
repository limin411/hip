# Manual QA Checklist — agent-design-remediation

> Manual smoke checklist for flows that cannot be automated without a pre-built Tauri `.app` binary. Run this against a local `yarn tauri dev` build on macOS before declaring the branch ready.

## Environment

- [ ] Built with `yarn sidecar:dev-bin` and `yarn tauri dev` on the `agent-design-remediation` branch.
- [ ] `~/.hip/config/auth.json` contains a valid API key for the provider under test (file mode `0600`).
- [ ] No leftover `hip` processes from previous runs.

## App launch & onboarding

- [ ] **Launch**
  - App window opens without crashing.
  - Window title reads "hip" (or localized equivalent).
  - URL hash is `#/login` within 30 seconds.

- [ ] **Skip login**
  - "跳过登录" button is visible on the login screen.
  - Clicking it navigates to `#/app` within 10 seconds.
  - Centered composer landing is rendered with one of the greeting phrases.

- [ ] **New conversation**
  - "新对话" button creates a new chat session.
  - Session appears in the sidebar with a generated title.

## Network policy round-trip

- [ ] **Open settings**
  - Settings panel opens from the top-right gear icon.
  - Network policy section is visible.

- [ ] **Edit and save**
  - Add an allowlist entry: `https://api.example.com`.
  - Add a rate limit: `maxRequestsPerMinute: 60`.
  - Save succeeds without error toast.

- [ ] **Rust → frontend sync**
  - Close and reopen settings.
  - Previously saved allowlist and rate limit are still present.

- [ ] **File on disk**
  - `~/.hip/config/network.json` exists and contains the saved values as pretty-printed JSON with camelCase keys (`allowlist`, `maxRequestsPerMinute`).

- [ ] **Sidecar reload**
  - Network policy is honored on the next agent turn (no hard failure; policy loads at top of each turn in `Session.runTurn`).

## Chat turn

- [ ] **Pure-chat message**
  - In a session without a workspace folder, type "hello" and send.
  - Assistant replies within 60 seconds.
  - `message:complete` is rendered; no `error` message with code `NO_API_KEY` or `INCOMPATIBLE_MODEL`.

- [ ] **Input queue while running**
  - Send a second message while the first turn is still streaming.
  - Second message is queued and processed after the first completes.

- [ ] **Steer**
  - During an active turn, click the steer affordance and send "stop".
  - Current turn is interrupted and the steer becomes the next user message.

## Code workspace

- [ ] **Switch to code surface**
  - Click the "代码" rail item.
  - Code surface renders with a folder picker.

- [ ] **Pick folder**
  - Pick a local folder containing a `README.md`.
  - File tree renders and `README.md` entry is visible within 60 seconds.
  - No new sidebar session row is created while in draft state.

- [ ] **Markdown preview**
  - Click `README.md`.
  - A rendered Markdown preview appears (not raw source).

- [ ] **HTML preview**
  - Click an `.html` file.
  - A sandboxed iframe preview is rendered (`sandbox` attribute is present).

## Git / diff workspace

- [ ] **Init git**
  - In a non-repo folder, the Files tab shows "初始化 git 仓库".
  - Clicking it initializes the repo and reveals the Changes tab.

- [ ] **Detect changes**
  - Modify a tracked file out-of-band.
  - Switch to the Changes tab; the diff appears within 10 seconds.

- [ ] **Checkpoint / revert (smoke only)**
  - A checkpoint is captured automatically after a turn.
  - The revert affordance is present and clickable (do not actually revert unless in a disposable folder).

## Multi-agent & background subagent

- [ ] **Background subagent dispatch**
  - In a code session, ask the agent to run a background task (e.g. "search for TODOs in the background").
  - `agent:started` for a worker appears before the main turn completes.
  - `agent:notification` reports the task result when it finishes.

- [ ] **Multi-agent handoff**
  - If multiple agent profiles are enabled, request a task that triggers a handoff.
  - Verify the active agent switches and control returns to the supervisor.

## Shutdown

- [ ] **Clean exit**
  - Close the app window.
  - Sidecar process terminates within 5 seconds (no orphan `hip` or Node processes).

## Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| Tester | | | Pass / Fail |

---

*This checklist is intentionally manual. Do not add WebdriverIO automation here; new E2E specs are out of scope for this branch.*
