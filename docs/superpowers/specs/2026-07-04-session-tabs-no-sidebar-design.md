# Session Tabs + No Sidebar Layout Redesign

## 1. Goal

Replace the current collapsible session-list sidebar with a browser-style tab bar embedded in the title bar. Remove the left sidebar entirely. Move the settings entry point to a floating avatar button in the bottom-left corner. The "scheduled tasks" placeholder page is not implemented in this phase.

This design supersedes the previous sidebar-centric navigation model (including the "查看全部会话" session-management dialog entry point in the sidebar). Open sessions are represented directly as tabs; closed sessions are not reachable from the main chrome until a future history/recents feature is added.

## 2. Decisions from Brainstorming

| Topic | Decision |
|-------|----------|
| Tab location | Inside the title bar (VS Code / browser style). |
| Tab content | One tab per open session. Each tab shows surface icon, session title, and close button. |
| New session | "+" button in the tab bar opens the New Conversation page. |
| New Conversation page | Segmented toggle (Chat / Code) + adaptive composer. Composer tools change based on selected surface; Code mode shows folder picker and permission mode. Sending creates a session of the selected surface. |
| Left sidebar | Removed entirely. |
| Scheduled tasks | Not implemented. |
| Settings entry | Floating circular avatar button at bottom-left; click opens a small menu with Settings and Logout. |
| Settings display | Keep the existing full-screen overlay (`SettingsPage`). |
| Avatar menu trigger | Click (not hover). |
| Existing MenuRail (`src/components/rail/MenuRail.tsx`) | Removed. |
| Existing `Sidebar`, `SidebarPeek`, `SessionList`, etc. | Removed from main chrome; components may be deleted or archived. |

## 3. Prototype

HTML prototypes were produced during brainstorming and are preserved in the repo:

- `.superpowers/brainstorm/approach-b-v2.html` — main layout with tabs in title bar and floating avatar menu.
- `.superpowers/brainstorm/new-conversation.html` — New Conversation page with Chat / Code cards.
- `.superpowers/brainstorm/index.html` — summary page linking to the above.

Serve them with any static server from the project root, e.g.:

```bash
python3 -m http.server 8765 --directory .superpowers/brainstorm
```

Then open `http://localhost:8765/index.html`.

## 4. Architecture

### 4.1 Layout tree (after change)

```
AppLayout
├── TitleBar
│   ├── TrafficLights (macOS)
│   ├── SessionTabBar
│   │   ├── SessionTab[]
│   │   └── NewTabButton (+)
│   └── TitleBarActions (connection status, etc.)
├── MainContent
│   ├── NewConversationPage  (when no active session)
│   └── ChatPane + InputBar  (when active session exists)
└── FloatingAvatarButton
    └── AvatarDropdownMenu (Settings, Logout)
```

### 4.2 New / changed components

| Component | Purpose |
|-----------|---------|
| `src/components/tabs/SessionTabBar.tsx` | Title-bar tab bar: renders open session tabs and the "+" new-tab button. |
| `src/components/tabs/SessionTab.tsx` | Individual tab with icon, title, close button, and active state. |
| `src/components/chat/NewConversation.tsx` | Reworked New Conversation page with a Chat/Code surface toggle and an adaptive composer. Keeps the first-message flow; surface selection is now explicit in the page instead of the rail. |
| `src/components/account/FloatingAvatarButton.tsx` | Circular avatar button fixed to bottom-left; opens account/settings menu on click. |
| `src/components/layout/TitleBar.tsx` | Updated to host the tab bar and actions; no longer needs to render `ChatTitleBar` content in the same way. |
| `src/routes/AppLayout.tsx` | Simplified: removes sidebar panels, `MenuRail`, and `SidebarPeek`; keeps main content and settings overlay. |

### 4.3 Components to remove / deprecate

