# 智能体管理 UI redesign — design

**Date:** 2026-06-15
**Status:** Approved (brainstorm), pending spec review
**Scope:** Visual + interaction polish of the *智能体管理* (agent management) page in Settings. **No backend / protocol / store-shape changes.**

---

## 1. Problem

The current `AgentManagement.tsx` works but reads as unpolished:

1. **Cramped, undifferentiated rows** — each agent's metadata (`command · args · transport · model`) is concatenated into one truncated gray line. Technical noise, no hierarchy, ellipsis clips the useful part.
2. **No identity or status** — no per-agent icon/avatar; built-in and external agents look nearly identical; rich vs thin and enabled vs disabled are not legible at a glance (disabled is a faint `(已停用)`).
3. **Inconsistent with its sibling** — `ModelConfig.tsx` uses a polished inline master–detail layout; this page pops a flat modal. (We are *not* unifying the two — see Non-goals — but we are raising this page's visual quality to match.)
4. **Raw form** — default browser checkboxes, flat stacked inputs, no grouping.
5. **Weak affordances** — delete fires instantly with no confirmation; enable/disable is buried inside the modal.

## 2. Goals

- Give each agent a clear visual identity, legible status, and an at-a-glance summary.
- Replace the instant-delete footgun with a confirmation dialog.
- Make enable/disable a one-click inline action (no modal round-trip).
- Rebuild the add/edit modal as a clean, sectioned form with proper controls.
- Stay entirely within the existing list + modal structure and the existing data layer.

## 3. Non-goals (YAGNI)

- **No** master–detail restructure (that was the larger option we declined).
- **No** "test connection" / live health check — the agent bridge is per-conversation and not reachable from Settings; a status indicator here would be misleading. Status = `enabled`/`disabled` only.
- **No** changes to `agentsStore`, the IPC layer, `AgentConfig` shape, or persistence.
- **No** new agent capabilities, no card-grid gallery, no drag-reorder.

## 4. Locked decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Ambition | Polish cards + modal in place (keep list + modal) |
| Card style | 方案 A "as shown" — card with avatar, badges, **quiet monospace command subline visible**, inline toggle, kebab (⋯) menu |
| Editor | Sectioned modal; transport as **radio cards**; checkboxes → **toggles**; 启用 toggle in footer |
| Delete | **Confirmation dialog** (`删除智能体"X"？此操作无法撤销。` → 取消 / 删除) |

## 5. Files

**Modify**
- `src/components/account/AgentManagement.tsx` — the whole list + card + editor + new delete dialog. (Editor stays an inner component; consider splitting `AgentEditor` into its own file if the file grows past ~300 lines.)

**Add**
- `src/components/ui/Switch.tsx` — new reusable toggle primitive (none exists today).

**Touch**
- `src/components/ui/Avatar.tsx` — add an optional `shape?: 'circle' | 'square'` prop (default `circle`) so the square agent tile reuses it. Circle remains the default everywhere else.
- `src/components/ui/Button.tsx` — add a `danger` variant for the delete dialog's confirm button.
- `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`, `src/i18n/en.ts` — new keys (Section 11). All three locales must stay in sync (`i18next.d.ts` is type-checked against the resource shape).

**Reuse as-is**
- `DropdownMenu*` (kebab menu), `Modal` (editor + delete dialog), `Badge` (transport + model pills).

## 6. Agent list & cards

Container keeps `<div className="p-6">` with the existing title (`settings.agents.title`) + intro (`settings.agents.intro`). Below it, a `space-y-2` column of cards.

### 6.1 Built-in `hip` card (pinned, first)
- Tinted background (`bg-accent-subtle` / `bg-surface-subtle`), `rounded-lg`, border.
- Left: 38px **square** avatar tile, `bg-accent` with a white `Bot` icon (lucide).
- Name `hip` + a `内置` Badge (`bg-accent-subtle text-accent-strong`).
- Subline: `settings.agents.builtinDesc` (no command line for the built-in).
- Right: a muted `Lock` icon. **No toggle, no kebab** — always enabled, not editable.

### 6.2 External agent card
Layout: `flex items-center gap-3.5`, white `bg-surface`, `rounded-lg`, `border-border`, `px-4 py-3.5`.

- **Avatar** (left, shrink-0): 38px square tile via `Avatar` (`shape="square"`), initials from `name`, `bg-accent-subtle text-accent-strong`. (A deterministic per-name tint is a possible future nicety; default is the single accent tint for app-wide consistency.)
- **Body** (`min-w-0 flex-1`):
  - Line 1 (`flex items-center gap-2 flex-wrap`): name (`text-body font-medium text-ink`) + **transport Badge** + **model Badge** (only when `boundModel` is set).
    - Transport: `丰富` → `bg-accent-subtle text-accent-strong`; `精简` → default neutral Badge.
    - Model: `Badge` with a `Cpu` icon + the short `modelID` (the `providerID` is omitted to keep it short; full value is in the editor).
  - Line 2: command subline — `text-caption font-mono text-ink-tertiary`, a leading `Terminal` icon, `truncate`. Content: `command` + space-joined `args`. This is intentionally quiet but present (the chosen 方案 A).
- **Actions** (right, shrink-0, `flex items-center gap-2.5`):
  - **Switch** bound to `enabled`. Toggling calls `updateAgent(a.id, { enabled: next })`.
  - **Kebab** (`DropdownMenu` triggered by a `MoreVertical` ghost icon button) →
    - `编辑` (Pencil) → opens the editor in edit mode.
    - `删除` (Trash, `text-danger` item) → opens the **delete confirmation dialog**.
- **Disabled state** (`!enabled`): the avatar + body dim to `opacity-60` (the Switch and kebab stay full opacity so they remain usable).

### 6.3 Empty state
When there are no external agents, replace today's one-line dashed box with a centered empty card (`rounded-lg border border-dashed`, `py-8`): a muted `Bot`/`Plus` icon, `settings.agents.empty` as the heading, a one-line hint (`settings.agents.emptyHint`, e.g. "接入 Claude Code、Codex 等命令行智能体"), and the add tile/button below.

### 6.4 Add affordance
A full-width **dashed "添加智能体" tile** (`border-dashed`, `rounded-lg`, `py-3`, centered, `Plus` icon, `text-accent-strong`) at the end of the list — a stronger, more consistent affordance than today's text link. Opens the editor in add mode.

## 7. Editor modal (add / edit)

Keep the `Modal`, but make it a **fixed-width (~480px), non-resizable** sectioned form (drop the current `resizable` + 560×560). Body scrolls if needed (`max-h`, `overflow-y-auto`).

**Header:** the agent's square avatar tile (initials, or `Plus` tile in add mode) + title (`编辑智能体` / `添加智能体`) + close `X`.

**Sections** (quiet uppercase group labels, `text-caption text-ink-tertiary`):

1. **名称** — single text `Input`.
2. **启动命令** — `命令` (`Input`, mono) and `参数（空格分隔）` (`Input`, mono) stacked.
3. **协议** — two **radio cards** side by side (replaces the `<select>`):
   - `精简` — "纯文本流，兼容任何 CLI" (`transport: 'thin'`)
   - `丰富` — "JSON 事件流，显示思考过程" (`transport: 'rich'`)
   - Selected card: `border-accent bg-accent-subtle` + a filled check; unselected: `border-border` + hollow ring. Implemented as buttons with `role="radio"` in a `role="radiogroup"`.
4. **模型** — a **Switch row** for `acceptsModelConfig`: label `推送我配置的模型与密钥` + helper subline `把所选模型与 API 密钥传给该智能体`. When **on**, reveal the bound-model picker beneath it: a styled `<select>` grouped by provider via `<optgroup label={provider.name}>` (today it is a flat list — group it; options stay `providerID/modelID` keyed). When off, the picker is hidden and `boundModel` is cleared on save.

**Footer** (`border-t`, `bg-surface-subtle`): left = a **Switch** for `enabled` + label `启用此智能体`; right = `取消` (`Button` outline/secondary) + `保存` (`Button` primary). Save stays disabled while `busy` or invalid. Validation is unchanged: `name` and `command` non-empty, and if `acceptsModelConfig` then a model must be chosen. Error text (`settings.agents.error`) renders above the footer as today.

Submit payload is unchanged from the current `submit()` (name/kind/command/args/transport/acceptsModelConfig/boundModel/enabled).

## 8. Delete confirmation dialog

A small `Modal` (or a second dialog component): title `删除智能体"{name}"？`, body `此操作无法撤销。`, footer `取消` (secondary) + `删除` (`Button variant="danger"`). Confirm calls `removeAgent(a.id)` then closes. Triggered from the card's kebab `删除` item; the agent name is interpolated.

## 9. New primitive — `Switch`

`src/components/ui/Switch.tsx`: a controlled toggle.
- API: `{ checked: boolean; onCheckedChange: (next: boolean) => void; disabled?: boolean; 'aria-label'?: string; id?: string }`.
- Markup: a `<button role="switch" aria-checked={checked}>` track (`h-5 w-9 rounded-full`, `bg-accent` on / `bg-border` off, `disabled:opacity-50`) with an absolutely-positioned `h-4 w-4 rounded-full bg-white` knob that translates left/right via a `transition`. Focus ring `focus-visible:ring-2 ring-accent/60`.
- Keyboard: native button → Space/Enter toggle for free; toggles via `onClick`.
- Used by: card inline enable, editor `acceptsModelConfig`, editor `enabled`.

## 10. State & data flow

No store or protocol changes. The component continues to use `useAgentsStore` (`agents`, `loaded`, `load`, `addAgent`, `updateAgent`, `removeAgent`) and `useProvidersStore` (`config`, `catalog`) exactly as today.

- Inline enable toggle → `updateAgent(id, { enabled })`.
- Editor save → `addAgent(draft)` or `updateAgent(id, draft)` (existing `onSave`).
- Delete confirm → `removeAgent(id)`.
- New local UI state: `editing` (unchanged) + `deleting: AgentConfig | null` for the confirm dialog + the kebab `DropdownMenu`'s own open state.

## 11. i18n keys (add to all three locales)

Existing keys stay. Add under `settings.agents`:

| Key | zh-CN |
|---|---|
| `emptyHint` | 接入 Claude Code、Codex 等命令行智能体 |
| `transportThinDesc` | 纯文本流，兼容任何 CLI |
| `transportRichDesc` | JSON 事件流，显示思考过程 |
| `acceptsModelDesc` | 把所选模型与 API 密钥传给该智能体 |
| `enableThis` | 启用此智能体 |
| `sectionCommand` | 启动命令 |
| `sectionTransport` | 协议 |
| `sectionModel` | 模型 |
| `deleteConfirmTitle` | 删除智能体"{{name}}"？ |
| `deleteConfirmBody` | 此操作无法撤销。 |
| `builtin` | 内置 |
| `menuEdit` / `menuDelete` | 编辑 / 删除 (may reuse existing `edit`/`delete`) |

Provide `en` + `zh-TW` equivalents. Keep `i18next.d.ts` happy (same shape across locales).

## 12. Accessibility

- Switch: `role="switch"`, `aria-checked`, `aria-label` (e.g. `启用 {name}`), keyboard-toggleable, visible focus ring.
- Kebab: `DropdownMenu` (Radix) is keyboard + screen-reader ready; trigger button gets `aria-label` (`更多操作`).
- Radio cards: `role="radiogroup"` / `role="radio"` with `aria-checked`, arrow-key navigation.
- Delete dialog: focus moves to the dialog; `删除` is not the default focus (focus 取消) to avoid accidental Enter-to-delete.
- Maintain text contrast (avoid the `#999`-on-white tertiary issue flagged elsewhere) — command subline uses `text-ink-tertiary` on white, which already meets the token's contrast; keep ≥ the existing meta usage.

## 13. Testing

This repo has **no component-test harness** (`vitest` runs in `environment: 'node'`, include is `src/**/*.test.ts`; no jsdom/Testing-Library). It deliberately unit-tests **pure logic** and verifies UI by **manual GUI / browser preview**. We follow that convention — do **not** add an RTL/jsdom stack for this redesign (out of scope).

- **Extract + TDD pure logic** (`src/**/*.test.ts`, `yarn test`, paid-free):
  - `groupModelOptions(catalog, config)` — groups enabled providers' models for the picker.
  - `buildAgentDraft(form)` + `isAgentDraftValid(form)` — builds the `Omit<AgentConfig,'id'>` save payload and validity; covers args whitespace-splitting and **clearing `boundModel` when `acceptsModelConfig` is off / no model chosen**.
- **Type-check + lint** green (`yarn tsc --noEmit`, `yarn lint`).
- **Manual GUI acceptance** (`yarn tauri dev`) per project norm — verify look, inline toggle, kebab edit/delete, radio cards, model-toggle reveal, delete dialog, empty state, disabled dim. Browser-preview of the React tree is acceptable for the visual pass.

## 14. Out of scope / future

- Master–detail unification with `ModelConfig`.
- Live connection/health status.
- Per-agent avatar color-by-hash, drag-reorder, import/export.
