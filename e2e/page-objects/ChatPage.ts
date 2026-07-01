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

  // ── new getters ──
  get messageBubbles() { return browser.$$('[data-message-id]') }
  messageBubble(index: number) { return browser.$(`(//*[@data-message-id])[${index + 1}]`) }
  get lastMessageText() { return browser.$('(//*[@data-message-id])[last()]') }
  get jumpToLatest() { return browser.$('[data-testid="jump-to-latest"]') }
  get chatError() { return browser.$('[data-testid="chat-error"]') }
  get chatErrorRetry() { return browser.$('[data-testid="chat-error-retry"]') }
  get chatInterrupt() { return browser.$('[data-testid="chat-interrupt"]') }
  get composerStop() { return browser.$('[data-testid="composer-stop"]') }
  get attachmentButton() { return browser.$('[data-testid="attachment-button"]') }
  get attachmentChips() { return browser.$$('[data-testid="attachment-chip"]') }
  get modelChip() { return browser.$('[data-testid="model-chip"]') }
  get permissionChip() { return browser.$('[data-testid="permission-chip"]') }
  get planApprovalCard() { return browser.$('[data-testid="plan-approval-card"]') }
  get planApprove() { return browser.$('[data-testid="plan-approve"]') }
  get planAmend() { return browser.$('[data-testid="plan-amend"]') }
  get planReject() { return browser.$('[data-testid="plan-reject"]') }
  get permissionModal() { return browser.$('[data-testid="permission-modal"]') }
  permissionOption(id: string) { return browser.$(`[data-testid="permission-option-${id}"]`) }

  // ── title bar / usage ──
  get sessionUsage() { return browser.$('[data-testid="session-usage"]') }
  get messageUsage() { return browser.$('[data-testid="message-usage"]') }
  get messageTime() { return browser.$('[data-testid="message-time"]') }

  // ── surface tabs ──
  get surfaceTabChat() { return browser.$('[data-testid="surface-tab-chat"]') }
  get surfaceTabCode() { return browser.$('[data-testid="surface-tab-code"]') }
  get surfaceTabDomain() { return browser.$('[data-testid="surface-tab-domain"]') }

  // ── attachment removal ──
  get attachmentRemove() { return browser.$('[data-testid="attachment-remove"]') }
}
