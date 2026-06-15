# 模型配置 UI 重设计 — Design Spec

**Date:** 2026-06-15
**Status:** Design approved (pending written-spec review)
**Sibling precedent:** `2026-06-15-agent-config-ui-redesign-design.md` (智能体管理 redesign). This spec mirrors that effort for the **模型配置 (model configuration)** settings page and deliberately reuses its design language and decisions.

---

## 1. Problem

`src/components/account/ModelConfig.tsx` (327 lines, one file holding `ModelConfig` + `ProviderDetail` + `AddCustomProvider`) looks a generation behind the freshly-redesigned 智能体管理 sibling:

- **No page header.** Uses `px-5 py-4` with no title/intro, unlike `AgentManagement` (`p-6` + `text-title` heading + intro line) and `GeneralSettings`.
- **Current-model banner is weak.** A flat `bg-surface-subtle` strip showing `provider · modelID` as a plain string, falling back to a bare `—` placeholder (the same kind of stray-dash the user flagged on the agent page).
- **Provider list is cramped.** 18px letter avatars, `py-1.5` rows, plain-text group headers ("已配置 · N").
- **Detail pane has no section boundaries.** API-key field, Base-URL field, and the model list are stacked with tight `mt-4 mb-1` micro-labels — no visual grouping.
- **Model cards lack hierarchy.** Context window + reasoning/tools/vision all render as identical gray pills.
- **Add-custom hijacks the detail pane.** Clicking "+ 自定义提供商" swaps the right pane into an inline form, displacing whatever provider was being viewed.

## 2. Goal

Restyle the page into the new design language **without changing data flow, the store, the IPC layer, or the provider/model model**. This is a visual + interaction polish, scoped exactly like the agent-page redesign.

## 3. Chosen direction (user-approved)

**Direction A — refined two-pane (master-detail kept).** The "browse many providers on the left, configure one on the right" structure is the right fit for a catalog of dozens of providers; alternatives (card-list+modal, single-column accordion) only relocate the browse problem. We keep the structure and spend the effort on look-and-feel + the specific rough spots.

**Approved sub-decisions:**
- **Current-model hero = rich card** (avatar + model name headline + provider + capability badges + honest status). Not a compact strip.
- **Add custom provider = modal** (sectioned `Modal`, same shape as `AgentEditor`), not an inline pane swap.

## 4. Out of scope (YAGNI)

- No backend / store / protocol / IPC changes. `providersStore`, `catalog.ts`, `providersConfig`, `secrets` are untouched.
- No "test connection" / live health check. The hero status is derived **only** from whether the provider's API key is configured — we do **not** claim liveness we can't verify (same honesty rule as the agent page).
- No model favoriting, no per-provider enable/disable toggle beyond today's implicit "has a key" state.
- No new capability filters beyond the existing 推理/工具/视觉.

## 5. Architecture & file structure

Decompose the single 327-line file into focused units (mirrors how `AgentManagement` was split). All live under `src/components/account/`.

| File | Responsibility |
|------|----------------|
| `ModelConfig.tsx` (rewrite) | Slim orchestrator: page header, renders `CurrentModelHero`, the two-pane (`ProviderList` + `ProviderDetail`), and conditionally the `AddProviderDialog` modal. Owns state: `selected`, `filter`, `showIncompatible`, `addOpen`. Wires store actions. |
| `CurrentModelHero.tsx` (new) | The rich hero card for the active model + the "未选择模型" empty state. Pure presentational; takes the active model meta + provider + key-configured flag. |
| `ProviderList.tsx` (new) | Left pane: search box, the three groups (configured/available/incompatible) with counts, provider rows, collapsible 不兼容, and the "+ 自定义提供商" footer button. Takes `groups`, `activeId`, `keyConfigured`, and callbacks. |
| `ProviderDetail.tsx` (rewrite, extracted) | Right pane organized into three bordered **section cards**: `API 密钥`, `Base URL`, `模型`. Keeps the existing key/baseURL/model-select logic and the `run()`/`saveBaseURL()` busy/error handling verbatim — only the markup is reorganized. |
| `ModelList.tsx` (new, optional split) | The 模型 section's body: model search + capability chips + pinned-current card + filtered model cards. Extracted from `ProviderDetail` if that file would otherwise exceed ~150 lines; otherwise inline. |
| `AddProviderDialog.tsx` (new) | Replaces the inline `AddCustomProvider`. A sectioned `Modal` (名称 / Base URL / API 密钥 / 模型 id) with the same submit logic (`addCustom` then optional `saveKey`). |

**Reused primitives:** `Avatar` (square shape, added in the agent redesign), `Badge`, `Button`, `Modal`. No new UI primitive is required (unlike the agent redesign, which needed `Switch`).

**Pointer-events note:** `ModelConfig` has **no** `DropdownMenu`/`ContextMenu`, so the menu→Modal `body{pointer-events:none}` freeze does not apply here. `AddProviderDialog` is a `Modal` opened from a plain button (like `AgentEditor`), which is safe.

## 6. Pure helper (TDD)