- `src/components/rail/MenuRail.tsx`
- `src/components/rail/RailButton.tsx`
- `src/components/sidebar/Sidebar.tsx`
- `src/components/sidebar/SidebarPeek.tsx`
- `src/components/sidebar/SessionList.tsx`
- `src/components/sidebar/SessionSearch.tsx`
- `src/components/sidebar/SurfaceTabs.tsx`
- `src/components/sidebar/NewSessionButton.tsx`
- `src/components/sidebar/AccountFooter.tsx`
- `src/components/sessions/SessionsDialog.tsx` (entry point removed with sidebar; dialog itself may be deleted or repurposed later)

> **Note:** Deletion should be performed only after the new layout is verified. Tests referencing these components must be updated or removed in the same change.

## 5. Data Flow

### 5.1 Opening a session

1. User clicks "+" in `SessionTabBar` or closes the last tab.
2. `AppLayout` renders `NewConversation` because `activeSessionId == null`.
3. User switches the surface toggle to Chat or Code (default: Chat).
4. User composes the first message. In Code mode, a project folder and permission mode may be selected.
5. On send, `NewConversation` sets `useUiStore.activeView` to the selected surface and calls the existing session creation flow (e.g. `sessionService.sendMessage`), which creates the session surface-aware and activates it.
6. `AppLayout` renders the chat/code pane for the new session.
7. `SessionTabBar` sees the new active session and renders a tab for it.

### 5.2 Switching sessions

1. User clicks a tab.
2. `SessionTabBar` calls `sessionService.selectSession(id)`.
3. Domain layer updates the active session id in the store.
4. `AppLayout` and `SessionTabBar` re-render with the new active session.

### 5.3 Closing a session

1. User clicks the tab's close button.
2. `SessionTabBar` calls `sessionService.deleteSession(id)` or a new `sessionService.closeSession(id)` if we want to keep the session in history.
3. For this phase, closing a tab deletes the session (matching the current "×" behavior in `SessionItem`).
4. After close, if no sessions remain, `AppLayout` shows `NewConversation`. If other sessions remain, activate the most recently updated remaining session.

### 5.4 Surface switching

Previously the surface (`chat`/`code`) was switched via the left rail. After this redesign:

- Each session has a fixed surface (`chat` or `code`) determined at creation on the New Conversation page.
- Switching between chat and code sessions is done by switching tabs.
- The global `activeView` store value (`'chat' | 'code' | 'settings'`) is derived from the active session's surface. When no session is active (New Conversation page), `activeView` is irrelevant; the page itself presents Chat / Code choices.

### 5.5 Settings

1. User clicks the floating avatar button.
2. Menu opens with "Settings" item.
3. Clicking "Settings" calls `useUiStore.getState().setActiveView('settings')`.
4. `AppLayout` renders the existing full-screen `SettingsPage` overlay.

## 6. UI Details

### 6.1 Title bar

- Height: 40px (same as today to accommodate tabs).
- Background: `var(--glass-bg)` with `backdrop-blur-xl`.
- Left: macOS traffic lights, followed by `SessionTabBar`.
- Right: connection status dot + label (moved from `ChatTitleBar`).

### 6.2 Session tabs

- Tab height: 32px, aligned to the bottom of the title bar.
- Min/max width: 130px / 180px.
- Active tab: `bg-surface` with top border-radius and a subtle top border.
- Inactive tab: transparent, `text-ink-tertiary`, hover lightens.
- Content order: surface icon (16px), session title (truncated), close "×" (shown on hover).
- Overflow: horizontal scroll within the tab bar (Phase 1). A dropdown overflow menu can be added later.

### 6.3 New Conversation page

- Rendered when `activeSessionId == null` (i.e. after closing the last tab or clicking "+").
- Centered layout with the Hip logo, heading "开始新会话", a segmented Chat/Code toggle, and an adaptive composer.
- **Surface toggle:** A two-segment control at the top of the page lets the user switch between Chat and Code before sending the first message.
- **Adaptive composer:**
  - Shared: model picker, attachment button, textarea, send button.
  - **Chat mode:** standard composer; no project folder required.
  - **Code mode:** additionally shows permission-mode picker and a project-folder picker row. The folder row displays the selected path or a "未选择项目文件夹" placeholder. Sending without a folder is blocked and surfaces a hint.
