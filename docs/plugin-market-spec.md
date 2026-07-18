# Plugin Market — Spec & Implementation Plan

> Status: approved for implementation  
> Related: `docs/plugin-template.md` (package format)  
> Date: 2026-07-18

---

## 1. Problem

hip 已在磁盘与 sidecar 中支持插件包（`.plugin/plugin.json` + skills / MCP / agents / hooks），但设置页 **插件市场** 被收成「只读内置空目录」：

- 不扫描 `~/.hip/plugins/`
- 不展示已安装插件能力
- 不提供 Git URL 安装 / 卸载（后端与协议仍在）

目标：以 `docs/plugin-template.md` 约定的文档格式为能力源，打通 **扫描 → 展示 → 安装 → 卸载** 闭环。

---

## 2. Goals / Non-goals

### Goals

1. 从 `~/.hip/plugins/<id>/`（及 `hip-plugins.json` 注册路径）扫描已安装插件。
2. **能力真源** = `.plugin/plugin.json`；**展示增强** = 可选 `PLUGIN.md` frontmatter。
3. 市场卡片展示：名称、版本、描述、组件计数（skills / MCP / agents / hooks）、可选来源链接与关键词。
4. **不提供应用内「安装插件」入口**；安装仅通过数据/配置目录（`~/.hip/plugins/` 或 `hip-plugins.json` 注册路径）。
5. 可选卸载（`delete_plugin`）从磁盘移除已扫描到的插件并刷新列表。

### Non-goals（本阶段）

- 远程内置 catalog / 应用商店索引协议
- zip 安装 UI（IPC 已有 `install_plugin`，可不暴露按钮）
- 插件启用/禁用开关（会话层按清单全量合成）
- 在线更新 / 版本 diff
- 用散文 Markdown 章节替代 `plugin.json`

---

## 3. Package format (normative summary)

见 `docs/plugin-template.md`。市场扫描依赖：

```
~/.hip/plugins/<plugin-id>/
├── .plugin/plugin.json     # required for listing
├── PLUGIN.md               # optional marketplace card
├── skills/…
├── .mcp.json / agents.json / hooks/…
```

**Merge rules**

| Field | Source of truth |
|-------|-----------------|
| skills / mcp / agents / hooks paths | `plugin.json` only |
| name / version | `plugin.json`; empty name → skip plugin |
| description | `PLUGIN.md` frontmatter if non-empty, else `plugin.json` |
| author / license / keywords / sourceUrl | `PLUGIN.md` frontmatter, else `plugin.json` if present |
| id | directory basename under plugins root (stable for uninstall) |

---

## 4. Architecture

```
┌─────────────────┐   invoke list_plugins    ┌──────────────────┐
│ PluginConfig UI │ ───────────────────────► │ Tauri plugins.rs │
│ + pluginsStore  │ ◄── PluginMeta[] JSON ── │ scan + PLUGIN.md │
└────────┬────────┘                          └────────┬─────────┘
         │ delete_plugin (optional)                   │ reads
         ▼                                   ~/.hip/plugins/*
┌─────────────────┐                          ~/.hip/config/hip-plugins.json
│ Tauri uninstall │
└─────────────────┘
```

- **List path (renderer):** `listPlugins()` → Tauri `list_plugins` → disk scan (+ registered external paths).
- **Install path:** **directory only** — copy/link package under `~/.hip/plugins/<id>/` (or register path in `hip-plugins.json`). No market UI install.
- **Delete path:** `deletePlugin(id)` → Tauri remove dir + unregister → store update.

---

## 5. Data model

### 5.1 `PluginMeta` (protocol + wire)

Existing fields retained. Add optional marketplace fields:

```ts
interface PluginMeta {
  id: string
  name: string
  version: string
  description: string
  dir: string
  skills: string[]
  mcpServers: McpServerConfig[]
  agents: string[]
  hookCount: number
  hookEvents: string[]
  // new (optional)
  author?: string
  license?: string
  keywords?: string[]
  sourceUrl?: string
  sourceType?: string   // github | local | url | builtin
  hasPluginMd?: boolean
}
```

Rust `PluginMeta` mirrors camelCase JSON.

### 5.2 `PLUGIN.md` frontmatter (subset)

Parsed with same fence rules as `SKILL.md` (`---` … `---` + `serde_yaml`):

