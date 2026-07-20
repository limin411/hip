/**
 * Terminal Management surface flag.
 * When false, `activeView: 'terminals'` stays on PlaceholderPage.
 * AppLayout starts the PTY/terminal bridge when CODE_TERMINAL || TERMINAL_MANAGEMENT.
 * Flipped true for dogfood of local managed terminals (PR3).
 */
export const TERMINAL_MANAGEMENT = true
