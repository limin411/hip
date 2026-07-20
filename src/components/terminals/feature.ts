/**
 * Feature switch for the dedicated Terminal Management surface
 * (`activeView: 'terminals'`, host library, managed local/SSH).
 *
 * Default false until first dogfood ship of user-visible managed terminals.
 * Kill-switch restores PlaceholderPage without auto-killing native sessions.
 *
 * See docs/design/2026-07-20-terminal-management.md (K12).
 */
export const TERMINAL_MANAGEMENT = false
