# Competitive Research: Qoder Work (QoderWork)

**Date:** 2026-07-05  
**Researcher:** Kimi Code CLI  
**Scope:** QoderWork desktop AI agent and its parent Qoder ecosystem (Qoder Desktop / CLI / Quest). Qoder is an Alibaba-backed agentic platform; QoderWork is its local-first, general-work desktop agent.

---

## 1. Core Value Proposition

QoderWork is positioned as a **desktop AI teammate that finishes work, not just chats**. The user describes an outcome in natural language; the agent plans, executes, and delivers results locally on macOS/Windows. It targets knowledge workers, developers (for non-coding tasks), content creators, and researchers who need autonomous file organization, data analysis, document creation, browser automation, and desktop app control [[QoderWork landing page](https://qoder.com/en/qoderwork), [QoderWork introduction docs](https://docs.qoder.com/qoderwork/introduction)].

Key differentiators from traditional chatbots, per the product’s own comparison:

- **Task execution** vs. instructions only
- **Full local file access** vs. limited/none
- **Automatic planning & multi-step execution** vs. manual step-by-step
- **Local processing with granular permissions** vs. cloud-dependent
- **Extensible Skills & MCP** vs. limited customization [[QoderWork.org overview](https://qoderwork.org/)]

---

## 2. Product Suite Context

Qoder offers several products [[Qoder homepage](https://qoder.com/en)]:

| Product | Focus |
|---|---|
| **Qoder Desktop** | Autonomous development desktop / IDE for real-world software engineering |
| **QoderWork** | Local-first AI work companion for everyday office/knowledge work |
| **Qoder CLI** | Terminal-native coding agent and agent engine |
| **QoderWake** | 24/7 cloud AI employees for enterprises |
| **Cloud Agents** | Fully managed enterprise cloud agent platform |

This report focuses on **QoderWork**, but its agent/security model is shared with the broader Qoder platform.

---

## 3. Key Features

### 3.1 Autonomous Workflows
- Natural-language task input; the agent creates an execution plan, requests missing permissions, and runs steps in a visible Task Monitor [[Quick Start](https://docs.qoder.com/qoderwork/quick-start)].
- Clarifying questions are asked when instructions are ambiguous [[QoderWork.org](https://qoderwork.org/)].

### 3.2 File & Document Processing
- Read/write/organize documents, spreadsheets, presentations, PDFs through conversation.
- Built-in Skills for `docx`, `xlsx`, `pptx`, `pdf`.
- Typical scenarios: file organization, photo grouping, data analysis, report drafting, research synthesis [[Introduction](https://docs.qoder.com/qoderwork/introduction)].

### 3.3 Browser Automation
- Built-in connector controls Chrome/Edge (Chromium-based) to navigate, fill forms, extract data, and run multi-tab web workflows using existing login sessions [[Connectors docs](https://docs.qoder.com/qoderwork/connectors)].

### 3.4 Computer Use (Desktop GUI Control)
- “Computer Use” enables the agent to perceive the screen, click, type, scroll, and chain cross-app workflows.
- Requires **Accessibility** and **Screen Recording** permissions; operates in background without stealing focus.
- Per-action confirmation is configurable (Ask every time / Auto-execute / Disabled) [[Computer Use docs](https://docs.qoder.com/qoderwork/computer-use)].

### 3.5 Scheduled Tasks & IM Channels
- **Scheduled Tasks:** recurring/one-time tasks that auto-open a conversation and run a prompt.
- **IM Channels:** bridge to DingTalk, Feishu, Lark, WeChat, WeCom so users can @ the bot to run tasks remotely [[UI Overview](https://docs.qoder.com/qoderwork/ui-overview)].

### 3.6 Awareness (Memory & Personalization)
- Cross-session memory and skill evolution.
- Files: `SOUL.md` (collaboration style), `AGENTS.md` (work rules), `USER.md` (profile), `MEMORY.md` (long-term memory), plus short-term memory logs under `~/qoderwork/awareness/main`.
- Backup/restore for multi-device sync or migration [[Awareness docs](https://docs.qoder.com/qoderwork/memory)].

### 3.7 Workspaces
- **General** (chat assistant), **Design** (AI-native design canvas), **Slides**, **Writing** [[Settings docs](https://docs.qoder.com/qoderwork/settings)].

### 3.8 Voice Input & Global QuickPick
- Global voice hotkey and a bottom floating window for hands-free task entry.
- **QuickPick** global quick-task window triggered by a hotkey [[Settings docs](https://docs.qoder.com/qoderwork/settings)].

---

## 4. Agent Architecture

### 4.1 QoderWork Loop
The public docs describe a continuous cycle of **understand → plan → execute → verify → deliver** around real business tasks [[Qoder homepage](https://qoder.com/en)]. The UX matches this: task description → plan review → real-time execution monitor → result approval [[QoderWork.org](https://qoderwork.org/)].

### 4.2 Coding Agent Architecture (Qoder Desktop / Quest)
For software tasks, Qoder Desktop uses **Quest**, a dedicated agent-first window with two modes [[Quest overview](https://docs.qoder.com/user-guide/quest/overview)]:

- **Agent Mode:** single agent end-to-end (clarify → plan → code → verify).
- **Experts Mode:** multi-agent parallel collaboration.

Experts Mode roles (relevant as a design reference):

| Role | Responsibility |
|---|---|
| **Lead Agent** | Decompose tasks, coordinate, ensure quality |
| **Researcher** | Analysis, code location, dependency mapping |
| **Full-Stack Engineer** | Frontend/backend implementation |
| **QA** | Run tests/builds, collect validation evidence |
| **Code Reviewer** | Review code, flag risks |
| **UI Operator** | Browser/UI end-to-end validation |
| **Debug Engineer** | Reproduce failures, root-cause diagnosis |

[[Experts Mode docs](https://docs.qoder.com/user-guide/quest/experts-mode)]

### 4.3 Best Practices for Agent Tasks
- Write concrete task descriptions with acceptance criteria and `@` references.
- Use Spec-driven mode for complex features; Prototype exploration for quick validation.
- Prefer worktree isolation for heavy changes.
- Iterate: deliver MVP first, then refine through conversation [[Agent Mode docs](https://docs.qoder.com/user-guide/quest/agent-mode)].

---

## 5. Desktop Integration

- **Native apps** for macOS 14+ (Apple Silicon & Intel) and Windows 10+ (64-bit). Linux is on the roadmap.
- System installers: macOS `.dmg`, Windows System/User `.exe`.
- Requires system permissions: Full Disk Access, Screen Recording, Accessibility, Microphone, Automation, Notifications, Location [[Quick Start](https://docs.qoder.com/qoderwork/quick-start), [Settings](https://docs.qoder.com/qoderwork/settings)].
- Optional **Secure Work Environment** runs tasks in an isolated local sandbox; files/data stay on device [[Settings](https://docs.qoder.com/qoderwork/settings)].
- Task history is **stored locally per device and does not sync across devices** [[Quick Start](https://docs.qoder.com/qoderwork/quick-start)].

---

## 6. Context & Retrieval

- **Local file access** scoped to explicitly authorized work directories; access outside requires permission.
- **Awareness memory** gives cross-session context (user profile, long-term memory, short-term conversation summaries).
- **Repo Wiki / Knowledge Engine** (in Qoder Desktop) parses up to 100,000 files, visualizes architecture, and auto-generates structured project docs [[Qoder Desktop page](https://qoder.com/desktop)].
- **App Snapshot** captures the frontmost app’s screenshot and readable text as conversation context [[Settings](https://docs.qoder.com/qoderwork/settings)].
- Files are not uploaded to the cloud; only task instructions and text content needed by the LLM are sent to the AI provider [[Introduction FAQ](https://docs.qoder.com/qoderwork/introduction)].

---

## 7. Extensibility (MCP / Tools / Skills)

QoderWork exposes four extension types [[Extension Publishing Guide](https://docs.qoder.com/qoderwork/skill-marketplace-guidelines)]:

| Type | What it is | Example |
|---|---|---|
| **Skill** | Atomic, reusable playbook (`SKILL.md` + optional references) | Generate PDF reports, organize folders |
| **Plugin / Expert Suite** | Role-centric package of Skills + connectors + role instructions | Super HR, Super Legal, Super PM |
| **Connector** | OAuth-enabled MCP server bridge to external SaaS | DingTalk, Notion, Slack, Linear, M365 |
| **Workbench** | Standalone vertical UI with state management | Valuation review, contract review |

### 7.1 Skills
- Stored in `~/.qoderwork/skills/`; discovered automatically.
- Can be triggered by natural language, `/` shortcut, `@` context, or explicit name.
- Built-in Skills: `docx`, `pdf`, `pptx`, `xlsx`, `find-skills`, `create-skill`, `plugin-creator`, etc.
- Skills can render interactive HTML UI components inline in chat [[Skills docs](https://docs.qoder.com/qoderwork/skills)].

### 7.2 Expert Kits
- Package multiple Skills, data connections, workflows, and output standards for team-wide rollout.
- Can be created via natural language, shared as `.zip`, or uploaded manually.
- Designed to standardize team workflows [[Expert Kits docs](https://docs.qoder.com/qoderwork/expert-kits)].

### 7.3 Connectors / MCP
- Connectors are managed under **Extensions → Connectors**.
- Built-ins: Browser, macOS native apps, Microsoft 365.
- Integration market includes DingTalk, Feishu, Notion, Linear, Todoist, Canva, Supabase, Vercel, Neon, Slack, Figma, Google Calendar, etc.
- All connectors remain inactive until explicitly enabled and authorized [[Connectors docs](https://docs.qoder.com/qoderwork/connectors)].

### 7.4 Hooks
- Agent execution hooks (PreToolUse, PostToolUse, SessionStart, Stop, etc.) run custom logic without modifying the app.
- Hook types: command, HTTP, prompt (LLM evaluation), agent (sub-agent verification).
- Used for blocking dangerous commands, auto-lint, notifications, and input/output interception [[Hooks docs](https://docs.qoder.com/en/cli/hooks)].

---

## 8. Security & Permissions Model

### 8.1 Permission Modes (from Qoder CLI, shared by the platform)
| Mode | Behavior |
|---|---|
| `default` | Safe reads auto; sensitive actions ask |
| `accept_edits` | Auto-approves file edits in working dirs; risky ops ask |
| `auto` | Zero prompts; safe reads/edits auto-approved; risky denied or AI-classified |
| `bypass_permissions` / `yolo` | Skips all prompts; trusted experiments only |
| `dont_ask` | Never prompts; actions needing approval are denied |

[[Permissions docs](https://docs.qoder.com/en/cli/permissions)]

### 8.2 Permission Rule Stack
Rules merge from 8 layers (lowest to highest priority):
1. `~/.qoder/settings.json` (user global)
2. `<project>/.qoder/settings.json` (project)
3. `<project>/.qoder/settings.local.json` (machine-local)
4. `--settings <path>` flag
5. `--allowed-tools` / `--disallowed-tools` CLI args
6. In-session `/allow`, `/deny` commands
7. Runtime session rules

Decision order: `deny` rules → tool safety checks → `ask` rules → `allow` rules / mode auto-allow.

### 8.3 Path & Bash Rules
- File rules use gitignore-style patterns (`/src/**`, `~/Documents/**`, `//etc/**`).
- Bash rules support exact commands, prefixes, and wildcards; destructive commands like `rm -rf` and `sudo` can be blocked.
- Protected paths (`.git`, `.ssh`, `.bashrc`, `.mcp.json`, etc.) require explicit approval or are denied in `auto` mode.

### 8.4 MCP Rules
- Fully qualified names: `mcp__<server>__<tool>`.
- Supports `mcp__github__*`, `mcp__github`, `mcp__*` patterns.

### 8.5 Hook-Based Enforcement
- `PreToolUse` hooks can return `permissionDecision: allow | deny | ask` and **override permission modes**—even `bypass_permissions`.
- `PermissionRequest` hooks can auto-allow/deny before prompting the user.

### 8.6 Sandbox for Dangerous Commands
- Experts Mode sandboxes potentially dangerous commands (file deletion, disk ops, permission/network changes).
- macOS uses Seatbelt; Windows uses a proprietary sandbox engine; Linux uses `bubblewrap`.
- Sandbox can access workspace dir only; sensitive paths like `~/.ssh` are invisible.
- Escalation out of the sandbox requires user approval [[Terminal and Sandbox docs](https://docs.qoder.com/user-guide/quest/terminal-and-sandbox)].

### 8.7 Privacy Claims
- File operations run locally; files are not uploaded.
- Only task instructions and text content needed by the LLM are sent to the AI provider.
- Granular folder/file-type permissions; user explicitly authorizes access [[Introduction FAQ](https://docs.qoder.com/qoderwork/introduction), [QoderWork.org](https://qoderwork.org/)].

---

## 9. Collaboration & Sharing

- **Skill sharing:** generate a time-limited share link from the Skills page; recipients install with one click [[Skills docs](https://docs.qoder.com/qoderwork/skills)].
- **Expert Kits:** package workflows and distribute as `.zip` or via marketplace for team-wide rollout [[Expert Kits docs](https://docs.qoder.com/qoderwork/expert-kits)].
- **Teams plan:** group-based permissions and billing management, shared credit pool [[Pricing page](https://qoder.com/pricing), [Docs pricing](https://docs.qoder.com/account/pricing)].
- **IM Channels:** bot integration into DingTalk/Feishu/Lark/WeChat/WeCom for chat-driven delegation [[UI Overview](https://docs.qoder.com/qoderwork/ui-overview)].

---

## 10. Pricing

- QoderWork shares the Qoder account and **Credits** balance.
- Individual plans: Community (free), Pro ($20/mo), Pro+ ($60/mo), Ultra ($200/mo).
- Paid plans include monthly credits for premium models; when exhausted, the account falls back to basic models with daily limits.
- Credit packs: $0.02/Credit, minimum 1,000, 1-month expiry, non-refundable.
- 14-day Pro trial with 300 credits for new sign-ins (not on VMs) [[Docs pricing](https://docs.qoder.com/account/pricing)].

---

## 11. Public Best Practices & Design Decisions

1. **Outcome-oriented prompts:** describe the desired result, not the steps.
2. **Spec is the lifeline of quality:** review the generated Spec early to avoid rework [[Qoder case study](https://qoder.com/blog/qoder-case-5-7team)].
3. **One Quest = one testable functional unit** for easy acceptance.
4. **Don’t skimp on Review:** humans focus on architecture/logic, AI focuses on details.
5. **Skills first, Expert Kits second:** validate a methodology as a Skill, then package it into an Expert Kit for team rollout [[Expert Kits docs](https://docs.qoder.com/qoderwork/expert-kits)].
6. **Local-first with cloud models:** file operations stay local; AI inference is cloud-hosted.
7. **Transparent execution:** Task Monitor shows every step; Computer Use shows screenshots + action descriptions before acting.

---

## 12. Limitations & Caveats

- **Platform:** macOS 14+ and Windows 10+ only; Linux roadmap unclear.
- **Connectivity:** requires internet for AI inference/planning; no offline model execution.
- **History sync:** task history is local to each device; does not sync across machines.
- **Credits expiry:** monthly credits do not roll over; credit packs expire in one month.
- **Computer Use risks:** screen content is captured, irreversible actions possible, CAPTCHA/2FA not handled.
- **Sandbox limitations:** Windows sandbox is user-mode and not a strong adversarial boundary; Linux needs `bubblewrap`; network filtering is coarse on/off.
- **Permissions are not a security panacea:** `bypass_permissions` mode disables prompts, and hooks are the recommended hard-policy enforcement point.

---

## Top 5 Findings Most Relevant to a Feature-Gap Comparison Against `hip`

1. **Mature desktop permission & sandbox model.** Qoder ships an 8-layer permission rule stack, per-mode automation (`default` → `accept_edits` → `auto` → `yolo`), protected paths, Bash path/rule syntax, MCP rule patterns, and OS-level sandboxing for dangerous commands. `hip` will need a similarly granular policy engine to compete on trust and autonomy.  
   *Sources:* [Permissions](https://docs.qoder.com/en/cli/permissions), [Terminal and Sandbox](https://docs.qoder.com/user-guide/quest/terminal-and-sandbox)

2. **First-class extensibility via Skills, Expert Kits, and MCP Connectors.** QoderWork treats Skills as declarative `SKILL.md` playbooks, Expert Kits as team-distributable role packages, and Connectors as OAuth MCP servers. `hip`’s Supervisor→Planner→Coder→Reviewer LangGraph pipeline could similarly expose role/config packs and MCP connectors rather than hard-coding agents.  
   *Sources:* [Skills](https://docs.qoder.com/qoderwork/skills), [Expert Kits](https://docs.qoder.com/qoderwork/expert-kits), [Connectors](https://docs.qoder.com/qoderwork/connectors), [Extension Publishing Guide](https://docs.qoder.com/qoderwork/skill-marketplace-guidelines)

3. **Desktop GUI/Computer Use integration.** Beyond file tools, QoderWork controls native apps via accessibility/screen-recording and browsers via a Chromium extension. `hip` currently targets code agents; adding Computer Use and browser connectors would significantly widen its task surface.  
   *Sources:* [Computer Use](https://docs.qoder.com/qoderwork/computer-use), [Connectors](https://docs.qoder.com/qoderwork/connectors)

4. **Built-in cross-session memory and collaboration style (Awareness).** QoderWork persists user profile, long/short-term memory, and `AGENTS.md`/`SOUL.md` style rules in `~/qoderwork/awareness/main`. `hip` could adopt equivalent persistent memory and per-project/user instruction files for continuity.  
   *Source:* [Awareness](https://docs.qoder.com/qoderwork/memory)

5. **Multi-agent expert orchestration with parallel sub-agents.** Qoder’s Experts Mode uses a Lead Agent + Researcher + Full-Stack Engineer + QA + Code Reviewer + UI Operator + Debug Engineer pattern. This is structurally similar to `hip`’s Supervisor→Planner→Coder→Reviewer but adds QA/UI/Debug roles and parallel execution. `hip` could broaden its pipeline with verification/UI/test agents and explicit parallel delegation.  
   *Source:* [Experts Mode](https://docs.qoder.com/user-guide/quest/experts-mode)
