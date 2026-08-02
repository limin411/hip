// Smoothness P3: annotation outbound (unpaid).
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')

describe('smooth P3 @smooth-p3 @harness @panel', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
  })

  it('P3-G2 outbound user content includes hip.diff_annotations', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    const outbound = await browser.execute((id: string) => {
      const hooks = (window as unknown as {
        __hipE2E?: {
          seedDiffAnnotation?: (
            s: string,
            a: { path: string; body: string; note?: string },
          ) => string
          sendWithPendingAnnotations?: (s: string, text: string) => void
          getLastOutboundUserContent?: () => string | null
        }
      }).__hipE2E
      if (!hooks?.seedDiffAnnotation || !hooks.sendWithPendingAnnotations) {
        throw new Error('annotation e2e hooks missing')
      }
      hooks.seedDiffAnnotation(id, {
        path: 'src/a.ts',
        body: '@@ -1 +1 @@\n-old\n+new',
        note: 'prefer rename',
      })
      hooks.sendWithPendingAnnotations(id, 'please apply the review notes')
      return hooks.getLastOutboundUserContent?.() ?? null
    }, sessionId)

    expect(outbound).toBeTruthy()
    expect(outbound!).toContain('hip.diff_annotations')
    expect(outbound!).toContain('src/a.ts')
    expect(outbound!).toContain('please apply the review notes')
    expect(outbound!).toContain('prefer rename')
  })
})