- On send, the app creates a session of the selected surface and routes the message through `sessionService.sendMessage` (or `createSession` + send) so the first message is committed in the new session.
- The newly created session immediately appears as a tab and the main area renders the active chat/code pane.
- **UX continuity:** This keeps the current "type first message to start" behavior while surfacing the surface choice more explicitly via the toggle.

### 6.4 Floating avatar button

- Position: fixed/absolute `left: 14px; bottom: 14px`.
- Size: 36px circle.
- Appearance: avatar image or initials, ring on hover.
- Menu items: Settings, divider, Logout.
- Trigger: click.

## 7. State Changes

### 7.1 `useUiStore`

- Remove `collapsed`, `sidebarWidth`, `settingsNavCollapsed`, `toggleCollapsed`, etc. that relate to the sidebar.
- Keep `chatSessionId`, `codeSessionId`, `activeView`.
- `activeView` continues to be `'chat' | 'code' | 'settings'`.
- When `activeView` is `'settings'`, the previous view is tracked as today so "Back" works.

### 7.2 Domain layer

- `sessionService.createSession(config)` is already available; pass `{ ...DEFAULT_CONFIG, surface: 'chat' | 'code' }`.
- `sessionService.selectSession(id)` is already available.
- `sessionService.deleteSession(id)` is already available.
- Consider adding `sessionService.closeSession(id)` if we later want to keep history. For Phase 1, use `deleteSession`.

## 8. Error Handling

- Creating a session can fail (sidecar error). Surface the error in the New Conversation page or via a toast; do not leave the user on a broken tab.
- Closing the last tab returns to `NewConversation`; no error state.
- Settings overlay behavior is unchanged.

## 9. i18n

Add or update keys in the existing flat `translation` namespace (see `src/i18n/zh-CN.ts`).

```ts
{
  chat: {
    newConversationGreeting: '开始新会话',
    codeNeedFolder: '选择一个项目文件夹以开始编码',
  },
  nav: {
    newSession: '新建会话',
  },
  account: {
    settings: '设置',
    logout: '退出登录',
  }
}
```

The Chat/Code toggle labels reuse existing `nav.chat` / `nav.code` keys. Synchronize any new keys across `zh-CN.ts`, `zh-TW.ts`, and `en.ts`.

## 10. Testing Plan

| Test | What it verifies |
|------|------------------|
| `SessionTabBar.test.tsx` | Renders one tab per open session; active tab highlighted; clicking switches session; close button deletes session. |
| `SessionTab.test.tsx` | Shows icon + title + close; hover shows close; active styling. |
| `NewConversation.test.tsx` | Renders Chat / Code cards; clicking creates a session and activates it. |
| `FloatingAvatarButton.test.tsx` | Click opens menu; Settings item sets active view to settings; Logout item calls logout. |
| `AppLayout.test.tsx` | No sidebar panels rendered; shows NewConversation when no active session; shows chat pane when session active; settings overlay still works. |
| e2e smoke | Open app, create chat session, see tab, close tab, return to New Conversation. |

## 11. Out of Scope

- Scheduled tasks page/placeholder.
- Session history / recently closed sessions.
- Tab reordering (drag and drop).
- Tab overflow dropdown menu (Phase 1 uses horizontal scroll).
- Pinned / favorite sessions.
- Multiple windows or tab persistence across app restarts.
- Changes to the sidecar session model beyond reusing existing create/select/delete APIs.

## 12. Migration Notes

- The `SessionManagementPage` design (`2026-07-04-session-management-page-design.md`) placed a "查看全部会话" entry in the sidebar. Because the sidebar is removed, that entry point is obsolete. The `SessionsDialog` component may be deleted or kept in `components/sessions/` for a future history manager.
- `MenuRail` and `RailButton` are no longer referenced and should be removed.
- Sidebar collapse state in `useUiStore` should be removed; any persisted keys that are no longer used should be cleaned up.
