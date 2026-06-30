export class ChatPage {
  get newConversation() { return browser.$('[data-testid="new-conversation"]') }
  get composerTextarea() { return browser.$('[data-testid="new-conversation"] textarea') }
  get composerSend() { return browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]') }
  get sessionItems() { return browser.$$('[data-testid="session-item"]') }

  // ── slash command palette ──
  get slashPalette() { return browser.$('[data-testid="slash-palette"]') }
  slashCmd(name: string) { return browser.$(`[data-testid="slash-cmd-${name}"]`) }
  /** Active textarea in the chat view — works for both new-conversation and existing sessions. */
  get activeTextarea() { return browser.$('textarea') }
}