The hero and the model cards both render "context window + capability flags". Extract that to a pure, tested helper to keep them DRY:

`src/lib/modelBadges.ts`
```ts
import type { CatalogModel } from '@/ipc/catalog'

export type ModelCapKey = 'reasoning' | 'tool_call' | 'attachment'

export interface ModelBadges {
  /** Context window in thousands (rounded), or null when the model omits a limit. */
  contextK: number | null
  /** Capability flags present on the model, in display order. */
  caps: ModelCapKey[]
}

export function modelBadges(m: CatalogModel): ModelBadges { /* ... */ }
```
- `contextK` = `m.limit?.context ? Math.round(m.limit.context / 1000) : null`.
- `caps` = `['reasoning','tool_call','attachment']` filtered to those truthy on `m`, preserving that order.
- Components map `caps` keys to i18n labels (`settings.modelConfig.{reasoning|tools|vision}`) — the helper stays i18n-free.

**Existing helpers reused unchanged:** `groupProviders` (`src/lib/providerGroups.ts`) and `filterModels` (`src/lib/modelFilter.ts`) and their tests still apply.

## 7. Component specs

### 7.1 Page header
`ModelConfig` root becomes `<div className="p-6">` with:
- `<h2 className="text-title font-semibold text-ink">{t('settings.model')}</h2>` (reuses the existing "模型配置" string).
- `<p className="mt-1 text-body text-ink-secondary">{t('settings.modelConfig.intro')}</p>` (new key).

### 7.2 CurrentModelHero
- **Has active model:** a `bg-surface`/border-`rounded-lg` card, `px-4 py-3`:
  - Square `Avatar` (provider name initial), 40px.
  - Headline: `modelID` (`text-body font-medium text-ink`).
  - Subline: `{providerName} · {t('settings.modelConfig.currentModel')}` (`text-meta text-ink-tertiary`).
  - Badge row from `modelBadges(activeModelMeta)`: a reasoning badge uses the accent style (`bg-accent-subtle text-accent-strong`), tool/vision use the neutral `Badge`, and `{contextK}K` context renders as a neutral badge.
  - **Status (honest):** right-aligned pill. If `keyConfigured[providerID]` → subtle "已就绪" (`text-success`/`bg-success-subtle`); if the active provider's key is missing → a warning "密钥缺失" (`text-warning`) hint. No "live/活跃" claim.
- **No active model (empty state):** muted card: `t('settings.modelConfig.noModel')` ("未选择模型") + hint `t('settings.modelConfig.noModelHint')` ("在下方选择一个提供商并设为当前模型"). Replaces today's `—`.

### 7.3 ProviderList (left pane, ~212px)
- Bordered `rounded-lg` container.
- Search row (top, border-b): `Search` icon + filter input (existing behavior).
- Groups with counts, each header `text-caption text-ink-tertiary`:
  - `已配置 · {n}`, `可用 · {n}` always expanded.
  - `不兼容 · {n}` collapsible (chevron), auto-expanded while a filter query is active (existing `incompatibleOpen` logic preserved).
- **Provider row** (restyled): square 20px mini-avatar (initial), name (truncate), and a trailing status — green dot (`bg-success`) when configured, `未配置` (`text-caption text-ink-tertiary`) when not, `Ban` icon when incompatible (disabled, `opacity-55`, `cursor-not-allowed`). Active row: `bg-accent-active` + `text-accent-strong font-medium`.
- Footer (border-t): "+ 自定义提供商" button → opens `AddProviderDialog` (sets `addOpen`).

### 7.4 ProviderDetail (right pane) — three section cards
Each section is a `bg-surface` border `rounded-lg` card with a `text-body font-medium` label row (icon + title).

1. **API 密钥** — label row may carry a right-aligned `已配置 · 存于本地` success state (`Check` icon). Body: password input + primary `保存`/`更换` button + ghost `清除` button. Error line (`text-danger`) under the field. Logic unchanged (`run(onSaveKey)`, `run(onClearKey)`, busy/disabled rules).
2. **Base URL** — body: mono input (placeholder = provider `api`) + primary `保存` button (disabled when empty/unchanged). Logic unchanged (`saveBaseURL`, which must NOT clear the key draft).
3. **模型** — label row with model count on the right. Body: model search input + three capability chips (推理/工具/视觉; active = `bg-accent text-white`). Pinned current model card (outlined `border-accent bg-accent-active`, "当前" marker). Below: scrollable list (`max-h-[300px]`) of filtered model cards; each shows `m.name`, a meta row from `modelBadges` (`{contextK}K` + cap labels as quiet `text-caption text-ink-tertiary`), and a trailing `设为当前`/`当前` affordance. Click → `run(onSetCurrent)`. Empty → `noMatches`.

### 7.5 AddProviderDialog (modal)
- `Modal` (title `t('settings.modelConfig.addCustom')`), `max-w-md`, sectioned like `AgentEditor`:
  - 名称 (`customName`), Base URL (`baseUrl`), API 密钥 (password, `sk-...`), 模型 id（逗号分隔）(`customModels`).
  - Footer: `取消` (ghost) + `添加` (primary, disabled until name + baseURL present).
