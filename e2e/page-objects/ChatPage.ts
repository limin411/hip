export class ChatPage {
  get newConversation() { return browser.$('[data-testid="new-conversation"]') }
  get composerTextarea() { return browser.$('[data-testid="new-conversation"] textarea') }
  get composerSend() { return browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]') }
  get sessionItems() { return browser.$$('[data-testid="session-item"]') }
}
