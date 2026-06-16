# MCP 服务器配置 + Skill 配置(+ ACP/CLI 模型回退) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置页新增 MCP 服务器配置与 Claude 式 Skill 配置(端到端可用),并停止向 ACP/CLI 外部智能体下推 hip 的模型/密钥。

**Architecture:** MCP 工具与 Skill 只挂在 hip **自有 ReAct 循环**(核心智能体 + 内部智能体)上——sidecar 维护常驻 MCP 客户端池(工具名 `mcp__<server>__<tool>`)并把工具合并进 `buildTools`;Skill 走 Claude 渐进式披露(系统提示注入 name/description + `use_skill` 按需读正文),并新增 **HITL 门控的 `run_script`** 使自带脚本能执行(复用既有 `permission:request/respond` 通道)。ACP/CLI 为外部进程,不接触这些工具,且不再接收模型配置。

**Tech Stack:** Tauri v2(Rust:`zip`+`serde_yaml`)/ React + TypeScript + Zustand + Radix UI + i18next / Node sidecar(LangGraph + LangChain + vitest)+ `@modelcontextprotocol/sdk`。配置文件落在 `~/.hip/config/`(`hip-mcp-servers.json`、`hip-skills.json`)与 `~/.hip/skills/`。

---

## 规格依据 & 决策

实现严格遵循已批准 spec:[`docs/superpowers/specs/2026-06-16-mcp-and-skills-config-design.md`](../specs/2026-06-16-mcp-and-skills-config-design.md)(10 条锁定决策)。共 53 个任务,分 8 个切片(切片 8 为 spec §C.4 的补全:内部智能体在编辑器里授权 use_skill/run_script/MCP 服务器)。

## 共享接口契约(贯穿所有任务,命名/签名一致)

- **Env 路径**:`HIP_MCP_SERVERS_PATH` → `~/.hip/config/hip-mcp-servers.json`;`HIP_SKILLS_DIR` → `~/.hip/skills`;`HIP_SKILLS_PATH` → `~/.hip/config/hip-skills.json`。
- **协议类型**:`McpTransport`、`McpServerConfig`、`McpServersConfig`、`SkillMeta`、`SkillsConfig`(`acceptsModelConfig`/`AgentAuthMode`/`authMode` 标 `@deprecated`,`boundModel` 保留给内部智能体)。
- **工具**:`use_skill({ name })`、`run_script({ command, reason? })`;`buildTools(root, spawnSubagent?, cwd?, dispatch?, opts?: { mcpTools?, skills?, requestApproval? })`;`ApprovalFn = (req:{title;kind;content?}) => Promise<{optionId}|{cancelled:true}>`。
- **sidecar**:`mcpManager.reconcile(servers)` / `mcpManager.tools()`;`readEnabledSkills()` / `readSkillBody(dir)` / `listSkillFiles(dir)`;`readMcpServersConfig()`。

## 推荐构建顺序

1. **切片 1(S0)** 协议类型 — 其它切片都依赖它的类型,先做。
2. **切片 2–3(MCP)** 与 **切片 4–5(Skill)** 可并行(Rust/前端/sidecar 各自独立;对 `paths.rs`/`lib.rs`/`sidecar.rs`/`SettingsPanel.tsx`/i18n 的改动是**附加式**的,互不冲突)。
3. **切片 6(核心接线)** 依赖 S2 的 `mcpManager`、S4 的 `readEnabledSkills` 与协议类型,放在 MCP/Skill 切片之后。
4. **切片 7(模型回退)** 基本独立,可随时做;它对 `session.ts` 的小改(外部 `model=null`)与核心接线对 `session.ts` 的装配改动是不同位置,按任务顺序应用即可。
5. **切片 8(内部智能体工具授权,§C.4 补全)** 依赖 S1 的 MCP 配置 store、S2 的 MCP 工具命名、S6 的核心接线(filterTools/buildTools),放在最后。

> 注:对 `paths.rs`/`lib.rs`/`sidecar.rs`/`SettingsPanel.tsx` 与三份 i18n 文件,MCP 与 Skill 切片各自附加内容(不同函数/命令/页面/键),按任务顺序套用不会冲突。

---

## Slice 1: Protocol types & deprecations

### Task 1: Add MCP + Skill shared types to the protocol package (TDD on the type contract)

**Files:**
- Create `packages/protocol/src/mcpSkills.contract.test.ts` (compile-time contract test for the new types)
- Modify `packages/protocol/src/index.ts` (append the new MCP + Skill type block immediately after the `AgentsConfig` declaration at line 61, before the `providerKeyEnv` function at line 63)

The vitest config (`vitest.config.ts`) includes `packages/protocol/src/**/*.test.ts`, so this test runs under `yarn test`. The protocol package is type-checked via the root `yarn type-check` (`tsc --noEmit` with `@hip/protocol` path-mapped). The existing protocol tests import from `'./index.js'` (e.g. `orchestration-types.test.ts`); match that exact import-extension style.

- [ ] **Step 1: Write the failing contract test.** This test imports the five new types and constructs representative values for each. Because the types don't exist yet, `tsc` (and vitest's esbuild transform under `isolatedModules`) will fail to resolve them. The runtime `expect`s also assert the shapes survive a JSON round-trip, so it doubles as a real test rather than a pure type assertion.

  Create `packages/protocol/src/mcpSkills.contract.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import type {
    McpTransport,
    McpServerConfig,
    McpServersConfig,
    SkillMeta,
    SkillsConfig,
  } from './index.js'

  describe('protocol: MCP server types', () => {
    it('accepts all three transports', () => {
      const transports: McpTransport[] = ['stdio', 'sse', 'http']
      expect(transports).toEqual(['stdio', 'sse', 'http'])
    })

    it('models a stdio server (command/args/env)', () => {
      const server: McpServerConfig = {
        id: 'srv-1',
        name: 'Local files',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: { FOO: 'bar' },
        enabled: true,
      }
      const round = JSON.parse(JSON.stringify(server)) as McpServerConfig
      expect(round.transport).toBe('stdio')
      expect(round.command).toBe('npx')
      expect(round.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp'])
      expect(round.env).toEqual({ FOO: 'bar' })
      expect(round.enabled).toBe(true)
    })

    it('models an sse/http server (url/headers)', () => {
      const server: McpServerConfig = {
        id: 'srv-2',
        name: 'Remote',
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer x' },
        enabled: false,
      }
      const round = JSON.parse(JSON.stringify(server)) as McpServerConfig
      expect(round.transport).toBe('http')
      expect(round.url).toBe('https://example.com/mcp')
      expect(round.headers).toEqual({ Authorization: 'Bearer x' })
      expect(round.enabled).toBe(false)
    })

    it('wraps servers in McpServersConfig', () => {
      const cfg: McpServersConfig = { servers: [] }
      expect(cfg.servers).toEqual([])
    })
  })

  describe('protocol: Skill types', () => {
    it('models SkillMeta', () => {
      const meta: SkillMeta = {
        id: 'pdf-tools',
        name: 'PDF Tools',
        description: 'Read and edit PDFs',
        dir: '/Users/me/.hip/skills/pdf-tools',
        hasScripts: true,
      }
      const round = JSON.parse(JSON.stringify(meta)) as SkillMeta
      expect(round.id).toBe('pdf-tools')
      expect(round.name).toBe('PDF Tools')
      expect(round.description).toBe('Read and edit PDFs')
      expect(round.dir).toBe('/Users/me/.hip/skills/pdf-tools')
      expect(round.hasScripts).toBe(true)
    })

    it('models SkillsConfig enabled map (missing id => enabled)', () => {
      const cfg: SkillsConfig = { enabled: { 'pdf-tools': false } }
      expect(cfg.enabled['pdf-tools']).toBe(false)
      // a missing id is treated as enabled at the read sites; the type only stores explicit overrides
      expect(cfg.enabled['other']).toBeUndefined()
    })
  })
  ```

- [ ] **Step 2: Run the test, expect FAIL.** The imported names don't exist yet, so the module fails to type-check / transform.
  - Run: `yarn vitest run packages/protocol/src/mcpSkills.contract.test.ts`
  - Expected: FAIL — esbuild/tsc errors like `Module '"./index.js"' has no exported member 'McpTransport'` (and the same for `McpServerConfig`, `McpServersConfig`, `SkillMeta`, `SkillsConfig`). Vitest reports the file as failed to collect; `Tests  no tests` / `Test Files  1 failed`.

- [ ] **Step 3: Add the new types to `index.ts`.** Insert the block immediately after the `AgentsConfig` interface (line 61), before the `providerKeyEnv` function (line 63). Match the existing doc-comment style (`/** ... */` above each exported symbol, inline `// ...` field notes).

  In `packages/protocol/src/index.ts`, find:
  ```ts
  export interface AgentsConfig { agents: AgentConfig[] }

  /** auth.json key name AND env var name for a provider's API key. Single source of the rule. */
  export function providerKeyEnv(providerID: string): string {
  ```
  Replace with:
  ```ts
  export interface AgentsConfig { agents: AgentConfig[] }

  // ──────────────────────────────────────────────────────────────────
  // MCP server config (persisted to ~/.hip/config/hip-mcp-servers.json)
  // ──────────────────────────────────────────────────────────────────

  /** Transport hip uses to reach an MCP server. */
  export type McpTransport = 'stdio' | 'sse' | 'http'

  /** One user-configured MCP server. stdio uses command/args/env; sse/http use url/headers. */
  export interface McpServerConfig {
    id: string                          // nanoid
    name: string                        // display name
    transport: McpTransport
    command?: string                    // stdio: executable (PATH name or absolute path)
    args?: string[]                     // stdio: launch args
    env?: Record<string, string>        // stdio: child-process env overrides
    url?: string                        // sse/http: endpoint URL
    headers?: Record<string, string>    // sse/http: request headers (e.g. Authorization)
    enabled: boolean
  }

  /** Durable MCP server config persisted to ~/.hip/config/hip-mcp-servers.json. */
  export interface McpServersConfig { servers: McpServerConfig[] }

  // ──────────────────────────────────────────────────────────────────
  // Skills (Claude-format SKILL.md folders under ~/.hip/skills)
  // ──────────────────────────────────────────────────────────────────

  /** One installed skill, scanned from ~/.hip/skills/<id>/SKILL.md frontmatter. */
  export interface SkillMeta {
    id: string                          // folder slug under ~/.hip/skills
    name: string                        // frontmatter `name`
    description: string                 // frontmatter `description`
    dir: string                         // absolute skill directory
    hasScripts: boolean                 // true iff the skill ships a scripts/ dir (run_script hint)
  }

  /** Skill enable/disable overrides, persisted to ~/.hip/config/hip-skills.json. A missing id is treated as enabled. */
  export interface SkillsConfig { enabled: Record<string, boolean> }

  /** auth.json key name AND env var name for a provider's API key. Single source of the rule. */
  export function providerKeyEnv(providerID: string): string {
  ```

- [ ] **Step 4: Run the test, expect PASS.**
  - Run: `yarn vitest run packages/protocol/src/mcpSkills.contract.test.ts`
  - Expected: PASS — 1 test file, 6 tests passed (4 MCP + 2 Skill). Output ends `Test Files  1 passed (1)` / `Tests  6 passed (6)`.

- [ ] **Step 5: Commit.**
  - Run: `git add packages/protocol/src/index.ts packages/protocol/src/mcpSkills.contract.test.ts && git commit -m "$(printf 'feat(protocol): add MCP + Skill shared config types\n\nMcpTransport/McpServerConfig/McpServersConfig and SkillMeta/SkillsConfig\nfor the MCP-server + Skill settings modules. Contract test asserts\nshapes and JSON round-trip.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`

---

### Task 2: Mark `acceptsModelConfig` / `AgentAuthMode` / `AgentConfig.authMode` as `@deprecated`

**Files:**
- Modify `packages/protocol/src/index.ts` (the `AgentAuthMode` type at line 38, the `acceptsModelConfig` field at line 51, and the `authMode` field at line 53 inside `AgentConfig`)

This is a doc-comment-only change: the types stay (old configs must still parse), but `@deprecated` tags signal that the ACP/CLI runtime now ignores them. `boundModel` is intentionally NOT touched — internal agents still use it. There is no runtime behavior to test here, so the verify step is a type-check plus a re-run of the Task 1 contract test as a regression guard.

- [ ] **Step 1: Deprecate `AgentAuthMode`.** In `packages/protocol/src/index.ts`, find:
  ```ts
  /** acp only: who supplies the model + API key to the external agent. */
  export type AgentAuthMode = 'hip-managed' | 'opencode-self'
  ```
  Replace with:
  ```ts
  /**
   * @deprecated Historical field only. ACP and CLI agents now self-manage their model
   * and API key; hip no longer pushes model config to external agents. Kept so old
   * hip-agents.json configs still parse — the value is ignored at runtime.
   * acp only (historically): who supplied the model + API key to the external agent.
   */
  export type AgentAuthMode = 'hip-managed' | 'opencode-self'
  ```

- [ ] **Step 2: Deprecate `acceptsModelConfig` and `authMode` inside `AgentConfig`.** In the same file, find:
  ```ts
    transport: AgentTransport
    acceptsModelConfig: boolean
    boundModel?: BoundModel             // required iff acceptsModelConfig and the user picked a model; internal: the agent's model (unset ⇒ global active)
    authMode?: AgentAuthMode            // acp only: who supplies the model+key (default 'opencode-self')
  ```
  Replace with:
  ```ts
    transport: AgentTransport
    /** @deprecated Historical field; ignored at runtime. ACP/CLI agents self-manage their model. Kept for back-compat with old configs. */
    acceptsModelConfig: boolean
    boundModel?: BoundModel             // internal agents only: the agent's model (unset ⇒ global active); ignored for acp/custom
    /** @deprecated Historical field; ignored at runtime. ACP/CLI agents self-manage model + auth. Kept for back-compat with old configs. */
    authMode?: AgentAuthMode            // acp only (historically): who supplied the model+key
  ```

- [ ] **Step 3: Type-check the whole repo, expect PASS.** `@deprecated` is informational and must not break compilation; this also confirms nothing in `src/` or `packages/sidecar` broke. (Existing references to `acceptsModelConfig`/`authMode` may now show deprecation hints in editors, but `tsc` does not error on use of deprecated symbols.)
  - Run: `yarn type-check`
  - Expected: PASS — `tsc --noEmit` exits 0 with no output. If any error surfaces it is a pre-existing issue unrelated to this comment-only change.

- [ ] **Step 4: Re-run the protocol contract test, expect PASS (regression guard).**
  - Run: `yarn vitest run packages/protocol/src/mcpSkills.contract.test.ts`
  - Expected: PASS — `Test Files  1 passed (1)` / `Tests  6 passed (6)`.

- [ ] **Step 5: Commit.**
  - Run: `git add packages/protocol/src/index.ts && git commit -m "$(printf 'docs(protocol): deprecate acceptsModelConfig/AgentAuthMode/authMode\n\nMark the external-agent model fields @deprecated ahead of the ACP/CLI\nmodel-pushdown rollback; types kept so old configs still parse, ignored\nat runtime. boundModel left intact for internal agents.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"`

## Slice 2: MCP config — Rust + frontend (settings page)

> **Dependency note:** This slice imports `McpTransport`, `McpServerConfig`, `McpServersConfig` from `@hip/protocol`. Those types are owned by the protocol slice. Build order mandates the protocol slice (Task 1) lands first, so those exports already exist. All Rust/Sidecar-env/SettingsPanel/i18n edits here are **additive** (new functions, new keys, new array entries) — the Skill slice adds siblings later without conflict.
>
> **i18n typing note:** `src/i18n/i18next.d.ts` declares `resources: typeof zhCN`, so the **type source for `t()` keys is `zh-CN`**. Every key referenced by `McpConfig.tsx` MUST exist in `src/i18n/zh-CN.ts` for `yarn type-check` to pass. Task 9 adds the keys to all three locale files (en, zh-CN, zh-TW) and runs before any component that uses them.


### Task 3: Rust — `mcp_servers_config_path` in paths.rs

**Files:** Modify `src-tauri/src/paths.rs` (add `mcp_servers_config_path` next to `agents_config_path`; additive)

- [ ] **Step 1: Add the path helper.** In `/Users/lijiamin/data/my-github/hip/src-tauri/src/paths.rs`, insert this immediately after the `agents_config_path` function (the block ending at line 49), i.e. between `agents_config_path` and `auth_json_path`:

  ```rust

  /// Canonical path of the MCP-servers registry inside `config/`.
  pub fn mcp_servers_config_path(app: &AppHandle) -> Option<PathBuf> {
      Some(config_dir(app)?.join("hip-mcp-servers.json"))
  }
  ```

- [ ] **Step 2: Verify it compiles.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip/src-tauri && cargo build 2>&1 | tail -5
  ```
  Expected: `Finished ... dev [unoptimized + debuginfo]` (no errors; an `unused function` warning for the new fn is acceptable — it's wired up next task).

- [ ] **Step 3: Commit.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && git add src-tauri/src/paths.rs && git commit -m "feat(tauri): mcp_servers_config_path -> ~/.hip/config/hip-mcp-servers.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Expected: one commit created.

---

### Task 4: Rust — `get_mcp_servers_config` / `set_mcp_servers_config` commands + register

**Files:** Modify `src-tauri/src/lib.rs` (add two commands mirroring `get/set_agents_config`; register both in `generate_handler!`; additive)

- [ ] **Step 1: Add the two commands.** In `/Users/lijiamin/data/my-github/hip/src-tauri/src/lib.rs`, immediately after the `set_agents_config` function (the block ending at line 113), insert:

  ```rust

  #[tauri::command]
  fn get_mcp_servers_config(app: tauri::AppHandle) -> Result<String, String> {
      match paths::mcp_servers_config_path(&app) {
          Some(p) => Ok(std::fs::read_to_string(&p).unwrap_or_default()),
          None => Ok(String::new()),
      }
  }

  #[tauri::command]
  fn set_mcp_servers_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
      let p = paths::mcp_servers_config_path(&app).ok_or("no config dir")?;
      std::fs::write(&p, json).map_err(|e| e.to_string())
  }
  ```

- [ ] **Step 2: Register both in `generate_handler!`.** In the same file, the handler list currently ends (lines 184–186) with:
  ```rust
            get_agents_config,
            set_agents_config
        ])
  ```
  Replace that with:
  ```rust
            get_agents_config,
            set_agents_config,
            get_mcp_servers_config,
            set_mcp_servers_config
        ])
  ```

- [ ] **Step 3: Verify it compiles.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip/src-tauri && cargo build 2>&1 | tail -5
  ```
  Expected: `Finished ... dev [unoptimized + debuginfo]` with no errors (the `unused function` warning from Task 3 should now be gone).

- [ ] **Step 4: Commit.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && git add src-tauri/src/lib.rs && git commit -m "feat(tauri): get/set_mcp_servers_config commands + register

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Expected: one commit created.

---

### Task 5: Rust — set `HIP_MCP_SERVERS_PATH` env on sidecar spawn

**Files:** Modify `src-tauri/src/sidecar.rs` (one additive env block in `spawn_sidecar`, mirroring `HIP_AGENTS_PATH`)

- [ ] **Step 1: Add the env wiring.** In `/Users/lijiamin/data/my-github/hip/src-tauri/src/sidecar.rs`, after the `HIP_AGENTS_PATH` block (lines 36–39), insert:

  ```rust
      // Point the sidecar at the MCP-servers registry (read fresh per turn for reconcile).
      if let Some(p) = crate::paths::mcp_servers_config_path(app) {
          cmd = cmd.env("HIP_MCP_SERVERS_PATH", p.to_string_lossy().into_owned());
      }
  ```

- [ ] **Step 2: Verify it compiles.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip/src-tauri && cargo build 2>&1 | tail -5
  ```
  Expected: `Finished ... dev [unoptimized + debuginfo]`, no errors.

- [ ] **Step 3: Commit.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && git add src-tauri/src/sidecar.rs && git commit -m "feat(tauri): set HIP_MCP_SERVERS_PATH env on sidecar spawn

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Expected: one commit created.

---

### Task 6: Frontend IPC — `src/ipc/mcpServersConfig.ts` (TDD)

**Files:** Create `src/ipc/mcpServersConfig.test.ts`, Create `src/ipc/mcpServersConfig.ts` (mirrors `ipc/agentsConfig.ts`)

- [ ] **Step 1: Write the failing test.** Create `/Users/lijiamin/data/my-github/hip/src/ipc/mcpServersConfig.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  const invoke = vi.fn()
  vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

  beforeEach(() => invoke.mockReset())

  describe('mcpServersConfig IPC', () => {
    it('getMcpServersConfig parses the file payload', async () => {
      const { getMcpServersConfig } = await import('./mcpServersConfig.js')
      invoke.mockResolvedValueOnce(
        JSON.stringify({ servers: [{ id: 's1', name: 'Files', transport: 'stdio', command: 'srv', args: [], enabled: true }] }),
      )
      const cfg = await getMcpServersConfig()
      expect(cfg.servers).toHaveLength(1)
      expect(cfg.servers[0]).toMatchObject({ id: 's1', transport: 'stdio' })
      expect(invoke).toHaveBeenCalledWith('get_mcp_servers_config')
    })
    it('getMcpServersConfig returns empty on blank/corrupt', async () => {
      const { getMcpServersConfig } = await import('./mcpServersConfig.js')
      invoke.mockResolvedValueOnce('')
      expect((await getMcpServersConfig()).servers).toEqual([])
      invoke.mockResolvedValueOnce('{ broken')
      expect((await getMcpServersConfig()).servers).toEqual([])
    })
    it('getMcpServersConfig returns empty when servers is not an array', async () => {
      const { getMcpServersConfig } = await import('./mcpServersConfig.js')
      invoke.mockResolvedValueOnce(JSON.stringify({ servers: 'nope' }))
      expect((await getMcpServersConfig()).servers).toEqual([])
    })
    it('setMcpServersConfig stringifies and invokes set_mcp_servers_config', async () => {
      const { setMcpServersConfig } = await import('./mcpServersConfig.js')
      invoke.mockResolvedValueOnce(undefined)
      await setMcpServersConfig({ servers: [] })
      expect(invoke).toHaveBeenCalledWith('set_mcp_servers_config', { json: JSON.stringify({ servers: [] }, null, 2) })
    })
  })
  ```

- [ ] **Step 2: Run the test, expect FAIL.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && yarn vitest run src/ipc/mcpServersConfig.test.ts
  ```
  Expected: FAIL — `Failed to resolve import "./mcpServersConfig.js"` (module does not exist yet).

- [ ] **Step 3: Create the implementation.** Create `/Users/lijiamin/data/my-github/hip/src/ipc/mcpServersConfig.ts`:

  ```ts
  import { invoke } from '@tauri-apps/api/core'
  import type { McpServersConfig } from '@hip/protocol'

  export async function getMcpServersConfig(): Promise<McpServersConfig> {
    const raw = await invoke<string>('get_mcp_servers_config')
    if (!raw.trim()) return { servers: [] }
    try {
      const parsed = JSON.parse(raw) as McpServersConfig
      return Array.isArray(parsed?.servers) ? parsed : { servers: [] }
    } catch {
      return { servers: [] }
    }
  }

  export async function setMcpServersConfig(cfg: McpServersConfig): Promise<void> {
    await invoke<void>('set_mcp_servers_config', { json: JSON.stringify(cfg, null, 2) })
  }
  ```

- [ ] **Step 4: Run the test, expect PASS.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && yarn vitest run src/ipc/mcpServersConfig.test.ts
  ```
  Expected: PASS — `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 5: Commit.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && git add src/ipc/mcpServersConfig.ts src/ipc/mcpServersConfig.test.ts && git commit -m "feat(ipc): mcpServersConfig get/set (mirror agentsConfig)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Expected: one commit created.

---

### Task 7: Pure helper — transport→required-fields validator (TDD)

**Files:** Create `src/lib/mcpServerDraft.test.ts`, Create `src/lib/mcpServerDraft.ts` (a small pure form helper the editor uses for `isValid` + building the config object)

- [ ] **Step 1: Write the failing test.** Create `/Users/lijiamin/data/my-github/hip/src/lib/mcpServerDraft.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { buildMcpDraft, isMcpDraftValid, mcpConfigToForm, type McpForm } from './mcpServerDraft'

  const base: McpForm = {
    name: 'My Server',
    transport: 'stdio',
    command: 'my-mcp',
    args: '--flag a',
    env: [{ key: 'TOKEN', value: 'x' }],
    url: '',
    headers: [],
    enabled: true,
  }

  describe('isMcpDraftValid', () => {
    it('stdio requires a name and a command', () => {
      expect(isMcpDraftValid(base)).toBe(true)
      expect(isMcpDraftValid({ ...base, command: '   ' })).toBe(false)
      expect(isMcpDraftValid({ ...base, name: '' })).toBe(false)
    })
    it('sse/http require a name and a url, not a command', () => {
      const sse: McpForm = { ...base, transport: 'sse', command: '', url: 'https://x/mcp' }
      expect(isMcpDraftValid(sse)).toBe(true)
      expect(isMcpDraftValid({ ...sse, url: '  ' })).toBe(false)
      const http: McpForm = { ...base, transport: 'http', command: '', url: 'https://x/mcp' }
      expect(isMcpDraftValid(http)).toBe(true)
    })
  })

  describe('buildMcpDraft', () => {
    it('stdio emits command/args/env, drops url/headers', () => {
      const d = buildMcpDraft(base)
      expect(d).toEqual({
        name: 'My Server',
        transport: 'stdio',
        command: 'my-mcp',
        args: ['--flag', 'a'],
        env: { TOKEN: 'x' },
        enabled: true,
      })
      expect('url' in d).toBe(false)
      expect('headers' in d).toBe(false)
    })
    it('sse/http emit url/headers, drop command/args/env', () => {
      const d = buildMcpDraft({
        ...base,
        transport: 'http',
        command: 'ignored',
        url: 'https://x/mcp',
        headers: [{ key: 'Authorization', value: 'Bearer t' }],
      })
      expect(d).toEqual({
        name: 'My Server',
        transport: 'http',
        url: 'https://x/mcp',
        headers: { Authorization: 'Bearer t' },
        enabled: true,
      })
      expect('command' in d).toBe(false)
    })
    it('omits empty env/headers maps and empty args', () => {
      const d = buildMcpDraft({ ...base, args: '   ', env: [{ key: '', value: '' }] })
      expect('args' in d).toBe(false)
      expect('env' in d).toBe(false)
    })
  })

  describe('mcpConfigToForm', () => {
    it('round-trips a stdio config back into editable form', () => {
      const f = mcpConfigToForm({
        id: 's1',
        name: 'My Server',
        transport: 'stdio',
        command: 'my-mcp',
        args: ['--flag', 'a'],
        env: { TOKEN: 'x' },
        enabled: false,
      })
      expect(f).toEqual({
        name: 'My Server',
        transport: 'stdio',
        command: 'my-mcp',
        args: '--flag a',
        env: [{ key: 'TOKEN', value: 'x' }],
        url: '',
        headers: [],
        enabled: false,
      })
    })
  })
  ```

- [ ] **Step 2: Run the test, expect FAIL.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && yarn vitest run src/lib/mcpServerDraft.test.ts
  ```
  Expected: FAIL — `Failed to resolve import "./mcpServerDraft"` (module does not exist yet).

- [ ] **Step 3: Create the implementation.** Create `/Users/lijiamin/data/my-github/hip/src/lib/mcpServerDraft.ts`:

  ```ts
  import type { McpServerConfig, McpTransport } from '@hip/protocol'

  export interface KvPair {
    key: string
    value: string
  }

  export interface McpForm {
    name: string
    transport: McpTransport
    command: string
    args: string
    env: KvPair[]
    url: string
    headers: KvPair[]
    enabled: boolean
  }

  export const EMPTY_MCP_FORM: McpForm = {
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    env: [],
    url: '',
    headers: [],
    enabled: true,
  }

  /** stdio needs a command; sse/http need a url. Name is always required. */
  export function isMcpDraftValid(f: McpForm): boolean {
    if (!f.name.trim()) return false
    if (f.transport === 'stdio') return f.command.trim().length > 0
    return f.url.trim().length > 0
  }

  /** Whitespace-split arg string into tokens; empty when blank. */
  function splitArgs(s: string): string[] {
    return s.trim() ? s.trim().split(/\s+/) : []
  }

  /** Collapse non-empty key/value pairs into a record; undefined when none. */
  function kvToRecord(pairs: KvPair[]): Record<string, string> | undefined {
    const out: Record<string, string> = {}
    for (const { key, value } of pairs) {
      const k = key.trim()
      if (k) out[k] = value
    }
    return Object.keys(out).length ? out : undefined
  }

  /** Form → the persisted McpServerConfig minus id (the store mints the id). */
  export function buildMcpDraft(f: McpForm): Omit<McpServerConfig, 'id'> {
    const base = { name: f.name.trim(), transport: f.transport, enabled: f.enabled }
    if (f.transport === 'stdio') {
      const args = splitArgs(f.args)
      const env = kvToRecord(f.env)
      return {
        ...base,
        command: f.command.trim(),
        ...(args.length ? { args } : {}),
        ...(env ? { env } : {}),
      }
    }
    const headers = kvToRecord(f.headers)
    return {
      ...base,
      url: f.url.trim(),
      ...(headers ? { headers } : {}),
    }
  }

  /** Existing config → editable form (inverse of buildMcpDraft). */
  export function mcpConfigToForm(c: McpServerConfig): McpForm {
    const toPairs = (r?: Record<string, string>): KvPair[] =>
      r ? Object.entries(r).map(([key, value]) => ({ key, value })) : []
    return {
      name: c.name,
      transport: c.transport,
      command: c.command ?? '',
      args: (c.args ?? []).join(' '),
      env: toPairs(c.env),
      url: c.url ?? '',
      headers: toPairs(c.headers),
      enabled: c.enabled,
    }
  }
  ```

- [ ] **Step 4: Run the test, expect PASS.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && yarn vitest run src/lib/mcpServerDraft.test.ts
  ```
  Expected: PASS — `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 5: Commit.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && git add src/lib/mcpServerDraft.ts src/lib/mcpServerDraft.test.ts && git commit -m "feat(lib): mcpServerDraft form helpers (validate + build + invert)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Expected: one commit created.

---

### Task 8: Store — `src/store/mcpServersStore.ts` (TDD, mirrors agentsStore)

**Files:** Create `src/store/mcpServersStore.test.ts`, Create `src/store/mcpServersStore.ts`

- [ ] **Step 1: Write the failing test.** Create `/Users/lijiamin/data/my-github/hip/src/store/mcpServersStore.test.ts`:

  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  const getMcpServersConfig = vi.fn()
  const setMcpServersConfig = vi.fn()
  vi.mock('@/ipc/mcpServersConfig', () => ({
    getMcpServersConfig: (...a: unknown[]) => getMcpServersConfig(...a),
    setMcpServersConfig: (...a: unknown[]) => setMcpServersConfig(...a),
  }))

  beforeEach(async () => {
    getMcpServersConfig.mockReset().mockResolvedValue({ servers: [] })
    setMcpServersConfig.mockReset().mockResolvedValue(undefined)
    const { useMcpServersStore } = await import('./mcpServersStore.js')
    useMcpServersStore.setState({ servers: [], loaded: false })
  })

  describe('mcpServersStore', () => {
    it('load() hydrates from the IPC config', async () => {
      getMcpServersConfig.mockResolvedValueOnce({
        servers: [{ id: 's1', name: 'Files', transport: 'stdio', command: 'srv', args: [], enabled: true }],
      })
      const { useMcpServersStore } = await import('./mcpServersStore.js')
      await useMcpServersStore.getState().load()
      expect(useMcpServersStore.getState().servers).toHaveLength(1)
      expect(useMcpServersStore.getState().loaded).toBe(true)
    })
    it('addServer mints an id and persists', async () => {
      const { useMcpServersStore } = await import('./mcpServersStore.js')
      await useMcpServersStore.getState().addServer({ name: 'Files', transport: 'stdio', command: 'srv', enabled: true })
      const servers = useMcpServersStore.getState().servers
      expect(servers).toHaveLength(1)
      expect(typeof servers[0].id).toBe('string')
      expect(servers[0]).toMatchObject({ name: 'Files', transport: 'stdio' })
      expect(setMcpServersConfig).toHaveBeenCalledWith({ servers: [expect.objectContaining({ name: 'Files' })] })
    })
    it('updateServer patches the matching server', async () => {
      const { useMcpServersStore } = await import('./mcpServersStore.js')
      await useMcpServersStore.getState().addServer({ name: 'X', transport: 'stdio', command: 'b', enabled: true })
      const id = useMcpServersStore.getState().servers[0].id
      await useMcpServersStore.getState().updateServer(id, { enabled: false })
      expect(useMcpServersStore.getState().servers[0].enabled).toBe(false)
    })
    it('removeServer drops it', async () => {
      const { useMcpServersStore } = await import('./mcpServersStore.js')
      await useMcpServersStore.getState().addServer({ name: 'X', transport: 'stdio', command: 'b', enabled: true })
      const id = useMcpServersStore.getState().servers[0].id
      await useMcpServersStore.getState().removeServer(id)
      expect(useMcpServersStore.getState().servers).toHaveLength(0)
    })
  })
  ```

