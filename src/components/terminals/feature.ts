/**
 * Feature switch for the Terminal Management product surface (activeView: 'terminals').
 * Default false until dogfood of the first user-visible managed-terminals PR.
 * When false, AppLayout keeps PlaceholderPage for terminals; native sessions are not auto-killed.
 *
 * Bridge start is OR'd with CODE_TERMINAL so either flag can own store-only pty/ssh events.
 */
export const TERMINAL_MANAGEMENT = false
