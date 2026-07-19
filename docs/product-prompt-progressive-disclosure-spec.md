# Product Prompt Progressive Disclosure Spec

> Status: **approved for implementation**  
> Date: 2026-07-19  
> Plan: [`docs/product-prompt-progressive-disclosure-plan.md`](./product-prompt-progressive-disclosure-plan.md)  
> Baseline: `packages/sidecar/src/session/system-prompt.ts`, `packages/sidecar/src/session/product/*`  
> Comparators: Hermes (`HERMES_AGENT_HELP_GUIDANCE` + `hermes-agent` skill), pi (doc-path progressive read), hip skills L1→L2→L3

---

## 1. Problem

hip 已具备身份句 + 内置 `hip` product skill 的雏形，但仍有：

1. **指针空转** — `PRODUCT_HELP_GUIDANCE` 无条件要求 `use_skill("hip")`，但 skill 可能被预算 LRU 驱逐、被 `hip.toml` 禁用、或 external agent 清空 skills。
2. **L0 过薄** — 「你能干什么 / 密钥在哪 / 记忆默认？」常不 load skill 就瞎答。
3. **物化脆弱** — 仅比对 `.version` 字符串；用户改磁盘文件但不改 version 时，脏内容会残留。
4. **内容覆盖不全** — 缺 troubleshooting、agents/plugins 深度、app version。
5. **测试缺口** — ConfigManager 合并/禁用 builtin 未覆盖；pin 行为未测。
6. **双源漂移（中长期）** — `content.ts` 与 README/docs/UI 文案无单源约束。

---

## 2. Goals / Non-goals

### Goals

| ID | Goal |
|----|------|
| G1 | **可靠渐进披露**：L0 常驻短、L1 列表、L2 use_skill、L3 references；指针与 skill 存在性一致 |
| G2 | **Pin 产品 skill**：预算压力下优先保留 `hip`，避免「guidance 指向已驱逐 skill」 |
| G3 | **物化完整性**：内容指纹（version+hash）；文件被改则强制重写 |
| G4 | **L0 capability map**：不 load skill 也能答最常见 4–6 个产品事实 |
| G5 | **L3 补全**：troubleshooting + agents/plugins；注入 product version |
| G6 | **可测**：system-prompt / skillsBlock pin / materialize hash / ConfigManager merge·disable |

### Non-goals（本轮）

- 新建 `product_info` 专用 tool（除非 dogfood 证明 use_skill 命中率极低）
- 公开 docs 站 / 外链权威文档（Hermes 模式）
- 把整段 `BASE` 操作手册 skill 化（P2 另立）
- UI「关于/帮助」面板与 skill 同源渲染（P2）
- 从 `docs/product/*.md` 自动 codegen 进 content（P2 脚手架可预留，本轮不强制流水线）
- 改 external ACP agent 的 system prompt 策略

---

## 3. Baseline（不得无故破坏）

| 行为 | 说明 |
|------|------|
| Identity | 自称 hip；禁止冒充 Claude/ChatGPT/Gemini；不暴露底层模型名 |
| Skills L1–L3 | name+description → `use_skill` body → `references/` via `read_file` + skillDirs 放行 |
| Builtin merge | `mergeSkills(builtin, user)`；同 id 用户/项目/插件覆盖 builtin |
| Disable | `hip.toml` skills map 中 `hip: false` 时不注入 builtin |
| External agent | `ConfigManager` 清空 skills（保持） |
| Chat budget | skills block chat 默认 1500 chars（保持；pin 后仍可能截断 description） |
| ncc | 无松散 md 资源；内容嵌入 TS，运行时物化到磁盘 |

---

## 4. Disclosure model

```
┌─────────────────────────────────────────────────────────────┐
│ L0  Always in system prompt (main agent only)               │
│     IDENTITY + CAPABILITY_MAP + HELP_GUIDANCE (if skill on) │
│     ~0.4–0.8k chars                                          │
├─────────────────────────────────────────────────────────────┤
│ L1  ## Skills list (when hip in session skills)             │
│     name + description only; hip is pinned under budget     │
├─────────────────────────────────────────────────────────────┤
│ L2  use_skill({ name: "hip" }) → SKILL.md body              │
│     surfaces, modes, settings, tools overview, CLI          │
├─────────────────────────────────────────────────────────────┤
│ L3  read_file(absolute path under skill dir)                │
│     references/memory.md                                    │
│     references/config-and-data.md                           │
│     references/troubleshooting.md                           │
│     references/agents-and-plugins.md                        │
└─────────────────────────────────────────────────────────────┘
```

**Child / managed agents:** keep IDENTITY only (no product HELP_GUIDANCE). Product questions belong on the primary session.

---

## 5. Design

### 5.1 L0 — Identity + capability map + conditional guidance

**IDENTITY** (unchanged intent, wording may stay):

- You are hip, a desktop AI workbench agent…
- Never claim Claude / ChatGPT / Gemini / model maker

**PRODUCT_CAPABILITY_MAP** (always, main agent):

Compact bullets (English, model-facing):

- Desktop coding agent in the user's project (file tools, optional sub-agents)
- Surfaces: Chat (lighter) vs Code (full workbench)
- Permission modes: chat (read-only) / edit (default sandbox) / full (user-granted)
- API keys: `~/.hip/config/auth.json` (0600 plaintext by design)
- Cross-session memory: **off by default** (Settings → Memory)
- Product version: `HIP_PRODUCT_VERSION` (keep in sync with root `package.json` / `tauri.conf.json`)
- For deeper product help: see HELP_GUIDANCE