- [ ] **Step 2: Run the test, expect FAIL.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && yarn vitest run src/store/mcpServersStore.test.ts
  ```
  Expected: FAIL — `Failed to resolve import "./mcpServersStore.js"` (module does not exist yet).

- [ ] **Step 3: Create the implementation.** Create `/Users/lijiamin/data/my-github/hip/src/store/mcpServersStore.ts`:

  ```ts
  import { create } from 'zustand'
  import { nanoid } from 'nanoid'
  import type { McpServerConfig } from '@hip/protocol'
  import { getMcpServersConfig, setMcpServersConfig } from '@/ipc/mcpServersConfig'

  interface McpServersStore {
    servers: McpServerConfig[]
    loaded: boolean
    load: () => Promise<void>
    addServer: (s: Omit<McpServerConfig, 'id'>) => Promise<void>
    updateServer: (id: string, patch: Partial<McpServerConfig>) => Promise<void>
    removeServer: (id: string) => Promise<void>
  }

  export const useMcpServersStore = create<McpServersStore>((set, get) => ({
    servers: [],
    loaded: false,
    load: async () => {
      const cfg = await getMcpServersConfig()
      set({ servers: cfg.servers, loaded: true })
    },
    addServer: async (s) => {
      const next = [...get().servers, { ...s, id: nanoid() }]
      await setMcpServersConfig({ servers: next })
      set({ servers: next })
    },
    updateServer: async (id, patch) => {
      const next = get().servers.map((x) => (x.id === id ? { ...x, ...patch } : x))
      await setMcpServersConfig({ servers: next })
      set({ servers: next })
    },
    removeServer: async (id) => {
      const next = get().servers.filter((x) => x.id !== id)
      await setMcpServersConfig({ servers: next })
      set({ servers: next })
    },
  }))
  ```

- [ ] **Step 4: Run the test, expect PASS.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && yarn vitest run src/store/mcpServersStore.test.ts
  ```
  Expected: PASS — `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 5: Commit.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && git add src/store/mcpServersStore.ts src/store/mcpServersStore.test.ts && git commit -m "feat(store): mcpServersStore CRUD (mirror agentsStore)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Expected: one commit created.

---

### Task 9: i18n — `settings.mcpLabel` + `settings.mcp.*` keys (en, zh-CN, zh-TW)

**Files:** Modify `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts` (additive — add a `mcpLabel` line and an `mcp` block right before the existing `agentsLabel` line in each file)

> `i18next.d.ts` types `t()` against `typeof zhCN`, so **zh-CN is the type source** — its keys MUST be a superset of everything `McpConfig.tsx` references. Adding the block to all three files keeps runtime + type-check consistent. The `agentsLabel:` line sits at line 239 in all three files.

- [ ] **Step 1: Add the English keys.** In `/Users/lijiamin/data/my-github/hip/src/i18n/en.ts`, locate the `agentsLabel: 'Agent Management',` line (line 239). Immediately **before** that line, insert:

  ```ts
      mcpLabel: 'MCP Servers',
      mcp: {
        title: 'MCP Servers',
        intro: 'Connect Model Context Protocol servers. Their tools are merged into the hip agent (and internal agents you allow). External (ACP/CLI) agents do not use them.',
        add: 'Add server',
        empty: 'No MCP servers yet. Add one to extend hip with external tools.',
        editTitle: 'Edit MCP server',
        addTitle: 'Add MCP server',
        name: 'Name',
        namePlaceholder: 'My MCP server',
        sectionTransport: 'Transport',
        transportStdio: 'stdio',
        transportStdioDesc: 'Launch a local process and talk over stdin/stdout.',
        transportSse: 'SSE',
        transportSseDesc: 'Connect to a remote server over Server-Sent Events.',
        transportHttp: 'HTTP',
        transportHttpDesc: 'Connect to a remote server over streamable HTTP.',
        sectionCommand: 'Command',
        command: 'Command',
        commandPlaceholder: '/usr/local/bin/my-mcp',
        args: 'Arguments',
        argsPlaceholder: '--port 1234',
        env: 'Environment variables',
        sectionConnection: 'Connection',
        url: 'URL',
        urlPlaceholder: 'https://example.com/mcp',
        headers: 'Headers',
        keyPlaceholder: 'KEY',
        valuePlaceholder: 'value',
        addPair: 'Add',
        removePair: 'Remove',
        remoteNote: 'Remote servers receive your tool-call context. Only add servers you trust.',
        enableThis: 'Enabled',
        edit: 'Edit',
        delete: 'Delete',
        cancel: 'Cancel',
        save: 'Save',
        menuMore: 'More',
        error: 'Action failed. Please try again.',
        deleteConfirmTitle: 'Delete "{{name}}"?',
        deleteConfirmBody: 'This removes the MCP server configuration. It can be added again later.',
      },
  ```

- [ ] **Step 2: Add the Simplified-Chinese keys.** In `/Users/lijiamin/data/my-github/hip/src/i18n/zh-CN.ts`, immediately **before** the `agentsLabel: '智能体管理',` line (line 239), insert:

  ```ts
      mcpLabel: 'MCP 服务器',
      mcp: {
        title: 'MCP 服务器',
        intro: '接入 Model Context Protocol 服务器,其工具会合并进 hip 主智能体(以及你授权的内部智能体)。外部(ACP/CLI)智能体不使用它们。',
        add: '添加服务器',
        empty: '还没有 MCP 服务器。添加一个以扩展 hip 的外部工具。',
        editTitle: '编辑 MCP 服务器',
        addTitle: '添加 MCP 服务器',
        name: '名称',
        namePlaceholder: '我的 MCP 服务器',
        sectionTransport: '传输方式',
        transportStdio: 'stdio',
        transportStdioDesc: '启动本地进程,通过 stdin/stdout 通信。',
        transportSse: 'SSE',
        transportSseDesc: '通过 Server-Sent Events 连接远程服务器。',
        transportHttp: 'HTTP',
        transportHttpDesc: '通过 streamable HTTP 连接远程服务器。',
        sectionCommand: '命令',
        command: '命令',
        commandPlaceholder: '/usr/local/bin/my-mcp',
        args: '参数',
        argsPlaceholder: '--port 1234',
        env: '环境变量',
        sectionConnection: '连接',
        url: '地址',
        urlPlaceholder: 'https://example.com/mcp',
        headers: '请求头',
        keyPlaceholder: 'KEY',
        valuePlaceholder: '值',
        addPair: '添加',
        removePair: '删除',
        remoteNote: '远程服务器会收到你的工具调用上下文。仅添加你信任的服务器。',
        enableThis: '启用',
        edit: '编辑',
        delete: '删除',
        cancel: '取消',
        save: '保存',
        menuMore: '更多',
        error: '操作失败,请重试。',
        deleteConfirmTitle: '删除「{{name}}」?',
        deleteConfirmBody: '这会移除该 MCP 服务器配置。之后可以重新添加。',
      },
  ```

- [ ] **Step 3: Add the Traditional-Chinese keys.** In `/Users/lijiamin/data/my-github/hip/src/i18n/zh-TW.ts`, immediately **before** the `agentsLabel: '智能體管理',` line (line 239), insert:

  ```ts
      mcpLabel: 'MCP 伺服器',
      mcp: {
        title: 'MCP 伺服器',
        intro: '接入 Model Context Protocol 伺服器,其工具會合併進 hip 主智能體(以及你授權的內部智能體)。外部(ACP/CLI)智能體不使用它們。',
        add: '新增伺服器',
        empty: '還沒有 MCP 伺服器。新增一個以擴充 hip 的外部工具。',
        editTitle: '編輯 MCP 伺服器',
        addTitle: '新增 MCP 伺服器',
        name: '名稱',
        namePlaceholder: '我的 MCP 伺服器',
        sectionTransport: '傳輸方式',
        transportStdio: 'stdio',
        transportStdioDesc: '啟動本機程序,透過 stdin/stdout 通訊。',
        transportSse: 'SSE',
        transportSseDesc: '透過 Server-Sent Events 連接遠端伺服器。',
        transportHttp: 'HTTP',
        transportHttpDesc: '透過 streamable HTTP 連接遠端伺服器。',
        sectionCommand: '命令',
        command: '命令',
        commandPlaceholder: '/usr/local/bin/my-mcp',
        args: '參數',
        argsPlaceholder: '--port 1234',
        env: '環境變數',
        sectionConnection: '連線',
        url: '位址',
        urlPlaceholder: 'https://example.com/mcp',
        headers: '請求標頭',
        keyPlaceholder: 'KEY',
        valuePlaceholder: '值',
        addPair: '新增',
        removePair: '刪除',
        remoteNote: '遠端伺服器會收到你的工具呼叫上下文。僅新增你信任的伺服器。',
        enableThis: '啟用',
        edit: '編輯',
        delete: '刪除',
        cancel: '取消',
        save: '儲存',
        menuMore: '更多',
        error: '操作失敗,請重試。',
        deleteConfirmTitle: '刪除「{{name}}」?',
        deleteConfirmBody: '這會移除該 MCP 伺服器設定。之後可以重新新增。',
      },
  ```

- [ ] **Step 4: Type-check (the i18n files are `as const`-typed; `zh-CN` is the resource type source, so any key drift surfaces here).**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && yarn type-check
  ```
  Expected: exits 0, no errors.

- [ ] **Step 5: Commit.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts && git commit -m "i18n: settings.mcpLabel + settings.mcp.* (en/zh-CN/zh-TW)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Expected: one commit created.

---

### Task 10: UI — `McpConfig.tsx` (list + cards) and `McpServerEditor` modal

**Files:** Create `src/components/account/McpConfig.tsx` (contains `McpConfig`, the per-server row, the `McpServerEditor` modal, and an inline delete-confirm dialog — all mirroring `AgentManagement` / `AgentCard` / `AgentEditor` / `DeleteAgentDialog`)

- [ ] **Step 1: Create the component file.** Create `/Users/lijiamin/data/my-github/hip/src/components/account/McpConfig.tsx`:

  ```tsx
  import { useEffect, useState } from 'react'
  import { useTranslation } from 'react-i18next'
  import { Plug, Plus, Pencil, Trash2, MoreVertical, Check, X } from 'lucide-react'
  import type { McpServerConfig } from '@hip/protocol'
  import { useMcpServersStore } from '@/store/mcpServersStore'
  import { cn } from '@/lib/utils'
  import { Modal } from '@/components/ui/Modal'
  import { Button } from '@/components/ui/Button'
  import { Switch } from '@/components/ui/Switch'
  import { Badge } from '@/components/ui/Badge'
  import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
  } from '@/components/ui/DropdownMenu'
  import {
    buildMcpDraft,
    isMcpDraftValid,
    mcpConfigToForm,
    EMPTY_MCP_FORM,
    type McpForm,
    type KvPair,
  } from '@/lib/mcpServerDraft'

  const inputCls =
    'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

  type Editing = { mode: 'add' } | { mode: 'edit'; server: McpServerConfig } | null

  export function McpConfig() {
    const { t } = useTranslation()
    const { servers, loaded, load, addServer, updateServer, removeServer } = useMcpServersStore()
    const [editing, setEditing] = useState<Editing>(null)
    const [deleting, setDeleting] = useState<McpServerConfig | null>(null)

    useEffect(() => {
      if (!loaded) void load()
    }, [loaded, load])

    return (
      <div className="p-6">
        <h2 className="text-title font-semibold text-ink">{t('settings.mcp.title')}</h2>
        <p className="mt-1 text-body text-ink-secondary">{t('settings.mcp.intro')}</p>

        <div className="mt-5 space-y-2">
          {servers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-5 text-center text-meta text-ink-tertiary">
              {t('settings.mcp.empty')}
            </div>
          ) : (
            servers.map((s) => (
              <McpServerRow
                key={s.id}
                server={s}
                onToggle={(enabled) => void updateServer(s.id, { enabled })}
                onEdit={() => setEditing({ mode: 'edit', server: s })}
                onDelete={() => setDeleting(s)}
              />
            ))
          )}
          <button
            onClick={() => setEditing({ mode: 'add' })}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-3 text-body font-medium text-accent-strong transition-colors hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Plus size={15} /> {t('settings.mcp.add')}
          </button>
        </div>

        {editing && (
          <McpServerEditor
            initial={editing.mode === 'edit' ? editing.server : null}
            onCancel={() => setEditing(null)}
            onSave={async (draft) => {
              if (editing.mode === 'edit') await updateServer(editing.server.id, draft)
              else await addServer(draft)
              setEditing(null)
            }}
          />
        )}

        {deleting && (
          <DeleteServerDialog
            server={deleting}
            onCancel={() => setDeleting(null)}
            onConfirm={() => {
              void removeServer(deleting.id)
              setDeleting(null)
            }}
          />
        )}
      </div>
    )
  }

  function McpServerRow({
    server,
    onToggle,
    onEdit,
    onDelete,
  }: {
    server: McpServerConfig
    onToggle: (enabled: boolean) => void
    onEdit: () => void
    onDelete: () => void
  }) {
    const { t } = useTranslation()
    const transportLabel =
      server.transport === 'stdio'
        ? t('settings.mcp.transportStdio')
        : server.transport === 'sse'
          ? t('settings.mcp.transportSse')
          : t('settings.mcp.transportHttp')
    const detail =
      server.transport === 'stdio' ? [server.command, ...(server.args ?? [])].join(' ') : (server.url ?? '')
    return (
      <div className="flex items-center gap-3.5 rounded-lg border border-border bg-surface px-4 py-3.5">
        <span
          className={cn(
            'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong',
            !server.enabled && 'opacity-60',
          )}
        >
          <Plug size={18} />
        </span>
        <div className={cn('min-w-0 flex-1', !server.enabled && 'opacity-60')}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-medium text-ink">{server.name}</span>
            <Badge>{transportLabel}</Badge>
          </div>
          <div className="mt-1 truncate font-mono text-caption text-ink-tertiary">{detail}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <Switch checked={server.enabled} onCheckedChange={onToggle} ariaLabel={t('settings.mcp.enableThis')} />
          {/* modal={false}: a modal menu + the dialog its items open both lock `body { pointer-events: none }`;
              stacking them leaves the lock stuck after the dialog closes (see AgentCard). */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                aria-label={t('settings.mcp.menuMore')}
              >
                <MoreVertical size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil size={14} /> {t('settings.mcp.edit')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-danger focus:bg-danger/10" onSelect={onDelete}>
                <Trash2 size={14} /> {t('settings.mcp.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    )
  }

  function McpServerEditor({
    initial,
    onSave,
    onCancel,
  }: {
    initial: McpServerConfig | null
    onSave: (draft: Omit<McpServerConfig, 'id'>) => Promise<void>
    onCancel: () => void
  }) {
    const { t } = useTranslation()
    const [form, setForm] = useState<McpForm>(initial ? mcpConfigToForm(initial) : EMPTY_MCP_FORM)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const patch = (p: Partial<McpForm>) => setForm((f) => ({ ...f, ...p }))
    const isStdio = form.transport === 'stdio'

    const submit = async () => {
      setBusy(true)
      setError(null)
      try {
        await onSave(buildMcpDraft(form))
      } catch {
        setError(t('settings.mcp.error'))
      } finally {
        setBusy(false)
      }
    }

    return (
      <Modal
        open
        onOpenChange={(o) => {
          if (!o) onCancel()
        }}
        title={initial ? t('settings.mcp.editTitle') : t('settings.mcp.addTitle')}
      >
        <div className="flex flex-col">
          <div className="space-y-5 p-5">
            <Field label={t('settings.mcp.name')}>
              <input className={inputCls} value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t('settings.mcp.namePlaceholder')} />
            </Field>

            <Section label={t('settings.mcp.sectionTransport')}>
              <div role="radiogroup" aria-label={t('settings.mcp.sectionTransport')} className="flex gap-2">
                <ChoiceCard selected={form.transport === 'stdio'} title={t('settings.mcp.transportStdio')} desc={t('settings.mcp.transportStdioDesc')} onClick={() => patch({ transport: 'stdio' })} />
                <ChoiceCard selected={form.transport === 'sse'} title={t('settings.mcp.transportSse')} desc={t('settings.mcp.transportSseDesc')} onClick={() => patch({ transport: 'sse' })} />
                <ChoiceCard selected={form.transport === 'http'} title={t('settings.mcp.transportHttp')} desc={t('settings.mcp.transportHttpDesc')} onClick={() => patch({ transport: 'http' })} />
              </div>
            </Section>

            {isStdio ? (
              <Section label={t('settings.mcp.sectionCommand')}>
                <Field label={t('settings.mcp.command')}>
                  <input className={cn(inputCls, 'font-mono')} value={form.command} onChange={(e) => patch({ command: e.target.value })} placeholder={t('settings.mcp.commandPlaceholder')} />
                </Field>
                <Field label={t('settings.mcp.args')}>
                  <input className={cn(inputCls, 'font-mono')} value={form.args} onChange={(e) => patch({ args: e.target.value })} placeholder={t('settings.mcp.argsPlaceholder')} />
                </Field>
                <Field label={t('settings.mcp.env')}>
                  <KvEditor pairs={form.env} onChange={(env) => patch({ env })} />
                </Field>
              </Section>
            ) : (
              <Section label={t('settings.mcp.sectionConnection')}>
                <Field label={t('settings.mcp.url')}>
                  <input className={cn(inputCls, 'font-mono')} value={form.url} onChange={(e) => patch({ url: e.target.value })} placeholder={t('settings.mcp.urlPlaceholder')} />
                </Field>
                <Field label={t('settings.mcp.headers')}>
                  <KvEditor pairs={form.headers} onChange={(headers) => patch({ headers })} />
                </Field>
                <div className="text-caption text-ink-tertiary">{t('settings.mcp.remoteNote')}</div>
              </Section>
            )}

            {error && <div className="text-meta text-danger">{error}</div>}
          </div>

          <div className="flex items-center gap-2 border-t border-border bg-surface-subtle px-5 py-3">
            <div className="flex flex-1 items-center gap-2">
              <Switch checked={form.enabled} onCheckedChange={(v) => patch({ enabled: v })} ariaLabel={t('settings.mcp.enableThis')} />
              <span className="text-body text-ink-secondary">{t('settings.mcp.enableThis')}</span>
            </div>
            <Button variant="outline" size="sm" onClick={onCancel}>
              {t('settings.mcp.cancel')}
            </Button>
            <Button variant="primary" size="sm" disabled={busy || !isMcpDraftValid(form)} onClick={() => void submit()}>
              {t('settings.mcp.save')}
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  function DeleteServerDialog({
    server,
    onConfirm,
    onCancel,
  }: {
    server: McpServerConfig
    onConfirm: () => void
    onCancel: () => void
  }) {
    const { t } = useTranslation()
    return (
      <Modal
        open
        onOpenChange={(o) => {
          if (!o) onCancel()
        }}
        title={t('settings.mcp.deleteConfirmTitle', { name: server.name })}
        className="max-w-sm"
      >
        <div className="p-5">
          <p className="text-body text-ink-secondary">{t('settings.mcp.deleteConfirmBody')}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>
              {t('settings.mcp.cancel')}
            </Button>
            <Button variant="danger" size="sm" onClick={onConfirm}>
              {t('settings.mcp.delete')}
            </Button>
          </div>
        </div>
      </Modal>
    )
  }

  function KvEditor({ pairs, onChange }: { pairs: KvPair[]; onChange: (pairs: KvPair[]) => void }) {
    const { t } = useTranslation()
    const setAt = (i: number, p: Partial<KvPair>) => onChange(pairs.map((kv, idx) => (idx === i ? { ...kv, ...p } : kv)))
    const removeAt = (i: number) => onChange(pairs.filter((_, idx) => idx !== i))
    const add = () => onChange([...pairs, { key: '', value: '' }])
    return (
      <div className="space-y-2">
        {pairs.map((kv, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={cn(inputCls, 'font-mono')} value={kv.key} onChange={(e) => setAt(i, { key: e.target.value })} placeholder={t('settings.mcp.keyPlaceholder')} />
            <input className={cn(inputCls, 'font-mono')} value={kv.value} onChange={(e) => setAt(i, { value: e.target.value })} placeholder={t('settings.mcp.valuePlaceholder')} />
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={t('settings.mcp.removePair')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <X size={15} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-accent-strong transition-colors hover:bg-accent-subtle"
        >
          <Plus size={13} /> {t('settings.mcp.addPair')}
        </button>
      </div>
    )
  }

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div>
        <label className="mb-1.5 block text-meta text-ink-tertiary">{label}</label>
        {children}
      </div>
    )
  }

  function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div>
        <div className="mb-2 text-caption font-medium uppercase tracking-wide text-ink-tertiary">{label}</div>
        <div className="space-y-2">{children}</div>
      </div>
    )
  }

  function ChoiceCard({
    selected,
    title,
    desc,
    onClick,
  }: {
    selected: boolean
    title: string
    desc: string
    onClick: () => void
  }) {
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onClick}
        className={cn(
          'flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          selected ? 'border-accent bg-accent-subtle' : 'border-border hover:bg-surface-muted',
        )}
      >
        <div className="flex items-center justify-between">
          <span className={cn('text-body font-medium', selected ? 'text-accent-strong' : 'text-ink')}>{title}</span>
          <span
            className={cn(
              'flex h-4 w-4 items-center justify-center rounded-full border',
              selected ? 'border-accent bg-accent text-white' : 'border-border',
            )}
          >
            {selected && <Check size={11} />}
          </span>
        </div>
        <div className={cn('mt-1 text-caption', selected ? 'text-accent-strong/80' : 'text-ink-tertiary')}>{desc}</div>
      </button>
    )
  }
  ```

- [ ] **Step 2: Type-check (no separate test for the view component; the store + draft helper carry the logic tests). `DropdownMenuSeparator` is exported by `@/components/ui/DropdownMenu` and used by `AgentCard.tsx`, so the imports resolve.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && yarn type-check
  ```
  Expected: exits 0, no errors.

- [ ] **Step 3: Commit.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && git add src/components/account/McpConfig.tsx && git commit -m "feat(ui): McpConfig settings page (list + editor + delete dialog)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Expected: one commit created.

---

### Task 11: Register the `mcp` page in `SettingsPanel.tsx`

**Files:** Modify `src/components/account/SettingsPanel.tsx` (import `McpConfig` + `Plug`; add one entry to the `PAGES` array — additive; the Skill slice appends another entry later)

- [ ] **Step 1: Add the import for the icon.** In `/Users/lijiamin/data/my-github/hip/src/components/account/SettingsPanel.tsx`, change the lucide import (line 5):

  Replace:
  ```tsx
  import { SlidersHorizontal, Cpu, Bot } from 'lucide-react'
  ```
  with:
  ```tsx
  import { SlidersHorizontal, Cpu, Bot, Plug } from 'lucide-react'
  ```

- [ ] **Step 2: Add the `McpConfig` import.** After the `AgentManagement` import (line 10), insert:

  ```tsx
  import { McpConfig } from './McpConfig'
  ```

- [ ] **Step 3: Add the page entry.** Change the `PAGES` array (lines 12–16). Replace:

  ```tsx
  const PAGES = [
    { id: 'general', icon: SlidersHorizontal, labelKey: 'settings.general', Component: GeneralSettings },
    { id: 'model', icon: Cpu, labelKey: 'settings.model', Component: ModelConfig },
    { id: 'agents', icon: Bot, labelKey: 'settings.agentsLabel', Component: AgentManagement },
  ] as const
  ```
  with:
  ```tsx
  const PAGES = [
    { id: 'general', icon: SlidersHorizontal, labelKey: 'settings.general', Component: GeneralSettings },
    { id: 'model', icon: Cpu, labelKey: 'settings.model', Component: ModelConfig },
    { id: 'agents', icon: Bot, labelKey: 'settings.agentsLabel', Component: AgentManagement },
    { id: 'mcp', icon: Plug, labelKey: 'settings.mcpLabel', Component: McpConfig },
  ] as const
  ```

- [ ] **Step 4: Type-check + build.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && yarn type-check && yarn build
  ```
  Expected: type-check exits 0; `tsc && vite build` completes with `✓ built in ...` and no errors.

- [ ] **Step 5: Commit.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && git add src/components/account/SettingsPanel.tsx && git commit -m "feat(ui): register MCP page in settings nav

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Expected: one commit created.

---

### Task 12: Slice verification — full paid-free test run + Rust tests

**Files:** none (verification + final commit if anything pending)

- [ ] **Step 1: Run the new frontend tests as a scoped set (avoids the `vitest run src …` paid-suite substring trap — explicit file paths only).**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && yarn vitest run src/ipc/mcpServersConfig.test.ts src/lib/mcpServerDraft.test.ts src/store/mcpServersStore.test.ts
  ```
  Expected: `Test Files  3 passed (3)`, `Tests  16 passed (16)` (4 + 8 + 4).

- [ ] **Step 2: Full paid-free suite.** Per memory, move `auth.json` aside so no real-LLM suite fires (vitest.setup.ts re-seeds keys from `~/.hip/config/auth.json`, so `env -u` alone is insufficient), run the full suite, then restore.

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && ( [ -f ~/.hip/config/auth.json ] && mv ~/.hip/config/auth.json ~/.hip/config/auth.json.bak || true ) ; yarn test ; rc=$? ; ( [ -f ~/.hip/config/auth.json.bak ] && mv ~/.hip/config/auth.json.bak ~/.hip/config/auth.json || true ) ; exit $rc
  ```
  Expected: all test files pass; the real-LLM suites report `skipped` (no API keys present); overall exit 0.

- [ ] **Step 3: Rust unit tests (paths.rs tests still green).**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip/src-tauri && cargo test 2>&1 | tail -15
  ```
  Expected: `test result: ok.` for the paths/sidecar test modules; no failures.

- [ ] **Step 4: Final type-check + build gate.**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && yarn type-check && yarn build
  ```
  Expected: type-check exits 0; `tsc && vite build` prints `✓ built in ...`.

- [ ] **Step 5: Confirm a clean tree (all work committed across the slice).**

  Run:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && git status --short
  ```
  Expected: empty output (no uncommitted changes). If anything remains, commit it:
  ```bash
  cd /Users/lijiamin/data/my-github/hip && git add -A && git commit -m "chore(mcp): finalize MCP config slice

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

Relevant absolute paths for this slice:
- Rust: `/Users/lijiamin/data/my-github/hip/src-tauri/src/paths.rs`, `/Users/lijiamin/data/my-github/hip/src-tauri/src/lib.rs`, `/Users/lijiamin/data/my-github/hip/src-tauri/src/sidecar.rs`
- Frontend new: `/Users/lijiamin/data/my-github/hip/src/ipc/mcpServersConfig.ts`, `/Users/lijiamin/data/my-github/hip/src/lib/mcpServerDraft.ts`, `/Users/lijiamin/data/my-github/hip/src/store/mcpServersStore.ts`, `/Users/lijiamin/data/my-github/hip/src/components/account/McpConfig.tsx`
- Frontend modified: `/Users/lijiamin/data/my-github/hip/src/components/account/SettingsPanel.tsx`, `/Users/lijiamin/data/my-github/hip/src/i18n/en.ts`, `/Users/lijiamin/data/my-github/hip/src/i18n/zh-CN.ts`, `/Users/lijiamin/data/my-github/hip/src/i18n/zh-TW.ts`
- Protocol guard: `/Users/lijiamin/data/my-github/hip/packages/protocol/src/index.ts`

## Slice 3: MCP runtime — sidecar client pool + tool adaptation

> Cross-slice ordering note (read first): this slice's type-check steps do NOT assert the whole `@hip/sidecar` package is error-free, because sibling in-flight slices (notably the `tools` field on `SessionConfig`, exercised by `src/session/build-model.test.ts`) currently leave pre-existing `tsc` errors on the tree. Each type-check step below instead asserts that **no error mentions an MCP file this slice creates** (`config/mcp-servers`, `session/mcp/json-schema-to-zod`, `session/mcp/manager`). That is robust regardless of which sibling slice lands first. The protocol types `McpServerConfig`/`McpServersConfig` must be exported from `@hip/protocol` (protocol/types slice) before Task 14's test compiles — that slice must land first.

### Task 13: Add `@modelcontextprotocol/sdk` to the sidecar package

**Files:**
- Modify `/Users/lijiamin/data/my-github/hip/packages/sidecar/package.json` (add dependency)

- [ ] **Step 1: Add the dependency to `packages/sidecar/package.json`.**
  Edit the `dependencies` block so it reads exactly (keeps the existing `@`-cluster ordering, inserts the new dep alphabetically before `ws`):
```json
  "dependencies": {
    "@agentclientprotocol/sdk": "0.25.1",
    "@hip/protocol": "*",
    "@langchain/core": "^1.1",
    "@langchain/langgraph": "^1.3.6",
    "@langchain/openai": "^1.4",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "ws": "^8"
  },
```

- [ ] **Step 2: Install so the dependency resolves and the lockfile updates.**
  Run: `cd /Users/lijiamin/data/my-github/hip && yarn install`
  Expected: completes with `Done in ...s` (or `success Saved lockfile.`); no `error` lines. Afterward `ls /Users/lijiamin/data/my-github/hip/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js` prints the path (file exists).

- [ ] **Step 3: Verify the new dependency introduces no MCP-related type errors.**
  Run: `cd /Users/lijiamin/data/my-github/hip && yarn workspace @hip/sidecar type-check 2>&1 | grep -E "modelcontextprotocol|mcp" ; echo "MCP-ERRORS-DONE"`
  Expected: prints only `MCP-ERRORS-DONE` (no line mentions `@modelcontextprotocol` or `mcp`). (Pre-existing errors from sibling slices, e.g. `src/session/build-model.test.ts`, may still be reported by `tsc` overall — they are not in scope here and are filtered out by the grep.)

- [ ] **Step 4: Commit.**
  Run:
```
cd /Users/lijiamin/data/my-github/hip && git add packages/sidecar/package.json yarn.lock && git commit -m "build(sidecar): add @modelcontextprotocol/sdk dependency

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
  Expected: a `2 files changed` summary mentioning `package.json` and `yarn.lock` (if `yarn install` did not modify the lockfile, `1 file changed` mentioning `package.json`).

---

### Task 14: `readMcpServersConfig` — read the configured server list from `HIP_MCP_SERVERS_PATH`

This mirrors `packages/sidecar/src/session/agents/registry.ts` (`readAgentsConfig`) and its test exactly. Note: the sidecar reader returns the raw configured server list (enabled and disabled); `enabled` filtering happens later in `McpManager.reconcile` (Task 16/24).

**Files:**
- Create `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/config/mcp-servers.test.ts`
- Create `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/config/mcp-servers.ts`

- [ ] **Step 1: Write the failing test.** Create `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/config/mcp-servers.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServerConfig } from '@hip/protocol'
import { readMcpServersConfig } from './mcp-servers.js'

const tmps: string[] = []
function writeFile(name: string, obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'hip-mcp-')); tmps.push(dir)
  const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.HIP_MCP_SERVERS_PATH
})

const stdioServer: McpServerConfig = {
  id: 's1', name: 'Local', transport: 'stdio', command: 'node', args: ['server.js'], enabled: true,
}
const httpServer: McpServerConfig = {
  id: 's2', name: 'Remote', transport: 'http', url: 'https://example.test/mcp', enabled: false,
}

describe('readMcpServersConfig', () => {
  it('returns [] when HIP_MCP_SERVERS_PATH is unset', () => {
    delete process.env.HIP_MCP_SERVERS_PATH
    expect(readMcpServersConfig()).toEqual([])
  })
  it('reads the servers array from the file', () => {
    process.env.HIP_MCP_SERVERS_PATH = writeFile('hip-mcp-servers.json', { servers: [stdioServer, httpServer] })
    expect(readMcpServersConfig()).toEqual([stdioServer, httpServer])
  })
  it('returns [] when servers is missing or not an array', () => {
    process.env.HIP_MCP_SERVERS_PATH = writeFile('hip-mcp-servers.json', { servers: 'nope' })
    expect(readMcpServersConfig()).toEqual([])
  })
  it('returns [] on a corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hip-mcp-')); tmps.push(dir)
    const p = join(dir, 'hip-mcp-servers.json'); writeFileSync(p, '{ not json'); process.env.HIP_MCP_SERVERS_PATH = p
    expect(readMcpServersConfig()).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test, expect FAIL (module does not exist yet).**
  Run: `cd /Users/lijiamin/data/my-github/hip && yarn vitest run packages/sidecar/src/config/mcp-servers.test.ts`
  Expected: FAIL — `Failed to resolve import "./mcp-servers.js"` (or `Cannot find module`), 0 passed.

- [ ] **Step 3: Write the minimal implementation.** Create `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/config/mcp-servers.ts`:
```ts
import { readFileSync } from 'node:fs'
import type { McpServerConfig, McpServersConfig } from '@hip/protocol'

/** Read the configured MCP servers from HIP_MCP_SERVERS_PATH. Missing/corrupt file → []. */
export function readMcpServersConfig(): McpServerConfig[] {
  const file = process.env.HIP_MCP_SERVERS_PATH?.trim()
  if (!file) return []
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as McpServersConfig
    return Array.isArray(cfg?.servers) ? cfg.servers : []
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run the test, expect PASS.**
  Run: `cd /Users/lijiamin/data/my-github/hip && yarn vitest run packages/sidecar/src/config/mcp-servers.test.ts`
  Expected: PASS — `4 passed`, 0 failed.
  > NOTE: this requires the protocol types `McpServerConfig` / `McpServersConfig` to already be exported from `@hip/protocol` by the protocol/types slice (per the contract: `export interface McpServerConfig { id; name; transport: 'stdio'|'sse'|'http'; command?; args?; env?; url?; headers?; enabled }` and `export interface McpServersConfig { servers: McpServerConfig[] }`). If they are not yet present that slice must land first; do NOT add the types here.

- [ ] **Step 5: Commit.**
  Run:
```
cd /Users/lijiamin/data/my-github/hip && git add packages/sidecar/src/config/mcp-servers.ts packages/sidecar/src/config/mcp-servers.test.ts && git commit -m "feat(sidecar): readMcpServersConfig reads HIP_MCP_SERVERS_PATH

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
  Expected: `2 files changed`.

---

### Task 15: JSON-Schema → zod conversion helper (pure, unit-tested)

MCP tools expose an `inputSchema` as JSON Schema. LangChain's `tool()` needs a zod schema. This is a small, dependency-free converter covering the JSON-Schema subset MCP tools actually use (object/string/number/integer/boolean/array, `properties`, `required`, `enum`, nested objects/arrays, `description`). Unknowns degrade to `z.any()`. Kept in the `mcp/` dir alongside the manager. (The repo's zod is v4 — `z.enum([...])`, `.passthrough()`, `z.number().int()`, `.describe()`, `.optional()` all verified present.)

**Files:**
- Create `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/mcp/json-schema-to-zod.test.ts`
- Create `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/mcp/json-schema-to-zod.ts`

- [ ] **Step 1: Write the failing test.** Create `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/mcp/json-schema-to-zod.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { jsonSchemaToZod, type JsonSchema } from './json-schema-to-zod.js'

describe('jsonSchemaToZod', () => {
  it('an empty / non-object schema becomes an open object', () => {
    const shape = jsonSchemaToZod(undefined)
    expect(shape).toBeInstanceOf(z.ZodObject)
    expect(shape.safeParse({ anything: 1 }).success).toBe(true)
  })

  it('required string + optional number', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { weightKg: { type: 'number' }, unit: { type: 'string' } },
      required: ['weightKg'],
    }
    const z0 = jsonSchemaToZod(schema)
    expect(z0.safeParse({ weightKg: 70 }).success).toBe(true)          // optional unit omitted
    expect(z0.safeParse({ weightKg: 70, unit: 'kg' }).success).toBe(true)
    expect(z0.safeParse({ unit: 'kg' }).success).toBe(false)            // missing required weightKg
    expect(z0.safeParse({ weightKg: 'heavy' }).success).toBe(false)     // wrong type
  })

  it('integer maps to z.number().int()', () => {
    const z0 = jsonSchemaToZod({ type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] })
    expect(z0.safeParse({ n: 3 }).success).toBe(true)
    expect(z0.safeParse({ n: 3.5 }).success).toBe(false)
  })

  it('boolean and array of strings', () => {
    const z0 = jsonSchemaToZod({
      type: 'object',
      properties: { flag: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string' } } },
      required: ['flag', 'tags'],
    })
    expect(z0.safeParse({ flag: true, tags: ['a', 'b'] }).success).toBe(true)
    expect(z0.safeParse({ flag: true, tags: [1] }).success).toBe(false)
  })

  it('enum string', () => {
    const z0 = jsonSchemaToZod({ type: 'object', properties: { color: { type: 'string', enum: ['red', 'green'] } }, required: ['color'] })
    expect(z0.safeParse({ color: 'red' }).success).toBe(true)
    expect(z0.safeParse({ color: 'blue' }).success).toBe(false)
  })

  it('nested object', () => {
    const z0 = jsonSchemaToZod({
      type: 'object',
      properties: { who: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
      required: ['who'],
    })
    expect(z0.safeParse({ who: { name: 'x' } }).success).toBe(true)
    expect(z0.safeParse({ who: {} }).success).toBe(false)
  })

  it('unknown leaf type degrades to z.any (still accepts)', () => {
    const z0 = jsonSchemaToZod({ type: 'object', properties: { weird: { type: 'null' } }, required: ['weird'] })
    expect(z0.safeParse({ weird: null }).success).toBe(true)
    expect(z0.safeParse({ weird: 'whatever' }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test, expect FAIL (module does not exist).**
  Run: `cd /Users/lijiamin/data/my-github/hip && yarn vitest run packages/sidecar/src/session/mcp/json-schema-to-zod.test.ts`
  Expected: FAIL — `Failed to resolve import "./json-schema-to-zod.js"`, 0 passed.

- [ ] **Step 3: Write the implementation.** Create `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/mcp/json-schema-to-zod.ts`:
```ts
import { z, type ZodObject, type ZodRawShape, type ZodTypeAny } from 'zod'

