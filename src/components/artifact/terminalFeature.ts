/**
 * Feature switch for the code-surface right-panel Terminal tab.
 * No hipConfig schema. Set false to dark-launch rollback.
 *
 * Scope: code surface + committed session only; login shell (`$SHELL -il`);
 * no OS sandbox; Windows shows the tab but open fails with an in-panel error.
 */
export const CODE_TERMINAL = true