```yaml
id: my-plugin          # ignored for id (dir wins)
name: My Plugin        # display override only if plugin.json name empty? NO — name stays plugin.json
version: 1.0.0         # display ignore (plugin.json wins)
description: "…"
author:
  name: Alice
  url: https://…
# or author: Alice
license: MIT
keywords: [git, review]
source:
  type: github
  url: https://github.com/org/repo
```

Only keys used for market card are merged; body is not required for list view (detail view may come later).

---

## 6. Backend changes

### 6.1 `src-tauri/src/plugins.rs`

1. Extract `scan_one_plugin(dir) -> Option<PluginMeta>`.
2. After building meta from `plugin.json`, if `PLUGIN.md` exists, parse frontmatter and fill optional display fields.
3. `scan_plugins(root)`: skip `.staging-*` dirs; call `scan_one_plugin`.
4. `list_plugins` command: scan `plugins_dir`, then for each path in `hip-plugins.json` not already listed, `scan_one_plugin` (supports e2e absolute paths / external checkouts).
5. Unit tests: PLUGIN.md merge, staging skip, external registry path.

### 6.2 Protocol

- Extend `PluginMeta` in `packages/protocol/src/plugins.ts`.
- No new WS messages.

---

## 7. Frontend changes

### 7.1 `PluginConfig` / `PluginConfigView`

- Header: title + intro (**no Install button**)
- Grid of cards:
  - name, version, description
  - component counts
  - optional keywords / source link
  - Uninstall (optional cleanup)
- Confirm modal on uninstall
- `useEffect` load plugins on mount

### 7.2 Store

`usePluginsStore` `load` / `remove` — use as-is. In-app zip/Git install not exposed in market UI.

### 7.3 i18n (en / zh-CN / zh-TW)

Intro/empty copy: **directory-only install** under `~/.hip/plugins/`.

---

## 8. Security / trust

Unchanged:

- Path traversal rejected in manifest paths
- `delete_plugin` rejects `..` / path separators in id
- Install trust surface remains sidecar `deriveTrust` (not shown in UI this PR unless already present)
- No remote code execution beyond existing hook CJS load on session

---

## 9. Testing

| Layer | What |
|-------|------|
| Rust unit | PLUGIN.md merge; scan staging skipped; full component extract regression |
| Vitest | PluginConfigView cards / no install control; PluginConfig loads list |
| e2e | Market page has **no** install affordance; lists fixture plugins when seeded |

---

## 10. Key Decisions

1. **`plugin.json` remains capability truth** — marketplace never infers skills from free Markdown headings.
2. **`PLUGIN.md` is optional enrichment** — listing works with only `plugin.json` (sample-plugin / auto-gen).
3. **Directory basename is `PluginMeta.id`** — matches uninstall and registry.
4. **No in-app install in Plugin Market** — install is directory/config only; sidecar `plugin:install:url` may remain for CLI/tests but is not exposed in settings UI.
5. **List = disk scan ∪ registry paths** — e2e and manual external checkouts keep working.
6. **No zip / Git install button in UI** — keep IPC for programmatic use only.

---

## 11. PR Plan

### PR1 — Spec + format docs (this doc + template already in tree)

- `docs/plugin-market-spec.md`
- `docs/plugin-template.md` (already written)

### PR2 — Protocol + Tauri scan enrichment

- `packages/protocol/src/plugins.ts`
- `src-tauri/src/plugins.rs`, `list_plugins` union registry
- Rust tests

### PR3 — Plugin Market UI + i18n + unit tests

- `PluginConfig.tsx` / `PluginConfigView.tsx` / tests (list + uninstall; **no install UI**)
- i18n en/zh-CN/zh-TW
- e2e asserts no install control

**Implementation note:** ship PR2+PR3 together in one branch for speed; keep logical separation in commits if needed.

---

## 12. Success criteria

1. Place `e2e/fixtures/sample-plugin` under `~/.hip/plugins/sample-plugin` → market lists 2 skills.
2. Add `PLUGIN.md` with description/source → card shows enriched description and source link.
3. No Install button / form on the market page.
4. Uninstall → removed from disk, list, and `hip-plugins.json`.
5. `yarn test` unit tests for PluginConfig pass; Rust `plugins` tests pass.

---

## 13. Open Questions

None blocking. Deferred: remote catalog index, optional future install UX, per-plugin enable toggle.