/** The minimal JSON-Schema shape we read off an MCP tool's `inputSchema`. */
export interface JsonSchema {
  type?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
}

/** Convert one JSON-Schema node to a zod type. Unknown/unsupported nodes degrade to z.any(). */
function nodeToZod(node: JsonSchema | undefined): ZodTypeAny {
  if (!node || typeof node !== 'object') return z.any()

  // enum (string enums are the common MCP case; anything else falls through to permissive z.any)
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const strings = node.enum.filter((v): v is string => typeof v === 'string')
    if (strings.length === node.enum.length) {
      return z.enum(strings as [string, ...string[]])
    }
    return z.any()
  }

  switch (node.type) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'integer':
      return z.number().int()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(nodeToZod(node.items))
    case 'object':
      return objectToZod(node)
    default:
      return z.any()
  }
}

/** Build a zod object from a JSON-Schema object node (honouring `required`). */
function objectToZod(node: JsonSchema | undefined): ZodObject<ZodRawShape> {
  const props = node?.properties ?? {}
  const required = new Set(node?.required ?? [])
  const shape: ZodRawShape = {}
  for (const [key, child] of Object.entries(props)) {
    let t = nodeToZod(child)
    if (child?.description) t = t.describe(child.description)
    shape[key] = required.has(key) ? t : t.optional()
  }
  // passthrough so MCP servers that send extra fields don't break parsing
  return z.object(shape).passthrough()
}

/**
 * Convert an MCP tool's JSON-Schema `inputSchema` into a zod object schema usable by
 * LangChain's `tool({ schema })`. A missing/non-object schema becomes an open object.
 */
export function jsonSchemaToZod(schema: JsonSchema | undefined): ZodObject<ZodRawShape> {
  if (!schema || typeof schema !== 'object' || schema.type !== 'object') {
    return z.object({}).passthrough()
  }
  return objectToZod(schema)
}
```

- [ ] **Step 4: Run the test, expect PASS.**
  Run: `cd /Users/lijiamin/data/my-github/hip && yarn vitest run packages/sidecar/src/session/mcp/json-schema-to-zod.test.ts`
  Expected: PASS — `7 passed`, 0 failed.

- [ ] **Step 5: Commit.**
  Run:
```
cd /Users/lijiamin/data/my-github/hip && git add packages/sidecar/src/session/mcp/json-schema-to-zod.ts packages/sidecar/src/session/mcp/json-schema-to-zod.test.ts && git commit -m "feat(sidecar): JSON-Schema to zod converter for MCP tool inputs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
  Expected: `2 files changed`.

---

### Task 16: `McpManager` — connect/transport factory, isolated for testing

This task creates the `McpManager` class with its transport-factory seam (a protected `connect()` a test subclass overrides to inject a Fake client), plus the module singleton `mcpManager`. `reconcile` and `tools()` get their behaviour locked in by Tasks 17–18; this task lands the skeleton + the connection/disconnection wiring so the diff logic in Task 17 has something concrete to drive. We use a `ClientLike` interface so a Fake client (no real network/process) can stand in.

> Verified against `@modelcontextprotocol/sdk@1.29.0`: import subpaths `@modelcontextprotocol/sdk/client/index.js` (`Client`, ctor `(Implementation, options?)`, `connect(transport)`, `callTool(params, ...)`, `listTools(params?, ...)`), `/client/stdio.js` (`StdioClientTransport`, ctor takes `StdioServerParameters` with `command/args/env/stderr`), `/client/streamableHttp.js` (`StreamableHTTPClientTransport`, ctor `(URL, opts?)` where `opts.requestInit?: RequestInit`), `/client/sse.js` (`SSEClientTransport`, ctor `(URL, opts?)` with the same `requestInit`).

**Files:**
- Create `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/mcp/manager.ts`

- [ ] **Step 1: Write the implementation (no test yet — Tasks 17/25 are the TDD steps that exercise it; this is the verify-by-type-check skeleton).** Create `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/mcp/manager.ts`:
```ts
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import type { McpServerConfig } from '@hip/protocol'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { jsonSchemaToZod, type JsonSchema } from './json-schema-to-zod.js'

/** The slice of the MCP Client surface the manager uses. Lets a Fake stand in for tests. */
export interface ClientLike {
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }>
  callTool(req: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>
  close(): Promise<void>
}

/** One connected server: its config fingerprint, the client, and its discovered tools. */
interface Connection {
  id: string
  fingerprint: string
  client: ClientLike
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>
}

/** A resident pool of MCP clients. Reconciled per turn against the configured server list. */
export class McpManager {
  private conns = new Map<string, Connection>()

  /** Stable fingerprint for change detection — any field change forces reconnect. */
  protected fingerprint(server: McpServerConfig): string {
    return JSON.stringify(server)
  }

  /**
   * Open a client to `server` and complete the MCP handshake.
   * Overridden in tests to inject a Fake client (no real process/network).
   */
  protected async connect(server: McpServerConfig): Promise<ClientLike> {
    const client = new Client({ name: 'hip', version: '0.1.0' })
    await client.connect(this.buildTransport(server))
    return client as unknown as ClientLike
  }

  /** Map a server config to the matching MCP transport. */
  private buildTransport(server: McpServerConfig) {
    if (server.transport === 'stdio') {
      return new StdioClientTransport({
        command: server.command ?? '',
        args: server.args ?? [],
        env: server.env,
        stderr: 'pipe',
      })
    }
    const url = new URL(server.url ?? '')
    const opts = server.headers ? { requestInit: { headers: server.headers } } : undefined
    if (server.transport === 'sse') return new SSEClientTransport(url, opts)
    return new StreamableHTTPClientTransport(url, opts)
  }

  /**
   * Reconcile the live pool with `servers`: connect newly-enabled, disconnect removed/disabled/changed,
   * reuse unchanged. Never throws — a failing server is logged and skipped (graceful degrade).
   */
  async reconcile(servers: McpServerConfig[]): Promise<void> {
    const target = new Map<string, McpServerConfig>()
    for (const s of servers) if (s.enabled) target.set(s.id, s)

    // disconnect: anything live that is no longer a target, or whose config changed
    for (const [id, conn] of [...this.conns]) {
      const want = target.get(id)
      if (!want || this.fingerprint(want) !== conn.fingerprint) {
        await conn.client.close().catch(() => {})
        this.conns.delete(id)
      }
    }

    // connect: anything wanted that is not already live (reuse skips matched fingerprints above)
    for (const [id, server] of target) {
      if (this.conns.has(id)) continue
      try {
        const client = await this.connect(server)
        const { tools } = await client.listTools()
        this.conns.set(id, { id, fingerprint: this.fingerprint(server), client, tools })
      } catch (err) {
        console.error(`[mcp] failed to connect server ${id} (${server.name}): ${(err as Error).message}`)
      }
    }
  }

  /** ids of the currently-connected servers (test/diagnostic helper). */
  connectedIds(): string[] {
    return [...this.conns.keys()].sort()
  }

  /**
   * Adapt every connected server's tools into namespaced LangChain tools.
   * Tool name = `mcp__<serverId>__<toolName>`; the body reverses the namespace and calls client.callTool.
   */
  tools(): StructuredToolInterface[] {
    const out: StructuredToolInterface[] = []
    for (const conn of this.conns.values()) {
      for (const t of conn.tools) {
        const namespaced = `mcp__${conn.id}__${t.name}`
        const schema = jsonSchemaToZod(t.inputSchema as JsonSchema | undefined)
        out.push(
          tool(
            async (args: Record<string, unknown>) => {
              try {
                const res = await conn.client.callTool({ name: t.name, arguments: args })
                return stringifyToolResult(res)
              } catch (err) {
                return `Error: ${(err as Error).message}`
              }
            },
            {
              name: namespaced,
              description: t.description ?? `MCP tool ${t.name} from server ${conn.id}`,
              schema,
            },
          ),
        )
      }
    }
    return out
  }
}

/** Flatten an MCP callTool result (content blocks) into a string for the model. */
function stringifyToolResult(res: unknown): string {
  const r = res as { content?: unknown; isError?: boolean }
  const content = r?.content
  if (Array.isArray(content)) {
    const parts = content
      .map((c) => {
        const block = c as { type?: string; text?: string }
        if (block?.type === 'text' && typeof block.text === 'string') return block.text
        return JSON.stringify(block)
      })
      .join('\n')
    return r?.isError ? `Error: ${parts}` : parts
  }
  return typeof res === 'string' ? res : JSON.stringify(res)
}

/** Module-level singleton — resident across turns. */
export const mcpManager = new McpManager()
```

- [ ] **Step 2: Verify the new MCP files introduce no type errors.**
  Run: `cd /Users/lijiamin/data/my-github/hip && yarn workspace @hip/sidecar type-check 2>&1 | grep -E "session/mcp/|config/mcp-servers" ; echo "MCP-ERRORS-DONE"`
  Expected: prints only `MCP-ERRORS-DONE` (no line references `session/mcp/manager.ts`, `session/mcp/json-schema-to-zod.ts`, or `config/mcp-servers.ts`). (`tsc` may still report pre-existing sibling-slice errors such as `src/session/build-model.test.ts` — out of scope, filtered out by the grep.)
  > If the grep DOES print an `manager.ts` line about the SDK transport-constructor option types (e.g. `requestInit`), narrow the `opts` object to match the installed `@modelcontextprotocol/sdk@1.29.0` `StreamableHTTPClientTransportOptions` / `SSEClientTransportOptions` shape — both expose `requestInit?: RequestInit` per `node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.d.ts` and `sse.d.ts`; do not change behaviour.

- [ ] **Step 3: Commit.**
  Run:
```
cd /Users/lijiamin/data/my-github/hip && git add packages/sidecar/src/session/mcp/manager.ts && git commit -m "feat(sidecar): McpManager pool skeleton + transport factory + tool adapter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
  Expected: `1 file changed`.

---

### Task 17: TDD `McpManager.reconcile` diff logic with a Fake client

Drive `reconcile` with a test subclass that overrides `connect()` to hand back a Fake client (no real process/network). Verifies: connect-new, skip-disabled, disconnect-removed, disconnect-on-config-change, reuse-unchanged, graceful-degrade on connect failure.

**Files:**
- Create `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/mcp/manager.test.ts`

- [ ] **Step 1: Write the failing test.** Create `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/mcp/manager.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { McpServerConfig } from '@hip/protocol'
import { McpManager, type ClientLike } from './manager.js'

/** A Fake MCP client: records calls, returns a fixed tool list, never touches the network. */
class FakeClient implements ClientLike {
  closed = false
  callArgs: Array<{ name: string; arguments?: Record<string, unknown> }> = []
  constructor(
    private readonly toolList: Array<{ name: string; description?: string; inputSchema?: unknown }>,
    private readonly callResult: unknown = { content: [{ type: 'text', text: 'ok' }] },
  ) {}
  async listTools() { return { tools: this.toolList } }
  async callTool(req: { name: string; arguments?: Record<string, unknown> }) { this.callArgs.push(req); return this.callResult }
  async close() { this.closed = true }
}

/** A test manager that injects Fake clients instead of spawning processes / opening sockets. */
class TestManager extends McpManager {
  connectCount = 0
  lastClients = new Map<string, FakeClient>()
  failIds = new Set<string>()
  toolsById: Record<string, Array<{ name: string; description?: string; inputSchema?: unknown }>> = {}

  protected async connect(server: McpServerConfig): Promise<ClientLike> {
    this.connectCount++
    if (this.failIds.has(server.id)) throw new Error('connect boom')
    const client = new FakeClient(this.toolsById[server.id] ?? [{ name: 'do_thing' }])
    this.lastClients.set(server.id, client)
    return client
  }
}

const stdio = (over: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 's1', name: 'S1', transport: 'stdio', command: 'node', args: ['a.js'], enabled: true, ...over,
})

let mgr: TestManager
beforeEach(() => { mgr = new TestManager(); vi.spyOn(console, 'error').mockImplementation(() => {}) })

