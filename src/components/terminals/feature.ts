/**
 * Terminal Management surface flag.
 * When false, `activeView: 'terminals'` stays on PlaceholderPage.
 * AppLayout starts the PTY/terminal bridge when CODE_TERMINAL || TERMINAL_MANAGEMENT.
 * Default true for release (PR7); kill-switch restores PlaceholderPage without auto-killing sessions.
 */
export const TERMINAL_MANAGEMENT = true
