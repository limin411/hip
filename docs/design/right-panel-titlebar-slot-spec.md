# Right-panel Titlebar Slot Spec

> Status: **accepted · stage gate for terminal-agent-panel-spec-v2 §3.3/§17.2** · 2026-08-02
> Scope: shared right-rail titlebar chrome (`[Context Slot | Tab▾ | Collapse]`) for Code / Chat / Knowledge / Terminals.

## 1. Skeleton

Every right rail body owns a titlebar row (`h-[var(--titlebar-height)]`, `border-b`, drag region):

```
[ Context Slot (flex-1) | Tab▾ (right dropdown) | Collapse (right-most icon) ]
```

- **Context Slot**: left identity + ≤2 tab-contextual actions (copy / refresh / stop…).
- **Tab▾**: `PanelTabBar` dropdown showing the current page label + chevron; the menu lists all visible tabs for the current surface.
- **Collapse**: `PanelToggle slot="panel"` one-click collapse icon (`PanelRightClose`).

## 2. Surfaces

| Surface | Context Slot identity | Tabs (Tab▾) | Actions (≤2) |
|---------|----------------------|-------------|---------------|
| Code | Preview path basename / cwd | outline · files · changes · terminal (gated) | copy / download / restart / close |
| Chat | Artifact name / outline / sources count | outline · files · sources | copy / download |
| Knowledge | Doc outline identity | outline (single) | — |
| Terminals · files | Remote path basename or host short name (local: cwd basename) | files · agent (SSH only) | refresh tree |
| Terminals · agent | Agent display name (+ optional `· 运行中` when streaming) | files · agent (SSH only) | Stop turn (streaming) |

## 3. PanelTabBar

- Extend `PanelTabBar` with `surface: 'code' | 'chat' | 'terminals'`.
- `surface="terminals"` resolves the active tab from `uiStore.activeTerminalPanelTab[focusedId]` (`'files' | 'agent'`).
- SSH rows: both tabs visible. **Local rows: no Tab▾** (single files tab; titlebar stays `[Context Slot | Collapse]`).
- The menu items use `terminals.panel.tab.files` / `terminals.panel.tab.agent` i18n keys.

## 4. PanelToggle

- Expanded: unchanged one-click collapse.
- Collapsed toolbar menu, Terminals branch: `Files` and (SSH only) `Agent` items. Selecting opens the rail onto that tab.
- When no managed terminal is focused, the Terminals branch is absent (HostLibrary landing).

## 5. Local rule

Local managed terminals (`kind === 'local'`) have no Agent tab and no session tree:

- `activeTerminalPanelTab` for a local terminal is ignored/always `'files'`.
- `PanelTabBar surface="terminals"` renders no trigger for local terminals.
- `PanelToggle` Terminals branch shows only `Files`.

## 6. Interaction scope

This document defines only the titlebar chrome. Tab switching behavior, session focus rules, and the Agent panel body are owned by `terminal-agent-panel-spec-v2.md` (§3.2/§3.3/§3.5). No new product surface is introduced here.
