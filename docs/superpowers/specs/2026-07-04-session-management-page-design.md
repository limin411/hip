# Session Management Page Design

## 1. Goal

Add a dedicated page to manage all conversations, while the sidebar only shows the 5 most recent sessions for the current surface (chat / code).

## 2. Decisions from Brainstorming

| Topic | Decision |
|-------|----------|
| Entry point | A "查看全部会话" link at the bottom of the sidebar. |
| Page form | A centered modal dialog (`SessionsDialog`). |
| Phase 1 features | List all sessions, filter by chat/code/all, search, rename, delete, show total count. |
| Sidebar limit | Per-surface: show up to 5 most-recent sessions of the current surface. |
| Sidebar search | The sidebar search only filters those 5 sessions. For full search, open the dialog. |
| Pagination | 10 sessions per page, simple numbered pagination. |

## 3. Architecture

```
src/
  components/sessions/
    SessionsDialog.tsx      # modal shell + filter/search/pagination state
    SessionsDialog.test.tsx
    SessionFilters.tsx      # surface filter tabs (all / chat / code)
    SessionPagination.tsx   # page size / prev / next / page numbers
  components/sidebar/
    Sidebar.tsx             # add "查看全部会话" entry + SessionsDialog
    SessionList.tsx         # slice to 5 sessions for the current surface
```

The modal reuses the existing `SessionItem` component for each row so that rename, delete, and select behaviors stay consistent.

## 4. Data Flow

1. `SessionsDialog` reads `useSessions()` from `@/domain`.
2. It filters locally by:
   - `surface` (all / chat / code)
   - `query` (title / preview substring)
3. Sorted by `updatedAtMs` descending (the store already keeps this order).
4. Pagination is computed on the filtered list.
5. Selecting a session calls `sessionService.selectSession(id)` and closes the dialog.
6. Rename / delete delegate to `sessionService.renameSession` / `sessionService.deleteSession`, which already update the store and notify the sidecar.

## 5. Sidebar 5-Session Limit

In `SessionList`:

- Filter sessions by current surface.
- If no search query: take the first 5 sessions of that filtered list.
- If a search query exists: still filter from those 5 sessions only.
- Existing grouping by relative date is preserved for the displayed subset.

This keeps the sidebar lightweight and pushes full history management to the dialog.

## 6. Component Details

### SessionsDialog

- Header: title "全部会话", close button.
- Toolbar: `SessionFilters`, search input, total count label.
- Body: scrollable list of `SessionItem` rows.
- Footer: `SessionPagination`.

### SessionFilters

Three tabs: 全部 / 办公 / 编码 (all / chat / code). Defaults to "全部". Changing the filter resets pagination to page 1.

### SessionPagination

- Page size: 10 (constant).
- Controls: previous, next, and a small set of page numbers.
- Changing page scrolls the list body to top.

## 7. Error Handling

- Rename/delete errors are surfaced by the existing `SessionItem` / sidecar flow.
- Empty states reuse existing "没有匹配的会话" copy.
- If the filtered list is empty, show an empty state in the dialog body.

## 8. i18n

Add new keys under `sidebar`:

- `viewAllSessions`: "查看全部会话"
- `allSessions`: "全部会话"
- `sessionCount`: "共 {{count}} 个会话"
- `filterAll`, `filterChat`, `filterCode`: "全部 / 办公 / 编码"

Synchronize across `zh-CN.ts`, `zh-TW.ts`, and `en.ts`.

## 9. Testing Plan

| Test | What it verifies |
|------|------------------|
| `SessionList.test.tsx` | Only 5 sessions render; order is `updatedAtMs` descending; search still works within those 5. |
| `SessionsDialog.test.tsx` | Pagination advances; surface filter works; search filters; selecting calls `selectSession` and closes dialog; rename/delete actions work. |
| `Sidebar.test.tsx` | "查看全部会话" button opens `SessionsDialog`. |
| i18n sanity | All three locale files contain the new keys. |

## 10. Out of Scope

- Pinning / starring sessions.
- Batch delete or archive.
- Infinite scroll or virtualized list.
- Changing the existing sidecar FTS search behavior.