describe('McpManager.reconcile', () => {
  it('connects newly-enabled servers and exposes their ids', async () => {
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    expect(mgr.connectedIds()).toEqual(['s1', 's2'])
    expect(mgr.connectCount).toBe(2)
  })

  it('skips disabled servers', async () => {
    await mgr.reconcile([stdio({ id: 's1', enabled: false }), stdio({ id: 's2' })])
    expect(mgr.connectedIds()).toEqual(['s2'])
  })

  it('reuses an unchanged server without reconnecting', async () => {
    await mgr.reconcile([stdio({ id: 's1' })])
    expect(mgr.connectCount).toBe(1)
    await mgr.reconcile([stdio({ id: 's1' })]) // identical config
    expect(mgr.connectCount).toBe(1)            // not reconnected
    expect(mgr.connectedIds()).toEqual(['s1'])
  })

  it('disconnects servers that were removed', async () => {
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    const c1 = mgr.lastClients.get('s1')!
    await mgr.reconcile([stdio({ id: 's2' })])
    expect(c1.closed).toBe(true)
    expect(mgr.connectedIds()).toEqual(['s2'])
  })

  it('disconnects servers that were disabled', async () => {
    await mgr.reconcile([stdio({ id: 's1' })])
    const c1 = mgr.lastClients.get('s1')!
    await mgr.reconcile([stdio({ id: 's1', enabled: false })])
    expect(c1.closed).toBe(true)
    expect(mgr.connectedIds()).toEqual([])
  })

  it('reconnects a server whose config changed (fingerprint differs)', async () => {
    await mgr.reconcile([stdio({ id: 's1', args: ['a.js'] })])
    const c1 = mgr.lastClients.get('s1')!
    await mgr.reconcile([stdio({ id: 's1', args: ['b.js'] })]) // changed args
    expect(c1.closed).toBe(true)        // old client closed
    expect(mgr.connectCount).toBe(2)    // reconnected
    expect(mgr.connectedIds()).toEqual(['s1'])
  })

  it('graceful-degrades: a failing server is skipped, others still connect', async () => {
    mgr.failIds.add('s1')
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    expect(mgr.connectedIds()).toEqual(['s2'])
    expect(console.error).toHaveBeenCalled()
  })

  it('never throws when every server fails', async () => {
    mgr.failIds.add('s1')
    await expect(mgr.reconcile([stdio({ id: 's1' })])).resolves.toBeUndefined()
    expect(mgr.connectedIds()).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test, expect PASS** (the behaviour was implemented in Task 16; this is the TDD lock-in for the diff logic).
  Run: `cd /Users/lijiamin/data/my-github/hip && yarn vitest run packages/sidecar/src/session/mcp/manager.test.ts`
  Expected: PASS — `8 passed`, 0 failed.
  > If any case fails, the bug is in `manager.ts` `reconcile` — fix `manager.ts` (do NOT weaken the test) until all 8 pass.

- [ ] **Step 3: Commit.**
  Run:
```
cd /Users/lijiamin/data/my-github/hip && git add packages/sidecar/src/session/mcp/manager.test.ts && git commit -m "test(sidecar): McpManager.reconcile diff logic with a Fake client

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
  Expected: `1 file changed`.

---

### Task 18: TDD `McpManager.tools()` — namespacing, schema, and callTool wiring

Verifies tool naming (`mcp__<serverId>__<toolName>`), that invoking a namespaced tool calls the right server's `client.callTool` with the original (un-namespaced) tool name + args, that text content is flattened, that a `callTool` rejection is caught and returned as an `Error:` string, that an MCP `isError` result is surfaced, and that the generated tool's zod schema reflects the MCP `inputSchema`. (`tool().invoke(args)` resolving to the string body is verified against `@langchain/core` in this repo.)

**Files:**
- Modify `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/mcp/manager.test.ts` (append a `describe('McpManager.tools', ...)` block)

- [ ] **Step 1: Append the failing test block** to `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/mcp/manager.test.ts` (add after the existing `describe('McpManager.reconcile', ...)` block, before end of file):
```ts
describe('McpManager.tools', () => {
  it('namespaces each connected tool as mcp__<serverId>__<toolName>', async () => {
    mgr.toolsById = { s1: [{ name: 'search' }], s2: [{ name: 'fetch' }] }
    await mgr.reconcile([stdio({ id: 's1' }), stdio({ id: 's2' })])
    const names = mgr.tools().map((t) => t.name).sort()
    expect(names).toEqual(['mcp__s1__search', 'mcp__s2__fetch'])
  })

  it('invoking a namespaced tool calls the right server with the un-namespaced name + args', async () => {
    mgr.toolsById = {
      s1: [{ name: 'add', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } }],
    }
    await mgr.reconcile([stdio({ id: 's1' })])
    const t = mgr.tools().find((x) => x.name === 'mcp__s1__add')!
    const out = String(await t.invoke({ a: 1, b: 2 }))
    const client = mgr.lastClients.get('s1')!
    expect(client.callArgs).toEqual([{ name: 'add', arguments: { a: 1, b: 2 } }])
    expect(out).toBe('ok') // FakeClient default content => "ok"
  })

  it('flattens multiple text content blocks', async () => {
    mgr.toolsById = { s1: [{ name: 'd' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    // swap the fake's call result to a multi-block payload
    const client = mgr.lastClients.get('s1')!
    ;(client as unknown as { callTool: (r: unknown) => Promise<unknown> }).callTool = async () => ({
      content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }],
    })
    const t = mgr.tools().find((x) => x.name === 'mcp__s1__d')!
    expect(String(await t.invoke({}))).toBe('line1\nline2')
  })

  it('surfaces an MCP isError result as an Error string', async () => {
    mgr.toolsById = { s1: [{ name: 'boom' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    const client = mgr.lastClients.get('s1')!
    ;(client as unknown as { callTool: (r: unknown) => Promise<unknown> }).callTool = async () => ({
      isError: true, content: [{ type: 'text', text: 'tool blew up' }],
    })
    const t = mgr.tools().find((x) => x.name === 'mcp__s1__boom')!
    expect(String(await t.invoke({}))).toMatch(/^Error: tool blew up/)
  })

  it('a callTool rejection is caught and returned as an Error string', async () => {
    mgr.toolsById = { s1: [{ name: 'flaky' }] }
    await mgr.reconcile([stdio({ id: 's1' })])
    const client = mgr.lastClients.get('s1')!
    ;(client as unknown as { callTool: (r: unknown) => Promise<unknown> }).callTool = async () => { throw new Error('network down') }
    const t = mgr.tools().find((x) => x.name === 'mcp__s1__flaky')!
    expect(String(await t.invoke({}))).toBe('Error: network down')
  })

  it('returns [] when nothing is connected', () => {
    expect(mgr.tools()).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test, expect PASS** (behaviour landed in Task 16).
  Run: `cd /Users/lijiamin/data/my-github/hip && yarn vitest run packages/sidecar/src/session/mcp/manager.test.ts`
  Expected: PASS — `14 passed` (8 reconcile + 6 tools), 0 failed.
  > If a tools() case fails, fix `manager.ts` (`tools()` / `stringifyToolResult`) — not the test.

- [ ] **Step 3: Commit.**
  Run:
```
cd /Users/lijiamin/data/my-github/hip && git add packages/sidecar/src/session/mcp/manager.test.ts && git commit -m "test(sidecar): McpManager.tools namespacing + callTool wiring + error handling

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
  Expected: `1 file changed`.

---

### Task 19: Full sidecar verification (type-check + scoped tests, paid-free)

Final guard for the slice: the MCP files introduce no type errors, and all four new test files pass together. Tests are scoped to the explicit new file paths so no paid real-LLM suite fires (per the `vitest src` substring trap in memory — never pass a bare `src` argument here).

**Files:** (none — verification only)

- [ ] **Step 1: Type-check the sidecar package and confirm no MCP-file errors.**
  Run: `cd /Users/lijiamin/data/my-github/hip && yarn workspace @hip/sidecar type-check 2>&1 | grep -E "session/mcp/|config/mcp-servers" ; echo "MCP-ERRORS-DONE"`
  Expected: prints only `MCP-ERRORS-DONE`. (Pre-existing sibling-slice errors such as `src/session/build-model.test.ts(…): error TS2353 … 'tools'` may still appear in the un-filtered `tsc` output — those belong to the core-wiring/build-model slice and are intentionally out of scope here.)

- [ ] **Step 2: Run all three new test files together (scoped, paid-free).**
  Run:
```
cd /Users/lijiamin/data/my-github/hip && yarn vitest run \
  packages/sidecar/src/config/mcp-servers.test.ts \
  packages/sidecar/src/session/mcp/json-schema-to-zod.test.ts \
  packages/sidecar/src/session/mcp/manager.test.ts
```
  Expected: PASS — `Test Files  3 passed (3)`, `Tests  25 passed` (4 + 7 + 14), 0 failed. No DeepSeek/real-LLM network output.

- [ ] **Step 3: Confirm no stray non-test, non-MCP files were left uncommitted.**
  Run: `cd /Users/lijiamin/data/my-github/hip && git status --porcelain`
  Expected: empty output (clean tree).
  > If anything shows, it belongs to another slice (e.g. `session.ts`/`tools.ts`/`internal-runner.ts`/`invoker.ts`/`system-prompt.ts` MCP-tool wiring is the core-wiring slice; the `tools` field on `SessionConfig` is the build-model slice) — do NOT edit those here; this slice ends at the manager + config reader.

---

Relevant file paths for this slice:
- New: `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/config/mcp-servers.ts` (+ `.test.ts`)
- New: `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/mcp/json-schema-to-zod.ts` (+ `.test.ts`)
- New: `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/mcp/manager.ts` (+ `.test.ts`)
- Modified: `/Users/lijiamin/data/my-github/hip/packages/sidecar/package.json` (add `@modelcontextprotocol/sdk`)

Cross-slice dependency note: protocol types `McpServerConfig`/`McpServersConfig` must be exported from `@hip/protocol` (protocol slice) before Task 14's test compiles; consumption of `mcpManager.tools()` / `mcpManager.reconcile(readMcpServersConfig())` inside `session.ts`/`internal-runner.ts`/`invoker.ts` is owned by the core-wiring slice and is NOT touched here. SDK import subpaths verified against `@modelcontextprotocol/sdk@1.29.0`: `@modelcontextprotocol/sdk/client/index.js`, `/client/stdio.js`, `/client/streamableHttp.js`, `/client/sse.js` (the latter three resolve through the package's `./*` export wildcard). The sidecar package does NOT currently `tsc`-clean on its own because of pre-existing sibling-slice errors in `src/session/build-model.test.ts`; every type-check step in this slice is therefore scoped (via `grep`) to MCP files only.

## Slice 4: Skill config — Rust (zip/yaml) + frontend (settings page)

### Task 20: Rust paths — `skills_dir` + `skills_config_path`

**Files:**
- Modify `src-tauri/src/paths.rs` (add a pure helper + two `pub fn` after `auth_json_path` on line 54, add a test in the `mod tests` block)

- [ ] **Step 1: Write the failing test.** In `src-tauri/src/paths.rs`, replace the `mod tests` import line (line 58) so the test can reach the new pure helper, then add a test inside the `mod tests` block after `unix_none_home_is_none` (after line 72).

Replace:
```rust
    use super::hip_base_from;
```
with:
```rust
    use super::{hip_base_from, skills_subpath_from};
```

Add this test after the `unix_none_home_is_none` function (after line 72, before `#[cfg(windows)]`):
```rust
    #[test]
    #[cfg(not(windows))]
    fn skills_subpath_joins_under_base() {
        let base = PathBuf::from("/Users/x/.hip");
        assert_eq!(
            skills_subpath_from(&base, "skills"),
            PathBuf::from("/Users/x/.hip/skills"),
        );
        assert_eq!(
            skills_subpath_from(&base, "config/hip-skills.json"),
            PathBuf::from("/Users/x/.hip/config/hip-skills.json"),
        );
    }
```

- [ ] **Step 2: Run it, expect FAIL.**
  Run: `cargo test --manifest-path src-tauri/Cargo.toml paths:: 2>&1 | tail -25`
  Expected: a compile error — `cannot find function 'skills_subpath_from' in this scope` (the test module does not compile).

- [ ] **Step 3: Minimal impl — add the pure helper + the two AppHandle wrappers.** In `src-tauri/src/paths.rs`, insert the pure helper and the public wrappers right after `auth_json_path` (after line 54, before the `#[cfg(test)]` block on line 56):

```rust
/// Pure core for skill-related paths: `<base>/<sub>`. Split out so the join
/// logic is unit-testable without a Tauri AppHandle (mirrors `hip_base_from`).
pub fn skills_subpath_from(base: &std::path::Path, sub: &str) -> PathBuf {
    base.join(sub)
}

/// Directory holding installed Claude-format skills (`<dir>/<skill-id>/SKILL.md`).
pub fn skills_dir(app: &AppHandle) -> Option<PathBuf> {
    hip_subdir(app, "skills")
}

/// Canonical path of the skill enable/disable table inside `config/`.
pub fn skills_config_path(app: &AppHandle) -> Option<PathBuf> {
    Some(config_dir(app)?.join("hip-skills.json"))
}
```

- [ ] **Step 4: Run, expect PASS.**
  Run: `cargo test --manifest-path src-tauri/Cargo.toml paths:: 2>&1 | tail -15`
  Expected: `test result: ok.` with `skills_subpath_joins_under_base`, `unix_uses_home_dot_hip`, and `unix_none_home_is_none` passing.

- [ ] **Step 5: Commit.**
  Run: `git add src-tauri/src/paths.rs && git commit -m "feat(skills): add skills_dir + skills_config_path Rust paths

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 21: Cargo deps — `zip` + `serde_yaml`

**Files:**
- Modify `src-tauri/Cargo.toml` (`[dependencies]` section, after the `reqwest = ...` line on line 31)

- [ ] **Step 1: Add the two crates.** In `src-tauri/Cargo.toml`, add these lines at the end of the `[dependencies]` block (after line 31):

```toml
# Skill install: unzip uploaded skill bundles (zip-slip-safe extraction in skills.rs).
zip = { version = "2", default-features = false, features = ["deflate"] }
# Skill metadata: parse SKILL.md YAML frontmatter (name/description).
serde_yaml = "0.9"
```

- [ ] **Step 2: Verify the manifest resolves and builds.**
  Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`
  Expected: `Compiling zip ...`, `Compiling serde_yaml ...`, ending in `Finished` with no errors. (First build may be slow; that is expected.)

- [ ] **Step 3: Commit.**
  Run: `git add src-tauri/Cargo.toml src-tauri/Cargo.lock && git commit -m "build(skills): add zip + serde_yaml crates for skill install

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 22: Rust — zip-slip path sanitization helper (TDD)

**Files:**
- Create `src-tauri/src/skills.rs` (pure helpers + zip-slip unit tests)
- Modify `src-tauri/src/lib.rs` (add `mod skills;` near the top, line 1–3 area)

- [ ] **Step 1: Register the module.** In `src-tauri/src/lib.rs`, add the module declaration alongside the existing ones at the top (after line 3, `mod auth;`):

```rust
mod skills;
```

- [ ] **Step 2: Write the failing test file.** Create `src-tauri/src/skills.rs` with a pure `safe_join` (zip-slip guard) and a `slugify` helper, plus their tests:

```rust
//! Pure helpers for skill install (zip-slip-safe extraction + slug derivation).
//! Kept separate from `lib.rs` so the path-sanitization logic is unit-testable.

use std::path::{Component, Path, PathBuf};

/// Resolve a zip entry's relative path against `dest`, rejecting anything that
/// would escape `dest` (zip-slip). Returns `None` for absolute paths, paths with
/// a `..` component, or anything containing a Windows drive/root prefix.
pub fn safe_join(dest: &Path, entry: &str) -> Option<PathBuf> {
    let rel = Path::new(entry);
    let mut out = dest.to_path_buf();
    for comp in rel.components() {
        match comp {
            // Normal path segment — append it.
            Component::Normal(seg) => out.push(seg),
            // A bare `.` is harmless; skip it.
            Component::CurDir => {}
            // Anything that could escape the destination is rejected outright.
            Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => return None,
        }
    }
    Some(out)
}

/// Derive a filesystem-safe kebab-case slug from a skill's frontmatter `name`.
/// Lowercases, maps non-alphanumerics to `-`, collapses runs, trims edges.
/// Falls back to `"skill"` when nothing usable remains.
pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "skill".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::{safe_join, slugify};
    use std::path::{Path, PathBuf};

    #[test]
    fn safe_join_allows_nested_normal_paths() {
        let dest = Path::new("/tmp/skills/my-skill");
        assert_eq!(
            safe_join(dest, "scripts/run.sh"),
            Some(PathBuf::from("/tmp/skills/my-skill/scripts/run.sh")),
        );
        assert_eq!(
            safe_join(dest, "SKILL.md"),
            Some(PathBuf::from("/tmp/skills/my-skill/SKILL.md")),
        );
        // A leading `./` is normalized away, not rejected.
        assert_eq!(
            safe_join(dest, "./SKILL.md"),
            Some(PathBuf::from("/tmp/skills/my-skill/SKILL.md")),
        );
    }

    #[test]
    fn safe_join_rejects_parent_traversal() {
        let dest = Path::new("/tmp/skills/my-skill");
        assert_eq!(safe_join(dest, "../evil.sh"), None);
        assert_eq!(safe_join(dest, "scripts/../../evil.sh"), None);
        assert_eq!(safe_join(dest, "a/../../b"), None);
    }

    #[test]
    fn safe_join_rejects_absolute_paths() {
        let dest = Path::new("/tmp/skills/my-skill");
        assert_eq!(safe_join(dest, "/etc/passwd"), None);
    }

    #[test]
    fn slugify_kebabs_and_trims() {
        assert_eq!(slugify("PDF Tools!"), "pdf-tools");
        assert_eq!(slugify("  Hello   World  "), "hello-world");
        assert_eq!(slugify("already-kebab"), "already-kebab");
        assert_eq!(slugify("!!!"), "skill");
    }
}
```

- [ ] **Step 3: Run it, expect PASS.** (These are pure helpers with no external deps; they compile and pass immediately. This step verifies the new module compiles and the tests pass before the riskier `lib.rs` wiring.)
  Run: `cargo test --manifest-path src-tauri/Cargo.toml skills:: 2>&1 | tail -20`
  Expected: `test result: ok.` listing `safe_join_allows_nested_normal_paths`, `safe_join_rejects_parent_traversal`, `safe_join_rejects_absolute_paths`, and `slugify_kebabs_and_trims` passing.

- [ ] **Step 4: Commit.**
  Run: `git add src-tauri/src/skills.rs src-tauri/src/lib.rs && git commit -m "feat(skills): zip-slip-safe path join + slug helpers (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 23: Rust — skill scanning + frontmatter parse helpers (TDD)

**Files:**
- Modify `src-tauri/src/skills.rs` (add `parse_frontmatter` + `scan_skills` + `SkillMeta`/`Frontmatter` + tests)

- [ ] **Step 1: Write the failing test.** Add tests at the **end** of the `mod tests` block in `src-tauri/src/skills.rs` (just before its closing `}`). These cover frontmatter parsing and a filesystem scan against a temp dir (mirrors `auth.rs`'s `std::env::temp_dir()` test style):

```rust
    #[test]
    fn parse_frontmatter_reads_name_and_description() {
        let md = "---\nname: PDF Tools\ndescription: Work with PDFs\nextra: ignored\n---\n# Body\nhello\n";
        let fm = super::parse_frontmatter(md).unwrap();
        assert_eq!(fm.name.as_deref(), Some("PDF Tools"));
        assert_eq!(fm.description.as_deref(), Some("Work with PDFs"));
    }

    #[test]
    fn parse_frontmatter_none_without_fences() {
        assert!(super::parse_frontmatter("# Just a heading\nno frontmatter").is_none());
    }

    #[test]
    fn scan_skills_lists_valid_dirs_and_flags_scripts() {
        let root = std::env::temp_dir()
            .join(format!("hip-skills-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        // Valid skill with a scripts/ dir.
        let a = root.join("pdf-tools");
        std::fs::create_dir_all(a.join("scripts")).unwrap();
        std::fs::write(
            a.join("SKILL.md"),
            "---\nname: PDF Tools\ndescription: Work with PDFs\n---\nbody",
        )
        .unwrap();
        std::fs::write(a.join("scripts").join("run.sh"), "echo hi").unwrap();
        // Valid skill, no scripts.
        let b = root.join("notes");
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(
            b.join("SKILL.md"),
            "---\nname: Notes\ndescription: Take notes\n---\nbody",
        )
        .unwrap();
        // A non-skill dir (no SKILL.md) — must be skipped.
        std::fs::create_dir_all(root.join("junk")).unwrap();

        let mut metas = super::scan_skills(&root);
        metas.sort_by(|x, y| x.id.cmp(&y.id));
        assert_eq!(metas.len(), 2);
        let notes = metas.iter().find(|m| m.id == "notes").unwrap();
        assert_eq!(notes.name, "Notes");
        assert_eq!(notes.description, "Take notes");
        assert!(!notes.has_scripts);
        let pdf = metas.iter().find(|m| m.id == "pdf-tools").unwrap();
        assert_eq!(pdf.name, "PDF Tools");
        assert!(pdf.has_scripts);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_skills_missing_root_is_empty() {
        let root = std::env::temp_dir().join("hip-skills-does-not-exist-xyz");
        let _ = std::fs::remove_dir_all(&root);
        assert!(super::scan_skills(&root).is_empty());
    }
```

- [ ] **Step 2: Run it, expect FAIL.**
  Run: `cargo test --manifest-path src-tauri/Cargo.toml skills:: 2>&1 | tail -25`
  Expected: compile errors — `cannot find function 'parse_frontmatter'` / `cannot find function 'scan_skills'` (the test module does not compile).

- [ ] **Step 3: Minimal impl.** Add the `SkillMeta` struct, `Frontmatter` struct, `parse_frontmatter`, and `scan_skills` to `src-tauri/src/skills.rs` after the `slugify` function (before the `#[cfg(test)]` block).

Replace the top import line:
```rust
use std::path::{Component, Path, PathBuf};
```
with:
```rust
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
```

Then add this block before `#[cfg(test)]`:

```rust
/// Mirrors the protocol `SkillMeta` shape (camelCase over the wire to the renderer).
/// Serialized as the JSON array returned by `list_skills`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub dir: String,
    pub has_scripts: bool,
}

/// The subset of `SKILL.md` YAML frontmatter we read. Extra keys are ignored.
#[derive(Deserialize)]
pub struct Frontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
}

/// Parse the leading `---\n...\n---` YAML block of a `SKILL.md` body.
/// Returns `None` when there is no frontmatter or the YAML is invalid.
pub fn parse_frontmatter(body: &str) -> Option<Frontmatter> {
    let rest = body
        .strip_prefix("---\n")
        .or_else(|| body.strip_prefix("---\r\n"))?;
    // Closing fence at the start of a line: a `\n---` after the YAML, or an
    // immediate `---` (empty frontmatter block).
    let end = rest
        .find("\n---")
        .map(|i| i + 1)
        .or_else(|| if rest.starts_with("---") { Some(0) } else { None })?;
    let yaml = &rest[..end];
    serde_yaml::from_str::<Frontmatter>(yaml).ok()
}

/// Scan `<root>/*/SKILL.md`, parse frontmatter, and build a `SkillMeta` per valid
/// skill. Directories without a parseable `SKILL.md` (or missing a `name`) are
/// skipped. Never panics; a missing/unreadable root yields an empty list.
pub fn scan_skills(root: &Path) -> Vec<SkillMeta> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let skill_md = dir.join("SKILL.md");
        let body = match std::fs::read_to_string(&skill_md) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let fm = match parse_frontmatter(&body) {
            Some(f) => f,
            None => continue,
        };
        let name = match fm.name {
            Some(n) if !n.trim().is_empty() => n,
            _ => continue,
        };
        let id = match dir.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let has_scripts = dir.join("scripts").is_dir();
        out.push(SkillMeta {
            id,
            name,
            description: fm.description.unwrap_or_default(),
            dir: dir.to_string_lossy().into_owned(),
            has_scripts,
        });
    }
    out
}
```

- [ ] **Step 4: Run, expect PASS.**
  Run: `cargo test --manifest-path src-tauri/Cargo.toml skills:: 2>&1 | tail -20`
  Expected: `test result: ok.` with all `parse_frontmatter_*`, `scan_skills_*`, `safe_join_*`, `slugify_*` passing.

- [ ] **Step 5: Commit.**
  Run: `git add src-tauri/src/skills.rs && git commit -m "feat(skills): SKILL.md frontmatter parse + skill dir scan (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 24: Rust — install/extract zip helper (TDD)

**Files:**
- Modify `src-tauri/src/skills.rs` (add `extract_zip` + `find_skill_root` + their tests)

- [ ] **Step 1: Write the failing test.** Append to the `mod tests` block in `src-tauri/src/skills.rs` (before its closing `}`). The test builds a tiny in-memory zip, extracts it, and verifies a zip-slip entry is refused. Add the `std::io::Write` import at the top of the `mod tests` block (after `use std::path::{Path, PathBuf};`):

```rust
    use std::io::Write;
```

Then add the tests:

```rust
    fn make_zip(entries: &[(&str, &[u8])]) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "hip-skill-zip-{}-{}.zip",
            std::process::id(),
            entries.len(),
        ));
        let file = std::fs::File::create(&path).unwrap();
        let mut zw = zip::ZipWriter::new(file);
        let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
        for (name, body) in entries {
            zw.start_file(*name, opts).unwrap();
            zw.write_all(body).unwrap();
        }
        zw.finish().unwrap();
        path
    }

    #[test]
    fn extract_zip_writes_files_and_skips_slip() {
        let zip_path = make_zip(&[
            ("SKILL.md", b"---\nname: Z\ndescription: d\n---\nbody"),
            ("scripts/run.sh", b"echo hi"),
            ("../escape.sh", b"pwned"),
        ]);
        let dest = std::env::temp_dir()
            .join(format!("hip-skill-extract-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest);
        std::fs::create_dir_all(&dest).unwrap();

        super::extract_zip(&zip_path, &dest).unwrap();

        assert!(dest.join("SKILL.md").exists());
        assert!(dest.join("scripts").join("run.sh").exists());
        // The zip-slip entry must NOT have escaped the destination.
        assert!(!dest.parent().unwrap().join("escape.sh").exists());

        let _ = std::fs::remove_dir_all(&dest);
        let _ = std::fs::remove_file(&zip_path);
    }

    #[test]
    fn find_skill_root_finds_nested_skill_md() {
        let dest = std::env::temp_dir()
            .join(format!("hip-skill-root-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest);
        // Many archives wrap content in a top folder; find_skill_root unwraps it.
        let inner = dest.join("my-skill");
        std::fs::create_dir_all(&inner).unwrap();
        std::fs::write(inner.join("SKILL.md"), "---\nname: X\n---\n").unwrap();

        let found = super::find_skill_root(&dest).unwrap();
        assert_eq!(found, inner);

        // Top-level SKILL.md is found directly.
        let dest2 = std::env::temp_dir()
            .join(format!("hip-skill-root2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dest2);
        std::fs::create_dir_all(&dest2).unwrap();
        std::fs::write(dest2.join("SKILL.md"), "---\nname: X\n---\n").unwrap();
        assert_eq!(super::find_skill_root(&dest2).unwrap(), dest2);

        let _ = std::fs::remove_dir_all(&dest);
        let _ = std::fs::remove_dir_all(&dest2);
    }
```

- [ ] **Step 2: Run it, expect FAIL.**
  Run: `cargo test --manifest-path src-tauri/Cargo.toml skills:: 2>&1 | tail -25`
  Expected: compile errors — `cannot find function 'extract_zip'` / `cannot find function 'find_skill_root'`.

- [ ] **Step 3: Minimal impl.** Add the `io` import at the top of `src-tauri/src/skills.rs`, then add `extract_zip` and `find_skill_root` before the `#[cfg(test)]` block.

Update the top imports to:
```rust
use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Component, Path, PathBuf};
```

Add before `#[cfg(test)]`:

```rust
/// Extract every entry of `zip_path` into `dest`, skipping any entry whose
/// resolved path would escape `dest` (zip-slip, via `safe_join`). Directory
/// entries create dirs; file entries create parent dirs then write bytes.
pub fn extract_zip(zip_path: &Path, dest: &Path) -> io::Result<()> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
        let name = entry.name().to_string();
        let target = match safe_join(dest, &name) {
            Some(p) => p,
            None => continue, // zip-slip / absolute — skip silently.
        };
        if entry.is_dir() {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = std::fs::File::create(&target)?;
        io::copy(&mut entry, &mut out)?;
    }
    Ok(())
}

/// Find the directory that actually contains `SKILL.md`: either `dest` itself or
/// the single wrapping subfolder many archives add. Returns `None` if no
/// `SKILL.md` is found at either level.
pub fn find_skill_root(dest: &Path) -> Option<PathBuf> {
    if dest.join("SKILL.md").is_file() {
        return Some(dest.to_path_buf());
    }
    for entry in std::fs::read_dir(dest).ok()?.flatten() {
        let p = entry.path();
        if p.is_dir() && p.join("SKILL.md").is_file() {
            return Some(p);
        }
    }
    None
}
```

- [ ] **Step 4: Run, expect PASS.**
  Run: `cargo test --manifest-path src-tauri/Cargo.toml skills:: 2>&1 | tail -20`
  Expected: `test result: ok.` with `extract_zip_writes_files_and_skips_slip` and `find_skill_root_finds_nested_skill_md` plus all earlier skills tests passing.

- [ ] **Step 5: Commit.**
  Run: `git add src-tauri/src/skills.rs && git commit -m "feat(skills): zip extraction (slip-safe) + skill-root discovery (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 25: Rust — Tauri commands `list_skills` / `install_skill_zip` / `delete_skill` / `read_skill_file` / `get_skills_config` / `set_skills_config`

**Files:**
- Modify `src-tauri/src/lib.rs` (add six `#[tauri::command]` fns after `set_agents_config` on line 113, and register them in `generate_handler!` on line 174–186)

- [ ] **Step 1: Add the command functions.** In `src-tauri/src/lib.rs`, insert the following after the `set_agents_config` function (after line 113, before `models_catalog`):

```rust
#[tauri::command]
fn list_skills(app: tauri::AppHandle) -> Result<String, String> {
    let dir = paths::skills_dir(&app).ok_or("no skills dir")?;
    let metas = skills::scan_skills(&dir);
    serde_json::to_string(&metas).map_err(|e| e.to_string())
}

#[tauri::command]
fn install_skill_zip(app: tauri::AppHandle, zip_path: String) -> Result<String, String> {
    let skills_root = paths::skills_dir(&app).ok_or("no skills dir")?;
    // Stage into a temp dir under the skills root so a half-extracted bundle never
    // pollutes the live list; promote to <root>/<slug> only after validation.
    let staging = skills_root.join(format!(".staging-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let cleanup = |dir: &std::path::Path| {
        let _ = std::fs::remove_dir_all(dir);
    };

    if let Err(e) = skills::extract_zip(std::path::Path::new(&zip_path), &staging) {
        cleanup(&staging);
        return Err(format!("解压失败: {e}"));
    }
    let root = match skills::find_skill_root(&staging) {
        Some(r) => r,
        None => {
            cleanup(&staging);
            return Err("压缩包内未找到 SKILL.md".to_string());
        }
    };
    let body = match std::fs::read_to_string(root.join("SKILL.md")) {
        Ok(b) => b,
        Err(e) => {
            cleanup(&staging);
            return Err(e.to_string());
        }
    };
    let name = match skills::parse_frontmatter(&body).and_then(|f| f.name) {
        Some(n) if !n.trim().is_empty() => n,
        _ => {
            cleanup(&staging);
            return Err("SKILL.md 缺少 name 字段".to_string());
        }
    };

    // Derive a unique slug under the skills root.
    let base = skills::slugify(&name);
    let mut slug = base.clone();
    let mut n = 2;
    while skills_root.join(&slug).exists() {
        slug = format!("{base}-{n}");
        n += 1;
    }
    let final_dir = skills_root.join(&slug);
    if let Err(e) = std::fs::rename(&root, &final_dir) {
        cleanup(&staging);
        return Err(format!("安装失败: {e}"));
    }
    cleanup(&staging);
    Ok(slug)
}

#[tauri::command]
fn delete_skill(app: tauri::AppHandle, id: String) -> Result<(), String> {
    // Guard against path traversal in the id — it must be a single dir name.
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("非法 skill id".to_string());
    }
    let dir = paths::skills_dir(&app).ok_or("no skills dir")?.join(&id);
    if !dir.is_dir() {
        return Err("skill 不存在".to_string());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_skill_file(app: tauri::AppHandle, id: String, rel: String) -> Result<String, String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("非法 skill id".to_string());
    }
    let skill_dir = paths::skills_dir(&app).ok_or("no skills dir")?.join(&id);
    let target = skills::safe_join(&skill_dir, &rel).ok_or("非法文件路径")?;
    std::fs::read_to_string(&target).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_skills_config(app: tauri::AppHandle) -> Result<String, String> {
    match paths::skills_config_path(&app) {
        Some(p) => Ok(std::fs::read_to_string(&p).unwrap_or_default()),
        None => Ok(String::new()),
    }
}

#[tauri::command]
fn set_skills_config(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = paths::skills_config_path(&app).ok_or("no config dir")?;
    std::fs::write(&p, json).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register the commands.** In `src-tauri/src/lib.rs`, extend the `tauri::generate_handler!` list (currently ending at `set_agents_config` on line 185). Replace:

```rust
            get_agents_config,
            set_agents_config
        ])
```
with:
```rust
            get_agents_config,
            set_agents_config,
            list_skills,
            install_skill_zip,
            delete_skill,
            read_skill_file,
            get_skills_config,
            set_skills_config
        ])
```

- [ ] **Step 3: Verify it builds.**
  Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`
  Expected: `Finished` with no errors (no `unused` warnings for the new commands since they are registered).

- [ ] **Step 4: Run the Rust test suite to confirm nothing broke.**
  Run: `cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -15`
  Expected: `test result: ok.` across the `paths::`, `skills::`, `auth::`, and `sidecar::` modules.

- [ ] **Step 5: Commit.**
  Run: `git add src-tauri/src/lib.rs && git commit -m "feat(skills): list/install/delete/read/get/set skill Tauri commands

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 26: Rust — sidecar env `HIP_SKILLS_DIR` + `HIP_SKILLS_PATH`

**Files:**
- Modify `src-tauri/src/sidecar.rs` (`spawn_sidecar`, add env after the `HIP_AGENTS_PATH` block on line 37–39)

- [ ] **Step 1: Add the two env vars.** In `src-tauri/src/sidecar.rs`, in `spawn_sidecar`, after the `HIP_AGENTS_PATH` block (after line 39, before the `HIP_DB_PATH` comment on line 40):

```rust
    // Point the sidecar at the installed skills directory + the enable/disable table.
    // The sidecar scans <HIP_SKILLS_DIR>/*/SKILL.md and cross-refs HIP_SKILLS_PATH.
    if let Some(p) = crate::paths::skills_dir(app) {
        cmd = cmd.env("HIP_SKILLS_DIR", p.to_string_lossy().into_owned());
    }
    if let Some(p) = crate::paths::skills_config_path(app) {
        cmd = cmd.env("HIP_SKILLS_PATH", p.to_string_lossy().into_owned());
    }
```

- [ ] **Step 2: Verify it builds.**
  Run: `cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -12`
  Expected: `Finished` with no errors.

- [ ] **Step 3: Commit.**
  Run: `git add src-tauri/src/sidecar.rs && git commit -m "feat(skills): set HIP_SKILLS_DIR + HIP_SKILLS_PATH for sidecar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 27: Protocol types + frontend IPC — `SkillMeta`/`SkillsConfig` + `src/ipc/skills.ts` (TDD)

**Files:**
- Modify `packages/protocol/src/index.ts` (add `SkillMeta` + `SkillsConfig` if not already present)
- Create `src/ipc/skills.ts`
- Create `src/ipc/skills.test.ts`

- [ ] **Step 1: Ensure the protocol types exist.** Check whether the MCP/skills protocol slice already added these:
  Run: `grep -n "SkillMeta\|SkillsConfig" packages/protocol/src/index.ts`
  - If BOTH `SkillMeta` and `SkillsConfig` are already exported, skip to Step 2 (do not duplicate them).
  - If they are missing, append these exports to the end of `packages/protocol/src/index.ts` (exact shapes from the shared contract — camelCase to match the Rust `SkillMeta` serializer):

```ts
export interface SkillMeta {
  id: string
  name: string
  description: string
  dir: string
  hasScripts: boolean
}

/** Per-skill enable/disable table; a missing id means enabled. */
export interface SkillsConfig {
  enabled: Record<string, boolean>
}
```

  Then verify the protocol package builds:
  Run: `yarn workspace @hip/protocol build 2>&1 | tail -10`
  Expected: `tsc` completes with no errors (emits `dist/`).

- [ ] **Step 2: Write the failing test.** Create `src/ipc/skills.test.ts` (mirrors `agentsConfig.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

beforeEach(() => invoke.mockReset())

describe('skills IPC', () => {
  it('listSkills parses the JSON array payload', async () => {
    const { listSkills } = await import('./skills.js')
    invoke.mockResolvedValueOnce(
      JSON.stringify([{ id: 'pdf', name: 'PDF', description: 'd', dir: '/x/pdf', hasScripts: true }]),
    )
    const skills = await listSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({ id: 'pdf', hasScripts: true })
    expect(invoke).toHaveBeenCalledWith('list_skills')
  })

  it('listSkills returns [] on blank/corrupt', async () => {
    const { listSkills } = await import('./skills.js')
    invoke.mockResolvedValueOnce('')
    expect(await listSkills()).toEqual([])
    invoke.mockResolvedValueOnce('{ broken')
    expect(await listSkills()).toEqual([])
  })

  it('installSkillZip passes the path and returns the installed id', async () => {
    const { installSkillZip } = await import('./skills.js')
    invoke.mockResolvedValueOnce('pdf-tools')
    const id = await installSkillZip('/tmp/x.zip')
    expect(id).toBe('pdf-tools')
    expect(invoke).toHaveBeenCalledWith('install_skill_zip', { zipPath: '/tmp/x.zip' })
  })

  it('deleteSkill passes the id', async () => {
    const { deleteSkill } = await import('./skills.js')
    invoke.mockResolvedValueOnce(undefined)
    await deleteSkill('pdf')
    expect(invoke).toHaveBeenCalledWith('delete_skill', { id: 'pdf' })
  })

  it('readSkillFile passes id + rel', async () => {
    const { readSkillFile } = await import('./skills.js')
    invoke.mockResolvedValueOnce('# Body')
    const body = await readSkillFile('pdf', 'SKILL.md')
    expect(body).toBe('# Body')
    expect(invoke).toHaveBeenCalledWith('read_skill_file', { id: 'pdf', rel: 'SKILL.md' })
  })

  it('getSkillsConfig parses + returns default on blank/corrupt', async () => {
    const { getSkillsConfig } = await import('./skills.js')
    invoke.mockResolvedValueOnce(JSON.stringify({ enabled: { pdf: false } }))
    expect((await getSkillsConfig()).enabled).toEqual({ pdf: false })
    invoke.mockResolvedValueOnce('')
    expect((await getSkillsConfig()).enabled).toEqual({})
    invoke.mockResolvedValueOnce('{ broken')
    expect((await getSkillsConfig()).enabled).toEqual({})
  })

  it('setSkillsConfig stringifies and invokes set_skills_config', async () => {
    const { setSkillsConfig } = await import('./skills.js')
    invoke.mockResolvedValueOnce(undefined)
    await setSkillsConfig({ enabled: { pdf: true } })
    expect(invoke).toHaveBeenCalledWith('set_skills_config', {
      json: JSON.stringify({ enabled: { pdf: true } }, null, 2),
    })
  })
})
```

- [ ] **Step 3: Run it, expect FAIL.**
  Run: `yarn vitest run src/ipc/skills.test.ts 2>&1 | tail -20`
  Expected: failure — `Failed to resolve import "./skills.js"` / `Cannot find module './skills'` (the file does not exist yet).

- [ ] **Step 4: Minimal impl.** Create `src/ipc/skills.ts`:

```ts
import { invoke } from '@tauri-apps/api/core'
import type { SkillMeta, SkillsConfig } from '@hip/protocol'

export async function listSkills(): Promise<SkillMeta[]> {
  const raw = await invoke<string>('list_skills')
  if (!raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as SkillMeta[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function installSkillZip(zipPath: string): Promise<string> {
  return invoke<string>('install_skill_zip', { zipPath })
}

export async function deleteSkill(id: string): Promise<void> {
  await invoke<void>('delete_skill', { id })
}

export async function readSkillFile(id: string, rel: string): Promise<string> {
  return invoke<string>('read_skill_file', { id, rel })
}

export async function getSkillsConfig(): Promise<SkillsConfig> {
  const raw = await invoke<string>('get_skills_config')
  if (!raw.trim()) return { enabled: {} }
  try {
    const parsed = JSON.parse(raw) as SkillsConfig
    return parsed && typeof parsed.enabled === 'object' && parsed.enabled !== null
      ? { enabled: parsed.enabled }
      : { enabled: {} }
  } catch {
    return { enabled: {} }
  }
}

export async function setSkillsConfig(cfg: SkillsConfig): Promise<void> {
  await invoke<void>('set_skills_config', { json: JSON.stringify(cfg, null, 2) })
}
```

- [ ] **Step 5: Run, expect PASS.**
  Run: `yarn vitest run src/ipc/skills.test.ts 2>&1 | tail -20`
  Expected: `Test Files  1 passed` with all 7 tests green.

- [ ] **Step 6: Commit.**
  Run: `git add packages/protocol/src/index.ts src/ipc/skills.ts src/ipc/skills.test.ts && git commit -m "feat(skills): SkillMeta/SkillsConfig protocol types + skills IPC wrappers + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 28: Frontend IPC — add `pickZipFile` to `src/ipc/dialog.ts`

**Files:**
- Modify `src/ipc/dialog.ts` (add a `pickZipFile` export + an E2E seam like `__hipPickDir`)

- [ ] **Step 1: Add the seam + the function.** Replace the entire contents of `src/ipc/dialog.ts` with the version below (keeps `pickDirectory` unchanged, adds the ZIP picker and its `__hipPickZip` E2E seam):

```ts
// Native folder picker. In E2E (and any harness), `window.__hipPickDir` is a seam
// that returns a fixture path, since WebdriverIO can't drive the native OS dialog.
declare global {
  interface Window {
    __hipPickDir?: () => Promise<string | null>
    __hipPickZip?: () => Promise<string | null>
  }
}

export async function pickDirectory(): Promise<string | null> {
  if (typeof window !== 'undefined' && window.__hipPickDir) return window.__hipPickDir()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({ directory: true, multiple: false, title: '选择项目文件夹' })
  return typeof result === 'string' ? result : null
}

export async function pickZipFile(): Promise<string | null> {
  if (typeof window !== 'undefined' && window.__hipPickZip) return window.__hipPickZip()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    multiple: false,
    title: '选择 skill 压缩包',
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })
  return typeof result === 'string' ? result : null
}

export {}
```

- [ ] **Step 2: Type-check.**
  Run: `yarn type-check 2>&1 | tail -12`
  Expected: no errors (exits cleanly).

- [ ] **Step 3: Commit.**
  Run: `git add src/ipc/dialog.ts && git commit -m "feat(skills): add pickZipFile native dialog (+ E2E seam)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 29: Frontend store — `src/store/skillsStore.ts` (TDD)

**Files:**
- Create `src/store/skillsStore.ts`
- Create `src/store/skillsStore.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/store/skillsStore.test.ts` (mirrors `agentsStore.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const listSkills = vi.fn()
const installSkillZip = vi.fn()
const deleteSkill = vi.fn()
const getSkillsConfig = vi.fn()
const setSkillsConfig = vi.fn()
vi.mock('@/ipc/skills', () => ({
  listSkills: (...a: unknown[]) => listSkills(...a),
  installSkillZip: (...a: unknown[]) => installSkillZip(...a),
  deleteSkill: (...a: unknown[]) => deleteSkill(...a),
  getSkillsConfig: (...a: unknown[]) => getSkillsConfig(...a),
  setSkillsConfig: (...a: unknown[]) => setSkillsConfig(...a),
}))

const META = { id: 'pdf', name: 'PDF', description: 'd', dir: '/x/pdf', hasScripts: true }

beforeEach(async () => {
  listSkills.mockReset().mockResolvedValue([])
  installSkillZip.mockReset().mockResolvedValue('pdf')
  deleteSkill.mockReset().mockResolvedValue(undefined)
  getSkillsConfig.mockReset().mockResolvedValue({ enabled: {} })
  setSkillsConfig.mockReset().mockResolvedValue(undefined)
  const { useSkillsStore } = await import('./skillsStore.js')
  useSkillsStore.setState({ skills: [], enabled: {}, loaded: false })
})

describe('skillsStore', () => {
  it('load() hydrates skills + enabled map', async () => {
    listSkills.mockResolvedValueOnce([META])
    getSkillsConfig.mockResolvedValueOnce({ enabled: { pdf: false } })
    const { useSkillsStore } = await import('./skillsStore.js')
    await useSkillsStore.getState().load()
    const s = useSkillsStore.getState()
    expect(s.skills).toHaveLength(1)
    expect(s.enabled).toEqual({ pdf: false })
    expect(s.loaded).toBe(true)
  })

  it('toggle(id, on) persists the enabled map and updates state', async () => {
    const { useSkillsStore } = await import('./skillsStore.js')
    useSkillsStore.setState({ skills: [META], enabled: {}, loaded: true })
    await useSkillsStore.getState().toggle('pdf', false)
    expect(useSkillsStore.getState().enabled.pdf).toBe(false)
    expect(setSkillsConfig).toHaveBeenCalledWith({ enabled: { pdf: false } })
  })

  it('install(zip) installs then reloads the list', async () => {
    installSkillZip.mockResolvedValueOnce('pdf')
    listSkills.mockResolvedValueOnce([META])
    getSkillsConfig.mockResolvedValueOnce({ enabled: {} })
    const { useSkillsStore } = await import('./skillsStore.js')
    await useSkillsStore.getState().install('/tmp/x.zip')
    expect(installSkillZip).toHaveBeenCalledWith('/tmp/x.zip')
    expect(useSkillsStore.getState().skills).toHaveLength(1)
  })

  it('remove(id) deletes, drops from list, and clears its enabled entry', async () => {
    const { useSkillsStore } = await import('./skillsStore.js')
    useSkillsStore.setState({ skills: [META], enabled: { pdf: false }, loaded: true })
    await useSkillsStore.getState().remove('pdf')
    expect(deleteSkill).toHaveBeenCalledWith('pdf')
    expect(useSkillsStore.getState().skills).toHaveLength(0)
    expect(useSkillsStore.getState().enabled.pdf).toBeUndefined()
    expect(setSkillsConfig).toHaveBeenCalledWith({ enabled: {} })
  })
})
```

- [ ] **Step 2: Run it, expect FAIL.**
  Run: `yarn vitest run src/store/skillsStore.test.ts 2>&1 | tail -20`
  Expected: failure — `Cannot find module './skillsStore'` / unresolved import.

- [ ] **Step 3: Minimal impl.** Create `src/store/skillsStore.ts` (mirrors `agentsStore.ts` style):

```ts
import { create } from 'zustand'
import type { SkillMeta } from '@hip/protocol'
import {
  listSkills,
  installSkillZip,
  deleteSkill,
  getSkillsConfig,
  setSkillsConfig,
} from '@/ipc/skills'

interface SkillsStore {
  skills: SkillMeta[]
  enabled: Record<string, boolean>
  loaded: boolean
  load: () => Promise<void>
  toggle: (id: string, on: boolean) => Promise<void>
  install: (zipPath: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  skills: [],
  enabled: {},
  loaded: false,
  load: async () => {
    const [skills, cfg] = await Promise.all([listSkills(), getSkillsConfig()])
    set({ skills, enabled: cfg.enabled, loaded: true })
  },
  toggle: async (id, on) => {
    const enabled = { ...get().enabled, [id]: on }
    await setSkillsConfig({ enabled })
    set({ enabled })
  },
  install: async (zipPath) => {
    await installSkillZip(zipPath)
    const [skills, cfg] = await Promise.all([listSkills(), getSkillsConfig()])
    set({ skills, enabled: cfg.enabled })
  },
  remove: async (id) => {
    await deleteSkill(id)
    const enabled = { ...get().enabled }
    delete enabled[id]
    await setSkillsConfig({ enabled })
    set({ skills: get().skills.filter((s) => s.id !== id), enabled })
  },
}))
```

- [ ] **Step 4: Run, expect PASS.**
  Run: `yarn vitest run src/store/skillsStore.test.ts 2>&1 | tail -20`
  Expected: `Test Files  1 passed` with all 4 tests green.

- [ ] **Step 5: Commit.**
  Run: `git add src/store/skillsStore.ts src/store/skillsStore.test.ts && git commit -m "feat(skills): skillsStore (load/toggle/install/remove) + tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 30: i18n — `settings.skillLabel` + `settings.skill.*` (3 files)

**Files:**
- Modify `src/i18n/en.ts` (add after `agentsLabel` on line 239)
- Modify `src/i18n/zh-CN.ts` (same keys, after line 239)
- Modify `src/i18n/zh-TW.ts` (same keys, after line 239)

- [ ] **Step 1: Add EN keys.** In `src/i18n/en.ts`, insert immediately after the `agentsLabel: 'Agent Management',` line (line 239):

```ts
      skillLabel: 'Skills',
      skill: {
        title: 'Skills',
        intro: 'Install Claude-format skills (SKILL.md folders). hip loads enabled skills on demand.',
        upload: 'Upload skill (.zip)',
        empty: 'No skills installed yet.',
        emptyHint: 'Upload a .zip, or drop a skill folder into ~/.hip/skills/',
        hasScripts: 'Has scripts',
        hasScriptsTitle: 'This skill ships scripts. Running them asks for your approval each time.',
        view: 'View',
        delete: 'Delete',
        viewTitle: 'Skill: {{name}}',
        menuMore: 'More actions',
        enableThis: 'Enable this skill',
        deleteConfirmTitle: 'Delete skill "{{name}}"?',
        deleteConfirmBody: 'This removes the skill folder from disk. This cannot be undone.',
        cancel: 'Cancel',
        installError: 'Install failed. Make sure the .zip contains a SKILL.md.',
        loadError: 'Could not read this skill file.',
      },
```

- [ ] **Step 2: Add zh-CN keys.** In `src/i18n/zh-CN.ts`, insert after the `agentsLabel:` line (line 239):

```ts
      skillLabel: '技能',
      skill: {
        title: '技能',
        intro: '安装 Claude 格式的技能（SKILL.md 文件夹）。hip 会按需加载已启用的技能。',
        upload: '上传技能（.zip）',
        empty: '尚未安装任何技能。',
        emptyHint: '上传 .zip，或把技能文件夹放进 ~/.hip/skills/',
        hasScripts: '含脚本',
        hasScriptsTitle: '该技能自带脚本。运行脚本时每次都会请求你确认。',
        view: '查看',
        delete: '删除',
        viewTitle: '技能：{{name}}',
        menuMore: '更多操作',
        enableThis: '启用此技能',
        deleteConfirmTitle: '删除技能「{{name}}」？',
        deleteConfirmBody: '将从磁盘移除该技能文件夹，此操作不可撤销。',
        cancel: '取消',
        installError: '安装失败。请确认 .zip 内含 SKILL.md。',
        loadError: '无法读取该技能文件。',
      },
```

- [ ] **Step 3: Add zh-TW keys.** In `src/i18n/zh-TW.ts`, insert after the `agentsLabel:` line (line 239):

```ts
      skillLabel: '技能',
      skill: {
        title: '技能',
        intro: '安裝 Claude 格式的技能（SKILL.md 資料夾）。hip 會按需載入已啟用的技能。',
        upload: '上傳技能（.zip）',
        empty: '尚未安裝任何技能。',
        emptyHint: '上傳 .zip，或把技能資料夾放進 ~/.hip/skills/',
        hasScripts: '含腳本',
        hasScriptsTitle: '該技能自帶腳本。執行腳本時每次都會請求你確認。',
        view: '檢視',
        delete: '刪除',
        viewTitle: '技能：{{name}}',
        menuMore: '更多操作',
        enableThis: '啟用此技能',
        deleteConfirmTitle: '刪除技能「{{name}}」？',
        deleteConfirmBody: '將從磁碟移除該技能資料夾，此操作無法復原。',
        cancel: '取消',
        installError: '安裝失敗。請確認 .zip 內含 SKILL.md。',
        loadError: '無法讀取該技能檔案。',
      },
```

- [ ] **Step 4: Type-check (catches `as const satisfies` mismatch across the 3 locales).**
  Run: `yarn type-check 2>&1 | tail -15`
  Expected: no errors. (If react-i18next complains about a key-shape mismatch, the three locales differ — reconcile so all three carry the identical `skill.*` keys.)

- [ ] **Step 5: Commit.**
  Run: `git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts && git commit -m "i18n(skills): add settings.skillLabel + settings.skill.* (en/zh-CN/zh-TW)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 31: Frontend UI — `SkillConfig.tsx` (list + upload + view modal) and register the settings page

**Files:**
- Create `src/components/account/SkillConfig.tsx` (list cards, upload button, empty state, `SkillViewModal`, inline delete dialog)
- Modify `src/components/account/SettingsPanel.tsx` (`PAGES` += `skill` entry; import `Sparkles` + `SkillConfig`)

- [ ] **Step 1: Create the component.** Create `src/components/account/SkillConfig.tsx`. Patterns mirror `AgentManagement.tsx` (store-driven, `useEffect` load), `AgentCard.tsx` (card layout + `Switch` + kebab `DropdownMenu modal={false}`), `DeleteAgentDialog.tsx` (delete modal), and `FilePreview.tsx` (read-only markdown via `ReactMarkdown` with the `max-w-none text-prose leading-relaxed text-ink` class set — `prose-hip` does NOT exist in this repo, so use the plain class set FilePreview uses):

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { Sparkles, Upload, FileText, Eye, Trash2, MoreVertical, TerminalSquare } from 'lucide-react'
import type { SkillMeta } from '@hip/protocol'
import { useSkillsStore } from '@/store/skillsStore'
import { pickZipFile } from '@/ipc/dialog'
import { readSkillFile } from '@/ipc/skills'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Modal } from '@/components/ui/Modal'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu'

export function SkillConfig() {
  const { t } = useTranslation()
  const { skills, enabled, loaded, load, toggle, install, remove } = useSkillsStore()
  const [viewing, setViewing] = useState<SkillMeta | null>(null)
  const [deleting, setDeleting] = useState<SkillMeta | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const onUpload = async () => {
    setError(null)
    const zip = await pickZipFile()
    if (!zip) return
    try {
      await install(zip)
    } catch {
      setError(t('settings.skill.installError'))
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-title font-semibold text-ink">{t('settings.skill.title')}</h2>
          <p className="mt-1 text-body text-ink-secondary">{t('settings.skill.intro')}</p>
        </div>
        <Button size="sm" onClick={() => void onUpload()}>
          <Upload size={15} /> {t('settings.skill.upload')}
        </Button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-meta text-danger">
          {error}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2.5">
        {skills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-8 text-center">
            <Sparkles size={22} className="mx-auto text-ink-tertiary" />
            <div className="mt-2 text-body text-ink-secondary">{t('settings.skill.empty')}</div>
            <div className="mt-1 text-meta text-ink-tertiary">{t('settings.skill.emptyHint')}</div>
          </div>
        ) : (
          skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              enabled={enabled[skill.id] !== false}
              onToggle={(on) => void toggle(skill.id, on)}
              onView={() => setViewing(skill)}
              onDelete={() => setDeleting(skill)}
            />
          ))
        )}
      </div>

      {viewing && <SkillViewModal skill={viewing} onClose={() => setViewing(null)} />}

      {deleting && (
        <Modal
          open
          onOpenChange={(o) => {
            if (!o) setDeleting(null)
          }}
          title={t('settings.skill.deleteConfirmTitle', { name: deleting.name })}
          className="max-w-sm"
        >
          <div className="p-5">
            <p className="text-body text-ink-secondary">{t('settings.skill.deleteConfirmBody')}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleting(null)}>
                {t('settings.skill.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  void remove(deleting.id)
                  setDeleting(null)
                }}
              >
                {t('settings.skill.delete')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function SkillCard({
  skill,
  enabled,
  onToggle,
  onView,
  onDelete,
}: {
  skill: SkillMeta
  enabled: boolean
  onToggle: (on: boolean) => void
  onView: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-border bg-surface px-4 py-3.5">
      <Avatar name={skill.name} shape="square" size={38} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium text-ink">{skill.name}</span>
          {skill.hasScripts && (
            <Badge title={t('settings.skill.hasScriptsTitle')}>
              <TerminalSquare size={11} />
              {t('settings.skill.hasScripts')}
            </Badge>
          )}
        </div>
        {skill.description && (
          <div className="mt-1 truncate text-caption text-ink-tertiary">{skill.description}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <Switch checked={enabled} onCheckedChange={onToggle} ariaLabel={t('settings.skill.enableThis')} />
        {/* modal={false}: a modal menu + a dialog its item opens both lock body{pointer-events:none};
            stacking them leaves the lock stuck after close. A kebab needs no trap, so non-modal is safe. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              aria-label={t('settings.skill.menuMore')}
            >
              <MoreVertical size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onView}>
              <Eye size={14} /> {t('settings.skill.view')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-danger focus:bg-danger/10" onSelect={onDelete}>
              <Trash2 size={14} /> {t('settings.skill.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function SkillViewModal({ skill, onClose }: { skill: SkillMeta; onClose: () => void }) {
  const { t } = useTranslation()
  const [body, setBody] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    setBody(null)
    setError(false)
    readSkillFile(skill.id, 'SKILL.md')
      .then((b) => {
        if (live) setBody(b)
      })
      .catch(() => {
        if (live) setError(true)
      })
    return () => {
      live = false
    }
  }, [skill.id])

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={t('settings.skill.viewTitle', { name: skill.name })}
      resizable
      storageKey="skill-view"
    >
      <div className="p-6">
        {error ? (
          <div className="flex items-center gap-2 text-body text-danger">
            <FileText size={16} /> {t('settings.skill.loadError')}
          </div>
        ) : body === null ? (
          <div className="text-body text-ink-tertiary">…</div>
        ) : (
          <div className="max-w-none text-prose leading-relaxed text-ink">
            <ReactMarkdown>{body}</ReactMarkdown>
          </div>
        )}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Register the settings page.** In `src/components/account/SettingsPanel.tsx`, extend the `lucide-react` import (line 5) and the imports (after line 10), then add the `PAGES` entry.

Replace the icon import line:
```tsx
import { SlidersHorizontal, Cpu, Bot } from 'lucide-react'
```
with:
```tsx
import { SlidersHorizontal, Cpu, Bot, Sparkles } from 'lucide-react'
```

Add after the `AgentManagement` import (line 10):
```tsx
import { SkillConfig } from './SkillConfig'
```

Replace the `PAGES` array:
```tsx
const PAGES = [
  { id: 'general', icon: SlidersHorizontal, labelKey: 'settings.general', Component: GeneralSettings },
  { id: 'model', icon: Cpu, labelKey: 'settings.model', Component: ModelConfig },
  { id: 'agents', icon: Bot, labelKey: 'settings.agentsLabel', Component: AgentManagement },
] as const
```
with:
```tsx
const PAGES = [
  { id: 'general', icon: SlidersHorizontal, labelKey: 'settings.general', Component: GeneralSettings },
  { id: 'model', icon: Cpu, labelKey: 'settings.model', Component: ModelConfig },
  { id: 'agents', icon: Bot, labelKey: 'settings.agentsLabel', Component: AgentManagement },
  { id: 'skill', icon: Sparkles, labelKey: 'settings.skillLabel', Component: SkillConfig },
] as const
```

> Note: the MCP page (`{ id: 'mcp', icon: Plug, labelKey: 'settings.mcpLabel', Component: McpConfig }`) is added by the MCP slice. If that slice has already landed, the `import { McpConfig }` line and `mcp` entry will already be present — leave them, and insert the `skill` entry directly after the `mcp` entry. The array stays `as const`.

- [ ] **Step 3: Type-check + build.**
  Run: `yarn type-check 2>&1 | tail -15`
  Expected: no errors.
  Run: `yarn build 2>&1 | tail -15`
  Expected: `tsc` clean then `vite build` emits `dist/` with no errors.

- [ ] **Step 4: Commit.**
  Run: `git add src/components/account/SkillConfig.tsx src/components/account/SettingsPanel.tsx && git commit -m "feat(skills): SkillConfig settings page (list/upload/view/delete) + register page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 32: Slice-wide verification (paid-free) + commit

**Files:** (none — verification only)

- [ ] **Step 1: Move auth.json aside to guarantee paid-free, then run the full JS test suite.** (Per memory: `yarn test` re-seeds keys from `~/.hip/config/auth.json`; move it so no real-LLM suite can fire.)
  Run: `AUTH=~/.hip/config/auth.json; [ -f "$AUTH" ] && mv "$AUTH" "$AUTH.slice30-bak" || true; yarn test 2>&1 | tail -25; [ -f "$AUTH.slice30-bak" ] && mv "$AUTH.slice30-bak" "$AUTH" || true`
  Expected: `Test Files ... passed` overall green (including `src/ipc/skills.test.ts` and `src/store/skillsStore.test.ts`); no network/paid-LLM suite executed. The trap-restore puts `auth.json` back regardless of outcome.

- [ ] **Step 2: Full Rust test suite.**
  Run: `cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20`
  Expected: `test result: ok.` across the `paths::`, `skills::`, `auth::`, and `sidecar::` modules.

- [ ] **Step 3: Final type-check.**
  Run: `yarn type-check 2>&1 | tail -10`
  Expected: no errors.

- [ ] **Step 4: Confirm clean tree (everything already committed in prior tasks).**
  Run: `git status --short`
  Expected: empty output (all slice work committed). If anything is unstaged, commit it:
  Run: `git add -A && git commit -m "chore(skills): slice verification cleanup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

## Slice 5: Skill runtime — sidecar registry

### Task 33: Frontmatter splitter helper (TDD)

**Files:**
- Create: `packages/sidecar/src/session/skills/frontmatter.ts`
- Create: `packages/sidecar/src/session/skills/frontmatter.test.ts`

This task builds a tiny dependency-free YAML-frontmatter splitter (no `js-yaml`/`gray-matter` in `packages/sidecar/package.json`, confirmed). It only needs to extract scalar `name`/`description` keys from a leading `---`-fenced block — exactly what `SKILL.md` carries. Task 34 consumes it.

- [ ] **Step 1: Write the failing test [full code]**

```ts
// packages/sidecar/src/session/skills/frontmatter.test.ts
import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from './frontmatter.js'

describe('parseFrontmatter', () => {
  it('extracts scalar keys from a leading --- fenced block', () => {
    const src = [
      '---',
      'name: PDF Filler',
      'description: Fill PDF forms from a CSV.',
      '---',
      '',
      '# Body',
      'Some markdown here.',
    ].join('\n')
    const { data, body } = parseFrontmatter(src)
    expect(data.name).toBe('PDF Filler')
    expect(data.description).toBe('Fill PDF forms from a CSV.')
    expect(body).toBe('# Body\nSome markdown here.')
  })

  it('strips matching single/double quotes around values', () => {
    const src = ['---', "name: 'Quoted Name'", 'description: "Has: a colon"', '---', 'b'].join('\n')
    const { data } = parseFrontmatter(src)
    expect(data.name).toBe('Quoted Name')
    expect(data.description).toBe('Has: a colon')
  })

  it('ignores unknown extra keys without throwing', () => {
    const src = ['---', 'name: X', 'version: 3', 'tags: a,b', '---', 'body'].join('\n')
    const { data } = parseFrontmatter(src)
    expect(data.name).toBe('X')
    expect(data.version).toBe('3')
  })

  it('returns empty data and the whole input as body when there is no frontmatter', () => {
    const src = '# No frontmatter\njust text'
    const { data, body } = parseFrontmatter(src)
    expect(data).toEqual({})
    expect(body).toBe(src)
  })

  it('returns empty data when the opening --- is not on the very first line', () => {
    const src = '\n---\nname: X\n---\nbody'
    const { data, body } = parseFrontmatter(src)
    expect(data).toEqual({})
    expect(body).toBe(src)
  })

  it('handles CRLF line endings', () => {
    const src = ['---', 'name: CRLF', 'description: ok', '---', 'body'].join('\r\n')
    const { data, body } = parseFrontmatter(src)
    expect(data.name).toBe('CRLF')
    expect(body).toBe('body')
  })

  it('returns the whole input as body when the closing --- is missing', () => {
    const src = '---\nname: X\nnever closes'
    const { data, body } = parseFrontmatter(src)
    expect(data).toEqual({})
    expect(body).toBe(src)
  })
})
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd /Users/lijiamin/data/my-github/hip && npx vitest run packages/sidecar/src/session/skills/frontmatter.test.ts`

Expected: failure resolving the import — `Failed to load url ./frontmatter.js` / `Cannot find module './frontmatter.js'` (the file does not exist yet). No tests pass.

- [ ] **Step 3: Minimal impl [full code]**

```ts
// packages/sidecar/src/session/skills/frontmatter.ts

/** Parsed frontmatter: scalar string values keyed by their YAML field name. */
export interface Frontmatter {
  data: Record<string, string>
  body: string
}

/** Strip one matching pair of surrounding single or double quotes from a scalar value. */
function unquote(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2) {
    const first = v[0]
    const last = v[v.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1)
    }
  }
  return v
}

/**
 * Minimal, dependency-free YAML-frontmatter splitter for SKILL.md.
 * Only flat `key: value` scalar lines are parsed (enough for `name`/`description`);
 * non-scalar/nested YAML is ignored. No frontmatter (or a missing closing fence,
 * or an opening fence not on line 1) → empty data and the whole input as body.
 */
export function parseFrontmatter(src: string): Frontmatter {
  const normalized = src.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0] !== '---') return { data: {}, body: src }

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { end = i; break }
  }
  if (end === -1) return { data: {}, body: src }

  const data: Record<string, string> = {}
  for (let i = 1; i < end; i++) {
    const line = lines[i]
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    if (!key) continue
    data[key] = unquote(line.slice(colon + 1))
  }

  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '')
  return { data, body }
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `cd /Users/lijiamin/data/my-github/hip && npx vitest run packages/sidecar/src/session/skills/frontmatter.test.ts`

Expected: `Test Files  1 passed (1)` and `Tests  7 passed (7)`.

- [ ] **Step 5: Commit**

Run: `cd /Users/lijiamin/data/my-github/hip && git add packages/sidecar/src/session/skills/frontmatter.ts packages/sidecar/src/session/skills/frontmatter.test.ts && git commit -m "feat(sidecar): add minimal SKILL.md frontmatter splitter"`

Expected: one commit created; `git status` clean for those paths.

---

### Task 34: `readEnabledSkills` — scan + frontmatter + enabled cross-ref (TDD)

**Files:**
- Create: `packages/sidecar/src/session/skills/registry.ts` (the `readEnabledSkills` export)
- Create: `packages/sidecar/src/session/skills/registry.test.ts`

Mirrors the read pattern of `packages/sidecar/src/config/providers.ts` (`process.env.X?.trim()` → `readFileSync` → parse → `[]`/skip on error) and the temp-dir fixture style of `providers.test.ts`. `SkillMeta`/`SkillsConfig` are imported from `@hip/protocol` (added by the protocol-types slice; their contract is `SkillMeta { id; name; description; dir; hasScripts }` and `SkillsConfig { enabled: Record<string, boolean> }`, where a skill id missing from the map counts as enabled).

- [ ] **Step 1: Write the failing test [full code]**

```ts
// packages/sidecar/src/session/skills/registry.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readEnabledSkills } from './registry.js'

const dirs: string[] = []

/** Make a temp ~/.hip/skills root with one skill folder + SKILL.md content. */
function makeSkillsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hip-skills-'))
  dirs.push(root)
  return root
}
function addSkill(root: string, folder: string, skillMd: string, extra?: { scripts?: boolean }): string {
  const dir = join(root, folder)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), skillMd)
  if (extra?.scripts) {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'run.sh'), 'echo hi\n')
  }
  return dir
}
function fm(name: string, description: string): string {
  return ['---', `name: ${name}`, `description: ${description}`, '---', '', 'Body text.'].join('\n')
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.HIP_SKILLS_DIR
  delete process.env.HIP_SKILLS_PATH
})

describe('readEnabledSkills', () => {
  it('returns [] when HIP_SKILLS_DIR is unset', () => {
    delete process.env.HIP_SKILLS_DIR
    expect(readEnabledSkills()).toEqual([])
  })

  it('returns [] when the skills dir does not exist', () => {
    process.env.HIP_SKILLS_DIR = join(tmpdir(), 'hip-skills-does-not-exist-xyz')
    expect(readEnabledSkills()).toEqual([])
  })

  it('parses a skill with frontmatter into a SkillMeta', () => {
    const root = makeSkillsRoot()
    const dir = addSkill(root, 'pdf-filler', fm('PDF Filler', 'Fill PDF forms.'))
    process.env.HIP_SKILLS_DIR = root
    const skills = readEnabledSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0]).toEqual({
      id: 'pdf-filler',
      name: 'PDF Filler',
      description: 'Fill PDF forms.',
      dir,
      hasScripts: false,
    })
  })

  it('uses the folder name as the id', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'my-cool-skill', fm('Totally Different Name', 'desc'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].id).toBe('my-cool-skill')
  })

  it('detects hasScripts when a scripts/ subdir exists', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'with-scripts', fm('With Scripts', 'desc'), { scripts: true })
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills()[0].hasScripts).toBe(true)
  })

  it('skips folders without a SKILL.md', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'good', fm('Good', 'desc'))
    mkdirSync(join(root, 'empty-folder'), { recursive: true })
    process.env.HIP_SKILLS_DIR = root
    const skills = readEnabledSkills()
    expect(skills.map((s) => s.id)).toEqual(['good'])
  })

  it('skips a SKILL.md whose frontmatter has no name', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'good', fm('Good', 'desc'))
    addSkill(root, 'nameless', ['---', 'description: no name here', '---', 'body'].join('\n'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['good'])
  })

  it('treats a skill missing from the enabled map as enabled', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'a', fm('A', 'da'))
    process.env.HIP_SKILLS_DIR = root
    const cfgDir = mkdtempSync(join(tmpdir(), 'hip-skills-cfg-'))
    dirs.push(cfgDir)
    const cfgPath = join(cfgDir, 'hip-skills.json')
    writeFileSync(cfgPath, JSON.stringify({ enabled: {} }))
    process.env.HIP_SKILLS_PATH = cfgPath
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['a'])
  })

  it('excludes a skill explicitly disabled in the enabled map', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'a', fm('A', 'da'))
    addSkill(root, 'b', fm('B', 'db'))
    process.env.HIP_SKILLS_DIR = root
    const cfgDir = mkdtempSync(join(tmpdir(), 'hip-skills-cfg-'))
    dirs.push(cfgDir)
    const cfgPath = join(cfgDir, 'hip-skills.json')
    writeFileSync(cfgPath, JSON.stringify({ enabled: { b: false } }))
    process.env.HIP_SKILLS_PATH = cfgPath
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['a'])
  })

  it('ignores a corrupt enabled map and treats all skills as enabled', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'a', fm('A', 'da'))
    process.env.HIP_SKILLS_DIR = root
    const cfgDir = mkdtempSync(join(tmpdir(), 'hip-skills-cfg-'))
    dirs.push(cfgDir)
    const cfgPath = join(cfgDir, 'hip-skills.json')
    writeFileSync(cfgPath, 'not-json{{')
    process.env.HIP_SKILLS_PATH = cfgPath
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['a'])
  })

  it('returns skills sorted by id for stable ordering', () => {
    const root = makeSkillsRoot()
    addSkill(root, 'zebra', fm('Zebra', 'dz'))
    addSkill(root, 'alpha', fm('Alpha', 'da'))
    process.env.HIP_SKILLS_DIR = root
    expect(readEnabledSkills().map((s) => s.id)).toEqual(['alpha', 'zebra'])
  })
})
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd /Users/lijiamin/data/my-github/hip && npx vitest run packages/sidecar/src/session/skills/registry.test.ts`

Expected: failure resolving the import — `Cannot find module './registry.js'` (file does not exist yet). No tests pass.

- [ ] **Step 3: Minimal impl [full code]**

```ts
// packages/sidecar/src/session/skills/registry.ts
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SkillMeta, SkillsConfig } from '@hip/protocol'
import { parseFrontmatter } from './frontmatter.js'

/** Read the enabled/disabled map from HIP_SKILLS_PATH. Missing/corrupt → {} (everything enabled). */
function readEnabledMap(): Record<string, boolean> {
  const file = process.env.HIP_SKILLS_PATH?.trim()
  if (!file) return {}
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as SkillsConfig
    return cfg?.enabled && typeof cfg.enabled === 'object' ? cfg.enabled : {}
  } catch {
    return {}
  }
}

/** True when <dir>/scripts exists and is a directory. */
function detectScripts(dir: string): boolean {
  try {
    return statSync(join(dir, 'scripts')).isDirectory()
  } catch {
    return false
  }
}

/**
 * Scan HIP_SKILLS_DIR/<folder>/SKILL.md, parse YAML frontmatter (name/description),
 * cross-reference the HIP_SKILLS_PATH enabled map (a skill missing from the map counts
 * as enabled), and return the enabled SkillMeta[] sorted by id. Folders without a
 * SKILL.md, or whose frontmatter has no `name`, are skipped. Called every turn; never throws.
 */
export function readEnabledSkills(): SkillMeta[] {
  const root = process.env.HIP_SKILLS_DIR?.trim()
  if (!root || !existsSync(root)) return []

  const enabled = readEnabledMap()
  const out: SkillMeta[] = []

  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }

  for (const folder of entries) {
    const dir = join(root, folder)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const skillMd = join(dir, 'SKILL.md')
    if (!existsSync(skillMd)) continue

    let raw: string
    try {
      raw = readFileSync(skillMd, 'utf8')
    } catch {
      continue
    }
    const { data } = parseFrontmatter(raw)
    const name = data.name?.trim()
    if (!name) continue

    const id = folder
    if (enabled[id] === false) continue

    out.push({
      id,
      name,
      description: data.description?.trim() ?? '',
      dir,
      hasScripts: detectScripts(dir),
    })
  }

  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `cd /Users/lijiamin/data/my-github/hip && npx vitest run packages/sidecar/src/session/skills/registry.test.ts`

Expected: `Test Files  1 passed (1)` and `Tests  11 passed (11)`.

- [ ] **Step 5: Type-check the sidecar (confirms `@hip/protocol` SkillMeta/SkillsConfig resolve)**

Run: `cd /Users/lijiamin/data/my-github/hip && yarn workspace @hip/sidecar type-check`

Expected: exits 0, no output. (If it errors with `Module '"@hip/protocol"' has no exported member 'SkillMeta'`, the protocol-types slice has not landed yet — that slice owns `SkillMeta`/`SkillsConfig`; coordinate ordering, do not redefine the types here.)

- [ ] **Step 6: Commit**

Run: `cd /Users/lijiamin/data/my-github/hip && git add packages/sidecar/src/session/skills/registry.ts packages/sidecar/src/session/skills/registry.test.ts && git commit -m "feat(sidecar): readEnabledSkills scans SKILL.md + cross-refs enabled map"`

Expected: one commit created; clean status for those paths.

---

### Task 35: `readSkillBody` + `listSkillFiles` (TDD)

**Files:**
- Modify: `packages/sidecar/src/session/skills/registry.ts` (add two exports below `readEnabledSkills`)
- Modify: `packages/sidecar/src/session/skills/registry.test.ts` (append two `describe` blocks)

`readSkillBody(dir)` returns the Markdown body of `<dir>/SKILL.md` (frontmatter stripped, via `parseFrontmatter`). `listSkillFiles(dir)` returns every file's path relative to `dir` (recursive), for the `use_skill` file manifest. Both are consumed by the core-wiring slice's `use_skill` tool — this slice only provides them.

- [ ] **Step 1: Append failing tests [full code]**

```ts
// append to packages/sidecar/src/session/skills/registry.test.ts
import { readSkillBody, listSkillFiles } from './registry.js'

describe('readSkillBody', () => {
  it('returns the SKILL.md body with frontmatter stripped', () => {
    const root = makeSkillsRoot()
    const dir = addSkill(
      root,
      'doc',
      ['---', 'name: Doc', 'description: d', '---', '', '# Heading', 'paragraph'].join('\n'),
    )
    expect(readSkillBody(dir)).toBe('# Heading\nparagraph')
  })

  it('returns the whole file when there is no frontmatter', () => {
    const root = makeSkillsRoot()
    const dir = join(root, 'plain')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '# Just a heading\nno frontmatter')
    expect(readSkillBody(dir)).toBe('# Just a heading\nno frontmatter')
  })

  it('returns "" when SKILL.md is missing', () => {
    const root = makeSkillsRoot()
    const dir = join(root, 'ghost')
    mkdirSync(dir, { recursive: true })
    expect(readSkillBody(dir)).toBe('')
  })
})

describe('listSkillFiles', () => {
  it('lists files relative to the skill dir, recursively, with forward slashes', () => {
    const root = makeSkillsRoot()
    const dir = join(root, 'multi')
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    mkdirSync(join(dir, 'references'), { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), 'body')
    writeFileSync(join(dir, 'scripts', 'run.sh'), 'echo')
    writeFileSync(join(dir, 'references', 'guide.md'), 'g')
    const files = listSkillFiles(dir).sort()
    expect(files).toEqual(['SKILL.md', 'references/guide.md', 'scripts/run.sh'])
  })

  it('returns [] when the dir does not exist', () => {
    expect(listSkillFiles(join(tmpdir(), 'hip-skills-no-such-dir-zzz'))).toEqual([])
  })

  it('returns [] for an empty dir', () => {
    const root = makeSkillsRoot()
    const dir = join(root, 'empty')
    mkdirSync(dir, { recursive: true })
    expect(listSkillFiles(dir)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd /Users/lijiamin/data/my-github/hip && npx vitest run packages/sidecar/src/session/skills/registry.test.ts`

Expected: failures in the new `readSkillBody` / `listSkillFiles` suites — `readSkillBody is not a function` / `listSkillFiles is not a function` (exports do not exist yet). The 11 `readEnabledSkills` tests still pass.

- [ ] **Step 3: Add impl [full code — append to registry.ts]**

```ts
// append to packages/sidecar/src/session/skills/registry.ts

/** Read the Markdown body of <dir>/SKILL.md (frontmatter stripped). Missing/unreadable → "". */
export function readSkillBody(dir: string): string {
  try {
    const raw = readFileSync(join(dir, 'SKILL.md'), 'utf8')
    return parseFrontmatter(raw).body
  } catch {
    return ''
  }
}

/**
 * Relative paths (forward-slashed) of every file under a skill dir, recursively —
 * the file manifest handed to the model by use_skill. Missing/unreadable dir → [].
 */
export function listSkillFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string, prefix: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = join(current, entry)
      const rel = prefix ? `${prefix}/${entry}` : entry
      let isDir = false
      try {
        isDir = statSync(abs).isDirectory()
      } catch {
        continue
      }
      if (isDir) walk(abs, rel)
      else out.push(rel)
    }
  }
  walk(dir, '')
  return out
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `cd /Users/lijiamin/data/my-github/hip && npx vitest run packages/sidecar/src/session/skills/registry.test.ts`

Expected: `Test Files  1 passed (1)` and `Tests  17 passed (17)`.

- [ ] **Step 5: Type-check the sidecar**

Run: `cd /Users/lijiamin/data/my-github/hip && yarn workspace @hip/sidecar type-check`

Expected: exits 0, no output.

- [ ] **Step 6: Commit**

Run: `cd /Users/lijiamin/data/my-github/hip && git add packages/sidecar/src/session/skills/registry.ts packages/sidecar/src/session/skills/registry.test.ts && git commit -m "feat(sidecar): add readSkillBody + listSkillFiles to skills registry"`

Expected: one commit created; clean status for those paths.

## Slice 6: Core wiring — buildTools opts, use_skill, run_script (HITL), prompt injection, session assembly

> This slice depends on `SkillMeta`/`SkillsConfig` types existing in `@hip/protocol` and on `packages/sidecar/src/session/skills/registry.ts` exporting `readEnabledSkills()`, `readSkillBody(dir)`, `listSkillFiles(dir)`, plus `packages/sidecar/src/session/mcp/manager.ts` exporting the `mcpManager` singleton with `reconcile()`/`tools()`, and `packages/sidecar/src/config/mcp-servers.ts` exporting `readMcpServersConfig()`. Those are built in earlier slices. This slice imports them but stubs/fakes them in tests so it can be developed independently. (`SkillMeta` already exists in `@hip/protocol`; the `skills/`, `mcp/` and `config/mcp-servers.ts` modules are owned by earlier slices — confirm `packages/sidecar/src/session/skills/registry.ts`, `packages/sidecar/src/session/mcp/manager.ts`, and `packages/sidecar/src/config/mcp-servers.ts` exist before Task 36/54 build green.)

---

### Task 36: Add `ApprovalFn` type + extend `buildTools` opts with `use_skill` and `run_script`

**Files:**
- Modify `packages/sidecar/src/session/tools.ts` (the `buildTools` signature + a new tail block adding `use_skill` / `run_script` / merging `mcpTools`; new imports for `child_process`, `SkillMeta`, `readSkillBody`/`listSkillFiles`; new size/timeout constants)
- Create test `packages/sidecar/src/session/tools-skill-script.test.ts`

- [ ] **Step 1: Write the failing test.** Create `packages/sidecar/src/session/tools-skill-script.test.ts` with the COMPLETE contents below. It covers `use_skill` (body + manifest from a temp skill dir), `run_script` auto-approve (`echo hi`), `run_script` reject + cancel paths (no exec, refusal text), and output truncation (a 64KB cap).

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillMeta } from '@hip/protocol'
import { buildTools, type ApprovalFn } from './tools.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-toolsx-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function byName(tools: ReturnType<typeof buildTools>, name: string) {
  return tools.find((t) => t.name === name)!
}

/** A skill living at <root>/skills/<id> with a SKILL.md body + one script file. */
function makeSkill(id: string, name: string, body: string): SkillMeta {
  const dir = join(root, 'skills', id)
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n${body}`, 'utf8')
  writeFileSync(join(dir, 'scripts', 'run.sh'), 'echo run', 'utf8')
  return { id, name, description: 'd', dir, hasScripts: true }
}

const allowApproval: ApprovalFn = async () => ({ optionId: 'allow_once' })
const rejectApproval: ApprovalFn = async () => ({ optionId: 'reject_once' })

describe('use_skill tool', () => {
  it('is absent when no skills are given', () => {
    const tools = buildTools(root, undefined, root, undefined, {})
    expect(tools.find((t) => t.name === 'use_skill')).toBeUndefined()
  })

  it('returns the SKILL.md body plus a file manifest', async () => {
    const skill = makeSkill('formatter', 'formatter', 'Run scripts/run.sh to format.')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'formatter' }))
    expect(out).toContain('Run scripts/run.sh to format.')
    expect(out).toContain('scripts/run.sh')
    expect(out).toContain('SKILL.md')
  })

  it('reports a missing skill by name', async () => {
    const skill = makeSkill('a', 'a', 'body')
    const tools = buildTools(root, undefined, root, undefined, { skills: [skill] })
    const out = String(await byName(tools, 'use_skill').invoke({ name: 'nope' }))
    expect(out).toMatch(/not found|不存在/i)
  })
})

describe('run_script tool', () => {
  it('is absent when no requestApproval is given', () => {
    const tools = buildTools(root, undefined, root, undefined, {})
    expect(tools.find((t) => t.name === 'run_script')).toBeUndefined()
  })

  it('executes after approval and returns exit code + stdout', async () => {
    const tools = buildTools(root, undefined, root, undefined, { requestApproval: allowApproval })
    const out = String(await byName(tools, 'run_script').invoke({ command: 'echo hi' }))
    expect(out).toContain('hi')
    expect(out).toMatch(/exit(Code)?\D*0/i)
  })

  it('does not execute and returns a refusal when rejected', async () => {
    const marker = join(root, 'should-not-exist.txt')
    const tools = buildTools(root, undefined, root, undefined, { requestApproval: rejectApproval })
    const out = String(await byName(tools, 'run_script').invoke({ command: `touch ${marker}` }))
    expect(out).toMatch(/拒绝|reject|declined/i)
    expect(existsSync(marker)).toBe(false)
  })

  it('passes a cancelled decision through as a refusal without executing', async () => {
    const cancel: ApprovalFn = async () => ({ cancelled: true })
    const marker = join(root, 'cancel-marker.txt')
    const tools = buildTools(root, undefined, root, undefined, { requestApproval: cancel })
    const out = String(await byName(tools, 'run_script').invoke({ command: `touch ${marker}` }))
    expect(out).toMatch(/拒绝|reject|declined|cancel/i)
    expect(existsSync(marker)).toBe(false)
  })

  it('truncates very large output to ~64KB', async () => {
    const tools = buildTools(root, undefined, root, undefined, { requestApproval: allowApproval })
    // emit ~200KB of x's instantly (portable, no slow shell loop)
    const out = String(await byName(tools, 'run_script').invoke({ command: 'head -c 200000 /dev/zero | tr "\\0" x' }))
    expect(out.length).toBeLessThan(70 * 1024)
    expect(out).toMatch(/truncat/i)
  }, 30_000)
})
```

- [ ] **Step 2: Run the test, expect FAIL.**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/tools-skill-script.test.ts`
  - Expected: FAIL — TypeScript/runtime error like `'"./tools.js"' has no exported member 'ApprovalFn'` and `buildTools` rejecting a 5th argument; no `use_skill`/`run_script` tools found.

- [ ] **Step 3: Minimal impl — edit `packages/sidecar/src/session/tools.ts`.** First replace the import header (lines 1-10: the existing imports + the two existing constants) to add the new imports and constants:

```ts
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { SkillMeta } from '@hip/protocol'
import { resolveWithin } from './workspace-fs.js'
import { gitCommit, gitCreateBranch, gitSwitchBranch } from './workspace-git.js'
import { readSkillBody, listSkillFiles } from './skills/registry.js'

const EXCLUDE_DIRS = new Set(['node_modules', '.git'])
const MAX_SCAN_FILE_BYTES = 256 * 1024
const SCRIPT_TIMEOUT_MS = 120_000
const SCRIPT_OUTPUT_CAP = 64 * 1024
```

Then add the `ApprovalFn` type + `BuildToolsOpts` interface right above the `buildTools` definition (after the existing `DispatchSpec` interface):

```ts
/** HITL approval seam for run_script. session.ts supplies a closure that registers a pending
 *  permission and resolves on the user's choice; tests supply a fake. */
export type ApprovalFn = (req: { title: string; kind: string; content?: string }) => Promise<{ optionId: string } | { cancelled: true }>

export interface BuildToolsOpts {
  /** Namespaced MCP tools (mcp__<server>__<tool>) merged onto hip's own loop. */
  mcpTools?: StructuredToolInterface[]
  /** Enabled skills — when non-empty, adds the use_skill tool. */
  skills?: SkillMeta[]
  /** When present, adds the HITL-gated run_script tool. */
  requestApproval?: ApprovalFn
}

/** True for an allow decision (run_script may execute). Reject/cancel ⇒ false. */
function isApproved(d: { optionId: string } | { cancelled: true }): boolean {
  return 'optionId' in d && (d.optionId === 'allow_once' || d.optionId === 'allow_always')
}
```

Now change the `buildTools` signature line. Replace:

```ts
export function buildTools(
  root: string,
  spawnSubagent?: (description: string) => Promise<string>,
  cwd?: string,
  dispatch?: DispatchSpec,
): StructuredToolInterface[] {
```

with:

```ts
export function buildTools(
  root: string,
  spawnSubagent?: (description: string) => Promise<string>,
  cwd?: string,
  dispatch?: DispatchSpec,
  opts: BuildToolsOpts = {},
): StructuredToolInterface[] {
```

- [ ] **Step 4: Add the new tools to the assembled list.** The current function builds `base`, then early-returns at three points (`if (!spawnSubagent) return base`, `const out = [...base, task]`, `if (!dispatch ...) return out`, final `return [...out, dispatchAgent]`). To make `use_skill`/`run_script`/`mcpTools` apply on EVERY path, build them once after `base` (as `extras`) and append them at every return point. Replace the entire tail — from the `const base: StructuredToolInterface[] = ...` line (currently line 216) through the closing of `buildTools` (the `return [...out, dispatchAgent]` and its brace, line 295) — with this complete block:

```ts
  const base: StructuredToolInterface[] = [writeFile, readFile, editFile, ls, glob, grep, writeTodos]

  // Git tools are registered only for a real on-disk cwd (a git repo). They run against `cwd`
  // (the bound project root), NOT the file-tool sandbox `root` — same dir in practice, but explicit.
  if (cwd) {
    const gitCommitTool = tool(
      async ({ message }) => {
        const r = await gitCommit(cwd, message)
        return r.ok ? `committed ${(r.sha ?? '').slice(0, 7)}` : `Error: ${r.error ?? 'commit failed'}`
      },
      {
        name: 'git_commit',
        description:
          'Stage all changes and create a git commit with the given one-line `message`. Use ' +
          'proactively after completing a coherent unit of work (not per file). Returns "committed <sha>" ' +
          'or an error.',
        schema: z.object({ message: z.string() }),
      },
    )
    const gitCreateBranchTool = tool(
      async ({ branchName }) => {
        const r = await gitCreateBranch(cwd, branchName)
        return r.ok ? `created branch ${branchName}` : `Error: ${r.error ?? 'create branch failed'}`
      },
      {
        name: 'git_create_branch',
        description: 'Create a new git branch named `branchName` at the current HEAD (does not switch to it).',
        schema: z.object({ branchName: z.string() }),
      },
    )
    const gitSwitchBranchTool = tool(
      async ({ branchName }) => {
        const r = await gitSwitchBranch(cwd, branchName)
        return r.ok ? `switched to ${branchName}` : `Error: ${r.error ?? 'switch branch failed'}`
      },
      {
        name: 'git_switch_branch',
        description: 'Switch the checkout to an existing git branch named `branchName`.',
        schema: z.object({ branchName: z.string() }),
      },
    )
    base.push(gitCommitTool, gitCreateBranchTool, gitSwitchBranchTool)
  }

  // ── Skill / script / MCP extras (apply on hip's own loop, every assembly path) ──────────────
  const extras: StructuredToolInterface[] = []

  if (opts.skills && opts.skills.length > 0) {
    const skills = opts.skills
    const useSkill = tool(
      async ({ name }) => {
        const s = skills.find((sk) => sk.name === name || sk.id === name)
        if (!s) return `Error: skill not found: ${name}`
        try {
          const body = readSkillBody(s.dir)
          const files = listSkillFiles(s.dir)
          const manifest = files.length
            ? `\n\n## Files in this skill (read with read_file relative to this skill dir):\n${files.map((f) => `- ${f}`).join('\n')}`
            : ''
          return `${body}${manifest}`
        } catch (err) {
          return `Error: ${(err as Error).message}`
        }
      },
      {
        name: 'use_skill',
        description:
          'Load a skill into context by `name`. Returns the skill\'s full SKILL.md instructions plus a ' +
          'manifest of its bundled files. Call this when a task matches an advertised skill, then follow ' +
          'the loaded instructions (use read_file for reference files, run_script for bundled scripts).',
        schema: z.object({ name: z.string() }),
      },
    )
    extras.push(useSkill)
  }

  if (opts.requestApproval) {
    const requestApproval = opts.requestApproval
    const scriptCwd = cwd ?? root
    const runScript = tool(
      async ({ command, reason }) => {
        const decision = await requestApproval({ title: 'Run script', kind: 'execute', content: command })
        if (!isApproved(decision)) return '用户拒绝执行该脚本（command was rejected by the user; nothing ran）。'
        const isWin = process.platform === 'win32'
        const shell = isWin ? 'cmd' : 'sh'
        const shellArgs = isWin ? ['/c', command] : ['-c', command]
        void reason
        return await new Promise<string>((resolve) => {
          const child = spawn(shell, shellArgs, { cwd: scriptCwd, env: process.env })
          let out = ''
          let capped = false
          const onChunk = (b: Buffer) => {
            if (capped) return
            out += b.toString('utf8')
            if (out.length > SCRIPT_OUTPUT_CAP) { out = out.slice(0, SCRIPT_OUTPUT_CAP); capped = true }
          }
          child.stdout.on('data', onChunk)
          child.stderr.on('data', onChunk)
          let timedOut = false
          const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, SCRIPT_TIMEOUT_MS)
          timer.unref?.()
          child.on('error', (err) => {
            clearTimeout(timer)
            resolve(`Error: failed to spawn shell: ${err.message}`)
          })
          child.on('close', (code) => {
            clearTimeout(timer)
            const tail = capped ? '\n…(output truncated to 64KB)' : ''
            const note = timedOut ? '\n(timed out after 120s; process killed)' : ''
            resolve(`exitCode: ${code ?? 'null'}${note}\n${out}${tail}`)
          })
        })
      },
      {
        name: 'run_script',
        description:
          'Run a shell command in the project directory. EVERY call is gated by an explicit user ' +
          'approval prompt — explain WHY in `reason`. Use for skill-bundled scripts and build/test ' +
          'commands. Returns the exit code and combined stdout/stderr (truncated to 64KB, 120s timeout). ' +
          'If the user rejects, the command does not run.',
        schema: z.object({ command: z.string(), reason: z.string().optional() }),
      },
    )
    extras.push(runScript)
  }

  if (opts.mcpTools && opts.mcpTools.length > 0) extras.push(...opts.mcpTools)

  if (!spawnSubagent) return [...base, ...extras]
  const task = tool(
    async ({ description }) => spawnSubagent(description),
    {
      name: 'task',
      description:
        'Delegate a focused, self-contained sub-task to a fresh sub-agent that runs its own loop ' +
        'with the file tools and returns a text result. Use to isolate research or a chunk of work. ' +
        'The sub-agent cannot itself delegate.',
      schema: z.object({ description: z.string() }),
    },
  )
  const out = [...base, task]

  if (!dispatch || dispatch.agents.length === 0) return [...out, ...extras]

  const roster = dispatch.agents
    .map((a) => `- ${a.id} (${a.name})${a.description ? `: ${a.description}` : ''}`)
    .join('\n')
  const ids = dispatch.agents.map((a) => a.id) as [string, ...string[]]
  const dispatchAgent = tool(
    async ({ agent, task: t }) => dispatch.run(agent, t),
    {
      name: 'dispatch_agent',
      description:
        'Delegate a focused, self-contained task to a specialized sub-agent and return its result. ' +
        'Pick the agent best matched to the task. Available agents:\n' +
        roster,
      schema: z.object({
        agent: z.enum(ids).describe('id of the sub-agent to delegate to'),
        task: z.string().describe('the complete, self-contained instruction for the sub-agent'),
      }),
    },
  )
  return [...out, dispatchAgent, ...extras]
}
```

> Note: a single `timer` both flags `timedOut` and `SIGKILL`s the child; the close handler reads `timedOut` only to tag the timeout note. The truncation test never times out — it relies solely on the `SCRIPT_OUTPUT_CAP` slice + the `…(output truncated to 64KB)` tail.

- [ ] **Step 5: Run the test, expect PASS.**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/tools-skill-script.test.ts`
  - Expected: PASS — all 9 tests green (`use_skill` absent/body+manifest/missing; `run_script` absent/approve/reject/cancel/truncate).

- [ ] **Step 6: Type-check the sidecar (catches signature drift in callers).**
  - Run: `yarn workspace @hip/sidecar type-check`
  - Expected: clean (exit 0) — existing callers (`internal-runner.ts`/`session.ts`) don't pass a 5th arg yet, and `opts` has a default. If it errors on the missing `./skills/registry.js` module, that module is owned by an earlier slice; confirm it exists with `ls packages/sidecar/src/session/skills/registry.ts` before proceeding.

- [ ] **Step 7: Confirm the existing tools test still passes (no regression on the early-return paths).**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/tools.test.ts`
  - Expected: PASS — unchanged count, all green.

- [ ] **Step 8: Commit.**
  - Run: `git add packages/sidecar/src/session/tools.ts packages/sidecar/src/session/tools-skill-script.test.ts && git commit -m "feat(sidecar): buildTools opts — use_skill + HITL run_script + mcpTools merge"`

---

### Task 37: Inject the `## 可用 Skills` block into `buildSystemPrompt` and `buildManagedAgentPrompt`

**Files:**
- Modify `packages/sidecar/src/session/system-prompt.ts` (`SystemPromptInput` gains `skills?`; `buildSystemPrompt` appends a skills block; `buildManagedAgentPrompt` injects the same when `toolNames` includes `use_skill`)
- Modify `packages/sidecar/src/session/system-prompt.test.ts` (append tests)

- [ ] **Step 1: Write the failing tests.** Append the following block to the end of `packages/sidecar/src/session/system-prompt.test.ts`:

```ts
describe('buildSystemPrompt skills block', () => {
  const skills = [
    { id: 'fmt', name: 'formatter', description: 'Format code', dir: '/s/fmt', hasScripts: true },
    { id: 'lint', name: 'linter', description: 'Lint code', dir: '/s/lint', hasScripts: false },
  ]

  it('omits the skills section when no skills are given', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj' })
    expect(s).not.toMatch(/可用 Skills/)
  })

  it('lists enabled skill names and descriptions and mentions use_skill', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', skills })
    expect(s).toMatch(/可用 Skills/)
    expect(s).toContain('formatter')
    expect(s).toContain('Format code')
    expect(s).toContain('linter')
    expect(s).toMatch(/use_skill/)
  })

  it('omits the skills section when skills is an empty array', () => {
    const s = buildSystemPrompt({ cwd: '/tmp/proj', skills: [] })
    expect(s).not.toMatch(/可用 Skills/)
  })
})

describe('buildManagedAgentPrompt skills block', () => {
  const skills = [{ id: 'fmt', name: 'formatter', description: 'Format code', dir: '/s/fmt', hasScripts: true }]

  it('injects the skills block when use_skill is in the granted tools', () => {
    const s = buildManagedAgentPrompt({ cwd: '/tmp/proj', persona: 'P', toolNames: ['use_skill', 'read_file'], skills })
    expect(s).toMatch(/可用 Skills/)
    expect(s).toContain('formatter')
  })

  it('omits the skills block when use_skill is not granted', () => {
    const s = buildManagedAgentPrompt({ cwd: '/tmp/proj', persona: 'P', toolNames: ['read_file'], skills })
    expect(s).not.toMatch(/可用 Skills/)
  })

  it('omits the skills block when no skills are provided even with use_skill granted', () => {
    const s = buildManagedAgentPrompt({ cwd: '/tmp/proj', persona: 'P', toolNames: ['use_skill'] })
    expect(s).not.toMatch(/可用 Skills/)
  })
})
```

- [ ] **Step 2: Run the tests, expect FAIL.**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/system-prompt.test.ts`
  - Expected: FAIL — `buildSystemPrompt`/`buildManagedAgentPrompt` reject the `skills` property (TS) and the new assertions fail (no `可用 Skills`).

- [ ] **Step 3: Minimal impl — edit `packages/sidecar/src/session/system-prompt.ts`.** Add the `import type` as the FIRST line of the file (the file currently has no imports), then add a shared helper after the existing `cwdBlock` function (before `SystemPromptInput`):

Add as line 1:

```ts
import type { SkillMeta } from '@hip/protocol'
```

Add the helper (place it just after the `cwdBlock` function, before `export interface SystemPromptInput`):

```ts
/** A short "## 可用 Skills" block listing each enabled skill, instructing the model to call use_skill. */
function skillsBlock(skills: SkillMeta[]): string {
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
  return (
    '## 可用 Skills\n' +
    '以下技能可按需加载。当任务匹配某技能时，调用 use_skill 工具（参数 name）把其完整说明读入上下文，再据此操作。\n' +
    lines
  )
}
```

Update `SystemPromptInput` and `buildSystemPrompt`. Replace:

```ts
export interface SystemPromptInput {
  cwd: string
  userInstructions?: string
}

/** Assemble the single-agent system prompt: base + cwd convention + anti-phantom (+ optional user instructions). */
export function buildSystemPrompt({ cwd, userInstructions }: SystemPromptInput): string {
  const base = `${IDENTITY}\n\n${BASE}\n\n${cwdBlock(cwd)}\n\n${GIT_GUIDANCE}\n\n${ANTI_PHANTOM}`
  const extra = userInstructions?.trim()
  return extra
    ? `${base}\n\n## Additional instructions from the user (for this conversation)\n${extra}`
    : base
}
```

with:

```ts
export interface SystemPromptInput {
  cwd: string
  userInstructions?: string
  skills?: SkillMeta[]
}

/** Assemble the single-agent system prompt: base + cwd convention + anti-phantom (+ optional skills, user instructions). */
export function buildSystemPrompt({ cwd, userInstructions, skills }: SystemPromptInput): string {
  let base = `${IDENTITY}\n\n${BASE}\n\n${cwdBlock(cwd)}\n\n${GIT_GUIDANCE}\n\n${ANTI_PHANTOM}`
  if (skills && skills.length > 0) base = `${base}\n\n${skillsBlock(skills)}`
  const extra = userInstructions?.trim()
  return extra
    ? `${base}\n\n## Additional instructions from the user (for this conversation)\n${extra}`
    : base
}
```

Update `ManagedAgentPromptInput` and `buildManagedAgentPrompt`. Replace:

```ts
export interface ManagedAgentPromptInput {
  cwd: string
  persona: string
  toolNames: string[]
}

/** System prompt for an internal managed sub-agent: identity guard + an operating preamble that
 *  enumerates the agent's ACTUAL granted tools + cwd convention + anti-phantom + the persona, framed
 *  as a focused, non-delegating sub-agent. Git guidance only when a git tool is granted. */
export function buildManagedAgentPrompt({ cwd, persona, toolNames }: ManagedAgentPromptInput): string {
  const toolList = toolNames.length ? toolNames.join(', ') : '(no tools — answer from reasoning only)'
  const base =
    'Right now you are acting as a focused sub-agent completing a single delegated sub-task. ' +
    `Your available tools are: ${toolList}. ` +
    'Use them to do the work yourself — read what you need, make changes only with the tools you have, ' +
    'and verify your results. You cannot delegate further. When done, return a concise text result ' +
    'describing what you found or changed.'
  const hasGit = toolNames.some((n) => n.startsWith('git_'))
  const parts = [IDENTITY, base, cwdBlock(cwd)]
  if (hasGit) parts.push(GIT_GUIDANCE)
  parts.push(ANTI_PHANTOM, `## Your role and instructions\n${persona.trim()}`)
  return parts.join('\n\n')
}
```

with:

```ts
export interface ManagedAgentPromptInput {
  cwd: string
  persona: string
  toolNames: string[]
  skills?: SkillMeta[]
}

/** System prompt for an internal managed sub-agent: identity guard + an operating preamble that
 *  enumerates the agent's ACTUAL granted tools + cwd convention + anti-phantom + the persona, framed
 *  as a focused, non-delegating sub-agent. Git guidance only when a git tool is granted; skills block
 *  only when use_skill is granted AND skills are supplied. */
export function buildManagedAgentPrompt({ cwd, persona, toolNames, skills }: ManagedAgentPromptInput): string {
  const toolList = toolNames.length ? toolNames.join(', ') : '(no tools — answer from reasoning only)'
  const base =
    'Right now you are acting as a focused sub-agent completing a single delegated sub-task. ' +
    `Your available tools are: ${toolList}. ` +
    'Use them to do the work yourself — read what you need, make changes only with the tools you have, ' +
    'and verify your results. You cannot delegate further. When done, return a concise text result ' +
    'describing what you found or changed.'
  const hasGit = toolNames.some((n) => n.startsWith('git_'))
  const parts = [IDENTITY, base, cwdBlock(cwd)]
  if (hasGit) parts.push(GIT_GUIDANCE)
  if (toolNames.includes('use_skill') && skills && skills.length > 0) parts.push(skillsBlock(skills))
  parts.push(ANTI_PHANTOM, `## Your role and instructions\n${persona.trim()}`)
  return parts.join('\n\n')
}
```

- [ ] **Step 4: Run the tests, expect PASS.**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/system-prompt.test.ts`
  - Expected: PASS — all existing + 6 new tests green.

- [ ] **Step 5: Commit.**
  - Run: `git add packages/sidecar/src/session/system-prompt.ts packages/sidecar/src/session/system-prompt.test.ts && git commit -m "feat(sidecar): inject 可用 Skills block into system + managed-agent prompts"`

---

### Task 38: Thread `mcpTools`/`skills`/`requestApproval` through `runManagedAgent`

**Files:**
- Modify `packages/sidecar/src/session/internal-runner.ts` (`RunManagedAgentArgs` gains the three fields; pass into `buildTools` then `filterTools`; pass `skills` into `buildManagedAgentPrompt`)
- Modify `packages/sidecar/src/session/internal-runner.test.ts` (append tests)

- [ ] **Step 1: Write the failing tests.** Append to `packages/sidecar/src/session/internal-runner.test.ts` (the file already imports `AIMessage`, `ModelRunner`, and defines the `tmp()` + `collectingEmit()` helpers):

```ts
describe('runManagedAgent skills + run_script wiring', () => {
  it('grants use_skill when allowed and skills are supplied', async () => {
    const cwd = tmp()
    let seen: string[] = []
    const runner: ModelRunner = {
      async run(_m, opts) { seen = opts.tools.map((t) => t.name); opts.onText('ok'); return new AIMessage('ok') },
    }
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p', allowedTools: ['read_file', 'use_skill'],
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
      skills: [{ id: 'fmt', name: 'formatter', description: 'd', dir: cwd, hasScripts: false }],
    })
    expect(seen).toContain('use_skill')
  })

  it('does not grant run_script when not in the allow-list even with requestApproval', async () => {
    const cwd = tmp()
    let seen: string[] = []
    const runner: ModelRunner = {
      async run(_m, opts) { seen = opts.tools.map((t) => t.name); opts.onText('ok'); return new AIMessage('ok') },
    }
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p', allowedTools: ['read_file'],
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
      requestApproval: async () => ({ optionId: 'allow_once' }),
    })
    expect(seen).not.toContain('run_script')
  })

  it('grants run_script when allowed and requestApproval is supplied', async () => {
    const cwd = tmp()
    let seen: string[] = []
    const runner: ModelRunner = {
      async run(_m, opts) { seen = opts.tools.map((t) => t.name); opts.onText('ok'); return new AIMessage('ok') },
    }
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p', allowedTools: ['run_script'],
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
      requestApproval: async () => ({ optionId: 'allow_once' }),
    })
    expect(seen).toContain('run_script')
  })
})
```

- [ ] **Step 2: Run the tests, expect FAIL.**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/internal-runner.test.ts`
  - Expected: FAIL — TS rejects the `skills`/`requestApproval` properties on `RunManagedAgentArgs`; `seen` does not contain `use_skill`/`run_script`.

- [ ] **Step 3: Minimal impl — edit `packages/sidecar/src/session/internal-runner.ts`.** Add imports for the new types (top of file, alongside the existing imports):

```ts
import type { SkillMeta } from '@hip/protocol'
import type { ApprovalFn } from './tools.js'
```

Extend `RunManagedAgentArgs` (replace the existing interface):

```ts
export interface RunManagedAgentArgs {
  resolved: ResolvedModel | null      // the agent's bound model; null ⇒ global active model
  cwd: string
  prompt: string                      // persona
  allowedTools?: string[]
  task: string
  emit: GraphEmit
  signal: AbortSignal
  childMaxSteps: number
  runner?: ModelRunner                // injectable for tests; default builds the real model
  summarizer?: Summarizer             // injectable for tests; default = real summarizer
  mcpTools?: StructuredToolInterface[]  // namespaced MCP tools threaded from the parent session
  skills?: SkillMeta[]                  // enabled skills (use_skill candidate)
  requestApproval?: ApprovalFn          // HITL closure threaded from the parent session (run_script)
}
```

Replace the body of `runManagedAgent` (the destructure + the `buildTools`/`buildManagedAgentPrompt` lines):

```ts
export async function runManagedAgent(args: RunManagedAgentArgs): Promise<string> {
  const { resolved, cwd, prompt, allowedTools, task, emit, signal, childMaxSteps, mcpTools, skills, requestApproval } = args
  const runner = args.runner ?? new RealModelRunner(buildChatModel(resolved ?? getActiveModel()))
  const summarizer = args.summarizer ?? createSummarizer()
  // base + git tools + skill/script/mcp extras (no task/dispatch closures → depth-1), then narrow to the allow-list.
  const tools = filterTools(buildTools(cwd, undefined, cwd, undefined, { mcpTools, skills, requestApproval }), allowedTools)
  const toolNames = tools.map((t) => t.name)
  const ctx: GraphCtx = { runner, tools, emit, summarizer }
  const app = buildGraph(childMaxSteps)
  const final = await app.invoke(
    {
      messages: [new SystemMessage(buildManagedAgentPrompt({ cwd, persona: prompt, toolNames, skills })), new HumanMessage(task)],
      steps: 0,
      recentSigs: [],
      nudgedSig: undefined,
      status: 'running',
    },
    { configurable: { ctx }, signal, recursionLimit: recursionLimit(childMaxSteps) },
  )
  const text = lastAiText(final.messages)
  if (final.status === 'awaiting_user') {
    const q = final.pendingQuestion
    return q ? `${text}\n\n[sub-agent paused — open question: ${q}]` : text
  }
  return text
}
```

- [ ] **Step 4: Run the tests, expect PASS.**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/internal-runner.test.ts`
  - Expected: PASS — all existing + 3 new tests green.

- [ ] **Step 5: Commit.**
  - Run: `git add packages/sidecar/src/session/internal-runner.ts packages/sidecar/src/session/internal-runner.test.ts && git commit -m "feat(sidecar): thread mcpTools/skills/requestApproval through runManagedAgent"`

---

### Task 39: Thread `mcpTools`/`skills`/`requestApproval` from the parent session through `AgentInvoker` (internal kind)

**Files:**
- Modify `packages/sidecar/src/session/agents/invoker.ts` (`RunInternalArgs` gains the three fields; `AgentInvoker.invoke` signature takes an extra `extras` arg; internal branch passes them; default `runInternal` forwards them)
- Create test `packages/sidecar/src/session/agents/invoker-extras.test.ts`

> The `AgentInvoker.invoke` signature lives in `invoker.ts` (not `agents/types.ts`), so no change to `types.ts` is needed.

- [ ] **Step 1: Inspect the existing internal-dispatch integration test to mirror its stub style.**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/dispatch-internal.integration.test.ts`
  - Expected: PASS (baseline green before changes). Read `packages/sidecar/src/session/dispatch-internal.integration.test.ts` in the editor to confirm its `runInternal` stub shape (it calls `createAgentInvoker(cwd, { runInternal: (a) => runManagedAgent({...}) })`) so the new unit test mirrors it.

- [ ] **Step 2: Write the failing unit test.** Create `packages/sidecar/src/session/agents/invoker-extras.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { SkillMeta } from '@hip/protocol'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { GraphEmit } from '../graph.js'
import { createAgentInvoker, type RunInternalArgs } from './invoker.js'
import type { ApprovalFn } from '../tools.js'

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {} }
const skills: SkillMeta[] = [{ id: 'fmt', name: 'formatter', description: 'd', dir: '/s/fmt', hasScripts: true }]
const mcpTools: StructuredToolInterface[] = []
const approval: ApprovalFn = async () => ({ optionId: 'allow_once' })

describe('AgentInvoker forwards extras to the internal runner', () => {
  it('passes skills/mcpTools/requestApproval into runInternal for an internal agent', async () => {
    let captured: RunInternalArgs | null = null
    const invoker = createAgentInvoker('/proj', {
      readAgents: () => [
        { id: 'inner', name: 'Inner', enabled: true, kind: 'internal', prompt: 'p', allowedTools: ['use_skill', 'run_script'] } as never,
      ],
      runInternal: async (a) => { captured = a; return 'done' },
    })
    const text = await invoker.invoke('inner', 'do it', noopEmit, new AbortController().signal, undefined, { mcpTools, skills, requestApproval: approval })
    expect(text).toBe('done')
    expect(captured!.skills).toBe(skills)
    expect(captured!.mcpTools).toBe(mcpTools)
    expect(captured!.requestApproval).toBe(approval)
  })

  it('tolerates being called without extras (back-compat)', async () => {
    let captured: RunInternalArgs | null = null
    const invoker = createAgentInvoker('/proj', {
      readAgents: () => [{ id: 'inner', name: 'Inner', enabled: true, kind: 'internal', prompt: 'p' } as never],
      runInternal: async (a) => { captured = a; return 'ok' },
    })
    const text = await invoker.invoke('inner', 't', noopEmit, new AbortController().signal)
    expect(text).toBe('ok')
    expect(captured!.skills).toBeUndefined()
    expect(captured!.requestApproval).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run the test, expect FAIL.**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/agents/invoker-extras.test.ts`
  - Expected: FAIL — `invoke` rejects the 6th argument (TS) and `RunInternalArgs` has no `skills`/`mcpTools`/`requestApproval`.

- [ ] **Step 4: Minimal impl — edit `packages/sidecar/src/session/agents/invoker.ts`.** Replace the existing first import line `import type { AgentConfig } from '@hip/protocol'` with the combined form and add the two new imports right below it:

```ts
import type { AgentConfig, SkillMeta } from '@hip/protocol'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ApprovalFn } from '../tools.js'
```

Define a shared `InvokerExtras` type and extend `AgentInvoker.invoke` + `RunInternalArgs`. Replace the existing `AgentInvoker` interface and `RunInternalArgs` interface with:

```ts
/** Per-turn capabilities the parent session threads into an internal sub-agent's loop. */
export interface InvokerExtras {
  mcpTools?: StructuredToolInterface[]
  skills?: SkillMeta[]
  requestApproval?: ApprovalFn
}

export interface AgentInvoker {
  invoke(agentId: string, task: string, emit: GraphEmit, signal: AbortSignal, hooks?: ExternalAgentHooks, extras?: InvokerExtras): Promise<string>
}

/** Args handed to the internal-loop runner (a seam so tests can stub the loop). */
export interface RunInternalArgs {
  agentId: string
  resolved: ResolvedModel | null
  cwd: string
  prompt: string
  allowedTools?: string[]
  task: string
  emit: GraphEmit
  signal: AbortSignal
  mcpTools?: StructuredToolInterface[]
  skills?: SkillMeta[]
  requestApproval?: ApprovalFn
}
```

Replace the `createAgentInvoker` body (default `runInternal` forwarding + the `invoke` internal branch):

```ts
export function createAgentInvoker(cwd: string, deps: InvokerDeps = {}): AgentInvoker {
  const readAgents = deps.readAgents ?? readAgentsConfig
  const createProvider = deps.createProvider ?? createAgentProvider
  const resolveModel = deps.resolveModel ?? resolveAgentModel
  const runInternal = deps.runInternal ?? ((a: RunInternalArgs) =>
    runManagedAgent({
      resolved: a.resolved, cwd: a.cwd, prompt: a.prompt, allowedTools: a.allowedTools, task: a.task,
      emit: a.emit, signal: a.signal, childMaxSteps: CHILD_MAX_STEPS,
      mcpTools: a.mcpTools, skills: a.skills, requestApproval: a.requestApproval,
    }))
  return {
    async invoke(agentId, task, emit, signal, hooks, extras) {
      const agent = readAgents().find((a) => a.id === agentId && a.enabled)
      if (!agent) throw new Error(`unknown or disabled agent: ${agentId}`)

      if (agent.kind === 'internal') {
        // hip's own loop — no external provider, no token-teeing (runManagedAgent returns the final text).
        return runInternal({
          agentId, resolved: resolveModel(agent), cwd, prompt: agent.prompt ?? '', allowedTools: agent.allowedTools,
          task, emit, signal,
          mcpTools: extras?.mcpTools, skills: extras?.skills, requestApproval: extras?.requestApproval,
        })
      }

      const model = agent.acceptsModelConfig ? resolveModel(agent) : null
      const provider = createProvider(agent, cwd, model)
      let text = ''
      // Tee token deltas so we can return the final text while still forwarding
      // every event to the caller's sink (the dispatch tool-card).
      const teed: GraphEmit = {
        token: (d) => { text += d; emit.token(d) },
        reasoning: emit.reasoning,
        toolStarted: emit.toolStarted,
        toolFinished: emit.toolFinished,
        usage: emit.usage,
      }
      try {
        await provider.runTurn(task, teed, signal, hooks)
        return text
      } finally {
        provider.dispose()
      }
    },
  }
}
```

> The `extras` argument is plumbed only into the internal branch — external (acp/custom) providers never receive MCP/skills/run_script, matching the locked scope decision.

- [ ] **Step 5: Run the test, expect PASS.**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/agents/invoker-extras.test.ts`
  - Expected: PASS — both tests green.

- [ ] **Step 6: Confirm the existing invoker + dispatch-internal integration tests still pass.**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/agents/invoker.test.ts src/session/dispatch-internal.integration.test.ts`
  - Expected: PASS — `invoke` is back-compatible (the new `extras` arg is optional), no regression.

- [ ] **Step 7: Commit.**
  - Run: `git add packages/sidecar/src/session/agents/invoker.ts packages/sidecar/src/session/agents/invoker-extras.test.ts && git commit -m "feat(sidecar): thread mcpTools/skills/requestApproval through AgentInvoker (internal kind)"`

---

### Task 40: Wire the parent session — reconcile MCP, read skills, build the HITL closure, pass extras into `buildTools` and dispatch

**Files:**
- Modify `packages/sidecar/src/session/session.ts` (imports; in `runTurn`: reconcile MCP + read skills; pass `skills` into `buildSystemPrompt`; build a `requestApproval` closure that registers in `this.pendingPermissions` + sends `permission:request`; pass `{ mcpTools, skills, requestApproval }` into `buildTools`; pass an `extras` object into `invoker.invoke` for the dispatch path)
- Create test `packages/sidecar/src/session/session-skills-mcp.test.ts`

- [ ] **Step 1: Confirm the `permission:request` payload shape this slice must emit.** The dispatch path already sends `permission:request` with `{ requestId, tool, options, agentFrame? }` (session.ts lines ~673-677). The `run_script` HITL closure must emit the SAME message type so the existing `respondPermission` round-trip works.
  - Run: `grep -nE "PermissionRequestPayload|PermissionOption|permission:request" packages/protocol/src/index.ts`
  - Expected (confirmed): `permission:request` is `{ type, sessionId, turnId, requestId, tool: PermissionRequestPayload, options: PermissionOption[], agentFrame? }`; `PermissionRequestPayload = { title: string; kind: string; diff?: {...}; content?: string }`; `PermissionOption = { optionId: string; name: string; kind: string }` (all three fields required). The Step 4 literal uses exactly these field names.

- [ ] **Step 2: Write the failing test.** Create `packages/sidecar/src/session/session-skills-mcp.test.ts`. It drives a real `Session` with an injected `ModelRunner` that, on its first model call, invokes `run_script` (asserting the session emitted a `permission:request` and that resolving it via `respondPermission` runs the command), and asserts the system prompt carried the skills block. Skills come from a temp dir via the real `readEnabledSkills` (env-driven); MCP is neutralised by pointing `HIP_MCP_SERVERS_PATH` at a `{ servers: [] }` file so `reconcile([])` is a no-op.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage } from '@hip/protocol'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { Session } from './session.js'

let root: string
let skillsDir: string
const prevEnv: Record<string, string | undefined> = {}
function setEnv(k: string, v: string) { prevEnv[k] = process.env[k]; process.env[k] = v }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hip-sess-sk-'))
  skillsDir = join(root, 'skills')
  const fmt = join(skillsDir, 'formatter')
  mkdirSync(join(fmt, 'scripts'), { recursive: true })
  writeFileSync(join(fmt, 'SKILL.md'), '---\nname: formatter\ndescription: Format code\n---\nUse scripts/run.sh', 'utf8')
  writeFileSync(join(fmt, 'scripts', 'run.sh'), 'echo formatted', 'utf8')
  // empty MCP config so mcpManager.reconcile([]) is a clean no-op
  const mcpPath = join(root, 'mcp.json')
  writeFileSync(mcpPath, JSON.stringify({ servers: [] }), 'utf8')
  // empty skills enabled map → all enabled by default
  const skillsCfg = join(root, 'skills.json')
  writeFileSync(skillsCfg, JSON.stringify({ enabled: {} }), 'utf8')
  setEnv('HIP_SKILLS_DIR', skillsDir)
  setEnv('HIP_SKILLS_PATH', skillsCfg)
  setEnv('HIP_MCP_SERVERS_PATH', mcpPath)
  setEnv('HIP_AGENTS_PATH', '') // no external/internal agents in this test
})
afterEach(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  rmSync(root, { recursive: true, force: true })
})

/** A runner that, on its FIRST call, emits a run_script tool call, then on the SECOND call returns text.
 *  It also records the system prompt + tool names it received so the test can assert wiring. */
class ScriptThenTextRunner implements ModelRunner {
  calls = 0
  systemSeen = ''
  toolNamesSeen: string[] = []
  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    this.calls++
    this.systemSeen = String(messages[0]?.content ?? '')
    this.toolNamesSeen = opts.tools.map((t) => t.name)
    if (this.calls === 1) {
      return new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'run_script', args: { command: 'echo formatted', reason: 'format' } }] })
    }
    opts.onText('all done')
    return new AIMessage('all done')
  }
}

describe('Session wires skills, MCP reconcile, and the run_script HITL closure', () => {
  it('advertises skills in the system prompt and grants use_skill + run_script', async () => {
    const runner = new ScriptThenTextRunner()
    const session = new Session('s1', { cwd: root }, undefined, undefined, undefined, 60_000, runner)
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => {
      sent.push(m)
      if (m.type === 'permission:request') {
        // auto-approve the run_script HITL request the same way the UI's permission:respond would
        session.respondPermission((m as { requestId: string }).requestId, { optionId: 'allow_once' })
      }
    }
    await session.sendMessage('please format', send, 'u1')

    expect(runner.systemSeen).toMatch(/可用 Skills/)
    expect(runner.systemSeen).toContain('formatter')
    expect(runner.toolNamesSeen).toContain('use_skill')
    expect(runner.toolNamesSeen).toContain('run_script')

    // a permission:request was emitted for the run_script call
    expect(sent.some((m) => m.type === 'permission:request')).toBe(true)
    // the run_script tool result must reflect the executed command
    const toolFinished = sent.find((m) => m.type === 'tool:finished' && (m as { output?: string }).output?.includes('formatted'))
    expect(toolFinished).toBeTruthy()
  }, 30_000)
})
```

> `Session`'s constructor positional args are `(id, config, model?, store?, titleGenerator?, idleTimeoutMs?, runner?, summarizer?, invokerFactory?)` — passing `runner` as the 7th positional makes `usesEnvModel` false (no paid path, no real key needed), and exempts the session from `requireCompatibleModel`/`requireApiKey`.

- [ ] **Step 3: Run the test, expect FAIL.**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/session-skills-mcp.test.ts`
  - Expected: FAIL — `systemSeen` lacks `可用 Skills`, `toolNamesSeen` lacks `use_skill`/`run_script`, and no `permission:request` is emitted (session.ts not yet wired).

- [ ] **Step 4: Minimal impl — edit `packages/sidecar/src/session/session.ts`.** Add imports (in the import block at the top, near the other `./` imports — e.g. right after the `buildTools` import line):

```ts
import { mcpManager } from './mcp/manager.js'
import { readMcpServersConfig } from '../config/mcp-servers.js'
import { readEnabledSkills } from './skills/registry.js'
import type { ApprovalFn } from './tools.js'
```

In `runTurn`, locate this block (currently lines 616-619):

```ts
    const cwd = this._config.cwd ?? process.cwd()
    const runner = this.modelRunner()
    const summarizer = this.summarizer()
    const system = buildSystemPrompt({ cwd, userInstructions: this._config.systemPrompt })
```

Replace it with (reconcile MCP + read skills before assembling the prompt; both best-effort, never throw into the turn; external turns skip — they don't use hip's own toolset):

```ts
    const cwd = this._config.cwd ?? process.cwd()
    const runner = this.modelRunner()
    const summarizer = this.summarizer()
    // Pre-turn MCP reconcile + enabled-skills scan (mirrors the per-turn agents re-read). Both are
    // best-effort and never throw into the turn. ACP/CLI external turns skip this — they don't use
    // hip's own toolset (the isExternalAgent branch below ignores `tools`).
    let skills: ReturnType<typeof readEnabledSkills> = []
    if (!this.isExternalAgent()) {
      try { await mcpManager.reconcile(readMcpServersConfig()) } catch { /* degrade: skip MCP tools */ }
      try { skills = readEnabledSkills() } catch { skills = [] }
    }
    const system = buildSystemPrompt({ cwd, userInstructions: this._config.systemPrompt, skills })
```

Next, define the `requestApproval` closure BEFORE the `dispatchAgent` closure so there is no use-before-declaration (TDZ) issue — the dispatch path references it. Locate this line (currently line 663):

```ts
    const invoker = this.invokerFactory(cwd)
```

Insert the closure immediately AFTER it (before `const dispatchAgent = ...`):

```ts
    const invoker = this.invokerFactory(cwd)
    // HITL closure for the run_script tool (and dispatched internal agents): registers a pending
    // permission (same map + channel the external-agent and dispatch HITL paths use) and resolves on
    // the user's permission:respond. The turn-end / abort drain in `finally` settles any still-pending
    // request with {cancelled}. `turnId` and `nextSeq` are already in scope from the turn preamble.
    const requestApproval: ApprovalFn = (req) =>
      new Promise((resolve) => {
        const requestId = `run-script-${turnId}-${nextSeq()}`
        this.pendingPermissions.set(requestId, resolve)
        send({
          type: 'permission:request',
          sessionId: this.id,
          turnId,
          requestId,
          tool: { title: req.title, kind: req.kind, content: req.content },
          options: [
            { optionId: 'allow_once', name: '允许', kind: 'allow_once' },
            { optionId: 'reject_once', name: '拒绝', kind: 'reject_once' },
          ],
        })
      })
```

Now find the dispatch call inside the `dispatchAgent` closure (currently line 683):

```ts
        const text = await invoker.invoke(agentId, task, makeEmit(childId, 'subagent'), this.abortController!.signal, hooks)
```

Replace it with (forward MCP/skills/requestApproval so a dispatched INTERNAL agent can use them, scoped by its own `allowedTools` inside `runManagedAgent`):

```ts
        const text = await invoker.invoke(agentId, task, makeEmit(childId, 'subagent'), this.abortController!.signal, hooks, { mcpTools: mcpManager.tools(), skills, requestApproval })
```

Finally, find the dispatch-tools assembly block (currently lines 696-704):

```ts
    const tools = buildTools(
      cwd,
      spawnSubagent,
      this._config.cwd,
      enabledAgents.length
        ? { agents: enabledAgents.map((a) => ({ id: a.id, name: a.name, description: a.description })), run: dispatchAgent }
        : undefined,
    )
    const ctx: GraphCtx = { runner, tools, emit, summarizer }
```

Replace it with (pass the opts; MCP tools come from the singleton):

```ts
    const tools = buildTools(
      cwd,
      spawnSubagent,
      this._config.cwd,
      enabledAgents.length
        ? { agents: enabledAgents.map((a) => ({ id: a.id, name: a.name, description: a.description })), run: dispatchAgent }
        : undefined,
      { mcpTools: mcpManager.tools(), skills, requestApproval },
    )
    const ctx: GraphCtx = { runner, tools, emit, summarizer }
```

> The `tool` / `options` literal matches the exact `PermissionRequestPayload` (`title`/`kind`/`content`) and `PermissionOption` (`optionId`/`name`/`kind`) field names confirmed in Step 1; all three `PermissionOption` fields are required, so each option literal supplies `kind`. The option labels are not load-bearing for the test (which only requires that a `permission:request` is emitted with a `requestId` `respondPermission` can resolve, and that `run_script` runs after approval), but they MUST type-check.

- [ ] **Step 5: Run the test, expect PASS.**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/session-skills-mcp.test.ts`
  - Expected: PASS — system prompt carries `可用 Skills`/`formatter`, tools include `use_skill`+`run_script`, a `permission:request` is emitted, and the `tool:finished` output contains `formatted`.

- [ ] **Step 6: Type-check the sidecar (catches payload-field drift + ordering).**
  - Run: `yarn workspace @hip/sidecar type-check`
  - Expected: clean (exit 0). With `requestApproval` declared above the `dispatchAgent` closure there is no TDZ; if it errors on `tool`/`options` field names, re-check them against `PermissionRequestPayload`/`PermissionOption`.

- [ ] **Step 7: Run the full session suite + dispatch/HITL integration tests for regressions (paid-free — these all use injected runners/fakes).**
  - Run: `yarn workspace @hip/sidecar exec vitest run src/session/session-loop.test.ts src/session/dispatch.integration.test.ts src/session/dispatch-hitl.integration.test.ts src/session/dispatch-internal.integration.test.ts src/session/external-agent.integration.test.ts`
  - Expected: PASS — all green; the new per-turn reconcile/skills scan degrades cleanly when `HIP_MCP_SERVERS_PATH`/`HIP_SKILLS_DIR` are unset (returns `[]`).

- [ ] **Step 8: Commit.**
  - Run: `git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-skills-mcp.test.ts && git commit -m "feat(sidecar): session runTurn wires MCP reconcile, skills, and run_script HITL closure"`

---

### Task 41: Slice-wide verification — sidecar type-check + paid-free full sidecar suite

**Files:** (none — verification + final commit only if Step 1/3 surfaces a fix)

- [ ] **Step 1: Type-check the whole sidecar package.**
  - Run: `yarn workspace @hip/sidecar type-check`
  - Expected: clean (exit 0), no errors.

- [ ] **Step 2: Guarantee paid-free before the full run.** Per the known trap (`vitest run src` substring-matches paid suites and `vitest.setup.ts` re-seeds keys from `~/.hip/config/auth.json`), move the auth file aside for the run, then restore it.
  - Run: `[ -f ~/.hip/config/auth.json ] && mv ~/.hip/config/auth.json ~/.hip/config/auth.json.slice50-bak || echo "no auth.json present"`
  - Expected: prints nothing (file moved) or `no auth.json present`.

- [ ] **Step 3: Run the full sidecar test suite (scoped to the sidecar workspace, NOT root `vitest run src`).**
  - Run: `yarn workspace @hip/sidecar exec vitest run`
  - Expected: PASS — all sidecar tests green, including the new `tools-skill-script`, `system-prompt`, `internal-runner`, `agents/invoker-extras`, and `session-skills-mcp` tests. No paid real-LLM calls (every new/touched test uses fakes or injected runners).

- [ ] **Step 4: Restore the auth file.**
  - Run: `[ -f ~/.hip/config/auth.json.slice50-bak ] && mv ~/.hip/config/auth.json.slice50-bak ~/.hip/config/auth.json || echo "nothing to restore"`
  - Expected: prints nothing (restored) or `nothing to restore`.

- [ ] **Step 5: No code changes in this task — nothing to commit unless Step 1/3 surfaced a fix.** If a fix was required, commit it:
  - Run: `git add -A && git commit -m "fix(sidecar): slice-50 verification fixes"` (skip if the tree is clean).

---

Key files this slice touches (all absolute):
- `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/tools.ts` — `ApprovalFn`, `BuildToolsOpts`, `use_skill`, `run_script`, mcpTools merge
- `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/system-prompt.ts` — `## 可用 Skills` block in `buildSystemPrompt` + `buildManagedAgentPrompt`
- `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/internal-runner.ts` — threads `mcpTools`/`skills`/`requestApproval`
- `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/agents/invoker.ts` — `InvokerExtras`, internal-kind forwarding
- `/Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/session.ts` — `runTurn` MCP reconcile + skills scan + run_script HITL closure + dispatch extras

External-slice dependencies imported here (must exist before Task 36/54 build green): `@hip/protocol` `SkillMeta` (already present), `packages/sidecar/src/session/skills/registry.ts` (`readEnabledSkills`/`readSkillBody`/`listSkillFiles`), `packages/sidecar/src/session/mcp/manager.ts` (`mcpManager`), `packages/sidecar/src/config/mcp-servers.ts` (`readMcpServersConfig`), and the protocol `permission:request` payload field names (`PermissionRequestPayload` `title`/`kind`/`content`; `PermissionOption` `optionId`/`name`/`kind`, all required — verified in Task 40 Step 1).

## Slice 7: Model rollback — stop pushing model to ACP & CLI

### Task 42: Remove `buildModelEnv` from adapters (sidecar)

**Files:**
- Modify `packages/sidecar/src/session/agents/adapters.test.ts` (delete the `buildModelEnv` describe + its import)
- Modify `packages/sidecar/src/session/agents/adapters.ts` (delete the `buildModelEnv` function + its now-unused `ResolvedModel` import)

- [ ] **Step 1: Update the test file to drop the `buildModelEnv` suite + import.** Replace the entire contents of `packages/sidecar/src/session/agents/adapters.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { parseRichLine } from './adapters.js'

describe('parseRichLine', () => {
  it('parses text / reasoning / tool / done events', () => {
    expect(parseRichLine('{"type":"text","delta":"hi"}')).toEqual({ kind: 'text', delta: 'hi' })
    expect(parseRichLine('{"type":"reasoning","delta":"mm"}')).toEqual({ kind: 'reasoning', delta: 'mm' })
    expect(parseRichLine('{"type":"tool_start","id":"t1","name":"edit","input":{"a":1}}')).toEqual({ kind: 'tool_start', id: 't1', name: 'edit', input: { a: 1 } })
    expect(parseRichLine('{"type":"tool_end","id":"t1","output":"done","ok":true}')).toEqual({ kind: 'tool_end', id: 't1', output: 'done', ok: true })
    expect(parseRichLine('{"type":"done"}')).toEqual({ kind: 'done' })
  })
  it('returns null for malformed JSON or unknown types (tolerate noise)', () => {
    expect(parseRichLine('not json')).toBeNull()
    expect(parseRichLine('{"type":"chatter"}')).toBeNull()
    expect(parseRichLine('{"type":"text"}')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the adapters test, expect PASS for `parseRichLine` in isolation.** The trimmed test file no longer imports `buildModelEnv`, so it loads cleanly even before the impl deletion. Run from the repo root with the full path (never `vitest run src …`, which substring-matches the paid sidecar suites):
  ```
  npx vitest run packages/sidecar/src/session/agents/adapters.test.ts
  ```
  Expected: `Test Files  1 passed`, `Tests  2 passed`. This confirms the trimmed test file is valid. The real failure surfaces at type-check (Task 43 Step 2 / Task 46 Step…) because `loop-provider.ts` still imports `buildModelEnv` — that dangling import is fixed in Task 43.

- [ ] **Step 3: Delete `buildModelEnv` and the unused import from `adapters.ts`.** Replace the entire contents of `packages/sidecar/src/session/agents/adapters.ts` with:

```ts
export type RichEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'reasoning'; delta: string }
  | { kind: 'tool_start'; id: string; name: string; input: unknown }
  | { kind: 'tool_end'; id: string; output?: string; ok: boolean }
  | { kind: 'done' }

/** Parse one newline-delimited rich-protocol line. Returns null for noise (logged & skipped upstream). */
export function parseRichLine(line: string): RichEvent | null {
  let o: Record<string, unknown>
  try { o = JSON.parse(line) as Record<string, unknown> } catch { return null }
  switch (o?.type) {
    case 'text': return typeof o.delta === 'string' ? { kind: 'text', delta: o.delta } : null
    case 'reasoning': return typeof o.delta === 'string' ? { kind: 'reasoning', delta: o.delta } : null
    case 'tool_start':
      return o.id != null && o.name != null
        ? { kind: 'tool_start', id: String(o.id), name: String(o.name), input: o.input }
        : null
    case 'tool_end':
      return o.id != null
        ? { kind: 'tool_end', id: String(o.id), output: o.output != null ? String(o.output) : undefined, ok: o.ok !== false }
        : null
    case 'done': return { kind: 'done' }
    default: return null
  }
}
```

- [ ] **Step 4: Run the adapters test again, expect PASS.**
  Run:
  ```
  npx vitest run packages/sidecar/src/session/agents/adapters.test.ts
  ```
  Expected: `Test Files  1 passed`, `Tests  2 passed`.

  (Type-check is NOT run yet — `loop-provider.ts` still imports the now-deleted `buildModelEnv`; that is fixed in Task 43. Commit this atomic deletion now.)

- [ ] **Step 5: Commit.**
  Run:
  ```
  git add packages/sidecar/src/session/agents/adapters.ts packages/sidecar/src/session/agents/adapters.test.ts && git commit -m "refactor(sidecar): drop buildModelEnv model-env contract (rollback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 43: Stop injecting model env in the CLI loop provider (sidecar)

**Files:**
- Modify `packages/sidecar/src/session/agents/loop-provider.ts` (drop the `buildModelEnv` import + the `acceptsModelConfig && model` env-injection line; the `model` ctor param becomes vestigial but is kept for the existing factory signature)
- Modify `packages/sidecar/src/session/agents/loop-provider.test.ts` (delete the "injects the HIP_* model env" test)

- [ ] **Step 1: Delete the model-env test.** In `packages/sidecar/src/session/agents/loop-provider.test.ts`, remove this block (lines 42–47, including the blank line before it):

```ts
  it('injects the HIP_* model env when acceptsModelConfig', async () => {
    const p = new LoopAgentProvider({ ...thinAgent, acceptsModelConfig: true }, process.cwd(), { providerID: 'acme', modelID: 'acme-large', baseURL: 'u', apiKey: 'sk' })
    providers.push(p)
    const a = captureEmit(); await p.runTurn('hi', a.emit, new AbortController().signal)
    expect(a.cap.text).toBe('echo: hi [model=acme-large]')
  })
```

  So the `describe('LoopAgentProvider — thin', …)` block ends right after the "streams the echoed text" test:

```ts
describe('LoopAgentProvider — thin', () => {
  it('streams the echoed text and reuses one process across turns', async () => {
    const p = new LoopAgentProvider(thinAgent, process.cwd(), null); providers.push(p)
    const a = captureEmit(); await p.runTurn('hello', a.emit, new AbortController().signal)
    expect(a.cap.text).toBe('echo: hello')
    const b = captureEmit(); await p.runTurn('again', b.emit, new AbortController().signal)
    expect(b.cap.text).toBe('echo: again')
  })
})
```

- [ ] **Step 2: Run the loop-provider test, expect FAIL** (the file still imports `buildModelEnv` from `adapters.js`, which Task 42 deleted, so the suite cannot load).
  Run:
  ```
  npx vitest run packages/sidecar/src/session/agents/loop-provider.test.ts
  ```
  Expected: a load/transform error like `No matching export in "src/session/agents/adapters.ts" for import "buildModelEnv"` (originating from `loop-provider.ts`). FAIL.

- [ ] **Step 3: Remove the import + the injection line in `loop-provider.ts`.** Apply two edits.

  Edit A — change the import (line 5) from:
  ```ts
  import { buildModelEnv, parseRichLine, type RichEvent } from './adapters.js'
  ```
  to:
  ```ts
  import { parseRichLine, type RichEvent } from './adapters.js'
  ```

  Edit B — in `spawnChild()`, replace these three lines (61–63):
  ```ts
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (this.agent.acceptsModelConfig && this.model) Object.assign(env, buildModelEnv(this.model))
    if (this.agent.env) Object.assign(env, this.agent.env)
  ```
  with (drop the model branch; `this.model` is no longer read — the ctor param is retained only for the shared `(agent, cwd, model)` factory signature):
  ```ts
    // Model rollback: hip no longer pushes its model/key into CLI agents — they self-manage. The
    // `model` ctor param is retained only for the shared (agent, cwd, model) provider-factory signature.
    void this.model
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (this.agent.env) Object.assign(env, this.agent.env)
  ```

- [ ] **Step 4: Run the loop-provider test again, expect PASS.**
  Run:
  ```
  npx vitest run packages/sidecar/src/session/agents/loop-provider.test.ts
  ```
  Expected: `Test Files  1 passed`; all remaining `LoopAgentProvider` tests pass (thin/rich/cancellation), no `[model=…]` assertions.

- [ ] **Step 5: Commit.**
  Run:
  ```
  git add packages/sidecar/src/session/agents/loop-provider.ts packages/sidecar/src/session/agents/loop-provider.test.ts && git commit -m "refactor(sidecar): CLI loop provider no longer injects model env (rollback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 44: Remove the `hip-managed` branch from ACP spawn config (sidecar)

**Files:**
- Modify `packages/sidecar/src/session/agents/acp-config.ts` (delete the `authMode==='hip-managed'` branch + the now-unused `providerEnvVar` helper and the `fs`/`os`/`path` imports; keep `agent.env` passthrough; keep the `model` param + its `ResolvedModel` import only for the shared factory signature)
- Modify `packages/sidecar/src/session/agents/acp-config.test.ts` (rewrite to assert no model env is ever injected, in either legacy authMode)

- [ ] **Step 1: Rewrite the test to lock the rollback behavior.** Replace the entire contents of `packages/sidecar/src/session/agents/acp-config.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { buildAcpSpawn } from './acp-config.js'

const baseAgent: any = { id: 'opencode', name: 'OpenCode', kind: 'acp', command: 'opencode', args: ['acp', '--pure'], transport: 'rich', enabled: true, quirks: 'opencode' }

describe('buildAcpSpawn (model rollback)', () => {
  it('never writes OPENCODE_CONFIG or a key, even for a legacy hip-managed agent with a model', () => {
    const model = { providerID: 'deepseek', modelID: 'deepseek-chat', baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-test' }
    const { command, args, env } = buildAcpSpawn({ ...baseAgent, authMode: 'hip-managed', acceptsModelConfig: true, boundModel: { providerID: 'deepseek', modelID: 'deepseek-chat' } }, model)
    expect(command).toBe('opencode')
    expect(args).toEqual(['acp', '--pure'])
    expect(env.OPENCODE_CONFIG).toBeUndefined()
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
  })

  it('does not throw for a legacy hip-managed agent with no resolved model (no longer billed-default guard)', () => {
    expect(() => buildAcpSpawn({ ...baseAgent, authMode: 'hip-managed', acceptsModelConfig: true }, null)).not.toThrow()
  })

  it('opencode-self mode: no key, no OPENCODE_CONFIG', () => {
    const { env } = buildAcpSpawn({ ...baseAgent, authMode: 'opencode-self', acceptsModelConfig: false }, null)
    expect(env.OPENCODE_CONFIG).toBeUndefined()
  })

  it('passes agent.env through to the spawn env', () => {
    const { env } = buildAcpSpawn({ ...baseAgent, authMode: 'opencode-self', acceptsModelConfig: false, env: { MOCK_ACP_THINK: '1' } }, null)
    expect(env.MOCK_ACP_THINK).toBe('1')
  })
})
```

- [ ] **Step 2: Run the acp-config test, expect FAIL** (current impl still writes `OPENCODE_CONFIG` and throws for the no-model legacy agent).
  Run:
  ```
  npx vitest run packages/sidecar/src/session/agents/acp-config.test.ts
  ```
  Expected: failures — `expected '…/opencode.json' to be undefined` (OPENCODE_CONFIG still set) and the "does not throw" test fails because the current G1 guard throws. FAIL.

- [ ] **Step 3: Strip the `hip-managed` branch + dead helpers from `acp-config.ts`.** Replace the entire contents of `packages/sidecar/src/session/agents/acp-config.ts` with:

```ts
import type { AgentConfig } from '@hip/protocol'
import type { ResolvedModel } from './registry.js'

export interface AcpSpawn { command: string; args: string[]; env: NodeJS.ProcessEnv }

// Model rollback: hip no longer pushes its model/key into ACP agents — they self-manage (the legacy
// `hip-managed` authMode is ignored at runtime). The `model` param is retained only for the shared
// (agent, model) provider/connection factory signature; it is intentionally unused here.
export function buildAcpSpawn(agent: AgentConfig, model: ResolvedModel | null): AcpSpawn {
  // NOTE: this spawn path is OpenCode-shaped. A future ACP provider (claude-code/codex/kimi-code)
  // will branch here on its preset/quirks. Reserved — not reachable yet because only OpenCode is
  // selectable in the provider picker (src/lib/acpPresets.ts).
  void model
  const env: NodeJS.ProcessEnv = { ...process.env, ...(agent.env ?? {}) }
  // All ACP agents are self-managed: inject nothing model/key-related; OpenCode reads its own auth.json.
  return { command: agent.command, args: agent.args, env }
}
```

- [ ] **Step 4: Run the acp-config test again, expect PASS.**
  Run:
  ```
  npx vitest run packages/sidecar/src/session/agents/acp-config.test.ts
  ```
  Expected: `Test Files  1 passed`, `Tests  4 passed`.

- [ ] **Step 5: Commit.**
  Run:
  ```
  git add packages/sidecar/src/session/agents/acp-config.ts packages/sidecar/src/session/agents/acp-config.test.ts && git commit -m "refactor(sidecar): ACP spawn no longer pushes hip model/key (rollback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 45: External agents always resolve to `model=null` (sidecar session)

**Files:**
- Modify `packages/sidecar/src/session/session.ts` (`ensureExternalProvider`, line 196: stop calling `resolveAgentModel`; pass `null`; drop the now-unused `resolveAgentModel` import on line 23 — verified the only consumer is line 196)

- [ ] **Step 1: Verify whether `resolveAgentModel` is still used elsewhere in `session.ts`.**
  Run:
  ```
  grep -n "resolveAgentModel\|acceptsModelConfig" /Users/lijiamin/data/my-github/hip/packages/sidecar/src/session/session.ts
  ```
  Expected: exactly two hits — the import on line 23 and the use on line 196. (If any other use exists, keep the import.) Based on the current tree, line 196 is the only consumer, so the import will be removed. NOTE: `resolveAgentModel` remains exported by `agents/registry.ts` + re-exported by `agents/index.ts`; `invoker.ts` still imports it directly from `./registry.js` for the internal-agent path, so removing it from `session.ts` alone is safe.

- [ ] **Step 2: Edit `ensureExternalProvider` to force `model=null`.** In `packages/sidecar/src/session/session.ts`, replace this line (196):
  ```ts
      const model = agent.acceptsModelConfig ? resolveAgentModel(agent) : null
  ```
  with:
  ```ts
      // Model rollback: external agents (acp + custom) always self-manage — hip never resolves/pushes
      // a model. The legacy acceptsModelConfig/authMode fields are ignored here. resolveAgentModel now
      // serves only the internal-agent path (via the AgentInvoker).
      const model = null
  ```

- [ ] **Step 3: Drop the now-unused `resolveAgentModel` import.** On line 23, change:
  ```ts
  import { createAgentProvider, readAgentsConfig, resolveAgentModel, type AgentProvider } from './agents/index.js'
  ```
  to:
  ```ts
  import { createAgentProvider, readAgentsConfig, type AgentProvider } from './agents/index.js'
  ```

- [ ] **Step 4: Type-check the sidecar, expect PASS.** This also confirms Tasks 42–44 are coherent (no dangling `buildModelEnv`/`hip-managed` references in the sidecar). The sidecar's `type-check` script is `tsc --noEmit`.
  Run:
  ```
  yarn workspace @hip/sidecar type-check
  ```
  Expected: no output (exit 0). If `resolveAgentModel` is reported as "declared but never read", the import removal in Step 3 was missed — fix and re-run. If `model` is reported as inferred `null`-only and a strict-null assignment to `ResolvedModel | null` complains, that is fine — `createAgentProvider(agent, cwd, model)` accepts `ResolvedModel | null` and `null` is assignable.

- [ ] **Step 5: Run the affected sidecar integration tests to confirm external-agent paths still pass with `model=null`.** Use full file paths from the repo root (NOT `vitest run src …`, which substring-matches and can fire the paid suites). These three files all configure their agents with `acceptsModelConfig: false` and never assert a pushed model, so they should pass unchanged.
  Run:
  ```
  npx vitest run packages/sidecar/src/session/external-acp.integration.test.ts packages/sidecar/src/session/external-agent.integration.test.ts packages/sidecar/src/session/dispatch-internal.integration.test.ts
  ```
  Expected: all three files pass. If any test asserted that a model was pushed to an external agent, update that assertion to expect `null`/no model env (read the failing test, mirror the existing Fake-provider/mock-agent style; do NOT call a real model).

- [ ] **Step 6: Commit.**
  Run:
  ```
  git add packages/sidecar/src/session/session.ts && git commit -m "refactor(sidecar): external agents always model=null (rollback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 46: `agentDraft.isValid` — acp & custom never need a model

**Files:**
- Modify `src/lib/agentDraft.test.ts` (rewrite the acp/custom model expectations)
- Modify `src/lib/agentDraft.ts` (`isAgentDraftValid`: no `needsModel` for acp/custom; `buildAgentDraft`: acp/custom emit `acceptsModelConfig:false`, no `boundModel`, no `authMode`)

- [ ] **Step 1: Rewrite the failing/changed tests in `agentDraft.test.ts`.** Replace the whole `describe('isAgentDraftValid', …)` block (lines 22–37) with:

```ts
describe('isAgentDraftValid', () => {
  it('requires name and command', () => {
    expect(isAgentDraftValid(base)).toBe(true)
    expect(isAgentDraftValid({ ...base, name: '  ' })).toBe(false)
    expect(isAgentDraftValid({ ...base, command: '' })).toBe(false)
  })
  it('custom agents never require a model (rollback)', () => {
    expect(isAgentDraftValid({ ...base, acceptsModelConfig: true, boundModelKey: '' })).toBe(true)
    expect(isAgentDraftValid({ ...base, acceptsModelConfig: false, boundModelKey: '' })).toBe(true)
  })
  it('acp agents never require a model regardless of legacy authMode (rollback)', () => {
    expect(isAgentDraftValid({ ...base, kind: 'acp', authMode: 'hip-managed', boundModelKey: '' })).toBe(true)
    expect(isAgentDraftValid({ ...base, kind: 'acp', authMode: 'opencode-self', boundModelKey: '' })).toBe(true)
  })
})
```

  Then replace the existing "omits boundModel when acceptsModelConfig is off" and "splits boundModel on the FIRST slash" custom tests (lines 47–53) — both currently rely on `acceptsModelConfig` driving `boundModel` for custom agents — with a single rolled-back test:

```ts
  it('custom agents never emit a boundModel, even when a key is set (rollback)', () => {
    expect(buildAgentDraft({ ...base, acceptsModelConfig: false, boundModelKey: 'anthropic/x' }).boundModel).toBeUndefined()
    expect(buildAgentDraft({ ...base, acceptsModelConfig: true, boundModelKey: 'openrouter/meta/llama-3' }).boundModel).toBeUndefined()
  })
```

  Then replace the two `buildAgentDraft` acp tests (lines 54–63) — which currently expect `authMode` to be carried and `hip-managed` to bind a model — with:

```ts
  it('acp: no model pushed, acceptsModelConfig false, no authMode field (rollback)', () => {
    const d = buildAgentDraft({ ...base, kind: 'acp', authMode: 'opencode-self', quirks: 'opencode', boundModelKey: 'anthropic/x' })
    expect(d).toMatchObject({ kind: 'acp', quirks: 'opencode', acceptsModelConfig: false })
    expect(d.boundModel).toBeUndefined()
    expect('authMode' in d).toBe(false)
  })
  it('acp ignores a legacy hip-managed selection: still no model, no authMode (rollback)', () => {
    const d = buildAgentDraft({ ...base, kind: 'acp', authMode: 'hip-managed', quirks: 'opencode', boundModelKey: 'anthropic/claude-opus-4' })
    expect(d).toMatchObject({ kind: 'acp', acceptsModelConfig: false })
    expect(d.boundModel).toBeUndefined()
    expect('authMode' in d).toBe(false)
  })
```

  (Leave the remaining `buildAgentDraft` tests intact — "trims fields and whitespace-splits args" (lines 40–43), "empty args → []" (lines 44–46), the unchanged "non-acp forms do not emit an authMode field" test (lines 64–66, still true after the rollback since custom never emits authMode), and "carries a trimmed description" (lines 67–71). The internal-agent `describe` block at the bottom is also unchanged — internal agents keep `parseBoundModel` on the FIRST slash; its existing "binds a model when a key is chosen" test still covers the first-slash split.)

- [ ] **Step 2: Run the agentDraft test, expect FAIL** (current impl still treats acp `hip-managed` / custom `acceptsModelConfig` as needing a model and emits `boundModel`/`authMode`). Run from the repo root:
  ```
  npx vitest run src/lib/agentDraft.test.ts
  ```
  Expected: failures in the new "never require a model" and "no model pushed" tests. FAIL.

- [ ] **Step 3: Update `isAgentDraftValid` and `buildAgentDraft`.** In `src/lib/agentDraft.ts`, replace the `isAgentDraftValid` body (lines 24–35):
  ```ts
  export function isAgentDraftValid(form: AgentForm): boolean {
    if (form.kind === 'internal') {
      return form.name.trim() !== '' && form.prompt.trim() !== ''
    }
    // For an acp agent with hip-managed auth, a model must be chosen.
    const needsModel = form.kind === 'acp' ? form.authMode === 'hip-managed' : form.acceptsModelConfig
    return (
      form.name.trim() !== '' &&
      form.command.trim() !== '' &&
      (!needsModel || form.boundModelKey !== '')
    )
  }
  ```
  with (acp + custom never require a model after the rollback):
  ```ts
  export function isAgentDraftValid(form: AgentForm): boolean {
    if (form.kind === 'internal') {
      return form.name.trim() !== '' && form.prompt.trim() !== ''
    }
    // Model rollback: external agents (acp + custom) self-manage — a model is never required.
    return form.name.trim() !== '' && form.command.trim() !== ''
  }
  ```

  Then replace the external (non-internal) branch of `buildAgentDraft` (lines 60–75):
  ```ts
    const isAcp = form.kind === 'acp'
    const acceptsModelConfig = isAcp ? form.authMode === 'hip-managed' : form.acceptsModelConfig
    const useModel = acceptsModelConfig && form.boundModelKey !== ''
    return {
      name: form.name.trim(),
      description: (form.description ?? '').trim() || undefined,
      kind: form.kind,
      command: form.command.trim(),
      args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
      transport: form.transport,
      acceptsModelConfig,
      boundModel: useModel ? parseBoundModel(form.boundModelKey) : undefined,
      ...(isAcp ? { authMode: form.authMode } : {}),
      ...(form.quirks ? { quirks: form.quirks } : {}),
      enabled: form.enabled,
    }
  ```
  with (acp + custom: never push a model, never emit `authMode`; `acceptsModelConfig` is hard-`false`):
  ```ts
    // Model rollback: external agents (acp + custom) self-manage. We never push a model, so
    // acceptsModelConfig is always false and no boundModel/authMode is emitted (legacy fields stay
    // inert in the type for back-compat with already-saved configs).
    return {
      name: form.name.trim(),
      description: (form.description ?? '').trim() || undefined,
      kind: form.kind,
      command: form.command.trim(),
      args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
      transport: form.transport,
      acceptsModelConfig: false,
      ...(form.quirks ? { quirks: form.quirks } : {}),
      enabled: form.enabled,
    }
  ```

- [ ] **Step 4: Verify `parseBoundModel` is still used (internal branch keeps it) so there is no unused-symbol error.**
  Run:
  ```
  grep -n "parseBoundModel" /Users/lijiamin/data/my-github/hip/src/lib/agentDraft.ts
  ```
  Expected: two hits — the function definition and its call inside the `kind === 'internal'` branch (`boundModel: parseBoundModel(form.boundModelKey)`). It remains in use, so keep it.

- [ ] **Step 5: Run the agentDraft test again, expect PASS.**
  Run:
  ```
  npx vitest run src/lib/agentDraft.test.ts
  ```
  Expected: `Test Files  1 passed`; all `isAgentDraftValid`, `buildAgentDraft`, and `internal agents` tests pass.

- [ ] **Step 6: Commit.**
  Run:
  ```
  git add src/lib/agentDraft.ts src/lib/agentDraft.test.ts && git commit -m "refactor(ui): acp & custom drafts never bind a model (rollback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 47: Remove ACP auth-mode + CLI model UI from the agent editor

**Files:**
- Modify `src/components/account/AgentEditor.tsx` (delete the ACP `sectionAuth` radio + conditional model dropdown; delete the CLI `acceptsModel` switch + conditional model dropdown; the internal-agent model picker stays untouched; `groups` / `groupModelOptions` are still used by the internal picker, so keep them)

- [ ] **Step 1: Remove the ACP auth-mode `Section` (lines 187–248).** In `src/components/account/AgentEditor.tsx`, inside the `isAcp && ( … )` block, delete the entire `<Section label={t('settings.agents.sectionAuth')}> … </Section>` element so that block becomes only the quirks field.

  Replace this:
  ```tsx
              {isAcp && (
                <>
                  <Field label={t('settings.agents.quirks')}>
                    <input
                      className={cn(inputCls, 'font-mono')}
                      value={form.quirks ?? ''}
                      onChange={(e) => patch({ quirks: e.target.value || undefined })}
                      placeholder={t('settings.agents.quirksPlaceholder')}
                    />
                  </Field>
                  <Section label={t('settings.agents.sectionAuth')}>
                    <div
                      role="radiogroup"
                      aria-label={t('settings.agents.sectionAuth')}
                      className="flex gap-2"
                      onKeyDown={(e) => {
                        const next =
                          e.key === 'ArrowRight' || e.key === 'ArrowDown'
                            ? 'hip-managed'
                            : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                              ? 'opencode-self'
                              : null
                        if (!next) return
                        e.preventDefault()
                        patch({ authMode: next })
                        e.currentTarget.querySelectorAll('button')[next === 'opencode-self' ? 0 : 1]?.focus()
                      }}
                    >
                      <ChoiceCard
                        selected={form.authMode === 'opencode-self'}
                        title={t('settings.agents.authSelf')}
                        desc={t('settings.agents.authSelfDesc')}
                        onClick={() => patch({ authMode: 'opencode-self' })}
                      />
                      <ChoiceCard
                        selected={form.authMode === 'hip-managed'}
                        title={t('settings.agents.authManaged')}
                        desc={t('settings.agents.authManagedDesc')}
                        onClick={() => patch({ authMode: 'hip-managed' })}
                      />
                    </div>
                    {form.authMode === 'hip-managed' && (
                      <select
                        className={cn(inputCls, 'mt-2')}
                        value={form.boundModelKey}
                        onChange={(e) => patch({ boundModelKey: e.target.value })}
                      >
                        <option value="">{t('settings.agents.selectModel')}</option>
                        {groups.map((g) => (
                          <optgroup key={g.providerID} label={g.providerName}>
                            {g.models.map((m) => (
                              <option key={m.key} value={m.key}>
                                {m.modelID}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    )}
                  </Section>
                </>
              )}
  ```
  with (keep only the quirks field for ACP):
  ```tsx
              {isAcp && (
                <Field label={t('settings.agents.quirks')}>
                  <input
                    className={cn(inputCls, 'font-mono')}
                    value={form.quirks ?? ''}
                    onChange={(e) => patch({ quirks: e.target.value || undefined })}
                    placeholder={t('settings.agents.quirksPlaceholder')}
                  />
                </Field>
              )}
  ```

- [ ] **Step 2: Remove the CLI `acceptsModel` model `Section` (lines 283–315).** Delete the entire `{!isAcp && ( … )}` block that renders the model switch + dropdown. Delete this block in full:
  ```tsx
              {!isAcp && (
                <Section label={t('settings.agents.sectionModel')}>
                  <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
                    <div className="flex-1">
                      <div className="text-body text-ink">{t('settings.agents.acceptsModel')}</div>
                      <div className="mt-0.5 text-caption text-ink-tertiary">{t('settings.agents.acceptsModelDesc')}</div>
                    </div>
                    <Switch
                      checked={form.acceptsModelConfig}
                      onCheckedChange={(v) => patch({ acceptsModelConfig: v, boundModelKey: v ? form.boundModelKey : '' })}
                      ariaLabel={t('settings.agents.acceptsModel')}
                    />
                  </div>
                  {form.acceptsModelConfig && (
                    <select
                      className={cn(inputCls, 'mt-2')}
                      value={form.boundModelKey}
                      onChange={(e) => patch({ boundModelKey: e.target.value })}
                    >
                      <option value="">{t('settings.agents.selectModel')}</option>
                      {groups.map((g) => (
                        <optgroup key={g.providerID} label={g.providerName}>
                          {g.models.map((m) => (
                            <option key={m.key} value={m.key}>
                              {m.modelID}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </Section>
              )}
  ```
  After this edit the external-agent branch ends with the `sectionTransport` `Section`, immediately followed by the closing `</>` of the `: (` external branch. (`groups` is still consumed by the internal-agent `sectionModel` picker at lines ~145–156, so the local stays live; `form.acceptsModelConfig`, `form.authMode`, `pickPreset`'s `authMode` write, and the `useState` initializer's `authMode`/`acceptsModelConfig` reads remain in the `AgentForm` state but are now write-only — TypeScript does not error on a written-but-unread object property.)

- [ ] **Step 3: Type-check the renderer, expect PASS.** `groups`, `groupModelOptions`, `Switch`, and `ChoiceCard` are all still referenced (internal picker uses `groups`/`groupModelOptions`; the `enableThis` footer + internal tool toggles use `Switch`; the transport radio uses `ChoiceCard`), so no unused-symbol errors. The root `type-check` script is `tsc --noEmit`.
  Run:
  ```
  yarn type-check
  ```
  Expected: no output (exit 0).

  - If `groups`/`groupModelOptions` is reported unused: it is NOT — the internal-agent `sectionModel` picker (`groups.map(...)`, lines ~145–156) still consumes it. Re-check the edit did not remove the internal branch.
  - If `ChoiceCard`/`Switch` reported unused: they are still used (transport radio / enable footer / internal tool toggles). Re-check.

- [ ] **Step 4: Commit.**
  Run:
  ```
  git add src/components/account/AgentEditor.tsx && git commit -m "refactor(ui): remove ACP auth-mode + CLI model pickers from editor (rollback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 48: AgentCard — only internal agents show a model badge

**Files:**
- Modify `src/components/account/AgentCard.tsx` (the `boundModel`/global-model `Badge` should render for `internal` only — acp/custom no longer carry a meaningful `boundModel`)

- [ ] **Step 1: Restrict the model badge to internal agents.** In `src/components/account/AgentCard.tsx`, replace this block (lines 64–69):
  ```tsx
          {(agent.boundModel || cat === 'internal') && (
            <Badge>
              <Cpu size={11} />
              {agent.boundModel ? agent.boundModel.modelID : t('settings.agents.badgeGlobalModel')}
            </Badge>
          )}
  ```
  with (only internal agents surface a model; legacy `boundModel` on acp/custom is inert data and must not render):
  ```tsx
          {cat === 'internal' && (
            <Badge>
              <Cpu size={11} />
              {agent.boundModel ? agent.boundModel.modelID : t('settings.agents.badgeGlobalModel')}
            </Badge>
          )}
  ```

- [ ] **Step 2: Type-check the renderer, expect PASS.** `Cpu` is still imported/used inside the badge; the `badgeGlobalModel` key still exists (kept for internal agents).
  Run:
  ```
  yarn type-check
  ```
  Expected: no output (exit 0).

- [ ] **Step 3: Commit.**
  Run:
  ```
  git add src/components/account/AgentCard.tsx && git commit -m "refactor(ui): AgentCard shows model badge for internal agents only (rollback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 49: Remove orphaned ACP/CLI auth + model i18n keys (all three locales)

**Files:**
- Modify `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts` (remove `acceptsModel`, `acceptsModelDesc`, `sectionAuth`, `authSelf`, `authSelfDesc`, `authManaged`, `authManagedDesc`, `selectModel`; KEEP `sectionModel`, `modelGlobal`, `badgeGlobalModel` — the internal-agent picker + card still use them)

- [ ] **Step 1: Confirm `selectModel` is fully orphaned after Task 47** (it was only used by the two removed ACP/CLI dropdowns; the internal picker uses `modelGlobal`, not `selectModel`).
  Run:
  ```
  grep -rn "selectModel\|acceptsModel\|sectionAuth\|authSelf\|authManaged" /Users/lijiamin/data/my-github/hip/src --include='*.tsx' --include='*.ts' | grep -v "/i18n/"
  ```
  Expected: NO matches (every `t('settings.agents.<key>')` consumer was removed in Tasks 46–48). If any match remains in a `.tsx`, stop and remove that usage first.

- [ ] **Step 2: Remove the 8 keys from `src/i18n/en.ts`.** Delete by exact content (line numbers shift as you delete, so match the strings, not the line numbers):

  Delete:
  ```ts
        acceptsModel: 'Push my configured model + key',
  ```
  Delete:
  ```ts
        acceptsModelDesc: 'Push the selected model and API key to this agent',
  ```
  Delete the contiguous six-line block:
  ```ts
        sectionAuth: 'Model & key',
        authSelf: 'OpenCode self-managed',
        authSelfDesc: 'OpenCode manages its own model and key',
        authManaged: 'Managed by hip',
        authManagedDesc: 'Push the selected model and API key to OpenCode',
        selectModel: 'Select a model…',
  ```
  KEEP `sectionModel: 'Model',` (internal picker), `modelGlobal: 'Use global model',`, and `badgeGlobalModel: 'Global model',`.

- [ ] **Step 3: Remove the same 8 keys from `src/i18n/zh-CN.ts`.** Delete:
  ```ts
        acceptsModel: '推送我配置的模型与密钥',
  ```
  ```ts
        acceptsModelDesc: '把所选模型与 API 密钥传给该智能体',
  ```
  ```ts
        sectionAuth: '模型与密钥',
        authSelf: 'OpenCode 自管',
        authSelfDesc: '由 OpenCode 自行管理模型与密钥',
        authManaged: 'hip 托管',
        authManagedDesc: '把所选模型与 API 密钥传给 OpenCode',
        selectModel: '选择模型…',
  ```
  KEEP `sectionModel: '模型',`, `modelGlobal: '使用全局模型',`, `badgeGlobalModel: '全局模型',`.

- [ ] **Step 4: Remove the same 8 keys from `src/i18n/zh-TW.ts`.** Delete:
  ```ts
        acceptsModel: '推送我設定的模型與密鑰',
  ```
  ```ts
        acceptsModelDesc: '把所選模型與 API 金鑰傳給該智能體',
  ```
  ```ts
        sectionAuth: '模型與密鑰',
        authSelf: 'OpenCode 自管',
        authSelfDesc: '由 OpenCode 自行管理模型與密鑰',
        authManaged: 'hip 託管',
        authManagedDesc: '把所選模型與 API 金鑰傳給 OpenCode',
        selectModel: '選擇模型…',
  ```
  KEEP `sectionModel: '模型',`, `modelGlobal: '使用全域模型',`, `badgeGlobalModel: '全域模型',`.

- [ ] **Step 5: Type-check, expect PASS** (catches any locale shape mismatch / leftover `as const satisfies` violation, and any remaining `t()` reference to a removed key — the three locale objects must keep identical key shapes).
  Run:
  ```
  yarn type-check
  ```
  Expected: no output (exit 0).

- [ ] **Step 6: Confirm no dangling references to the removed keys remain anywhere.**
  Run:
  ```
  grep -rn "settings.agents.acceptsModel\|settings.agents.sectionAuth\|settings.agents.authSelf\|settings.agents.authManaged\|settings.agents.selectModel" /Users/lijiamin/data/my-github/hip/src
  ```
  Expected: NO matches.

- [ ] **Step 7: Commit.**
  Run:
  ```
  git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts && git commit -m "chore(i18n): remove ACP auth-mode + CLI model strings (rollback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 50: Full-suite green gate (type-check + paid-free vitest)

**Files:**
- No file changes — verification only. (Confirms the whole rollback is coherent across protocol/sidecar/renderer and that no other test asserted the old model-push behavior.)

- [ ] **Step 1: Type-check the whole workspace, expect PASS.** (Frontend `type-check` = `tsc --noEmit`; sidecar `type-check` = `tsc --noEmit`.)
  Run:
  ```
  yarn type-check && yarn workspace @hip/sidecar type-check
  ```
  Expected: no output from either (exit 0). If the sidecar reports `resolveAgentModel` declared-but-unused in `session.ts`, the Task 45 import removal was incomplete — fix and re-run.

- [ ] **Step 2: Guarantee paid-free, then run the full suite.** Per the memory trap (`yarn test`/`vitest run src …` substring-matches `packages/sidecar/src` and fires the paid real-LLM suites — `session.test.ts` and `reasoner-reasoning.integration.test.ts` — whose keys are re-seeded from `~/.hip/config/auth.json` even after `env -u`), the ONLY reliable lever is to move `auth.json` aside first, run, then restore.
  Run:
  ```
  AUTH="$HOME/.hip/config/auth.json"; [ -f "$AUTH" ] && mv "$AUTH" "$AUTH.slice60.bak"; yarn test; rc=$?; [ -f "$AUTH.slice60.bak" ] && mv "$AUTH.slice60.bak" "$AUTH"; exit $rc
  ```
  Expected: `Test Files … passed`, `Tests … passed | 4 skipped` (the 4 skipped = the 2 paid files; with `auth.json` gone their `skipIf(!key)` guards fire). Pay special attention to: `packages/sidecar/src/session/agents/adapters.test.ts`, `acp-config.test.ts`, `loop-provider.test.ts`, the three `session/*.integration.test.ts` files exercised in Task 45, and `src/lib/agentDraft.test.ts` — all green.

  - If any OTHER test (e.g. `acp-connection.test.ts`, `invoker.test.ts`, `acp-provider.test.ts`, `registry.test.ts`, `external-*.integration.test.ts`, `dispatch-internal.integration.test.ts`, `src/store/agentsStore.test.ts`, `src/ipc/agentsConfig.test.ts`, or `src/lib/acpPresets.test.ts`) asserts the OLD model-push / `hip-managed`-OPENCODE_CONFIG behavior, read that test and update its expectation to the rolled-back behavior (external agents self-manage: `model=null`, no `OPENCODE_CONFIG`, no model env, no `boundModel`/`authMode` emitted for acp/custom). NOTE: `invoker.test.ts` (internal-agent dispatch path) and `registry.test.ts` (`resolveAgentModel` unit) and `acp-provider.test.ts` (live `setConfigOption` mode switch) and `agentsStore.test.ts`/`acpPresets.test.ts` (default-seed `authMode`/`authModeDefault`) all test code paths this slice does NOT modify — they should pass unchanged. Re-run after each fix. Do NOT introduce any real-model call.

- [ ] **Step 3: Final rollback-residue sweep.** Confirm no production code path still pushes a hip model to an external agent.
  Run:
  ```
  grep -rn "buildModelEnv\|OPENCODE_CONFIG\|hip-managed" /Users/lijiamin/data/my-github/hip/packages/sidecar/src /Users/lijiamin/data/my-github/hip/src --include='*.ts' --include='*.tsx' | grep -v '\.test\.'
  ```
  Expected: NO matches in non-test code (the only surviving `hip-managed`/`acceptsModelConfig`/`authMode` mentions live in `packages/protocol/src/index.ts` as type members owned by S0 — not this slice — and in `src/lib/acpPresets.ts`'s `authModeDefault` preset field, which Task 47 deliberately keeps; neither is matched by this grep scope plus filter since the grep targets only `buildModelEnv`/`OPENCODE_CONFIG`/`hip-managed`).

- [ ] **Step 4: Commit (only if Step 2 required test edits).** If Step 2 required test edits, stage and commit them:
  ```
  git add -A && git commit -m "test: align suites with external-agent model rollback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  If no fixes were needed, skip this commit (the slice is already fully committed across Tasks 42–49).

## Slice 8: 内部智能体的 skill/script/MCP 工具授权(spec §C.4 gap-fill)

This slice closes the §C.4 gap where INTERNAL agents (`kind:'internal'`) could only be granted the four static capability groups (read/edit/plan/git) and had no way to enable `use_skill`, `run_script`, or any MCP-server tools through the agent editor's allow-list. We add two more static groups (`skill`→`use_skill`, `script`→`run_script`) and per-MCP-server grants. **Deviation — per-server wildcard:** MCP grants are whole-server (Decision 9), not per-tool, because the frontend cannot enumerate a server's individual tool names without a live ACP/stdio connection to that server. We therefore represent a granted server as the single allow-list entry `mcp__<serverId>__*` (a wildcard), and teach the sidecar's `filterTools` to honor that wildcard (any tool whose name starts with `mcp__<serverId>__` passes). All other allow-list entries keep exact-match semantics, and `undefined ⇒ keep all` is unchanged. The static helpers (`groupsToToolNames`/`toolNamesToGroups`) stay purely about static groups; the editor concatenates the static names with the per-server wildcards when assembling `allowedTools`, and the round-trip seeds static toggles via `toolNamesToGroups` and server checkboxes via a new `grantedMcpServerIds` parser that ignores everything but `mcp__<id>__*` entries.

### Task 51: filterTools — honor `mcp__<id>__*` wildcard grants (sidecar, TDD)

**Files:**
- `packages/sidecar/src/session/internal-runner.test.ts` (extend the existing `describe('filterTools')`)
- `packages/sidecar/src/session/internal-runner.ts` (modify `filterTools`)

- [ ] **Step 1:** Add failing tests for the wildcard behavior. Open `packages/sidecar/src/session/internal-runner.test.ts` and replace the existing `describe('filterTools', …)` block (currently lines 30–40) with this expanded block. It keeps the two existing cases verbatim and adds wildcard cases. The wildcard cases build fake tools by name (no real MCP server needed) so they stay pure and paid-LLM-free.

```ts
describe('filterTools', () => {
  it('keeps all tools when allowedTools is undefined', () => {
    const tools = buildTools('/proj')
    expect(filterTools(tools, undefined)).toHaveLength(tools.length)
  })
  it('keeps only the named tools', () => {
    const tools = buildTools('/proj')
    const kept = filterTools(tools, ['read_file', 'grep']).map((t) => t.name).sort()
    expect(kept).toEqual(['grep', 'read_file'])
  })
  it('a mcp__<id>__* wildcard keeps every tool of that server', () => {
    const fake = (name: string) => ({ name } as unknown as StructuredToolInterface)
    const tools = [fake('read_file'), fake('mcp__fs__read'), fake('mcp__fs__write'), fake('mcp__db__query')]
    const kept = filterTools(tools, ['mcp__fs__*']).map((t) => t.name).sort()
    expect(kept).toEqual(['mcp__fs__read', 'mcp__fs__write'])
  })
  it('mixes exact names and wildcards', () => {
    const fake = (name: string) => ({ name } as unknown as StructuredToolInterface)
    const tools = [fake('read_file'), fake('write_file'), fake('mcp__fs__read'), fake('mcp__db__query')]
    const kept = filterTools(tools, ['read_file', 'mcp__db__*']).map((t) => t.name).sort()
    expect(kept).toEqual(['mcp__db__query', 'read_file'])
  })
  it('a wildcard does not match a different server prefix', () => {
    const fake = (name: string) => ({ name } as unknown as StructuredToolInterface)
    const tools = [fake('mcp__fsx__read'), fake('mcp__fs__read')]
    const kept = filterTools(tools, ['mcp__fs__*']).map((t) => t.name)
    expect(kept).toEqual(['mcp__fs__read'])
  })
})
```

- [ ] **Step 2:** Add the `StructuredToolInterface` type import the new fakes need. At the top of `packages/sidecar/src/session/internal-runner.test.ts`, the imports already include `buildTools`; add a type-only import for `StructuredToolInterface` right after the `GraphEmit` import. Replace this line:

```ts
import type { GraphEmit } from './graph.js'
```

with:

```ts
import type { GraphEmit } from './graph.js'
import type { StructuredToolInterface } from '@langchain/core/tools'
```

- [ ] **Step 3:** Run the new tests and watch them FAIL (the current exact-match `filterTools` drops every `mcp__*` tool because `Set.has('mcp__fs__read')` is false for an allow-list of `['mcp__fs__*']`).

  Run: `yarn workspace @hip/sidecar test internal-runner`
  Expected: the two wildcard-keeping tests and the mixed test FAIL with e.g. `expected [] to deeply equal [ 'mcp__fs__read', 'mcp__fs__write' ]`; the two original tests still PASS.

- [ ] **Step 4:** Implement the wildcard in `filterTools`. In `packages/sidecar/src/session/internal-runner.ts`, replace the current function (lines 15–20):

```ts
/** Keep only the tools whose name is in `allowed`. undefined ⇒ keep all (legacy-safe). */
export function filterTools(tools: StructuredToolInterface[], allowed?: string[]): StructuredToolInterface[] {
  if (!allowed) return tools
  const set = new Set(allowed)
  return tools.filter((t) => set.has(t.name))
}
```

with:

```ts
/** Keep only the tools whose name is in `allowed`. undefined ⇒ keep all (legacy-safe).
 *  An entry of the form `mcp__<serverId>__*` is a whole-server wildcard: it permits any tool whose
 *  name starts with `mcp__<serverId>__` (the frontend grants MCP access per-server, since it cannot
 *  enumerate a server's individual tool names without a live connection). Every other entry is an
 *  exact name match. */
export function filterTools(tools: StructuredToolInterface[], allowed?: string[]): StructuredToolInterface[] {
  if (!allowed) return tools
  const exact = new Set<string>()
  const prefixes: string[] = []
  for (const a of allowed) {
    const m = /^mcp__(.+)__\*$/.exec(a)
    if (m) prefixes.push(`mcp__${m[1]}__`)
    else exact.add(a)
  }
  return tools.filter((t) => exact.has(t.name) || prefixes.some((p) => t.name.startsWith(p)))
}
```

- [ ] **Step 5:** Run the tests again and watch them PASS.

  Run: `yarn workspace @hip/sidecar test internal-runner`
  Expected: all `filterTools` cases PASS (5 tests) and the `runManagedAgent` cases still PASS.

- [ ] **Step 6:** Type-check the sidecar to confirm no signature regression.

  Run: `yarn workspace @hip/sidecar build`
  Expected: tsc completes with no errors.

- [ ] **Step 7:** Commit.

  Run: `git add packages/sidecar/src/session/internal-runner.ts packages/sidecar/src/session/internal-runner.test.ts && git commit -m "feat(sidecar): filterTools honors mcp__<id>__* whole-server wildcard grants"`
  Expected: one commit created.

### Task 52: agentTools + agentDraft — skill/script groups + MCP-server wildcard helpers (frontend, TDD)

**Files:**
- `src/lib/agentTools.test.ts` (extend)
- `src/lib/agentTools.ts` (add `skill`/`script` groups + `mcpServerWildcard`/`grantedMcpServerIds`)
- `src/lib/agentDraft.ts` (thread new static fields + mcp wildcards through `buildAgentDraft`)

- [ ] **Step 1:** Write failing tests for the two new static groups and the two new MCP helpers. Replace the entire body of `src/lib/agentTools.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import {
  TOOL_GROUPS,
  groupsToToolNames,
  toolNamesToGroups,
  DEFAULT_TOOL_GROUPS,
  mcpServerWildcard,
  grantedMcpServerIds,
} from './agentTools'

describe('agentTools', () => {
  it('expands group booleans to the flat tool-name list', () => {
    expect(groupsToToolNames({ read: true, edit: false, plan: true, git: false, skill: false, script: false }))
      .toEqual([...TOOL_GROUPS.read, ...TOOL_GROUPS.plan])
  })
  it('includes use_skill / run_script when their groups are on (stable order, after git)', () => {
    expect(groupsToToolNames({ read: false, edit: false, plan: false, git: false, skill: true, script: true }))
      .toEqual(['use_skill', 'run_script'])
  })
  it('round-trips: a name present in a group turns that group on', () => {
    const names = [...TOOL_GROUPS.read, 'write_file']
    expect(toolNamesToGroups(names)).toEqual({ read: true, edit: true, plan: false, git: false, skill: false, script: false })
  })
  it('detects use_skill / run_script', () => {
    expect(toolNamesToGroups(['use_skill'])).toEqual({ read: false, edit: false, plan: false, git: false, skill: true, script: false })
    expect(toolNamesToGroups(['run_script'])).toEqual({ read: false, edit: false, plan: false, git: false, skill: false, script: true })
  })
  it('treats undefined allowedTools as every group on (legacy-safe)', () => {
    expect(toolNamesToGroups(undefined)).toEqual({ read: true, edit: true, plan: true, git: true, skill: true, script: true })
  })
  it('default groups are read+edit+plan, git/skill/script off', () => {
    expect(DEFAULT_TOOL_GROUPS).toEqual({ read: true, edit: true, plan: true, git: false, skill: false, script: false })
  })
  it('ignores mcp wildcard entries when deriving static groups', () => {
    expect(toolNamesToGroups(['mcp__fs__*', 'mcp__db__*']))
      .toEqual({ read: false, edit: false, plan: false, git: false, skill: false, script: false })
  })
})

describe('mcp wildcard helpers', () => {
  it('builds a whole-server wildcard entry', () => {
    expect(mcpServerWildcard('fs')).toBe('mcp__fs__*')
  })
  it('parses granted server ids from an allow-list', () => {
    expect(grantedMcpServerIds(['read_file', 'mcp__fs__*', 'use_skill', 'mcp__db__*'])).toEqual(['fs', 'db'])
  })
  it('returns [] for undefined or no wildcard entries', () => {
    expect(grantedMcpServerIds(undefined)).toEqual([])
    expect(grantedMcpServerIds(['read_file', 'mcp__fs__read'])).toEqual([])
  })
})
```

- [ ] **Step 2:** Run the tests and watch them FAIL (`mcpServerWildcard`/`grantedMcpServerIds` don't exist; `ToolGroups` has no `skill`/`script`).

  Run: `yarn test src/lib/agentTools.test.ts`
  Expected: import/compile error or assertion failures such as `mcpServerWildcard is not a function` and `expected { read: …, git: false } to deeply equal { …, skill: false, script: false }`.

  > Note: `yarn test src/...` substring-matches package paths and can fire paid sidecar suites; this filter is scoped to a single frontend file so it stays paid-free. If unsure, run `yarn test` once after moving `~/.hip/config/auth.json` aside.

- [ ] **Step 3:** Implement the new groups and helpers. Replace the entire contents of `src/lib/agentTools.ts` with:

```ts
/** Built-in tools an internal agent may be granted, grouped into capability buckets. */
export const TOOL_GROUPS = {
  read: ['read_file', 'ls', 'glob', 'grep'],
  edit: ['write_file', 'edit_file'],
  plan: ['write_todos'],
  git: ['git_commit', 'git_create_branch', 'git_switch_branch'],
  skill: ['use_skill'],
  script: ['run_script'],
} as const

export type ToolGroup = keyof typeof TOOL_GROUPS
export interface ToolGroups {
  read: boolean
  edit: boolean
  plan: boolean
  git: boolean
  skill: boolean
  script: boolean
}

/** A new internal agent: read + edit + plan; git / skill / script off. */
export const DEFAULT_TOOL_GROUPS: ToolGroups = { read: true, edit: true, plan: true, git: false, skill: false, script: false }

const ORDER: ToolGroup[] = ['read', 'edit', 'plan', 'git', 'skill', 'script']

/** Flatten the enabled groups to the precise tool-name allow-list (stable order). MCP-server grants
 *  are NOT static groups — the editor concatenates them as `mcp__<id>__*` wildcards separately. */
export function groupsToToolNames(g: ToolGroups): string[] {
  return ORDER.filter((k) => g[k]).flatMap((k) => [...TOOL_GROUPS[k]])
}

/** Derive group toggles from a stored allow-list. undefined ⇒ all on (legacy-safe); otherwise a
 *  group is on iff ANY of its tool names is present. MCP wildcard entries (`mcp__<id>__*`) belong to
 *  no static group, so `.some(includes)` correctly ignores them. */
export function toolNamesToGroups(names: string[] | undefined): ToolGroups {
  if (!names) return { read: true, edit: true, plan: true, git: true, skill: true, script: true }
  const has = (k: ToolGroup) => TOOL_GROUPS[k].some((n) => names.includes(n))
  return { read: has('read'), edit: has('edit'), plan: has('plan'), git: has('git'), skill: has('skill'), script: has('script') }
}

/** The allow-list entry that grants an internal agent every tool of one MCP server. The sidecar's
 *  filterTools expands this wildcard (frontend can't enumerate a server's tools without connecting). */
export function mcpServerWildcard(serverId: string): string {
  return `mcp__${serverId}__*`
}

/** Parse a stored allow-list and return the serverIds granted via `mcp__<id>__*` wildcards. */
export function grantedMcpServerIds(names: string[] | undefined): string[] {
  if (!names) return []
  const out: string[] = []
  for (const n of names) {
    const m = /^mcp__(.+)__\*$/.exec(n)
    if (m) out.push(m[1])
  }
  return out
}
```

- [ ] **Step 4:** Run the tests and watch them PASS.

  Run: `yarn test src/lib/agentTools.test.ts`
  Expected: all `agentTools` and `mcp wildcard helpers` cases PASS (10 tests).

- [ ] **Step 5:** Thread the new static fields and the MCP wildcards through the draft mapping. In `src/lib/agentDraft.ts`, update the imports, the `AgentForm` type, and the internal branch of `buildAgentDraft`.

  First, replace the import line:

```ts
import { groupsToToolNames } from './agentTools'
```

  with:

```ts
import { groupsToToolNames, mcpServerWildcard } from './agentTools'
```

  Next, extend the internal-only fields in `AgentForm`. Replace:

```ts
  // internal-only fields:
  prompt: string
  toolsRead: boolean
  toolsEdit: boolean
  toolsPlan: boolean
  toolsGit: boolean
  enabled: boolean
}
```

  with:

```ts
  // internal-only fields:
  prompt: string
  toolsRead: boolean
  toolsEdit: boolean
  toolsPlan: boolean
  toolsGit: boolean
  toolsSkill: boolean
  toolsScript: boolean
  mcpServerIds: string[]   // serverIds granted whole-server access (→ mcp__<id>__* wildcards)
  enabled: boolean
}
```

  Finally, update the `allowedTools` line inside the `form.kind === 'internal'` branch of `buildAgentDraft`. Replace:

```ts
      allowedTools: groupsToToolNames({ read: form.toolsRead, edit: form.toolsEdit, plan: form.toolsPlan, git: form.toolsGit }),
```

  with:

```ts
      allowedTools: [
        ...groupsToToolNames({
          read: form.toolsRead,
          edit: form.toolsEdit,
          plan: form.toolsPlan,
          git: form.toolsGit,
          skill: form.toolsSkill,
          script: form.toolsScript,
        }),
        ...form.mcpServerIds.map(mcpServerWildcard),
      ],
```

- [ ] **Step 6:** Type-check the frontend. (This will report that `AgentEditor.tsx` doesn't yet supply `toolsSkill`/`toolsScript`/`mcpServerIds` in its `useState<AgentForm>` initializer — that is expected and is fixed in Task 53; do not fix it here. Confirm the ONLY errors are those three missing `AgentForm` properties in `AgentEditor.tsx`.)

  Run: `yarn type-check`
  Expected: errors limited to `AgentEditor.tsx` — `Property 'toolsSkill' is missing…`, `'toolsScript' is missing…`, `'mcpServerIds' is missing…`. No other files error.

- [ ] **Step 7:** Commit (the build is intentionally red until Task 53 wires the editor; commit the helper + draft layer as a self-contained unit).

  Run: `git add src/lib/agentTools.ts src/lib/agentTools.test.ts src/lib/agentDraft.ts && git commit -m "feat(frontend): add skill/script tool groups + MCP-server wildcard helpers to agentTools/agentDraft"`
  Expected: one commit created.

### Task 53: AgentEditor — internal-agent use_skill/run_script/MCP-server toggles + i18n

**Files:**
- `src/i18n/en.ts`
- `src/i18n/zh-CN.ts`
- `src/i18n/zh-TW.ts`
- `src/components/account/AgentEditor.tsx`

- [ ] **Step 1:** Add the new i18n keys to **en.ts**. In `src/i18n/en.ts`, find the `toolGitDesc` line (line 303) and insert the four new keys immediately after it. Replace:

```ts
        toolGit: 'Git',
        toolGitDesc: 'git_commit, git_create_branch, git_switch_branch',
```

  with:

```ts
        toolGit: 'Git',
        toolGitDesc: 'git_commit, git_create_branch, git_switch_branch',
        toolSkill: 'Run skills',
        toolSkillDesc: 'use_skill',
        toolScript: 'Run scripts',
        toolScriptDesc: 'run_script',
        toolMcpServers: 'MCP servers',
        toolMcpServersDesc: 'Grant this agent every tool from the chosen servers',
        toolMcpServersEmpty: 'No MCP servers configured yet',
```

- [ ] **Step 2:** Add the same keys to **zh-CN.ts**. In `src/i18n/zh-CN.ts`, find the `toolGitDesc` line (line 303) and replace:

```ts
        toolGit: 'Git 操作',
        toolGitDesc: 'git_commit、git_create_branch、git_switch_branch',
```

  with:

```ts
        toolGit: 'Git 操作',
        toolGitDesc: 'git_commit、git_create_branch、git_switch_branch',
        toolSkill: '运行技能',
        toolSkillDesc: 'use_skill',
        toolScript: '运行脚本',
        toolScriptDesc: 'run_script',
        toolMcpServers: 'MCP 服务器',
        toolMcpServersDesc: '授予该智能体所选服务器的全部工具',
        toolMcpServersEmpty: '尚未配置任何 MCP 服务器',
```

- [ ] **Step 3:** Add the same keys to **zh-TW.ts**. In `src/i18n/zh-TW.ts`, find the `toolGitDesc` line (line 303) and replace:

```ts
        toolGit: 'Git 操作',
        toolGitDesc: 'git_commit、git_create_branch、git_switch_branch',
```

  with:

```ts
        toolGit: 'Git 操作',
        toolGitDesc: 'git_commit、git_create_branch、git_switch_branch',
        toolSkill: '執行技能',
        toolSkillDesc: 'use_skill',
        toolScript: '執行指令稿',
        toolScriptDesc: 'run_script',
        toolMcpServers: 'MCP 伺服器',
        toolMcpServersDesc: '授予該智能體所選伺服器的全部工具',
        toolMcpServersEmpty: '尚未設定任何 MCP 伺服器',
```

- [ ] **Step 4:** Wire the new imports and store into `AgentEditor.tsx`. In `src/components/account/AgentEditor.tsx`, replace:

```ts
import { toolNamesToGroups, DEFAULT_TOOL_GROUPS } from '@/lib/agentTools'
```

  with:

```ts
import { toolNamesToGroups, DEFAULT_TOOL_GROUPS, grantedMcpServerIds } from '@/lib/agentTools'
import { useMcpServersStore } from '@/store/mcpServersStore'
```

  Then, inside the component, find the existing store hook and the `groups0` line (around lines 32–34):

```ts
  const { t } = useTranslation()
  const { config, catalog } = useProvidersStore()
  // Existing agent → derive toggles from its stored allow-list; new agent → the git-off default.
  const groups0 = initial ? toolNamesToGroups(initial.allowedTools) : DEFAULT_TOOL_GROUPS
```

  and replace it with (adds the MCP store read + the seeded set of granted server ids):

```ts
  const { t } = useTranslation()
  const { config, catalog } = useProvidersStore()
  const { servers: mcpServers } = useMcpServersStore()
  // Existing agent → derive toggles from its stored allow-list; new agent → the git-off default.
  const groups0 = initial ? toolNamesToGroups(initial.allowedTools) : DEFAULT_TOOL_GROUPS
  const grantedServers0 = grantedMcpServerIds(initial?.allowedTools)
```

- [ ] **Step 5:** Add the three new fields to the `useState<AgentForm>` initializer. In the same file, find the trailing internal fields of the initial form (around lines 47–51):

```ts
    toolsRead: groups0.read,
    toolsEdit: groups0.edit,
    toolsPlan: groups0.plan,
    toolsGit: groups0.git,
    enabled: initial?.enabled ?? true,
  })
```

  and replace with:

```ts
    toolsRead: groups0.read,
    toolsEdit: groups0.edit,
    toolsPlan: groups0.plan,
    toolsGit: groups0.git,
    toolsSkill: groups0.skill,
    toolsScript: groups0.script,
    mcpServerIds: grantedServers0,
    enabled: initial?.enabled ?? true,
  })
```

- [ ] **Step 6:** Add a small helper above the `return (` to toggle a server id in the form's `mcpServerIds` array. Find the `patch` definition (line 68):

```ts
  const patch = (p: Partial<AgentForm>) => setForm((f) => ({ ...f, ...p }))
```

  and add the toggle helper right after it:

```ts
  const patch = (p: Partial<AgentForm>) => setForm((f) => ({ ...f, ...p }))
  const toggleMcpServer = (id: string, on: boolean) =>
    setForm((f) => ({ ...f, mcpServerIds: on ? [...f.mcpServerIds, id] : f.mcpServerIds.filter((x) => x !== id) }))
```

- [ ] **Step 7:** Render the new toggles inside the internal-agent tools section. In the `<Section label={t('settings.agents.sectionTools')}>` block (lines 158–164), find the existing four `ToolToggle` rows and the closing `</Section>`:

```tsx
              <Section label={t('settings.agents.sectionTools')}>
                <div className="text-caption text-ink-tertiary">{t('settings.agents.toolsHint')}</div>
                <ToolToggle label={t('settings.agents.toolRead')} desc={t('settings.agents.toolReadDesc')} checked={form.toolsRead} onChange={(v) => patch({ toolsRead: v })} />
                <ToolToggle label={t('settings.agents.toolEdit')} desc={t('settings.agents.toolEditDesc')} checked={form.toolsEdit} onChange={(v) => patch({ toolsEdit: v })} />
                <ToolToggle label={t('settings.agents.toolPlan')} desc={t('settings.agents.toolPlanDesc')} checked={form.toolsPlan} onChange={(v) => patch({ toolsPlan: v })} />
                <ToolToggle label={t('settings.agents.toolGit')} desc={t('settings.agents.toolGitDesc')} checked={form.toolsGit} onChange={(v) => patch({ toolsGit: v })} />
              </Section>
```

  and replace it with (adds the skill/script rows after git, then the MCP-servers subsection):

```tsx
              <Section label={t('settings.agents.sectionTools')}>
                <div className="text-caption text-ink-tertiary">{t('settings.agents.toolsHint')}</div>
                <ToolToggle label={t('settings.agents.toolRead')} desc={t('settings.agents.toolReadDesc')} checked={form.toolsRead} onChange={(v) => patch({ toolsRead: v })} />
                <ToolToggle label={t('settings.agents.toolEdit')} desc={t('settings.agents.toolEditDesc')} checked={form.toolsEdit} onChange={(v) => patch({ toolsEdit: v })} />
                <ToolToggle label={t('settings.agents.toolPlan')} desc={t('settings.agents.toolPlanDesc')} checked={form.toolsPlan} onChange={(v) => patch({ toolsPlan: v })} />
                <ToolToggle label={t('settings.agents.toolGit')} desc={t('settings.agents.toolGitDesc')} checked={form.toolsGit} onChange={(v) => patch({ toolsGit: v })} />
                <ToolToggle label={t('settings.agents.toolSkill')} desc={t('settings.agents.toolSkillDesc')} checked={form.toolsSkill} onChange={(v) => patch({ toolsSkill: v })} />
                <ToolToggle label={t('settings.agents.toolScript')} desc={t('settings.agents.toolScriptDesc')} checked={form.toolsScript} onChange={(v) => patch({ toolsScript: v })} />
              </Section>

              <Section label={t('settings.agents.toolMcpServers')}>
                <div className="text-caption text-ink-tertiary">{t('settings.agents.toolMcpServersDesc')}</div>
                {mcpServers.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-2.5 text-caption text-ink-tertiary">
                    {t('settings.agents.toolMcpServersEmpty')}
                  </div>
                ) : (
                  mcpServers.map((s) => (
                    <ToolToggle
                      key={s.id}
                      label={s.name}
                      desc={s.id}
                      checked={form.mcpServerIds.includes(s.id)}
                      onChange={(v) => toggleMcpServer(s.id, v)}
                    />
                  ))
                )}
              </Section>
```

  > Note: this references `s.id` and `s.name` on each `McpServerConfig`; both fields exist on the protocol type added by the earlier MCP slice (`servers: McpServerConfig[]` in `useMcpServersStore`). If the configured shape uses a different name field, swap `s.name` accordingly when running tsc in Step 9.

- [ ] **Step 8:** Load the MCP servers when the editor (or its host settings page) mounts. The store exposes `load()`; ensure it is called so `mcpServers` is populated. If the host page (the 智能体管理 settings view that renders `AgentEditor`) already calls `useMcpServersStore.load()` alongside `useAgentsStore.load()`, no change is needed — verify by grepping. Otherwise, add a mount effect at the top of `AgentEditor`. After the `const [error, setError] = useState<string | null>(null)` line (line 54), add:

```tsx
  useEffect(() => { void useMcpServersStore.getState().load() }, [])
```

  and, only if you added that effect, extend the React import on line 1 from:

```ts
import { useState } from 'react'
```

  to:

```ts
import { useState, useEffect } from 'react'
```

  Run: `grep -rn "useMcpServersStore" src/views src/components/account` to confirm whether the host already loads it; prefer loading at the page level if it's there.

- [ ] **Step 9:** Type-check — this must now be fully GREEN (Task 52's three missing-property errors in `AgentEditor.tsx` are resolved by Step 5).

  Run: `yarn type-check`
  Expected: tsc completes with no errors.

- [ ] **Step 10:** Build the frontend to confirm the bundle compiles and i18n keys resolve.

  Run: `yarn build`
  Expected: `tsc && vite build` completes with no errors.

- [ ] **Step 11:** Run the full frontend test suite to confirm nothing regressed (paid-LLM-free; do NOT use a `src` filter that could pull in the sidecar). If you want a hard guarantee, move `~/.hip/config/auth.json` aside first, then restore.

  Run: `yarn test`
  Expected: all suites PASS (the new `agentTools` cases included); paid DeepSeek suites are skipped/absent.

- [ ] **Step 12:** Commit.

  Run: `git add src/components/account/AgentEditor.tsx src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts && git commit -m "feat(ui): grant internal agents use_skill/run_script + per-MCP-server tools in the agent editor"`
  Expected: one commit created.