- Submit logic identical to today's `AddCustomProvider.submit()`: derive id from name slug, `addCustom(id, name, baseURL, ids)`, then optional `saveKey(id, key)`, then `onDone(id)` (selects the new provider, closes modal). Error → `settings.modelConfig.error`.

## 8. Data flow

Unchanged. `ModelConfig` reads from `useProvidersStore` (`catalog`, `config`, `keyConfigured`, `loaded`) and calls `load`, `saveKey`, `clearKey`, `setBaseURL`, `setActiveModel`, `addCustom` exactly as today. The redesign only re-arranges which component renders which slice and replaces the inline add-form with a modal.

`activeId` resolution stays: `selected ?? config.activeModel?.providerID ?? groups.configured[0]?.id ?? groups.available[0]?.id ?? null`.

## 9. Error handling

Unchanged. Every async store action can reject; `ProviderDetail` and `AddProviderDialog` keep their local `busy`/`error` state and surface `t('settings.modelConfig.error')`. No store-level error field is introduced.

## 10. i18n

Add to `settings.modelConfig` in all three locales (`zh-CN`, `zh-TW`, `en`):
- `intro` — page subtitle ("配置提供商的 API 密钥与可用模型，并选择对话使用的当前模型。" / TW / EN).
- `noModel` — "未选择模型".
- `noModelHint` — "在下方选择一个提供商并设为当前模型".
- `ready` — "已就绪" (hero status when key configured).
- `keyMissing` — "密钥缺失" (hero warning).
- `contextWindow` — optional unit label; if used, "上下文" / context. (Context value itself renders as `{n}K`, no translation.)

Reuse existing keys: `currentModel`, `apiKey`, `baseUrl`, `models`, `reasoning`, `tools`, `vision`, `current`, `setCurrent`, `save`, `change`, `clear`, `addCustom`, `customName`, `customModels`, `addProvider`, `configured`, `available`, `incompatibleGroup`, `notConfigured`, `noMatches`, `searchProviders`, `searchModels`, `modelsUnit`, `keyStored`, `error`.

Prune any key that becomes dead after the rewrite (audit at the end, like the agent redesign pruned 4). Note: `models` currently is "模型 · 来自 models.dev"; the new 模型 section header uses a plain "模型" + count, so either repurpose `models` to "模型" or add `modelsSection` — decide during implementation and keep all three locales in sync.

## 11. Styling tokens

Use the app's real accent tokens (brand blue #0062AD): `bg-accent`, `accent-hover`, `accent-active`, `accent-strong`, `accent-subtle`, plus `surface`/`surface-subtle`/`surface-muted`, `border`, `ink`/`ink-secondary`/`ink-tertiary`, `success`/`danger`/`warning`. (The brainstorm mockup used the visualizer's info-blue as a proxy.)

## 12. Testing

Repo has **no component-test harness** (vitest `environment: 'node'`, include `*.test.ts`, no jsdom/RTL). Therefore:
- **TDD** the one new pure helper: `src/lib/modelBadges.test.ts` (context rounding incl. null, cap ordering, empty caps).
- Existing `providerGroups.test.ts` and `modelFilter.test.ts` continue to cover the list/model filtering logic.
- **Visual/interaction verification** via browser preview (hip-web → skip-login → 设置 → 模型配置) for: hero (active + empty), provider list groups/rows/active state, section cards, model search + cap chips + set-current, and the AddProviderDialog open/submit/cancel. Populated provider detail with a real key and live set-current that restarts the sidecar → **manual `yarn tauri dev` acceptance** (browser preview lacks Tauri IPC, so the real catalog/keys aren't present).

**Gates:** `yarn type-check` + `yarn test` (paid-free — node env, touches no sidecar; keep auth.json aside per the standing trap when running broad vitest) + `yarn build`.

## 13. Risks

- **Catalog absent in browser preview** — same limitation as the agent page; real providers/models only appear under `yarn tauri dev`. Mitigation: verify structure/empty-states in preview, defer populated-state acceptance to the user.
- **Dead i18n keys / out-of-sync locales** — mitigated by a final audit across all three files.
- **ProviderDetail logic regressions** — the key/baseURL/model logic is subtle (e.g. `saveBaseURL` must not clear the key draft; `setActiveModel` refuses empty baseURL). Mitigation: move the logic verbatim, change only markup; reuse existing store tests.

## 14. Implementation order (for the plan)

1. `lib/modelBadges.ts` (+ test, TDD).
2. i18n keys (all three locales).
3. `CurrentModelHero.tsx`.
4. `ProviderList.tsx`.
5. `ProviderDetail.tsx` (+ optional `ModelList.tsx`).
6. `AddProviderDialog.tsx`.
7. Rewrite `ModelConfig.tsx` orchestrator wiring it all together.
8. Prune dead i18n keys; `yarn type-check` + `yarn test` + `yarn build`; browser-preview verification.
