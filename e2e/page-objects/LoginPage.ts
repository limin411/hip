export class LoginPage {
  get heading() { return browser.$('h1') }
  get skipButton() { return browser.$('button=跳过登录') }

  async skipIfPresent(): Promise<void> {
    const skip = await this.skipButton
    if (await skip.isExisting()) await skip.click()
  }
}