**HELP_GUIDANCE** (only when session skills include id or name `hip` and `use_skill` is expected available):

- On product questions → `use_skill({ name: "hip" })` then L3 as needed
- Do not invent UI labels; do not load hip skill for ordinary coding

**HELP_FALLBACK** (when hip skill not in session):

- Same topics answer from CAPABILITY_MAP only; say deeper guide is unavailable if skill disabled; never call `use_skill({ name: "hip" })`

### 5.2 L1 — Pin `hip` under skills budget

`skillsBlock` options:

```ts
pinnedIds?: string[]  // default includes HIP_SKILL_ID when building main prompt
```

Eviction rules:

1. Sort by least-used (existing LRU)
2. Evict **non-pinned** first
3. If still over budget and only pinned remain: allow evicting pinned (or empty block) — last resort so budget is never exceeded
4. Prefer keeping `hip` over other pinned ids if multiple pins appear later

Main `buildSystemPrompt` passes `pinnedIds: [HIP_SKILL_ID]` whenever skills are present (chat budget path especially).

### 5.3 L2/L3 content + materialization integrity

Files under `~/.hip/builtin-skills/hip/` (or `$HIP_DATA_DIR/builtin-skills/hip/`):

| Path | Role |
|------|------|
| `SKILL.md` | L2 product guide |
| `references/memory.md` | L3 memory |
| `references/config-and-data.md` | L3 paths / env |
| `references/troubleshooting.md` | L3 common failures |
| `references/agents-and-plugins.md` | L3 agents / plugins / MCP |
| `.stamp` | `version:hexFingerprint` |

**Fingerprint:** SHA-256 over `PRODUCT_SKILL_VERSION` + each file body (canonical order), truncated hex (16+ chars).

**ensureHipProductSkillDir():**

1. Compute expected fingerprint from embedded content
2. If `.stamp` matches **and** each on-disk file byte-equals expected → return dir
3. Else rewrite all files + stamp (force fix dirty disk)

Bump `PRODUCT_SKILL_VERSION` on any content change (human-readable); fingerprint catches drift even if version forgotten.

### 5.4 ConfigManager

Keep merge order:

```
builtin (enabled) → global/project (readEnabledSkills) → plugin skills
```

`enabled[hip] === false` → omit builtin hip.

When building system prompt, pass the **session** skills list so guidance conditioning matches tools.

### 5.5 Version constant

```ts
export const HIP_PRODUCT_VERSION = '0.1.0'
```

Comment: keep in sync with root `package.json` and `src-tauri/tauri.conf.json`.  
Optional later: single generated `version.ts` from build (P2).

### 5.6 Language

Model-facing English (matches existing system prompts). L2 may note: answer product questions in the user's language. No full bilingual duplicate of L2/L3 in this milestone.

---

## 6. Key Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| KD-1 | Keep use_skill progressive path; no new product tool | Reuse skillDirs + L3; less schema noise |
| KD-2 | Conditional HELP_GUIDANCE | Prevents empty use_skill calls |
| KD-3 | Pin hip in skills budget | Aligns L1 list with guidance |
| KD-4 | Content fingerprint + force rewrite | Fixes dirty `~/.hip/builtin-skills` |
| KD-5 | Always-on L0 capability map | Fixes high-frequency product FAQs without L2 |
| KD-6 | Main agent only for product guidance | Sub-agents stay task-focused |
| KD-7 | Version as hand-synced constant | Avoids ncc path fragility; document sync rule |
| KD-8 | P2 single-source under `docs/product/` + generate `content.ts` | Humans edit markdown; ncc still embeds TS; `--check` prevents drift |

---

## 7. Acceptance criteria

1. Main prompt always contains CAPABILITY_MAP keywords: auth.json, memory off, Chat/Code, permission modes, version.
2. When skills include hip → guidance mentions `use_skill({ name: "hip" })`; when not → no such call instruction.
3. With chat budget 1500 and many skills, `hip` remains in Skills block until only pinned left and still over budget.
4. Mutating on-disk SKILL.md without stamp change → next `ensureHipProductSkillDir` rewrites correct content.
5. ConfigManager loads hip builtin; disable via enabled map removes it; user skill same id overrides dir/description.
6. Existing system-prompt / skillsBlock tests still pass; new tests green.
7. L2 body references new L3 files; use_skill manifest lists them.

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| CAPABILITY_MAP grows and bloats every turn | Hard cap ~600 chars; review in PR |
| Pin keeps hip but starves other skills | Accept for product reliability; only one pin |
| Fingerprint CPU cost | Negligible (few KB strings) |
| Version constant drift | Spec + comment; optional CI check later |

---

## 9. Future (after P4)

- Live-LLM dogfood: measure actual `use_skill("hip"|"hip-coding")` call rate on a fixed Q set
- Hosted public docs site (optional); local `docs/product` remains SoT
- Full app zh-TW string parity with en/zh-CN (beyond product Help packs)
- Optional: locale-specific agent skill bodies (today agent stays English; UI is localized)

---

## 10. PR Plan

See plan doc for ordered implementation PRs. This milestone may land as **one PR** if the diff stays surgical; split only if review needs isolation.
