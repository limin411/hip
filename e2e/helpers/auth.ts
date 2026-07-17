/** Login was removed; always lands on the main app. Kept as a shared entry helper. */
export async function skipLoginIfPresent(): Promise<void> {
  await browser.waitUntil(
    async () => (await browser.getUrl()).includes('#/app'),
    { timeout: 30000, interval: 200 }
  )
}
